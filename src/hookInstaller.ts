import * as path from "path";
import * as vscode from "vscode";
import { detectValidationCommand } from "./hook";
import {
  hostHooksInstalled,
  installHostHooks
} from "./hostInstaller";
import {
  readProjectConfig,
  writeProjectConfig
} from "./storage";

type HookCommand = {
  type: "command";
  command: string;
  timeout: number;
};

type HookGroup = {
  matcher?: string;
  loop_limit?: number;
  hooks: HookCommand[];
};

type HooksFile = {
  version: number;
  hooks: Record<string, HookGroup[]>;
};

const HOOK_MARKER = "--wayfinder-hook";

export async function installTraeHooks(
  root: string,
  extensionPath: string
): Promise<{ file: string; validationCommand?: string }> {
  const prepared = await configureProjectForHooks(root);
  const cliPath = path.join(extensionPath, "out", "cli.js");
  let file: string;
  try {
    file = await installHostHooks(root, "trae", cliPath, {
      stopTimeout: prepared.validationTimeoutSeconds + 60
    });
  } catch (error) {
    throw new Error(
      `无法更新 ${path.join(root, ".trae", "hooks.json")}。` +
      `请先修复该文件，Wayfinder 未修改现有 Hooks。原因：${String(error)}`
    );
  }
  return { file, validationCommand: prepared.validationCommand };
}

export async function configureProjectForHooks(
  root: string
): Promise<{
  validationCommand?: string;
  validationTimeoutSeconds: number;
}> {
  const config = vscode.workspace.getConfiguration("wayfinder");
  const inspected = config.inspect<string>("validationCommand");
  const configured =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue;
  const projectConfig = await readProjectConfig(root);
  projectConfig.validationTimeoutSeconds = clamp(
    config.get<number>("validationTimeoutSeconds", 60),
    5,
    600
  );
  projectConfig.maxFileSizeMB = clamp(
    config.get<number>("maxFileSizeMB", 20),
    1,
    200
  );
  if (configured !== undefined) {
    projectConfig.validationCommand = configured.trim();
  } else if (projectConfig.validationCommand === undefined) {
    projectConfig.validationCommand = await detectValidationCommand(root);
  }
  await writeProjectConfig(root, projectConfig);
  return {
    validationCommand: projectConfig.validationCommand,
    validationTimeoutSeconds: projectConfig.validationTimeoutSeconds
  };
}

export async function areTraeHooksInstalled(
  root: string,
  extensionPath: string
): Promise<boolean> {
  return hostHooksInstalled(
    root,
    "trae",
    path.join(extensionPath, "out", "cli.js")
  );
}

export function mergeHooksForTest(
  current: HooksFile,
  hookScript: string
): HooksFile {
  const clone = JSON.parse(JSON.stringify(current)) as HooksFile;
  clone.version ||= 1;
  clone.hooks ||= {};
  removeWayfinderCommands(clone);
  const command = hookCommand(hookScript);
  addHook(clone, "UserPromptSubmit", {
    hooks: [{ type: "command", command, timeout: 30 }]
  });
  addHook(clone, "PostToolUse", {
    matcher: "Write|Edit|RunCommand",
    hooks: [{ type: "command", command, timeout: 15 }]
  });
  addHook(clone, "Stop", {
    loop_limit: 1,
    hooks: [{ type: "command", command, timeout: 120 }]
  });
  return clone;
}

function addHook(file: HooksFile, event: string, group: HookGroup): void {
  file.hooks[event] ||= [];
  file.hooks[event].push(group);
}

function removeWayfinderCommands(file: HooksFile): void {
  for (const [event, groups] of Object.entries(file.hooks || {})) {
    const cleaned = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter(
          (hook) => !hook.command.includes(HOOK_MARKER)
        )
      }))
      .filter((group) => group.hooks.length > 0);
    if (cleaned.length > 0) {
      file.hooks[event] = cleaned;
    } else {
      delete file.hooks[event];
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hookCommand(hookScript: string): string {
  if (process.platform === "win32") {
    return `node "${hookScript.replace(/"/g, '""')}" hook --host trae ${HOOK_MARKER}`;
  }
  return `/usr/bin/env node ${shellQuote(hookScript)} hook --host trae ${HOOK_MARKER}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
