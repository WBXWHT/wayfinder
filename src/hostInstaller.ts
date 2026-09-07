import * as fs from "fs";
import * as path from "path";
import { AgentHost } from "./models";

type HookCommand = Record<string, unknown> & {
  command?: unknown;
};

type HookGroup = Record<string, unknown> & {
  hooks?: HookCommand[];
};

type HookFile = {
  version?: number;
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
};

const EVENTS = ["UserPromptSubmit", "PostToolUse", "Stop"] as const;
const HOOK_MARKER = "--wayfinder-hook";

export async function uninstallHostHooks(
  root: string,
  host: AgentHost
): Promise<string> {
  const file = hookFileFor(root, host);
  if (!fs.existsSync(file)) return file;
  const current = await readJson(file);
  removeWayfinderHooks(current);
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(current, null, 2)}\n`);
  await fs.promises.rename(temp, file);
  return file;
}

export async function installHostHooks(
  root: string,
  host: AgentHost,
  cliPath: string,
  options: { stopTimeout?: number } = {}
): Promise<string> {
  const file = hookFileFor(root, host);
  const current = await readJson(file);
  if (host !== "claude") {
    current.version ||= 1;
  }
  current.hooks ||= {};
  removeWayfinderHooks(current);
  const command = hookCommand(cliPath, host);
  add(current, "UserPromptSubmit", command, 30);
  add(
    current,
    "PostToolUse",
    command,
    15,
    host === "trae"
      ? "Write|Edit|RunCommand"
      : host === "codex"
        ? "Bash|apply_patch|Edit|Write"
        : "Write|Edit|Bash"
  );
  add(
    current,
    "Stop",
    command,
    Math.max(120, options.stopTimeout || 120),
    undefined,
    host === "trae" ? { loop_limit: 1 } : undefined
  );
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(current, null, 2)}\n`);
  await fs.promises.rename(temp, file);
  return file;
}

export async function hostHooksInstalled(
  root: string,
  host: AgentHost,
  cliPath?: string
): Promise<boolean> {
  try {
    const current = await readJson(hookFileFor(root, host));
    return EVENTS.every((event) =>
      (current.hooks?.[event] || []).some((group) =>
        (group.hooks || []).some((hook) => {
          const command = typeof hook.command === "string"
            ? hook.command
            : "";
          return command.includes(HOOK_MARKER) &&
            command.includes(`--host ${host}`) &&
            (!cliPath || command.includes(cliPath));
        })
      )
    );
  } catch {
    return false;
  }
}

function hookFileFor(root: string, host: AgentHost): string {
  if (host === "claude") {
    return path.join(root, ".claude", "settings.json");
  }
  return path.join(root, host === "codex" ? ".codex" : ".trae", "hooks.json");
}

async function readJson(file: string): Promise<HookFile> {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8")) as HookFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { hooks: {} };
    }
    throw new Error(`Cannot update invalid hook configuration: ${file}`);
  }
}

function removeWayfinderHooks(file: HookFile): void {
  for (const [event, groups] of Object.entries(file.hooks || {})) {
    const cleaned = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((hook) => {
          const command = typeof hook.command === "string"
            ? hook.command
            : "";
          return !command.includes(HOOK_MARKER);
        })
      }))
      .filter((group) => (group.hooks || []).length > 0);
    if (cleaned.length) file.hooks![event] = cleaned;
    else delete file.hooks![event];
  }
}

function add(
  file: HookFile,
  event: string,
  command: string,
  timeout: number,
  matcher?: string,
  extra?: Record<string, unknown>
): void {
  file.hooks![event] ||= [];
  file.hooks![event].push({
    ...extra,
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "command", command, timeout }]
  });
}

function hookCommand(cliPath: string, host: AgentHost): string {
  if (process.platform === "win32") {
    const quoted = `"${cliPath.replace(/"/g, '""')}"`;
    return `node ${quoted} hook --host ${host} ${HOOK_MARKER}`;
  }
  return `/usr/bin/env node ${shellQuote(cliPath)} hook --host ${host} ${HOOK_MARKER}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
