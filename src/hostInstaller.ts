import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as lockfile from "proper-lockfile";
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

const TURN_EVENTS = ["UserPromptSubmit", "PostToolUse", "Stop"] as const;
const HOOK_MARKER = "--wayfinder-hook";
const CONFIG_LOCK_STALE_MS = 10_000;
const TRANSIENT_FILE_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);

export async function uninstallHostHooks(
  root: string,
  host: AgentHost
): Promise<string> {
  const file = hookFileFor(root, host);
  if (!fs.existsSync(file)) return file;
  await updateHookFile(file, false, removeWayfinderHooks);
  return file;
}

export async function installHostHooks(
  root: string,
  host: AgentHost,
  cliPath: string,
  options: { stopTimeout?: number } = {}
): Promise<string> {
  const file = hookFileFor(root, host);
  return installHooksAt(file, host, cliPath, options);
}

export async function installGlobalHostHooks(
  host: Exclude<AgentHost, "trae">,
  cliPath: string,
  options: { stopTimeout?: number } = {}
): Promise<string> {
  return installHooksAt(globalHookFileFor(host), host, cliPath, options);
}

export async function uninstallGlobalHostHooks(
  host: Exclude<AgentHost, "trae">
): Promise<string> {
  const file = globalHookFileFor(host);
  if (!fs.existsSync(file)) return file;
  await updateHookFile(file, false, removeWayfinderHooks);
  return file;
}

export async function globalHostHooksInstalled(
  host: Exclude<AgentHost, "trae">,
  cliPath?: string
): Promise<boolean> {
  return hooksInstalledAt(globalHookFileFor(host), host, cliPath);
}

export async function globalHostHooksEnabled(
  host: Exclude<AgentHost, "trae">
): Promise<boolean> {
  if (host === "claude") {
    try {
      const settings = await readJson(globalHookFileFor(host));
      return settings.disableAllHooks !== true;
    } catch {
      return false;
    }
  }
  const home = process.env.WAYFINDER_HOST_HOME || os.homedir();
  const config = path.join(home, ".codex", "config.toml");
  let raw: string;
  try {
    raw = await fs.promises.readFile(config, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  let section = "";
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+#.*$/, "").trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (/^features\.hooks\s*=\s*false\b/i.test(line)) return false;
    if (section === "features" && /^hooks\s*=\s*false\b/i.test(line)) {
      return false;
    }
    if (/^features\s*=\s*\{[^}]*\bhooks\s*=\s*false\b/i.test(line)) {
      return false;
    }
  }
  return true;
}

async function installHooksAt(
  file: string,
  host: AgentHost,
  cliPath: string,
  options: { stopTimeout?: number }
): Promise<string> {
  await updateHookFile(file, true, (current) => {
    if (host === "trae") {
      current.version ||= 1;
    } else if (host === "codex") {
      delete current.version;
    }
    current.hooks ||= {};
    removeWayfinderHooks(current);
    const command = hookCommand(cliPath, host);
    if (host !== "trae") {
      add(current, "SessionStart", command, 15);
    }
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
    if (host === "claude") {
      add(current, "PostToolUseFailure", command, 15, "Write|Edit|Bash");
    }
    if (host !== "trae") {
      add(current, "SessionEnd", command, host === "codex" ? 3 : 15);
    }
    add(
      current,
      "Stop",
      command,
      Math.max(120, options.stopTimeout || 120),
      undefined,
      host === "trae" ? { loop_limit: 1 } : undefined
    );
  });
  return file;
}

export async function hostHooksInstalled(
  root: string,
  host: AgentHost,
  cliPath?: string
): Promise<boolean> {
  return hooksInstalledAt(hookFileFor(root, host), host, cliPath);
}

async function hooksInstalledAt(
  file: string,
  host: AgentHost,
  cliPath?: string
): Promise<boolean> {
  try {
    const current = await readJson(file);
    const events = requiredEvents(host);
    return events.every((event) =>
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

function requiredEvents(host: AgentHost): readonly string[] {
  if (host === "trae") return TURN_EVENTS;
  if (host === "claude") {
    return [
      "SessionStart",
      ...TURN_EVENTS,
      "PostToolUseFailure",
      "SessionEnd"
    ];
  }
  return ["SessionStart", ...TURN_EVENTS, "SessionEnd"];
}

function hookFileFor(root: string, host: AgentHost): string {
  if (host === "claude") {
    return path.join(root, ".claude", "settings.json");
  }
  return path.join(root, host === "codex" ? ".codex" : ".trae", "hooks.json");
}

function globalHookFileFor(host: Exclude<AgentHost, "trae">): string {
  const home = process.env.WAYFINDER_HOST_HOME || os.homedir();
  return host === "claude"
    ? path.join(home, ".claude", "settings.json")
    : path.join(home, ".codex", "hooks.json");
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

async function updateHookFile(
  file: string,
  createIfMissing: boolean,
  mutate: (current: HookFile) => void
): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), {
    recursive: true,
    mode: 0o700
  });
  const release = await lockfile.lock(file, {
    realpath: false,
    lockfilePath: `${file}.wayfinder.lock`,
    stale: CONFIG_LOCK_STALE_MS,
    update: 2_000,
    retries: {
      retries: 50,
      factor: 1,
      minTimeout: 40,
      maxTimeout: 40
    }
  });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const snapshot = await readHookSnapshot(file);
      if (snapshot.raw === undefined && !createIfMissing) return;
      mutate(snapshot.current);
      const serialized = `${JSON.stringify(snapshot.current, null, 2)}\n`;
      const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(temp, serialized, {
          flag: "wx",
          mode: snapshot.mode
        });
        if (process.platform !== "win32") {
          await fs.promises.chmod(temp, snapshot.mode);
        }
        if (await readRaw(file) !== snapshot.raw) {
          continue;
        }
        if (!await publishHookSnapshot(
          file,
          temp,
          snapshot.raw
        )) {
          continue;
        }
        return;
      } finally {
        await fs.promises.rm(temp, { force: true }).catch(() => undefined);
      }
    }
    throw new Error(
      `Hook configuration changed repeatedly while updating: ${file}`
    );
  } finally {
    await release().catch(() => undefined);
  }
}

async function publishHookSnapshot(
  file: string,
  temp: string,
  snapshotRaw: string | undefined
): Promise<boolean> {
  if (snapshotRaw === undefined) {
    return linkIfAbsent(temp, file);
  }
  const backup = `${file}.${process.pid}.${randomUUID()}.previous`;
  let backupPresent = false;
  let removeBackup = false;
  try {
    try {
      await retryTransientFileOperation(() =>
        fs.promises.rename(file, backup)
      );
      backupPresent = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (await readRaw(backup) !== snapshotRaw) {
      if (await restoreBackupIfAbsent(backup, file)) {
        backupPresent = false;
      }
      return false;
    }
    if (!await linkIfAbsent(temp, file)) {
      removeBackup = true;
      return false;
    }
    if (await readRaw(backup) !== snapshotRaw) {
      const conflict = `${file}.wayfinder-conflict-${randomUUID()}`;
      await fs.promises.copyFile(
        backup,
        conflict,
        fs.constants.COPYFILE_EXCL
      );
      throw new Error(
        `Concurrent hook configuration updates were preserved at: ${conflict}`
      );
    }
    removeBackup = true;
    return true;
  } catch (error) {
    if (backupPresent && await readRaw(file) === undefined) {
      if (await restoreBackupIfAbsent(backup, file)) {
        backupPresent = false;
      }
    }
    throw error;
  } finally {
    if (removeBackup && backupPresent) {
      await retryTransientFileOperation(() =>
        fs.promises.rm(backup, { force: true })
      ).catch(() => undefined);
    }
  }
}

async function restoreBackupIfAbsent(
  backup: string,
  file: string
): Promise<boolean> {
  if (!await linkIfAbsent(backup, file)) {
    return false;
  }
  await retryTransientFileOperation(() =>
    fs.promises.rm(backup, { force: true })
  );
  return true;
}

async function linkIfAbsent(
  source: string,
  destination: string
): Promise<boolean> {
  try {
    await retryTransientFileOperation(() =>
      fs.promises.link(source, destination)
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

async function retryTransientFileOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code || "";
      if (!TRANSIENT_FILE_ERRORS.has(code) || attempt >= 7) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10 * (2 ** attempt), 160))
      );
    }
  }
}

async function readHookSnapshot(file: string): Promise<{
  current: HookFile;
  mode: number;
  raw?: string;
}> {
  const raw = await readRaw(file);
  if (raw === undefined) {
    return { current: { hooks: {} }, mode: 0o600 };
  }
  let current: HookFile;
  try {
    current = JSON.parse(raw) as HookFile;
  } catch {
    throw new Error(`Cannot update invalid hook configuration: ${file}`);
  }
  const stat = await fs.promises.stat(file).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return readHookSnapshot(file);
  return { current, mode: stat.mode & 0o777, raw };
}

async function readRaw(file: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
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
  const isScript = /\.(?:c?js|mjs)$/i.test(cliPath);
  if (process.platform === "win32") {
    const quoted = `"${cliPath.replace(/"/g, '""')}"`;
    return `${isScript ? "node " : ""}${quoted} hook --host ${host} ${HOOK_MARKER}`;
  }
  return `${isScript ? "/usr/bin/env node " : ""}` +
    `${shellQuote(cliPath)} hook --host ${host} ${HOOK_MARKER}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
