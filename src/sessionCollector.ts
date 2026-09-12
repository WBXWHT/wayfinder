import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import {
  AgentHost,
  FileChange,
  LocalSessionSurface,
  TimelineNode,
  ToolAction
} from "./models";
import {
  clipText,
  commitTempFile,
  createId,
  latestNodeOnBranch,
  mutateProjectState,
  normalizeRoot,
  wayfinderHome
} from "./storage";

/**
 * Session collector.
 *
 * Codex, Claude Code, and Claude Cowork persist local session transcripts even
 * when lifecycle hooks are unavailable. Reading those files directly mirrors
 * established local session viewers and also lets a fresh Wayfinder install
 * backfill history that still exists on disk.
 *
 * This module only PARSES transcripts into candidate turns. Persisting them
 * into project state (dedup, snapshots, branch linking) is done by the caller.
 */

export interface CollectedTurn {
  host: AgentHost;
  surface: LocalSessionSurface;
  sessionId: string;
  turnId?: string;
  rolloutPath: string;
  turnIndex: number;
  cwd?: string;
  prompt: string;
  response?: string;
  actions: ToolAction[];
  files: FileChange[];
  startedAt: string;
  completedAt: string;
}

export interface CollectedSession {
  host: AgentHost;
  surface: LocalSessionSurface;
  sessionId: string;
  rolloutPath: string;
  cwd?: string;
  turns: CollectedTurn[];
}

const ENV_CONTEXT = /^\s*<(environment_context|app-context|user_instructions|system_instructions|developer_instructions|system-reminder|system_reminder)(?:\s|>)/i;
const CURSOR_PREFIX_BYTES = 64 * 1024;

export function codexSessionsRoot(): string {
  if (process.env.CODEX_SESSIONS_ROOT) {
    return process.env.CODEX_SESSIONS_ROOT;
  }
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "sessions");
}

export function codexArchivedSessionsRoot(): string {
  if (process.env.CODEX_ARCHIVED_SESSIONS_ROOT) {
    return process.env.CODEX_ARCHIVED_SESSIONS_ROOT;
  }
  if (process.env.CODEX_SESSIONS_ROOT) {
    return path.join(path.dirname(process.env.CODEX_SESSIONS_ROOT), "archived_sessions");
  }
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "archived_sessions");
}

export function claudeProjectsRoot(): string {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(home, "projects");
}

interface CoworkRootOptions {
  platform: NodeJS.Platform;
  home: string;
  override?: string;
  appData?: string;
  localAppData?: string;
  configHome?: string;
}

export function resolveClaudeCoworkSessionRoots({
  platform,
  home,
  override,
  appData,
  localAppData,
  configHome
}: CoworkRootOptions): string[] {
  if (override) {
    return [override];
  }
  if (platform === "darwin") {
    return [path.join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "local-agent-mode-sessions"
    )];
  }
  if (platform === "win32") {
    const roamingRoot = appData || path.join(home, "AppData", "Roaming");
    const localRoot = localAppData || path.join(home, "AppData", "Local");
    const roots = [
      path.join(roamingRoot, "Claude", "local-agent-mode-sessions"),
      path.join(localRoot, "Claude", "local-agent-mode-sessions")
    ];
    const packages = path.join(localRoot, "Packages");
    try {
      for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
        if (entry.isDirectory() && /claude/i.test(entry.name)) {
          roots.push(path.join(
            packages,
            entry.name,
            "LocalCache",
            "Roaming",
            "Claude",
            "local-agent-mode-sessions"
          ));
        }
      }
    } catch {
      // Non-Store installs do not have a matching Packages directory.
    }
    const seen = new Set<string>();
    return roots.filter((root) => {
      const key = path.resolve(root).toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  const resolvedConfigHome = configHome || path.join(home, ".config");
  return [path.join(
    resolvedConfigHome,
    "Claude",
    "local-agent-mode-sessions"
  )];
}

export function claudeCoworkSessionRoots(): string[] {
  return resolveClaudeCoworkSessionRoots({
    platform: process.platform,
    home: os.homedir(),
    override: process.env.CLAUDE_COWORK_ROOT,
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    configHome: process.env.XDG_CONFIG_HOME
  });
}

export function claudeCoworkSessionsRoot(): string {
  return claudeCoworkSessionRoots()[0];
}

export function unfiledConversationsRoot(): string {
  return path.join(wayfinderHome(), "unfiled", "通用协作");
}

/** Recursively list transcript files under a root, newest first. */
export function listTranscriptFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(full);
      }
    }
  };
  walk(root);
  return results.sort();
}

/** Cowork embeds nested Claude state; only its top-level audit logs are turns. */
export function listCoworkAuditFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith("local_")) {
        const audit = path.join(full, "audit.jsonl");
        try {
          if (fs.statSync(audit).isFile()) {
            results.push(audit);
          }
        } catch {
          // A session can disappear while Claude rotates account state.
        }
      } else if (depth < 3) {
        walk(full, depth + 1);
      }
    }
  };
  walk(root, 0);
  return results.sort();
}

function parseJsonl(file: string): Array<Record<string, unknown>> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      records.push(value);
    } catch {
      // Tolerate partially written trailing lines on active sessions.
    }
  }
  return records;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      const part = asRecord(item);
      if (!part) {
        return "";
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.content === "string") {
        return part.content;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isEnvelope(text: string): boolean {
  return ENV_CONTEXT.test(text.trimStart().slice(0, 80));
}

interface PendingFileOperation {
  action: ToolAction;
  changes: FileChange[];
  status: "pending" | "succeeded" | "failed";
}

function committedFileChanges(
  operations: PendingFileOperation[]
): FileChange[] {
  const files = new Map<string, FileChange>();
  for (const operation of operations) {
    if (operation.status !== "succeeded") {
      continue;
    }
    for (const change of operation.changes) {
      mergeFileChange(files, change);
    }
  }
  return [...files.values()];
}

/** Parse a single Codex rollout file into an ordered list of turns. */
export function parseCodexRollout(file: string): CollectedSession | undefined {
  const records = parseJsonl(file);
  if (records.length === 0) {
    return undefined;
  }

  let sessionId = path.basename(file);
  let cwd: string | undefined;
  const meta = records.find((r) => r.type === "session_meta");
  if (meta) {
    const payload = asRecord(meta.payload) || {};
    sessionId = String(payload.id || payload.session_id || sessionId);
    if (typeof payload.cwd === "string") {
      cwd = payload.cwd;
    }
  }

  const turns: CollectedTurn[] = [];
  let pendingPrompt:
    | { text: string; at: string; turnId?: string }
    | undefined;
  let activeTurnId: string | undefined;
  let pendingResponseParts: string[] = [];
  let pendingActions: ToolAction[] = [];
  let pendingOperations: PendingFileOperation[] = [];
  const calls = new Map<string, PendingFileOperation>();

  const flush = (responseText: string | undefined, at: string): void => {
    if (!pendingPrompt) {
      return;
    }
    const response = [...pendingResponseParts, responseText]
      .filter((part): part is string => Boolean(part?.trim()))
      .join("\n")
      .trim();
    turns.push({
      host: "codex",
      surface: "codex",
      sessionId,
      turnId: pendingPrompt.turnId,
      rolloutPath: file,
      turnIndex: turns.length,
      cwd,
      prompt: pendingPrompt.text,
      response: response || undefined,
      actions: pendingActions,
      files: committedFileChanges(pendingOperations),
      startedAt: pendingPrompt.at,
      completedAt: at
    });
    pendingPrompt = undefined;
    pendingResponseParts = [];
    pendingActions = [];
    pendingOperations = [];
    calls.clear();
  };

  for (const record of records) {
    const timestamp = typeof record.timestamp === "string"
      ? record.timestamp
      : new Date().toISOString();
    const payload = asRecord(record.payload) || {};
    const payloadType = payload.type;
    const recordTurnId = turnIdFrom(payload);
    if (
      recordTurnId &&
      (
        record.type === "turn_context" ||
        (
          record.type === "event_msg" &&
          payloadType === "task_started"
        )
      )
    ) {
      activeTurnId = recordTurnId;
    }

    if (record.type === "response_item" && payloadType === "message") {
      const role = payload.role;
      const text = textFromContent(payload.content).trim();
      if (!text) {
        continue;
      }
      if (role === "user") {
        if (isEnvelope(text)) {
          continue;
        }
        const turnId = recordTurnId || activeTurnId;
        // A fresh user prompt closes any previous unanswered turn — unless it
        // is an identical replay (e.g. a mid-turn model switch re-sends the
        // same prompt). In that case keep one turn, don't invent two.
        if (
          pendingPrompt &&
          (
            pendingPrompt.text !== text ||
            (
              turnId &&
              pendingPrompt.turnId &&
              turnId !== pendingPrompt.turnId
            )
          )
        ) {
          flush(undefined, pendingPrompt.at);
        }
        if (!pendingPrompt || pendingPrompt.text !== text) {
          pendingPrompt = { text, at: timestamp, turnId };
        } else if (turnId && !pendingPrompt.turnId) {
          pendingPrompt.turnId = turnId;
        }
      } else if (role === "assistant") {
        if (payload.phase === "commentary" && pendingPrompt) {
          pendingResponseParts.push(text);
        } else {
          flush(text, timestamp);
        }
      }
      continue;
    }

    if (
      record.type === "response_item" &&
      (
        payloadType === "function_call" ||
        payloadType === "local_shell_call" ||
        payloadType === "custom_tool_call"
      )
    ) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const action = toolActionFromCall(name, payload, cwd);
      const operation = {
        action,
        changes: fileChangesFromCall(name, payload, cwd),
        status: "pending" as const
      };
      pendingActions.push(action);
      pendingOperations.push(operation);
      if (callId) {
        calls.set(callId, operation);
      }
      continue;
    }

    if (
      record.type === "response_item" &&
      (
        payloadType === "function_call_output" ||
        payloadType === "custom_tool_call_output"
      )
    ) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const ok = !outputLooksFailed(payload.output ?? payload);
      const operation = callId
        ? calls.get(callId)
        : pendingOperations[pendingOperations.length - 1];
      if (operation) {
        operation.action.ok = ok;
        operation.status = ok ? "succeeded" : "failed";
      }
      continue;
    }

    if (
      record.type === "event_msg" &&
      (payloadType === "task_complete" || payloadType === "turn_aborted") &&
      pendingPrompt
    ) {
      pendingPrompt.turnId ||= recordTurnId;
      const response = [
        taskEventText(payload.last_agent_message),
        taskEventText(payload.error),
        taskEventText(payload.reason)
      ].find(Boolean);
      flush(response, timestamp);
    }
  }

  return {
    host: "codex",
    surface: "codex",
    sessionId,
    rolloutPath: file,
    cwd,
    turns
  };
}

function taskEventText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const key of ["message", "codex_error_info", "reason", "detail"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function turnIdFrom(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.turn_id === "string") {
    return payload.turn_id;
  }
  const metadata = asRecord(payload.internal_chat_message_metadata_passthrough);
  return typeof metadata?.turn_id === "string"
    ? metadata.turn_id
    : undefined;
}

interface ClaudeTranscriptDefaults {
  surface: Extract<LocalSessionSurface, "claude-code" | "claude-cowork">;
  sessionId: string;
  cwd?: string;
  acceptRecordCwd: boolean;
  acceptRecordSessionId: boolean;
}

function parseClaudeRecords(
  file: string,
  records: Array<Record<string, unknown>>,
  defaults: ClaudeTranscriptDefaults
): CollectedSession | undefined {
  if (records.length === 0) {
    return undefined;
  }

  let sessionId = defaults.sessionId;
  let cwd = defaults.cwd;
  const turns: CollectedTurn[] = [];
  let pendingPrompt:
    | { text: string; at: string; turnId?: string }
    | undefined;
  let pendingActions: ToolAction[] = [];
  let pendingOperations: PendingFileOperation[] = [];
  const calls = new Map<string, PendingFileOperation>();
  let responseParts: string[] = [];
  let lastAt: string | undefined;

  const flush = (): void => {
    if (!pendingPrompt) {
      return;
    }
    const response = responseParts.join("\n").trim();
    turns.push({
      host: "claude",
      surface: defaults.surface,
      sessionId,
      turnId: pendingPrompt.turnId,
      rolloutPath: file,
      turnIndex: turns.length,
      cwd,
      prompt: pendingPrompt.text,
      response: response || undefined,
      actions: pendingActions,
      files: committedFileChanges(pendingOperations),
      startedAt: pendingPrompt.at,
      completedAt: lastAt || pendingPrompt.at
    });
    pendingPrompt = undefined;
    pendingActions = [];
    pendingOperations = [];
    calls.clear();
    responseParts = [];
  };

  for (const record of records) {
    if (
      defaults.acceptRecordCwd &&
      typeof record.cwd === "string" &&
      !cwd
    ) {
      cwd = record.cwd;
    }
    if (
      defaults.acceptRecordSessionId &&
      typeof record.sessionId === "string"
    ) {
      sessionId = record.sessionId;
    }
    const timestamp = typeof record.timestamp === "string"
      ? record.timestamp
      : new Date().toISOString();
    const message = asRecord(record.message);
    if (!message) {
      continue;
    }
    const role = message.role;
    const text = textFromContent(message.content).trim();

    if (record.type === "user" || role === "user") {
      // Tool results arrive as user records; keep only real prompts.
      if (hasToolResult(message.content)) {
        applyClaudeToolResults(message.content, calls);
        lastAt = timestamp;
        continue;
      }
      if (!text || isEnvelope(text)) {
        continue;
      }
      // A new prompt finalizes the previous turn (with everything it gathered).
      flush();
      pendingPrompt = {
        text,
        at: timestamp,
        turnId:
          typeof record.uuid === "string"
            ? record.uuid
            : typeof record.turn_id === "string"
              ? record.turn_id
              : undefined
      };
      lastAt = timestamp;
    } else if (record.type === "assistant" || role === "assistant") {
      // Assistant text + tool_use all belong to the current turn; accumulate
      // rather than closing the turn on the first assistant line.
      collectClaudeToolUses(
        message.content,
        pendingActions,
        pendingOperations,
        calls,
        cwd
      );
      if (text) {
        responseParts.push(text);
      }
      lastAt = timestamp;
      const stopReason = typeof message.stop_reason === "string"
        ? message.stop_reason
        : undefined;
      if (stopReason && stopReason !== "tool_use") {
        flush();
      }
    }
  }

  return {
    host: "claude",
    surface: defaults.surface,
    sessionId,
    rolloutPath: file,
    cwd,
    turns
  };
}

/** Parse a single Claude Code JSONL transcript into an ordered list of turns. */
export function parseClaudeTranscript(file: string): CollectedSession | undefined {
  return parseClaudeRecords(file, parseJsonl(file), {
    surface: "claude-code",
    sessionId: path.basename(file, ".jsonl"),
    acceptRecordCwd: true,
    acceptRecordSessionId: true
  });
}

/** Parse one Claude Desktop Cowork audit log without exposing its HMAC fields. */
export function parseClaudeCoworkTranscript(
  file: string
): CollectedSession | undefined {
  const sidecar = readCoworkSidecar(file);
  const records = parseJsonl(file).map((record) => {
    const normalized = { ...record };
    if (
      typeof normalized.timestamp !== "string" &&
      typeof normalized._audit_timestamp === "string"
    ) {
      normalized.timestamp = normalized._audit_timestamp;
    }
    delete normalized._audit_hmac;
    return normalized;
  });
  const rawSessionId =
    typeof sidecar.sessionId === "string"
      ? sidecar.sessionId
      : path.basename(path.dirname(file));
  return parseClaudeRecords(file, records, {
    surface: "claude-cowork",
    sessionId: rawSessionId.replace(/^local_/, ""),
    cwd: coworkProjectRoot(sidecar, records),
    acceptRecordCwd: false,
    acceptRecordSessionId: false
  });
}

function readCoworkSidecar(file: string): Record<string, unknown> {
  const sidecar = coworkSidecarPath(file);
  try {
    return asRecord(JSON.parse(fs.readFileSync(sidecar, "utf8"))) || {};
  } catch {
    return {};
  }
}

function coworkSidecarPath(file: string): string {
  return `${path.dirname(file)}.json`;
}

function coworkProjectRoot(
  sidecar: Record<string, unknown>,
  records: Array<Record<string, unknown>>
): string | undefined {
  const selected: string[] = [];
  for (const key of ["userSelectedFolders", "userApprovedFileAccessPaths"]) {
    const values = sidecar[key];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const value of values) {
      const candidate = coworkPathValue(value);
      if (candidate) {
        selected.push(candidate);
      }
    }
  }
  for (const candidate of selected) {
    if (resolveProjectRoot(candidate)) {
      return candidate;
    }
  }
  if (selected.length > 0) {
    return selected[0];
  }

  const candidates = [sidecar.cwd, ...records.map((record) => record.cwd)];
  for (const value of candidates) {
    const candidate = coworkPathValue(value);
    if (candidate && fs.existsSync(candidate)) {
      try {
        if (fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch {
        // A disconnected or concurrently removed path is handled by fallback.
      }
    }
  }
  return undefined;
}

function coworkPathValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const candidate = value.trim();
    if (!candidate) {
      return undefined;
    }
    return candidate.startsWith("~/")
      ? path.join(os.homedir(), candidate.slice(2))
      : candidate;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const key of ["path", "folderPath", "localPath"]) {
    const candidate = coworkPathValue(record[key]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function toolActionFromCall(
  name: string,
  payload: Record<string, unknown>,
  cwd?: string
): ToolAction {
  let detail: string | undefined;
  let filePath: string | undefined;
  const args = callArguments(payload);
  if (args) {
    if (typeof args.command === "string") {
      detail = args.command;
    } else if (Array.isArray(args.command)) {
      detail = args.command.join(" ");
    }
    filePath = [args.file_path, args.path, args.target_file]
      .find((value) => typeof value === "string") as string | undefined;
  }
  const kind: ToolAction["kind"] =
    name === "apply_patch" || name === "edit"
      ? "edit"
      : name === "exec_command" || name === "local_shell" || name === "shell"
        ? "run"
        : "other";
  return {
    kind,
    tool: name,
    path: filePath
      ? projectRelativePath(filePath, cwd)
      : undefined,
    detail: detail ? clipInline(detail, 300) : undefined
  };
}

function collectClaudeToolUses(
  content: unknown,
  actions: ToolAction[],
  operations: PendingFileOperation[],
  calls: Map<string, PendingFileOperation>,
  cwd?: string
): void {
  if (!Array.isArray(content)) {
    return;
  }
  for (const item of content) {
    const part = asRecord(item);
    if (!part || part.type !== "tool_use") {
      continue;
    }
    const name = typeof part.name === "string" ? part.name : "tool";
    const input = asRecord(part.input) || {};
    const detail = typeof input.command === "string" ? input.command : undefined;
    const filePath = [input.file_path, input.path]
      .find((value) => typeof value === "string") as string | undefined;
    const action: ToolAction = {
      kind:
        name === "Write" ? "write" : name === "Edit" ? "edit"
          : name === "Bash" ? "run" : "other",
      tool: name,
      path: filePath
        ? projectRelativePath(filePath, cwd)
        : undefined,
      detail: detail ? clipInline(detail, 300) : undefined
    };
    const operation = {
      action,
      changes: claudeFileChangesForUse(name, input, cwd),
      status: "pending" as const
    };
    actions.push(action);
    operations.push(operation);
    if (typeof part.id === "string") {
      calls.set(part.id, operation);
    }
  }
}

function hasToolResult(content: unknown): boolean {
  return Array.isArray(content) &&
    content.some((item) => asRecord(item)?.type === "tool_result");
}

function applyClaudeToolResults(
  content: unknown,
  calls: Map<string, PendingFileOperation>
): void {
  if (!Array.isArray(content)) {
    return;
  }
  for (const item of content) {
    const part = asRecord(item);
    if (!part || part.type !== "tool_result") {
      continue;
    }
    const callId = typeof part.tool_use_id === "string"
      ? part.tool_use_id
      : undefined;
    const operation = callId ? calls.get(callId) : undefined;
    if (!operation) {
      continue;
    }
    const failed = typeof part.is_error === "boolean"
      ? part.is_error
      : outputLooksFailed(part.content);
    operation.action.ok = !failed;
    operation.status = failed ? "failed" : "succeeded";
  }
}

// --- File-change replay -----------------------------------------------------
//
// Session transcripts sometimes record both sides of a change: apply_patch
// carries changed lines, while Edit and MultiEdit carry old/new strings. Write
// has no previous state, so it remains an action instead of a fabricated diff.

function projectRelativePath(
  filePath: string,
  cwd?: string
): string | undefined {
  const value = filePath.trim();
  if (!value) {
    return undefined;
  }
  const windowsPath = /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(value);
  const posixPath = !windowsPath && path.posix.isAbsolute(value);
  const windowsCwd = Boolean(cwd && /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(cwd));
  const posixCwd = Boolean(
    cwd && !windowsCwd && path.posix.isAbsolute(cwd)
  );
  let relative = value;
  if (windowsPath || posixPath || windowsCwd || posixCwd) {
    if (
      !cwd ||
      (!windowsCwd && !posixCwd) ||
      (windowsPath && !windowsCwd) ||
      (posixPath && !posixCwd)
    ) {
      return undefined;
    }
    const useWindows = windowsPath || (!posixPath && windowsCwd);
    const flavor = useWindows ? path.win32 : path.posix;
    const nativePath =
      (process.platform === "win32" && useWindows) ||
      (process.platform !== "win32" && !useWindows);
    const projectRoot = nativePath
      ? canonicalNativePath(cwd)
      : flavor.normalize(cwd);
    const absoluteTarget = flavor.isAbsolute(value)
      ? value
      : flavor.resolve(cwd, value);
    const target = nativePath
      ? canonicalNativePath(absoluteTarget)
      : flavor.normalize(absoluteTarget);
    relative = flavor.relative(projectRoot, target);
  }
  const normalized = path.posix
    .normalize(relative.replaceAll("\\", "/"))
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function canonicalNativePath(value: string): string {
  const suffix: string[] = [];
  let current = path.resolve(value);
  while (true) {
    try {
      return path.join(fs.realpathSync.native(current), ...suffix);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(value);
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  const normalized = text.replace(/\r\n?/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

/** Merge a change into the per-turn map, accumulating repeated edits. */
function mergeFileChange(map: Map<string, FileChange>, change: FileChange): void {
  if (change.status === "R" && change.previousPath) {
    const source = map.get(change.previousPath);
    if (source) {
      map.delete(change.previousPath);
      const destination = map.get(change.path);
      if (destination) {
        destination.additions += source.additions;
        destination.deletions += source.deletions;
        if (source.status !== "A") {
          destination.previousPath ||=
            source.previousPath || change.previousPath;
          destination.status = "R";
        }
        mergeFileChangeMetadata(destination, source);
      } else {
        map.set(change.path, {
          ...source,
          path: change.path,
          status: source.status === "A" ? "A" : "R",
          previousPath: source.status === "A"
            ? undefined
            : source.previousPath || change.previousPath
        });
      }
    }
  }
  const existing = map.get(change.path);
  if (!existing) {
    const inserted = { ...change };
    map.set(change.path, inserted);
    normalizeRoundTripRename(map, inserted);
    return;
  }
  if (change.status === "D") {
    map.delete(change.path);
    if (existing.status === "A") {
      return;
    }
    map.set(existing.previousPath || existing.path, {
      path: existing.previousPath || existing.path,
      status: "D",
      additions: 0,
      deletions: 0,
      lineCountsKnown: false
    });
    return;
  }
  existing.additions += change.additions;
  existing.deletions += change.deletions;
  mergeFileChangeMetadata(existing, change);
  if (change.status === "R" && existing.status !== "A") {
    existing.status = "R";
    existing.previousPath ||= change.previousPath;
  } else if (existing.status !== "A" && existing.status !== "R") {
    existing.status = "M";
  }
  normalizeRoundTripRename(map, existing);
}

function normalizeRoundTripRename(
  map: Map<string, FileChange>,
  change: FileChange
): void {
  if (change.status !== "R" || change.previousPath !== change.path) {
    return;
  }
  delete change.previousPath;
  if (
    change.additions === 0 &&
    change.deletions === 0 &&
    !change.binary
  ) {
    map.delete(change.path);
    return;
  }
  change.status = "M";
}

function mergeFileChangeMetadata(
  existing: FileChange,
  change: FileChange
): void {
  if (
    existing.lineCountsKnown === false ||
    change.lineCountsKnown === false
  ) {
    existing.lineCountsKnown = false;
  } else if (
    existing.lineCountsKnown === true ||
    change.lineCountsKnown === true
  ) {
    existing.lineCountsKnown = true;
  }
  if (change.binary) {
    existing.binary = true;
  }
}

function editChange(
  filePath: string,
  oldString: string,
  newString: string,
  cwd?: string
): FileChange | undefined {
  const relativePath = projectRelativePath(filePath, cwd);
  if (!relativePath) {
    return undefined;
  }
  return {
    path: relativePath,
    status: "M",
    additions: countLines(newString),
    deletions: countLines(oldString)
  };
}

/** File changes from a Codex function/custom tool call. */
function fileChangesFromCall(
  name: string,
  payload: Record<string, unknown>,
  cwd?: string
): FileChange[] {
  const args = callArguments(payload);
  if (name === "apply_patch") {
    let patch: string | undefined;
    if (args && typeof args.input === "string") {
      patch = args.input;
    } else if (args && typeof args.patch === "string") {
      patch = args.patch;
    } else if (typeof payload.input === "string" && !args) {
      patch = payload.input;
    } else if (typeof payload.arguments === "string" && !args) {
      patch = payload.arguments;
    }
    return patch ? parseApplyPatch(patch, cwd) : [];
  }
  if (name === "Edit" && args && typeof args.file_path === "string") {
    const change = editChange(
      String(args.file_path),
      String(args.old_string || ""),
      String(args.new_string || ""),
      cwd
    );
    return change ? [change] : [];
  }
  // Write can create or replace a file, but its transcript input does not
  // carry the previous content. Keep the action and avoid inventing a diff.
  return [];
}

/** Provable file changes from Claude Edit / MultiEdit tool_use blocks. */
function claudeFileChangesForUse(
  name: string,
  input: Record<string, unknown>,
  cwd?: string
): FileChange[] {
  const changes: FileChange[] = [];
  const filePath = typeof input.file_path === "string"
    ? input.file_path
    : undefined;
  if (!filePath) {
    return changes;
  }
  if (name === "Edit") {
    const change = editChange(
      filePath,
      String(input.old_string || ""),
      String(input.new_string || ""),
      cwd
    );
    if (change) {
      changes.push(change);
    }
  } else if (name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const raw of input.edits) {
      const edit = asRecord(raw);
      if (!edit) {
        continue;
      }
      const change = editChange(
        filePath,
        String(edit.old_string || ""),
        String(edit.new_string || ""),
        cwd
      );
      if (change) {
        changes.push(change);
      }
    }
  }
  // Write is intentionally action-only: its input has no previous file state.
  return changes;
}

/** Parse a Codex apply_patch envelope into per-file line-change counts. */
export function parseApplyPatch(patch: string, cwd?: string): FileChange[] {
  const lines = patch.replace(/\r\n?/g, "\n").split("\n");
  const changes: FileChange[] = [];
  let current: FileChange | undefined;

  const push = (): void => {
    if (current) {
      changes.push(current);
      current = undefined;
    }
  };

  for (const line of lines) {
    const add = /^\*\*\* Add File: (.+)$/.exec(line);
    const update = /^\*\*\* Update File: (.+)$/.exec(line);
    const del = /^\*\*\* Delete File: (.+)$/.exec(line);
    if (add) {
      push();
      const filePath = projectRelativePath(add[1], cwd);
      current = filePath
        ? { path: filePath, status: "A", additions: 0, deletions: 0 }
        : undefined;
      continue;
    }
    if (update) {
      push();
      const filePath = projectRelativePath(update[1], cwd);
      current = filePath
        ? { path: filePath, status: "M", additions: 0, deletions: 0 }
        : undefined;
      continue;
    }
    if (del) {
      push();
      const filePath = projectRelativePath(del[1], cwd);
      current = filePath
        ? {
            path: filePath,
            status: "D",
            additions: 0,
            deletions: 0,
            lineCountsKnown: false
          }
        : undefined;
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && current) {
      const destination = projectRelativePath(move[1], cwd);
      if (destination) {
        current.previousPath = current.path;
        current.path = destination;
        current.status = "R";
      }
      continue;
    }
    if (/^\*\*\* End of File$/.test(line) || /^\*\*\* End Patch$/.test(line)) {
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      current.additions += 1;
    } else if (line.startsWith("-")) {
      current.deletions += 1;
    }
  }
  push();
  return changes;
}

function outputLooksFailed(output: unknown, depth = 0): boolean {
  if (Array.isArray(output)) {
    return depth < 4 &&
      output.some((item) => outputLooksFailed(item, depth + 1));
  }
  const record = typeof output === "string"
    ? safeJson(output) || undefined
    : asRecord(output);
  if (record) {
    const exitCode = [record.exit_code, record.exitCode]
      .find((value) => typeof value === "number");
    if (typeof exitCode === "number" && exitCode !== 0) {
      return true;
    }
    if (record.success === false) {
      return true;
    }
    if (
      record.error !== undefined &&
      record.error !== null &&
      record.error !== false &&
      record.error !== ""
    ) {
      return true;
    }
    if (depth < 4) {
      for (const key of ["metadata", "result", "response", "data"]) {
        if (
          record[key] !== undefined &&
          outputLooksFailed(record[key], depth + 1)
        ) {
          return true;
        }
      }
    }
    if (typeof exitCode === "number" || record.success === true) {
      return false;
    }
    if (typeof record.code === "number") {
      return record.code !== 0;
    }
  }
  const text = typeof output === "string" ? output : JSON.stringify(output || "");
  const statusHeader = text.split(
    /\r?\n\s*(?:final output|output)\s*:?\s*(?:\r?\n|$)/i,
    1
  )[0];
  const explicitExit = statusHeader.match(
    /^\s*(?:(?:process|command|operation|tool)\s+)?exit(?:ed)?\s+with\s+code\s*[:=]?\s*(-?\d+)\s*$/im
  ) || statusHeader.match(
    /^\s*exit\s+code\s*[:=]?\s*(-?\d+)\s*$/im
  );
  if (explicitExit) {
    return Number(explicitExit[1]) !== 0;
  }
  if (
    /\berrors?(?:\s+count)?\s*[:=]?\s*0\b/i.test(text)
  ) {
    return false;
  }
  return (
    /(?:^|\n)\s*(?:error|failed|failure|fatal|exception|traceback)\b/i.test(text) ||
    /\b(?:command|operation|patch|tool)\s+failed\b/i.test(text) ||
    /invalid context|permission denied|file not found/i.test(text)
  );
}

function callArguments(
  payload: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (typeof payload.arguments === "string") {
    return safeJson(payload.arguments);
  }
  const argumentsRecord = asRecord(payload.arguments);
  if (argumentsRecord) {
    return argumentsRecord;
  }
  if (typeof payload.input === "string") {
    return safeJson(payload.input);
  }
  return asRecord(payload.input);
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function clipInline(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// --- Persistence orchestration ---------------------------------------------

interface CollectorFileCursor {
  size: number;
  collectedTurns: number;
  identity?: string;
  prefixBytes?: number;
  prefixHash?: string;
  suffixBytes?: number;
  suffixHash?: string;
  mtimeMs?: number;
  ctimeMs?: number;
  contextFingerprint?: string;
  projectRoot?: string;
  cwd?: string;
}

interface CollectorCursor {
  version: 2;
  files: Record<string, CollectorFileCursor>;
}

export interface CollectRunResult {
  scannedFiles: number;
  newTurns: number;
  projects: string[];
  skippedNoProject: number;
}

function collectorStatePath(): string {
  return path.join(wayfinderHome(), "collector-state.json");
}

function readCursor(): CollectorCursor {
  try {
    const raw = fs.readFileSync(collectorStatePath(), "utf8");
    const parsed = JSON.parse(raw) as CollectorCursor;
    if (parsed.version === 2 && parsed.files) {
      return parsed;
    }
  } catch {
    // Fresh cursor.
  }
  return { version: 2, files: {} };
}

function transcriptIdentity(stat: fs.Stats): string | undefined {
  if (
    !Number.isSafeInteger(stat.dev) ||
    !Number.isSafeInteger(stat.ino) ||
    (stat.dev === 0 && stat.ino === 0)
  ) {
    return undefined;
  }
  return `${stat.dev}:${stat.ino}`;
}

function hashFileSegment(
  file: string,
  start: number,
  bytes: number
): string | undefined {
  const buffer = Buffer.alloc(bytes);
  let handle: number | undefined;
  let offset = 0;
  try {
    handle = fs.openSync(file, "r");
    while (offset < bytes) {
      const read = fs.readSync(
        handle,
        buffer,
        offset,
        bytes - offset,
        start + offset
      );
      if (read === 0) {
        break;
      }
      offset += read;
    }
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
  if (offset !== bytes) {
    return undefined;
  }
  return createHash("sha256").update(buffer).digest("hex");
}

function cursorMetadata(
  file: string,
  stat: fs.Stats,
  contextFile?: string
): Pick<
  CollectorFileCursor,
  | "size"
  | "identity"
  | "prefixBytes"
  | "prefixHash"
  | "suffixBytes"
  | "suffixHash"
  | "mtimeMs"
  | "ctimeMs"
  | "contextFingerprint"
> {
  const prefixBytes = Math.min(stat.size, CURSOR_PREFIX_BYTES);
  const suffixBytes = Math.min(stat.size, CURSOR_PREFIX_BYTES);
  return {
    size: stat.size,
    identity: transcriptIdentity(stat),
    prefixBytes,
    prefixHash: hashFileSegment(file, 0, prefixBytes),
    suffixBytes,
    suffixHash: hashFileSegment(
      file,
      Math.max(0, stat.size - suffixBytes),
      suffixBytes
    ),
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    contextFingerprint: contextFile
      ? fileFingerprint(contextFile)
      : undefined
  };
}

function fileFingerprint(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    return [
      transcriptIdentity(stat) || "",
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs
    ].join(":");
  } catch {
    return undefined;
  }
}

function continuesPreviousFile(
  file: string,
  stat: fs.Stats,
  current: ReturnType<typeof cursorMetadata>,
  previous: CollectorFileCursor
): boolean {
  if (previous.contextFingerprint !== current.contextFingerprint) {
    return false;
  }
  if (stat.size < previous.size) {
    return false;
  }
  if (
    previous.identity &&
    current.identity &&
    previous.identity !== current.identity
  ) {
    return false;
  }
  if (
    previous.prefixBytes === undefined ||
    previous.prefixHash === undefined ||
    stat.size < previous.prefixBytes
  ) {
    return false;
  }
  const currentPrefix = previous.prefixBytes === current.prefixBytes
    ? current.prefixHash
    : hashFileSegment(file, 0, previous.prefixBytes);
  if (currentPrefix !== previous.prefixHash) {
    return false;
  }
  if (
    previous.suffixBytes === undefined ||
    previous.suffixHash === undefined ||
    previous.size < previous.suffixBytes
  ) {
    return false;
  }
  const previousTail = hashFileSegment(
    file,
    previous.size - previous.suffixBytes,
    previous.suffixBytes
  );
  if (previousTail !== previous.suffixHash) {
    return false;
  }
  if (stat.size === previous.size) {
    if (
      previous.mtimeMs !== undefined &&
      previous.mtimeMs !== current.mtimeMs
    ) {
      return false;
    }
    if (
      previous.ctimeMs !== undefined &&
      previous.ctimeMs !== current.ctimeMs
    ) {
      return false;
    }
  }
  return true;
}

async function writeCursor(cursor: CollectorCursor): Promise<void> {
  const file = collectorStatePath();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${createId("cursor")}.tmp`;
  try {
    await fs.promises.writeFile(
      temp,
      `${JSON.stringify(cursor, null, 2)}\n`,
      "utf8"
    );
    await commitTempFile(temp, file);
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
  }
}

/** Resolve a transcript cwd to an existing project root, or undefined. */
function resolveProjectRoot(cwd: string | undefined): string | undefined {
  if (!cwd || !fs.existsSync(cwd)) {
    return undefined;
  }
  try {
    return fs.statSync(cwd).isDirectory() ? normalizeRoot(cwd) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Collect all Codex + Claude transcripts into project timelines.
 *
 * Idempotent: a per-file cursor tracks how many turns were already persisted,
 * so re-running only appends genuinely new turns. Turns are also deduped
 * by stable host turn ids or exact rollout provenance. Older hook records
 * without a turn id use a one-to-one, time-bounded content match so genuine
 * repeated prompts remain distinct.
 */
export async function collectSessions(): Promise<CollectRunResult> {
  const cursorFile = collectorStatePath();
  await fs.promises.mkdir(path.dirname(cursorFile), { recursive: true });
  const release = await lockfile.lock(cursorFile, {
    realpath: false,
    stale: 15_000,
    update: 5_000,
    retries: {
      retries: 600,
      factor: 1,
      minTimeout: 100,
      maxTimeout: 100
    }
  });
  try {
    return await collectSessionsUnlocked();
  } finally {
    await release().catch(() => undefined);
  }
}

async function collectSessionsUnlocked(): Promise<CollectRunResult> {
  const cursor = readCursor();
  const codexFiles = [...new Set([
    ...listTranscriptFiles(codexSessionsRoot()),
    ...listTranscriptFiles(codexArchivedSessionsRoot())
  ])];
  const claudeFiles = listTranscriptFiles(claudeProjectsRoot());
  const coworkFiles = [...new Set(
    claudeCoworkSessionRoots().flatMap(listCoworkAuditFiles)
  )];
  const result: CollectRunResult = {
    scannedFiles: 0,
    newTurns: 0,
    projects: [],
    skippedNoProject: 0
  };
  const touchedProjects = new Set<string>();

  const process_ = async (
    file: string,
    parse: (file: string) => CollectedSession | undefined,
    contextFile?: (file: string) => string
  ): Promise<void> => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return;
    }
    const previous = cursor.files[file];
    const currentIdentity = transcriptIdentity(stat);
    const currentContextFingerprint = contextFile
      ? fileFingerprint(contextFile(file))
      : undefined;
    const metadataUnchanged = Boolean(
      previous &&
      previous.size === stat.size &&
      previous.mtimeMs !== undefined &&
      previous.mtimeMs === stat.mtimeMs &&
      previous.ctimeMs !== undefined &&
      previous.ctimeMs === stat.ctimeMs &&
      previous.identity === currentIdentity &&
      previous.contextFingerprint === currentContextFingerprint
    );
    const currentRequestedRoot = resolveProjectRoot(previous?.cwd);
    const routeBecameAvailable = Boolean(
      metadataUnchanged &&
      previous?.projectRoot &&
      previous.cwd &&
      currentRequestedRoot &&
      currentRequestedRoot !== previous.projectRoot
    );
    if (metadataUnchanged && !routeBecameAvailable) {
      return;
    }
    const metadata = cursorMetadata(file, stat, contextFile?.(file));
    const continues = previous
      ? continuesPreviousFile(file, stat, metadata, previous)
      : false;
    const unchanged = Boolean(
      previous && continues && previous.size === stat.size
    );
    if (unchanged && !routeBecameAvailable) {
      return;
    }
    result.scannedFiles += 1;
    const session = parse(file);
    if (!session || session.turns.length === 0) {
      cursor.files[file] = {
        ...metadata,
        collectedTurns: continues ? previous?.collectedTurns || 0 : 0,
        projectRoot: previous?.projectRoot,
        cwd: previous?.cwd
      };
      return;
    }
    let root = resolveProjectRoot(session.cwd);
    if (!root) {
      const unfiledRoot = unfiledConversationsRoot();
      await fs.promises.mkdir(unfiledRoot, { recursive: true });
      root = normalizeRoot(unfiledRoot);
    }
    const routeChanged = Boolean(
      previous?.projectRoot && previous.projectRoot !== root
    );
    const alreadyCollected =
      continues && !routeChanged ? previous?.collectedTurns || 0 : 0;
    const fresh = session.turns.filter((turn) => turn.turnIndex >= alreadyCollected);
    if (fresh.length === 0) {
      cursor.files[file] = {
        ...metadata,
        collectedTurns: alreadyCollected,
        projectRoot: root,
        cwd: session.cwd
      };
      return;
    }

    const persisted = await persistTurns(root, session.host, fresh);
    if (routeChanged && previous?.projectRoot) {
      await removeCollectedSession(
        previous.projectRoot,
        session.host,
        session.sessionId,
        file
      );
      touchedProjects.add(previous.projectRoot);
    }
    result.newTurns += persisted;
    touchedProjects.add(root);
    cursor.files[file] = {
      ...metadata,
      collectedTurns: session.turns.length,
      projectRoot: root,
      cwd: session.cwd
    };
  };

  for (const file of codexFiles) {
    await process_(file, parseCodexRollout);
  }
  for (const file of claudeFiles) {
    await process_(file, parseClaudeTranscript);
  }
  for (const file of coworkFiles) {
    await process_(
      file,
      parseClaudeCoworkTranscript,
      coworkSidecarPath
    );
  }

  await writeCursor(cursor);
  result.projects = [...touchedProjects];
  return result;
}

async function removeCollectedSession(
  root: string,
  host: AgentHost,
  sessionId: string,
  rolloutPath: string
): Promise<void> {
  await mutateProjectState(root, (state) => {
    const removedParents = new Map<string, string | undefined>();
    for (const node of state.nodes) {
      if (
        node.source?.type === "rollout" &&
        node.source.host === host &&
        node.source.sessionId === sessionId &&
        node.source.rolloutPath === rolloutPath
      ) {
        removedParents.set(node.id, node.parentId);
      }
    }
    if (removedParents.size === 0) {
      return;
    }

    const survivingParent = (parentId: string | undefined): string | undefined => {
      const seen = new Set<string>();
      let current = parentId;
      while (current && removedParents.has(current) && !seen.has(current)) {
        seen.add(current);
        current = removedParents.get(current);
      }
      return current;
    };
    state.nodes = state.nodes
      .filter((node) => !removedParents.has(node.id))
      .map((node) => ({
        ...node,
        parentId: survivingParent(node.parentId)
      }));
    state.branches = state.branches.map((branch) => ({
      ...branch,
      parentNodeId: survivingParent(branch.parentNodeId)
    }));
  });
}

async function persistTurns(
  root: string,
  host: AgentHost,
  turns: CollectedTurn[]
): Promise<number> {
  return mutateProjectState(root, async (state) => {
    // Collected transcripts cannot reconstruct historical file contents.
    // Equal empty refs suppress restore/diff actions without requiring Git.
    const baseline = "";
    let added = 0;
    const matchedHookNodeIds = new Set<string>();

    for (const turn of turns) {
      const scopedSession = `${host}:${turn.sessionId}`;
      const provenance = turn.turnId
        ? [host, turn.sessionId, turn.turnId].join("\0")
        : [
            host,
            turn.rolloutPath,
            turn.sessionId,
            String(turn.turnIndex)
          ].join("\0");
      const provenanceId = createHash("sha256")
        .update(provenance)
        .digest("hex")
        .slice(0, 20);
      const nodeId = `collected-${host}-${provenanceId}`;
      const source = {
        type: "rollout" as const,
        host,
        surface: turn.surface,
        rolloutPath: turn.rolloutPath,
        sessionId: turn.sessionId,
        turnIndex: turn.turnIndex,
        turnId: turn.turnId,
        collectedAt: new Date().toISOString()
      };

      const duplicate = state.nodes.find((node) => {
        if (node.id === nodeId) {
          return true;
        }
        if (node.source?.type !== "rollout" || node.source.host !== host) {
          return false;
        }
        if (turn.turnId) {
          return (
            node.source.sessionId === turn.sessionId &&
            (
              node.turnId === turn.turnId ||
              node.source.turnId === turn.turnId
            )
          );
        }
        return (
          node.source.rolloutPath === turn.rolloutPath &&
          node.source.sessionId === turn.sessionId &&
          node.source.turnIndex === turn.turnIndex
        ) || (
          node.source.sessionId === turn.sessionId &&
          node.source.turnIndex === turn.turnIndex &&
          node.startedAt === turn.startedAt &&
          node.prompt === clipText(turn.prompt, 4_000)
        );
      });
      if (duplicate) {
        mergeCollectedTurn(duplicate, turn, source);
        continue;
      }
      const hookMatch = state.nodes
        .filter((node) =>
          node.kind === "turn" &&
          node.source?.type !== "rollout" &&
          !matchedHookNodeIds.has(node.id) &&
          node.sourceHost === host &&
          node.sessionId === scopedSession &&
          (
            Boolean(turn.turnId && node.turnId === turn.turnId) ||
            (
              node.prompt === clipText(turn.prompt, 4_000) &&
              (node.response || "") === clipText(turn.response, 4_000) &&
              sameTurnWindow(node, turn)
            )
          )
        )
        .sort((left, right) =>
          turnDistance(left, turn) - turnDistance(right, turn) ||
          left.id.localeCompare(right.id)
        )[0];
      if (hookMatch) {
        hookMatch.turnId ||= turn.turnId;
        hookMatch.source = source;
        matchedHookNodeIds.add(hookMatch.id);
        continue;
      }

      const parent = latestNodeOnBranch(state);
      const node: TimelineNode = {
        id: nodeId,
        kind: "collected",
        sessionId: scopedSession,
        turnId: turn.turnId,
        sourceHost: host,
        branchId: state.activeBranchId,
        parentId: parent?.id,
        prompt: turn.prompt,
        response: turn.response,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        snapshotBefore: baseline,
        snapshotAfter: baseline,
        files: turn.files,
        actions: turn.actions,
        validation: { status: "skipped" },
        source
      };
      state.nodes.push(node);
      added += 1;
    }
    return added;
  });
}

function mergeCollectedTurn(
  node: TimelineNode,
  turn: CollectedTurn,
  source: Extract<NonNullable<TimelineNode["source"]>, { type: "rollout" }>
): void {
  const previousCompletedAt = node.completedAt;
  node.turnId ||= turn.turnId;
  node.startedAt =
    turn.startedAt < node.startedAt ? turn.startedAt : node.startedAt;
  node.completedAt =
    turn.completedAt > node.completedAt ? turn.completedAt : node.completedAt;
  if (
    turn.response &&
    (
      !node.response ||
      turn.completedAt >= previousCompletedAt ||
      turn.response.length > node.response.length
    )
  ) {
    node.response = turn.response;
  }
  node.actions = mergeCollectedActions(node.actions, turn.actions);
  const files = new Map(
    node.files.map((file) => [
      `${file.previousPath || ""}\0${file.path}`,
      file
    ])
  );
  for (const file of turn.files) {
    files.set(`${file.previousPath || ""}\0${file.path}`, file);
  }
  node.files = [...files.values()];
  node.source = source;
}

function mergeCollectedActions(
  existing: ToolAction[],
  incoming: ToolAction[]
): ToolAction[] {
  const merged = existing.map((action) => ({ ...action }));
  const matched = new Set<number>();
  for (const action of incoming) {
    const index = merged.findIndex((candidate, candidateIndex) =>
      !matched.has(candidateIndex) &&
      (
        (
          action.id &&
          candidate.id &&
          action.id === candidate.id
        ) ||
        (
          action.kind === candidate.kind &&
          action.tool === candidate.tool &&
          action.path === candidate.path &&
          action.detail === candidate.detail
        )
      )
    );
    if (index >= 0) {
      matched.add(index);
      if (action.id) merged[index].id = action.id;
      if (action.ok !== undefined) merged[index].ok = action.ok;
    } else {
      merged.push({ ...action });
    }
  }
  return merged;
}

function sameTurnWindow(node: TimelineNode, turn: CollectedTurn): boolean {
  return (
    Math.abs(Date.parse(node.startedAt) - Date.parse(turn.startedAt)) <=
      2 * 60_000 &&
    Math.abs(Date.parse(node.completedAt) - Date.parse(turn.completedAt)) <=
      2 * 60_000
  );
}

function turnDistance(node: TimelineNode, turn: CollectedTurn): number {
  const started = Math.abs(
    Date.parse(node.startedAt) - Date.parse(turn.startedAt)
  );
  const completed = Math.abs(
    Date.parse(node.completedAt) - Date.parse(turn.completedAt)
  );
  return Number.isFinite(started) && Number.isFinite(completed)
    ? started + completed
    : Number.POSITIVE_INFINITY;
}
