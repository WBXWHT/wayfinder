import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ExperienceMapPanel } from "./experienceMapPanel";
import { installHostHooks } from "./hostInstaller";
import { configureProjectForHooks } from "./hookInstaller";
import { AgentHost, TimelineNode } from "./models";
import { ShadowRepo } from "./shadowRepo";
import {
  clip,
  createId,
  ensureProjectState,
  latestNodeOnBranch,
  mutateProjectState,
  projectDataDir,
  readProjectConfig,
  readProjectState,
  writeProjectConfig
} from "./storage";
import { TimelineViewProvider } from "./timelineView";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return;
  }
  await ensureProjectState(root);

  const refreshTargets: Array<{ refresh(): Promise<void> }> = [];
  let restoreInFlight = false;
  const refreshAll = async (): Promise<void> => {
    await Promise.all(refreshTargets.map((target) => target.refresh()));
  };
  const connectHosts = async (): Promise<void> => {
    const hosts = await chooseHosts();
    if (!hosts?.length) {
      return;
    }
    const prepared = await configureProjectForHooks(root);
    const cliPath = path.join(context.extensionPath, "out", "cli.js");
    for (const host of hosts) {
      await installHostHooks(root, host, cliPath, {
        stopTimeout: prepared.validationTimeoutSeconds + 60
      });
    }
    const labels = hosts.map(hostLabel).join("、");
    const validation = prepared.validationCommand
      ? `；验证命令：${prepared.validationCommand}`
      : "；未启用自动验证";
    await vscode.window.showInformationMessage(
      `Wayfinder 已连接 ${labels}${validation}。航海图保留在当前 IDE 侧栏。`
    );
    await refreshAll();
  };
  const setVerdict = async (
    nodeId: string,
    verdict?: "success" | "failure"
  ): Promise<void> => {
    await mutateProjectState(root, (state) => {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (node) {
        node.verdict = verdict;
      }
    });
    await refreshAll();
  };
  const setNote = async (nodeId: string): Promise<void> => {
    const state = await readProjectState(root);
    const node = state?.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }
    const value = await vscode.window.showInputBox({
      title: "记录这条路径留下的经验",
      prompt: "一句话即可，之后可以作为下一次任务的约束",
      value: node.note || "",
      placeHolder: "例如：保留现有鉴权结构，只修改回调逻辑"
    });
    if (value === undefined) {
      return;
    }
    await mutateProjectState(root, (latest) => {
      const target = latest.nodes.find((item) => item.id === nodeId);
      if (target) {
        target.note = value.trim() || undefined;
      }
    });
    await refreshAll();
  };
  const restoreNode = async (nodeId: string): Promise<void> => {
    if (restoreInFlight) {
      await vscode.window.showInformationMessage(
        "Wayfinder 正在恢复文件，请稍候。"
      );
      return;
    }
    restoreInFlight = true;
    try {
      await restoreFromNode(root, nodeId);
      await refreshAll();
    } finally {
      restoreInFlight = false;
    }
  };

  const mapPanel = new ExperienceMapPanel(context.extensionUri, root, {
    setVerdict,
    setNote,
    openDiff: (nodeId) => openNodeDiff(root, nodeId),
    restore: restoreNode
  });
  const provider = new TimelineViewProvider(
    context.extensionUri,
    root,
    {
      installHooks: connectHosts,
      openMap: async (treeId) => mapPanel.show(treeId),
      refresh: refreshAll,
      setVerdict,
      setNote,
      openDiff: async (nodeId) => openNodeDiff(root, nodeId),
      restore: restoreNode,
      configureValidation: async () => {
        await configureValidation(root);
        await refreshAll();
      }
    }
  );
  refreshTargets.push(provider, mapPanel);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("wayfinder.timeline", provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      "wayfinder-snapshot",
      new SnapshotContentProvider(root)
    ),
    vscode.commands.registerCommand("wayfinder.installHooks", connectHosts),
    vscode.commands.registerCommand("wayfinder.captureCheckpoint", async () => {
      await captureManualCheckpoint(root);
      await refreshAll();
    }),
    vscode.commands.registerCommand("wayfinder.configureValidation", async () => {
      await configureValidation(root);
      await refreshAll();
    }),
    vscode.commands.registerCommand("wayfinder.refresh", refreshAll),
    vscode.commands.registerCommand("wayfinder.openMap", () => mapPanel.show()),
    vscode.commands.registerCommand("wayfinder.openDataFolder", async () => {
      await vscode.commands.executeCommand(
        "revealFileInOS",
        vscode.Uri.file(projectDataDir(root))
      );
    })
  );

  const watcher = watchTimeline(root, () => void refreshAll());
  context.subscriptions.push({ dispose: () => watcher.close() });
  context.subscriptions.push(mapPanel);
  await refreshAll();

  if (process.env.WAYFINDER_E2E === "1") {
    setTimeout(() => {
      void vscode.commands.executeCommand("workbench.view.extension.wayfinder");
    }, 500);
  }
}

export function deactivate(): void {}

const HOST_ITEMS: Array<vscode.QuickPickItem & { host: AgentHost }> = [
  {
    host: "trae",
    label: "TraeCode",
    description: ".trae/hooks.json"
  },
  {
    host: "claude",
    label: "Claude Code",
    description: ".claude/settings.json"
  },
  {
    host: "codex",
    label: "Codex",
    description: ".codex/hooks.json"
  }
];

async function chooseHosts(): Promise<AgentHost[] | undefined> {
  const detected = detectHosts();
  if (detected.length === 1) {
    return detected;
  }
  const picks = await vscode.window.showQuickPick(
    HOST_ITEMS.map((item) => ({
      ...item,
      picked: detected.includes(item.host)
    })),
    {
      canPickMany: true,
      title: "连接 Wayfinder 采集器",
      placeHolder: "选择在当前项目中使用的 AI 工具"
    }
  );
  return picks?.map((item) => item.host);
}

function detectHosts(): AgentHost[] {
  const appName = vscode.env.appName.toLocaleLowerCase();
  const extensions = vscode.extensions.all.map((extension) =>
    [
      extension.id,
      extension.packageJSON?.displayName,
      extension.packageJSON?.name
    ].filter(Boolean).join(" ").toLocaleLowerCase()
  );
  const hosts: AgentHost[] = [];
  if (appName.includes("trae")) {
    hosts.push("trae");
  }
  if (extensions.some((value) => value.includes("anthropic") ||
    value.includes("claude code"))) {
    hosts.push("claude");
  }
  if (extensions.some((value) => value.includes("openai.chatgpt") ||
    value.includes("codex"))) {
    hosts.push("codex");
  }
  return hosts;
}

function hostLabel(host: AgentHost): string {
  return host === "trae"
    ? "TraeCode"
    : host === "claude"
      ? "Claude Code"
      : "Codex";
}

class SnapshotContentProvider
  implements vscode.TextDocumentContentProvider
{
  constructor(private readonly root: string) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const commit = params.get("commit");
    const relPath = params.get("path");
    if (!commit || !relPath) {
      return "";
    }
    const config = await readProjectConfig(this.root);
    const content = await new ShadowRepo(
      this.root,
      config.maxFileSizeMB
    ).fileAt(commit, relPath);
    return content?.toString("utf8") || "";
  }
}

async function openNodeDiff(root: string, nodeId: string): Promise<void> {
  const state = await readProjectState(root);
  const node = state?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return;
  }
  if (node.files.length === 0) {
    await vscode.window.showInformationMessage("这一轮没有文件变化。");
    return;
  }

  let selected = node.files[0];
  if (node.files.length > 1) {
    const picked = await vscode.window.showQuickPick(
      node.files.map((file) => ({
        label: path.basename(file.path),
        description: file.previousPath
          ? `${file.previousPath} → ${file.path}`
          : file.path,
        detail: file.lineCountsKnown === false
          ? "变更行数未知"
          : `+${file.additions}  -${file.deletions}`,
        file
      })),
      {
        title: clip(node.prompt, 80),
        placeHolder: "选择要查看的文件"
      }
    );
    if (!picked) {
      return;
    }
    selected = picked.file;
  }
  if (selected.binary) {
    await vscode.window.showInformationMessage("二进制文件不提供文本 Diff。");
    return;
  }

  const before = snapshotUri(
    node.snapshotBefore,
    selected.previousPath || selected.path,
    "before"
  );
  const after = snapshotUri(node.snapshotAfter, selected.path, "after");
  await vscode.commands.executeCommand(
    "vscode.diff",
    before,
    after,
    `${selected.path} · ${clip(node.prompt, 48)}`
  );
}

async function captureManualCheckpoint(root: string): Promise<void> {
  const config = await readProjectConfig(root);
  const shadow = new ShadowRepo(root, config.maxFileSizeMB);
  let changed = false;

  await mutateProjectState(root, async (state) => {
    const parent = latestNodeOnBranch(state);
    const id = createId("manual");
    const snapshot = await shadow.capture(
      id,
      "Manual checkpoint",
      parent?.snapshotAfter
    );
    if (!snapshot.changed && parent) {
      return;
    }
    const files = parent
      ? await shadow.diffFiles(parent.snapshotAfter, snapshot.commit)
      : [];
    const now = new Date().toISOString();
    state.nodes.push({
      id,
      kind: "manual",
      sessionId: "manual",
      branchId: state.activeBranchId,
      parentId: parent?.id,
      prompt: "Manual checkpoint",
      startedAt: now,
      completedAt: now,
      snapshotBefore: parent?.snapshotAfter || snapshot.commit,
      snapshotAfter: snapshot.commit,
      files,
      actions: [],
      validation: { status: "skipped" }
    });
    changed = true;
  });

  await vscode.window.showInformationMessage(
    changed ? "已保存当前状态。" : "当前状态没有变化。"
  );
}

export async function restoreFromNode(
  root: string,
  nodeId: string
): Promise<void> {
  const state = await readProjectState(root);
  const target = state?.nodes.find((item) => item.id === nodeId);
  if (!state || !target) {
    return;
  }
  if (
    Object.keys(state.pending).length > 0 ||
    state.nodes.some((node) => node.validation.status === "running")
  ) {
    await vscode.window.showWarningMessage(
      "AI 正在执行任务，完成后才能恢复历史节点。"
    );
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `恢复到“${clip(target.prompt, 42)}”完成后的文件状态？当前路径会保留。此操作不会回退 AI 工具的聊天上下文，恢复后请新建对话继续。`,
    { modal: true },
    "从这里重来"
  );
  if (choice !== "从这里重来") {
    return;
  }

  const expectedBranchId = state.activeBranchId;
  const expectedLatestId = latestNodeOnBranch(state)?.id;
  const config = await readProjectConfig(root);
  const shadow = new ShadowRepo(root, config.maxFileSizeMB);
  const safetyId = createId("before-restore");
  let rollback:
    | { target: string; restoredFrom: string }
    | undefined;

  try {
    await mutateProjectState(root, async (current) => {
      if (
        Object.keys(current.pending).length > 0 ||
        current.nodes.some((node) => node.validation.status === "running")
      ) {
        throw new Error("AI 工具已开始新的任务，本次恢复已取消。");
      }
      const latest = latestNodeOnBranch(current);
      if (
        current.activeBranchId !== expectedBranchId ||
        latest?.id !== expectedLatestId
      ) {
        throw new Error("项目路径已发生变化，本次恢复已取消。");
      }
      const currentTarget = current.nodes.find((item) => item.id === nodeId);
      if (!currentTarget) {
        throw new Error("目标节点已不存在，本次恢复已取消。");
      }
      const safety = await shadow.capture(
        safetyId,
        "Before restore",
        latest?.snapshotAfter
      );
      let parent = latest;
      if (safety.changed && parent) {
        const now = new Date().toISOString();
        const files = await shadow.diffFiles(parent.snapshotAfter, safety.commit);
        const safetyNode: TimelineNode = {
          id: safetyId,
          kind: "safety",
          sessionId: "restore",
          branchId: current.activeBranchId,
          parentId: parent.id,
          prompt: "回退前现场",
          startedAt: now,
          completedAt: now,
          snapshotBefore: parent.snapshotAfter,
          snapshotAfter: safety.commit,
          files,
          actions: [],
          validation: { status: "skipped" }
        };
        current.nodes.push(safetyNode);
        parent = safetyNode;
      }

      await shadow.restore(currentTarget.snapshotAfter, safety.commit);
      rollback = {
        target: safety.commit,
        restoredFrom: currentTarget.snapshotAfter
      };
      const branchNumber = current.branches.length + 1;
      const branchId = createId("branch");
      current.branches.push({
        id: branchId,
        name: `path ${branchNumber}`,
        parentNodeId: currentTarget.id,
        createdAt: new Date().toISOString()
      });
      current.activeBranchId = branchId;
      void parent;
    });
    rollback = undefined;
  } catch (error) {
    if (rollback) {
      try {
        await shadow.restore(rollback.target, rollback.restoredFrom);
        await shadow.deleteRef(safetyId);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "恢复状态写入失败，且无法还原工作区"
        );
      }
    }
    throw error;
  }

  await vscode.window.showInformationMessage(
    "文件已恢复并创建新路径。请新建 AI 对话继续；原路径仍可查看。"
  );
}

async function configureValidation(root: string): Promise<void> {
  const config = await readProjectConfig(root);
  const value = await vscode.window.showInputBox({
    title: "每轮完成后的验证命令",
    prompt: "留空表示不自动验证",
    value: config.validationCommand || "",
    placeHolder: "例如 npm test、npm run build 或 pytest"
  });
  if (value === undefined) {
    return;
  }
  config.validationCommand = value.trim();
  await writeProjectConfig(root, config);
  await vscode.workspace
    .getConfiguration("wayfinder")
    .update(
      "validationCommand",
      config.validationCommand,
      vscode.ConfigurationTarget.Workspace
    );
}

function snapshotUri(
  commit: string,
  relPath: string,
  side: "before" | "after"
): vscode.Uri {
  return vscode.Uri.from({
    scheme: "wayfinder-snapshot",
    path: `/${side}/${path.basename(relPath)}`,
    query: new URLSearchParams({ commit, path: relPath }).toString()
  });
}

function watchTimeline(root: string, refresh: () => void): fs.FSWatcher {
  const directory = projectDataDir(root);
  fs.mkdirSync(directory, { recursive: true });
  let timer: NodeJS.Timeout | undefined;
  return fs.watch(directory, (_event, filename) => {
    if (filename !== "timeline.json" && filename !== "hook-errors.log") {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(refresh, 120);
  });
}
