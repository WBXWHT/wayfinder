import { exec, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  AgentHost,
  HookPayload,
  PendingTurn,
  ProjectConfig,
  TimelineNode,
  ToolAction,
  ValidationResult
} from "./models";
import { ShadowRepo } from "./shadowRepo";
import {
  clip,
  clipText,
  commitTempFile,
  createId,
  latestNodeOnBranch,
  mutateProjectState,
  normalizeRoot,
  projectDataDir,
  readProjectConfig,
  readProjectState,
  wayfinderHome,
  writeProjectConfig
} from "./storage";
import { readLastAssistantMessage } from "./transcript";

export async function processHookEvent(payload: HookPayload): Promise<void> {
  const root = resolveRoot(payload);
  if (!root || !payload.hook_event_name) {
    return;
  }

  switch (payload.hook_event_name) {
    case "SessionStart":
      await onSessionLifecycle(root, payload, "active");
      break;
    case "UserPromptSubmit":
      await onPrompt(root, payload);
      break;
    case "PostToolUse":
      await onTool(root, payload);
      break;
    case "PostToolUseFailure":
      await onTool(root, payload, true);
      break;
    case "Stop":
      await onStop(root, payload);
      break;
    case "SessionEnd":
      await onSessionLifecycle(root, payload, "ended");
      openCompanion();
      break;
    default:
      break;
  }
}

async function onSessionLifecycle(
  root: string,
  payload: HookPayload,
  status: "active" | "ended"
): Promise<void> {
  const home = wayfinderHome();
  const file = path.join(home, "activity.json");
  const temp = `${file}.${process.pid}.${createId("activity")}.tmp`;
  await fs.promises.mkdir(home, { recursive: true });
  try {
    await fs.promises.writeFile(temp, `${JSON.stringify({
      status,
      root,
      sourceHost: hostFor(payload),
      sessionId: payload.session_id || "unknown",
      updatedAt: new Date().toISOString()
    }, null, 2)}\n`, "utf8");
    await commitTempFile(temp, file);
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
  }
}

function openCompanion(): void {
  if (process.platform !== "darwin") {
    return;
  }
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = process.execPath.indexOf(marker);
  const configured = process.env.WAYFINDER_COMPANION_APP;
  const appPath = configured ||
    (markerIndex >= 0 ? process.execPath.slice(0, markerIndex) : undefined);
  if (!appPath?.endsWith(".app") || !fs.existsSync(appPath)) {
    return;
  }
  const child = spawn("/usr/bin/open", [appPath], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function onPrompt(root: string, payload: HookPayload): Promise<void> {
  const prompt = clipText(payload.prompt, 4_000);
  const host = hostFor(payload);
  const sessionId = scopedSessionId(host, payload.session_id);
  if (!prompt) {
    return;
  }

  const config = await readProjectConfig(root);
  const shadow = new ShadowRepo(root, config.maxFileSizeMB);
  await mutateProjectState(root, async (state) => {
    let parent = latestNodeOnBranch(state);
    const preId = createId(`pending-${safePart(sessionId)}`);
    const preSnapshot = await shadow.capture(
      preId,
      `Before: ${clip(prompt, 80)}`,
      parent?.snapshotAfter
    );

    if (!parent) {
      const now = new Date().toISOString();
      const initialNode: TimelineNode = {
        id: createId("initial"),
        kind: "manual",
        sessionId: "initial",
        sourceHost: host,
        branchId: state.activeBranchId,
        prompt: "初始状态",
        startedAt: now,
        completedAt: now,
        snapshotBefore: preSnapshot.commit,
        snapshotAfter: preSnapshot.commit,
        files: [],
        actions: [],
        validation: { status: "skipped" }
      };
      state.nodes.push(initialNode);
      parent = initialNode;
    } else if (preSnapshot.changed) {
      const manualId = createId("manual");
      const files = await shadow.diffFiles(
        parent.snapshotAfter,
        preSnapshot.commit
      );
      const manualNode: TimelineNode = {
        id: manualId,
        kind: "manual",
        sessionId,
        sourceHost: host,
        branchId: state.activeBranchId,
        parentId: parent.id,
        prompt: "Manual changes",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        snapshotBefore: parent.snapshotAfter,
        snapshotAfter: preSnapshot.commit,
        files,
        actions: [],
        validation: { status: "skipped" }
      };
      state.nodes.push(manualNode);
      parent = manualNode;
    }

    const pending: PendingTurn = {
      sessionId,
      turnId: payload.turn_id,
      sourceHost: host,
      branchId: state.activeBranchId,
      parentId: parent?.id,
      prompt,
      startedAt: new Date().toISOString(),
      snapshotBefore: preSnapshot.commit,
      actions: []
    };
    state.pending[sessionId] = pending;
  });
}

async function onTool(
  root: string,
  payload: HookPayload,
  failedByEvent = false
): Promise<void> {
  const sessionId = scopedSessionId(hostFor(payload), payload.session_id);
  await mutateProjectState(root, (state) => {
    const pending = state.pending[sessionId];
    if (!pending) {
      return;
    }
    const action = toAction(payload, failedByEvent);
    if (
      action.id &&
      pending.actions.some((existing) => existing.id === action.id)
    ) {
      return;
    }
    pending.actions.push(action);
  });
}

async function onStop(root: string, payload: HookPayload): Promise<void> {
  const host = hostFor(payload);
  const sessionId = scopedSessionId(host, payload.session_id);
  const response = clipText(
    payload.last_assistant_message ||
      await readLastAssistantMessage(payload.transcript_path),
    4_000
  );
  const config = await ensureValidationConfig(root);
  const shadow = new ShadowRepo(root, config.maxFileSizeMB);
  let nodeId = createId("turn");
  let foundPending = false;
  let captureError: unknown;
  let files: TimelineNode["files"] = [];
  let recorded = false;
  await mutateProjectState(root, async (state) => {
    const pending = state.pending[sessionId];
    if (!pending) {
      return;
    }
    foundPending = true;
    const existing = pending.turnId
      ? state.nodes.find((node) =>
          node.turnId === pending.turnId &&
          node.sourceHost === host &&
          node.sessionId === sessionId
        )
      : undefined;
    if (existing) {
      nodeId = existing.id;
    }
    try {
      const snapshot = await shadow.capture(
        nodeId,
        `${hostLabel(host)}: ${clip(pending.prompt, 80)}`,
        pending.snapshotBefore
      );
      files = await shadow.diffFiles(
        pending.snapshotBefore,
        snapshot.commit
      );
      const completedAt = new Date().toISOString();
      if (existing) {
        existing.response = response || existing.response;
        existing.startedAt =
          pending.startedAt < existing.startedAt
            ? pending.startedAt
            : existing.startedAt;
        existing.completedAt =
          completedAt > existing.completedAt
            ? completedAt
            : existing.completedAt;
        existing.snapshotBefore = pending.snapshotBefore;
        existing.snapshotAfter = snapshot.commit;
        existing.files = files.length > 0 ? files : existing.files;
        existing.actions = mergeToolActions(
          existing.actions,
          pending.actions
        );
        existing.validation = existing.files.length > 0
          ? { command: config.validationCommand, status: "running" }
          : { command: config.validationCommand, status: "skipped" };
        files = existing.files;
      } else {
        const node: TimelineNode = {
          id: nodeId,
          kind: "turn",
          sessionId,
          turnId: pending.turnId,
          sourceHost: host,
          branchId: pending.branchId,
          parentId: pending.parentId,
          prompt: pending.prompt,
          response,
          startedAt: pending.startedAt,
          completedAt,
          snapshotBefore: pending.snapshotBefore,
          snapshotAfter: snapshot.commit,
          files,
          actions: pending.actions,
          validation: files.length > 0
            ? { command: config.validationCommand, status: "running" }
            : { command: config.validationCommand, status: "skipped" }
        };
        state.nodes.push(node);
      }
      delete state.pending[sessionId];
      recorded = true;
    } catch (error) {
      captureError = error;
      const failedValidation = {
        command: config.validationCommand,
        status: "failed" as const,
        summary: `本轮记录失败，文件变化未归档：${String(error)}`
      };
      if (existing) {
        existing.response = response || existing.response;
        existing.actions = mergeToolActions(
          existing.actions,
          pending.actions
        );
        existing.validation = failedValidation;
      } else {
        state.nodes.push({
          id: nodeId,
          kind: "turn",
          sessionId,
          turnId: pending.turnId,
          sourceHost: host,
          branchId: pending.branchId,
          parentId: pending.parentId,
          prompt: pending.prompt,
          response,
          startedAt: pending.startedAt,
          completedAt: new Date().toISOString(),
          snapshotBefore: pending.snapshotBefore,
          snapshotAfter: pending.snapshotBefore,
          files: [],
          actions: pending.actions,
          validation: failedValidation
        });
      }
      delete state.pending[sessionId];
    }
  });
  if (!foundPending) {
    return;
  }
  if (captureError) {
    throw captureError;
  }

  try {
    const validation = await validateTurn(root, config, files.length > 0);
    await mutateProjectState(root, (state) => {
      const current = state.nodes.find((item) => item.id === nodeId);
      if (current) {
        current.validation = validation;
      }
    });
  } catch (error) {
    if (recorded) {
      await mutateProjectState(root, (state) => {
        const current = state.nodes.find((item) => item.id === nodeId);
        if (current) {
          current.validation = {
            command: config.validationCommand,
            status: "failed",
            summary: `验证未完成：${String(error)}`
          };
        }
      }).catch(() => undefined);
    }
    throw error;
  }
}

function mergeToolActions(
  existing: ToolAction[],
  incoming: ToolAction[]
): ToolAction[] {
  const merged = existing.map((action) => ({ ...action }));
  const matched = new Set<number>();
  for (const action of incoming) {
    const currentIndex = merged.findIndex((candidate, index) =>
      !matched.has(index) &&
      (
        (
          action.id &&
          candidate.id &&
          action.id === candidate.id
        ) ||
        (
          action.tool === candidate.tool &&
          action.kind === candidate.kind &&
          action.path === candidate.path &&
          action.detail === candidate.detail
        )
      )
    );
    if (currentIndex >= 0) {
      matched.add(currentIndex);
      const current = merged[currentIndex];
      if (action.id) current.id = action.id;
      if (action.ok !== undefined) current.ok = action.ok;
      continue;
    }
    merged.push({ ...action });
  }
  return merged;
}

async function ensureValidationConfig(root: string): Promise<ProjectConfig> {
  const config = await readProjectConfig(root);
  if (config.validationCommand !== undefined) {
    return config;
  }
  config.validationCommand = await detectValidationCommand(root);
  await writeProjectConfig(root, config);
  return config;
}

export async function detectValidationCommand(
  root: string
): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(
      await fs.promises.readFile(path.join(root, "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts || {};
    if (
      scripts.test &&
      !/no test specified|exit 1/i.test(scripts.test)
    ) {
      return "npm test";
    }
    for (const name of ["typecheck", "build", "lint"]) {
      if (scripts[name]) {
        return `npm run ${name}`;
      }
    }
  } catch {
    // Continue with other project types.
  }
  if (fs.existsSync(path.join(root, "pyproject.toml"))) {
    return "pytest";
  }
  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    return "cargo check";
  }
  return undefined;
}

async function validateTurn(
  root: string,
  config: ProjectConfig,
  changed: boolean
): Promise<ValidationResult> {
  if (!changed) {
    return { command: config.validationCommand, status: "skipped" };
  }
  if (!config.validationCommand) {
    return { status: "not-configured" };
  }

  const started = Date.now();
  return new Promise((resolve) => {
    exec(
      config.validationCommand!,
      {
        cwd: root,
        timeout: config.validationTimeoutSeconds * 1_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, CI: "1" }
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - started;
        const summary = summarizeCommandOutput(`${stdout}\n${stderr}`);
        if (!error) {
          resolve({
            command: config.validationCommand,
            status: "passed",
            exitCode: 0,
            durationMs,
            summary
          });
          return;
        }
        const timedOut =
          (error as NodeJS.ErrnoException & { killed?: boolean }).killed ||
          (error as NodeJS.ErrnoException).code === "ETIMEDOUT";
        resolve({
          command: config.validationCommand,
          status: timedOut ? "timeout" : "failed",
          exitCode:
            typeof (error as { code?: unknown }).code === "number"
              ? ((error as { code: number }).code)
              : undefined,
          durationMs,
          summary
        });
      }
    );
  });
}

function toAction(
  payload: HookPayload,
  failedByEvent = false
): ToolAction {
  const tool = payload.tool_name || payload.llm_tool_name || "Unknown";
  const input = payload.tool_input || {};
  const candidatePath = [
    input.file_path,
    input.path,
    input.target_file,
    input.filename
  ].find((value) => typeof value === "string") as string | undefined;
  const command =
    typeof input.command === "string"
      ? input.command
      : typeof input.cmd === "string"
        ? input.cmd
        : undefined;

  return {
    id: payload.tool_use_id,
    kind:
      tool === "Write"
        ? "write"
        : tool === "Edit" || tool === "apply_patch"
          ? "edit"
          : tool === "RunCommand" || tool === "Bash"
            ? "run"
            : "other",
    tool,
    path: candidatePath ? clip(candidatePath, 300) : undefined,
    detail: command ? clip(command, 300) : undefined,
    ok: !failedByEvent && !toolResponseFailed(payload.tool_response)
  };
}

function toolResponseFailed(value: unknown): boolean {
  if (typeof value === "string") {
    try {
      return toolResponseFailed(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const response = value as Record<string, unknown>;
  if (typeof response.success === "boolean") {
    return !response.success;
  }
  if (typeof response.ok === "boolean") {
    return !response.ok;
  }
  if (typeof response.is_error === "boolean") {
    return response.is_error;
  }
  const exitCode = [response.exit_code, response.exitCode, response.code]
    .find((candidate) => typeof candidate === "number");
  if (typeof exitCode === "number") {
    return exitCode !== 0;
  }
  if (
    typeof response.status === "string" &&
    ["error", "failed", "failure"].includes(response.status.toLowerCase())
  ) {
    return true;
  }
  return response.error !== undefined &&
    response.error !== null &&
    response.error !== false &&
    response.error !== "";
}

function hostFor(payload: HookPayload): AgentHost {
  const explicit = payload.wayfinder_host || process.env.WAYFINDER_HOST;
  return explicit === "claude" || explicit === "codex" ? explicit : "trae";
}

function scopedSessionId(
  host: AgentHost,
  sessionId: string | undefined
): string {
  const raw = sessionId || "unknown";
  return host === "trae" ? raw : `${host}:${raw}`;
}

function hostLabel(host: AgentHost): string {
  return host === "claude" ? "Claude" : host === "codex" ? "Codex" : "TRAE";
}

function resolveRoot(payload: HookPayload): string | undefined {
  const cwd = payload.cwd ? normalizeRoot(payload.cwd) : undefined;
  const roots = (payload.workspace_roots || [])
    .filter((root) => fs.existsSync(root))
    .map(normalizeRoot);
  const matchingRoot = roots.find(
    (root) =>
      cwd === root || Boolean(cwd?.startsWith(`${root}${path.sep}`))
  );
  const candidate = matchingRoot ||
    (cwd && fs.existsSync(cwd) ? cwd : roots[0]);
  if (!candidate || !fs.existsSync(candidate)) {
    return undefined;
  }
  return normalizeRoot(candidate);
}

function summarizeCommandOutput(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return undefined;
  }
  return clipText(lines.slice(-6).join("\n"), 1_000);
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runHookCli(
  requestedHost?: AgentHost
): Promise<void> {
  let root =
    process.env.WAYFINDER_PROJECT_DIR ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.TRAE_PROJECT_DIR ||
    process.cwd();
  const hookStartedAt = Date.now();
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      return;
    }
    const payload = JSON.parse(raw) as HookPayload;
    if (requestedHost) {
      payload.wayfinder_host = requestedHost;
    }
    const hostIndex = process.argv.indexOf("--host");
    if (hostIndex >= 0) {
      const requested = process.argv[hostIndex + 1];
      if (
        requested === "trae" ||
        requested === "claude" ||
        requested === "codex"
      ) {
        payload.wayfinder_host = requested;
      }
    }
    root = resolveRoot(payload) || root;
    const before =
      payload.hook_event_name === "Stop"
        ? (await readProjectState(root))?.nodes.length || 0
        : undefined;
    await processHookEvent(payload);
    if (before !== undefined) {
      const after = await readProjectState(root);
      if ((after?.nodes.length || 0) > before) {
        const successLog = path.join(
          projectDataDir(root),
          "hook-success.log"
        );
        await fs.promises.mkdir(path.dirname(successLog), { recursive: true });
        await fs.promises.appendFile(
          successLog,
          `${hookStartedAt}\n`,
          "utf8"
        );
      }
    }
  } catch (error) {
    const log = path.join(projectDataDir(root), "hook-errors.log");
    await fs.promises.mkdir(path.dirname(log), { recursive: true });
    await fs.promises
      .appendFile(log, `${new Date().toISOString()} ${String(error)}\n`, "utf8")
      .catch(() => undefined);
  }
}

if (require.main === module) {
  void runHookCli();
}
