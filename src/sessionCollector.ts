import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import { AgentHost, FileChange, TimelineNode, ToolAction } from "./models";
import { ShadowRepo } from "./shadowRepo";
import {
  createId,
  latestNodeOnBranch,
  mutateProjectState,
  normalizeRoot,
  readProjectConfig,
  wayfinderHome
} from "./storage";

/**
 * Session collector.
 *
 * Codex and Claude Code always persist every session to local transcript
 * files, regardless of whether lifecycle hooks are trusted/enabled. Desktop
 * clients (ChatGPT.app, Claude.app) run those same engines but never surface
 * the TUI hook-trust prompt, so hooks never fire there. Reading the transcript
 * files directly is how every comparable local tool captures sessions, and it
 * covers plain chat as well as coding turns.
 *
 * This module only PARSES transcripts into candidate turns. Persisting them
 * into project state (dedup, snapshots, branch linking) is done by the caller.
 */

export interface CollectedTurn {
  host: AgentHost;
  sessionId: string;
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
  sessionId: string;
  rolloutPath: string;
  cwd?: string;
  turns: CollectedTurn[];
}

const ENV_CONTEXT = /^\s*<(environment_context|app-context|user_instructions|system_instructions|developer_instructions)/i;

export function codexSessionsRoot(): string {
  if (process.env.CODEX_SESSIONS_ROOT) {
    return process.env.CODEX_SESSIONS_ROOT;
  }
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "sessions");
}

export function claudeProjectsRoot(): string {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(home, "projects");
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
  return ENV_CONTEXT.test(text.trimStart().slice(0, 40)) ||
    text.trimStart().startsWith("<");
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
  let pendingPrompt: { text: string; at: string } | undefined;
  let pendingActions: ToolAction[] = [];
  let pendingOperations: PendingFileOperation[] = [];
  const calls = new Map<string, PendingFileOperation>();

  const flush = (responseText: string | undefined, at: string): void => {
    if (!pendingPrompt) {
      return;
    }
    turns.push({
      host: "codex",
      sessionId,
      rolloutPath: file,
      turnIndex: turns.length,
      cwd,
      prompt: pendingPrompt.text,
      response: responseText?.trim() || undefined,
      actions: pendingActions,
      files: committedFileChanges(pendingOperations),
      startedAt: pendingPrompt.at,
      completedAt: at
    });
    pendingPrompt = undefined;
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
        // A fresh user prompt closes any previous unanswered turn — unless it
        // is an identical replay (e.g. a mid-turn model switch re-sends the
        // same prompt). In that case keep one turn, don't invent two.
        if (pendingPrompt && pendingPrompt.text !== text) {
          flush(undefined, pendingPrompt.at);
        }
        if (!pendingPrompt || pendingPrompt.text !== text) {
          pendingPrompt = { text, at: timestamp };
        }
      } else if (role === "assistant") {
        flush(text, timestamp);
      }
      continue;
    }

    if (
      record.type === "response_item" &&
      (payloadType === "function_call" || payloadType === "local_shell_call")
    ) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const action = toolActionFromCall(name, payload);
      const operation = {
        action,
        changes: fileChangesFromCall(name, payload),
        status: "pending" as const
      };
      pendingActions.push(action);
      pendingOperations.push(operation);
      if (callId) {
        calls.set(callId, operation);
      }
      continue;
    }

    if (record.type === "response_item" && payloadType === "function_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const ok = !outputLooksFailed(payload.output);
      const operation = callId
        ? calls.get(callId)
        : pendingOperations.at(-1);
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
      const response = [payload.last_agent_message, payload.error, payload.reason]
        .find((value) => typeof value === "string") as string | undefined;
      flush(response, timestamp);
    }
  }

  return { host: "codex", sessionId, rolloutPath: file, cwd, turns };
}

/** Parse a single Claude Code JSONL transcript into an ordered list of turns. */
export function parseClaudeTranscript(file: string): CollectedSession | undefined {
  const records = parseJsonl(file);
  if (records.length === 0) {
    return undefined;
  }

  let sessionId = path.basename(file, ".jsonl");
  let cwd: string | undefined;
  const turns: CollectedTurn[] = [];
  let pendingPrompt: { text: string; at: string } | undefined;
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
      sessionId,
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
    if (typeof record.cwd === "string" && !cwd) {
      cwd = record.cwd;
    }
    if (typeof record.sessionId === "string") {
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
      pendingPrompt = { text, at: timestamp };
      lastAt = timestamp;
    } else if (record.type === "assistant" || role === "assistant") {
      // Assistant text + tool_use all belong to the current turn; accumulate
      // rather than closing the turn on the first assistant line.
      collectClaudeToolUses(
        message.content,
        pendingActions,
        pendingOperations,
        calls
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

  return { host: "claude", sessionId, rolloutPath: file, cwd, turns };
}

function toolActionFromCall(
  name: string,
  payload: Record<string, unknown>
): ToolAction {
  let detail: string | undefined;
  let filePath: string | undefined;
  const args = typeof payload.arguments === "string"
    ? safeJson(payload.arguments)
    : asRecord(payload.arguments);
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
    path: filePath ? clipInline(filePath, 300) : undefined,
    detail: detail ? clipInline(detail, 300) : undefined
  };
}

function collectClaudeToolUses(
  content: unknown,
  actions: ToolAction[],
  operations: PendingFileOperation[],
  calls: Map<string, PendingFileOperation>
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
      path: filePath ? clipInline(filePath, 300) : undefined,
      detail: detail ? clipInline(detail, 300) : undefined
    };
    const operation = {
      action,
      changes: claudeFileChangesForUse(name, input),
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
// Session transcripts already record what the model wrote: apply_patch carries
// a patch envelope, Write carries full content, Edit carries old/new strings.
// Replaying those to count added/removed lines is how session-recovery tools
// reconstruct diffs — recorded fact, not a guess from the working tree.

function relPath(filePath: string): string {
  return filePath.replace(/^\.\//, "");
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
  const existing = map.get(change.path);
  if (!existing) {
    map.set(change.path, { ...change });
    return;
  }
  existing.additions += change.additions;
  existing.deletions += change.deletions;
  if (change.status === "D") {
    existing.status = "D";
  } else if (existing.status !== "A") {
    existing.status = "M";
  }
  existing.binary = existing.binary || change.binary;
}

function editChange(
  filePath: string,
  oldString: string,
  newString: string
): FileChange {
  return {
    path: relPath(filePath),
    status: "M",
    additions: countLines(newString),
    deletions: countLines(oldString)
  };
}

/** File changes from a Codex function_call (apply_patch / Write / Edit). */
function fileChangesFromCall(
  name: string,
  payload: Record<string, unknown>
): FileChange[] {
  const args = typeof payload.arguments === "string"
    ? safeJson(payload.arguments)
    : asRecord(payload.arguments);
  if (name === "apply_patch") {
    let patch: string | undefined;
    if (args && typeof args.input === "string") {
      patch = args.input;
    } else if (args && typeof args.patch === "string") {
      patch = args.patch;
    } else if (typeof payload.arguments === "string" && !args) {
      patch = payload.arguments;
    }
    return patch ? parseApplyPatch(patch) : [];
  }
  if (name === "Write" && args && typeof args.file_path === "string") {
    return [{
      path: relPath(args.file_path),
      status: "A",
      additions: countLines(String(args.content || "")),
      deletions: 0
    }];
  }
  if (name === "Edit" && args && typeof args.file_path === "string") {
    return [editChange(
      String(args.file_path),
      String(args.old_string || ""),
      String(args.new_string || "")
    )];
  }
  return [];
}

/** File changes from Claude tool_use blocks (Write / Edit / MultiEdit). */
function claudeFileChangesForUse(
  name: string,
  input: Record<string, unknown>
): FileChange[] {
  const changes: FileChange[] = [];
  const filePath = typeof input.file_path === "string"
    ? input.file_path
    : undefined;
  if (!filePath) {
    return changes;
  }
  if (name === "Write") {
    changes.push({
      path: relPath(filePath),
      status: "A",
      additions: countLines(String(input.content || "")),
      deletions: 0
    });
  } else if (name === "Edit") {
    changes.push(editChange(
      filePath,
      String(input.old_string || ""),
      String(input.new_string || "")
    ));
  } else if (name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const raw of input.edits) {
      const edit = asRecord(raw);
      if (!edit) {
        continue;
      }
      changes.push(editChange(
        filePath,
        String(edit.old_string || ""),
        String(edit.new_string || "")
      ));
    }
  }
  return changes;
}

/** Parse a Codex apply_patch envelope into per-file line-change counts. */
export function parseApplyPatch(patch: string): FileChange[] {
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
      current = { path: relPath(add[1].trim()), status: "A", additions: 0, deletions: 0 };
      continue;
    }
    if (update) {
      push();
      current = { path: relPath(update[1].trim()), status: "M", additions: 0, deletions: 0 };
      continue;
    }
    if (del) {
      push();
      current = { path: relPath(del[1].trim()), status: "D", additions: 0, deletions: 0 };
      continue;
    }
    if (/^\*\*\* End of File$/.test(line) || /^\*\*\* End Patch$/.test(line)) {
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("@@") || line.startsWith("*** Move to:")) {
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

function outputLooksFailed(output: unknown): boolean {
  const record = asRecord(output);
  if (record) {
    if (typeof record.success === "boolean") {
      return !record.success;
    }
    const exitCode = [record.exit_code, record.exitCode, record.code]
      .find((value) => typeof value === "number");
    if (typeof exitCode === "number") {
      return exitCode !== 0;
    }
  }
  const text = typeof output === "string" ? output : JSON.stringify(output || "");
  if (/process exited with code 0|exit code[:= ]+0\b/i.test(text)) {
    return false;
  }
  return (
    /"?(error|failed|exception|traceback)"?/i.test(text) ||
    /invalid context|permission denied|file not found/i.test(text)
  );
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

interface CollectorCursor {
  version: 1;
  files: Record<string, { size: number; collectedTurns: number }>;
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
    if (parsed.version === 1 && parsed.files) {
      return parsed;
    }
  } catch {
    // Fresh cursor.
  }
  return { version: 1, files: {} };
}

async function writeCursor(cursor: CollectorCursor): Promise<void> {
  const file = collectorStatePath();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${createId("cursor")}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(cursor, null, 2)}\n`, "utf8");
  await fs.promises.rename(temp, file);
}

/** Resolve a transcript cwd to an existing project root, or undefined. */
function resolveProjectRoot(cwd: string | undefined): string | undefined {
  if (!cwd || !fs.existsSync(cwd)) {
    return undefined;
  }
  try {
    return normalizeRoot(cwd);
  } catch {
    return undefined;
  }
}

/**
 * Collect all Codex + Claude transcripts into project timelines.
 *
 * Idempotent: a per-file cursor tracks how many turns were already persisted,
 * so re-running only appends genuinely new turns. Turns are also deduped
 * against existing nodes (including hook-produced ones) by rollout provenance
 * and by (sessionId, prompt, response) so a session captured by both a hook
 * and this collector is never double-recorded.
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
  const codexFiles = listTranscriptFiles(codexSessionsRoot());
  const claudeFiles = listTranscriptFiles(claudeProjectsRoot());
  const result: CollectRunResult = {
    scannedFiles: 0,
    newTurns: 0,
    projects: [],
    skippedNoProject: 0
  };
  const touchedProjects = new Set<string>();

  const process_ = async (
    file: string,
    parse: (file: string) => CollectedSession | undefined
  ): Promise<void> => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return;
    }
    const previous = cursor.files[file];
    // Skip files that haven't grown since last run.
    if (previous && previous.size === stat.size) {
      return;
    }
    result.scannedFiles += 1;
    const session = parse(file);
    if (!session || session.turns.length === 0) {
      cursor.files[file] = {
        size: stat.size,
        collectedTurns: previous?.collectedTurns || 0
      };
      return;
    }
    const alreadyCollected = previous?.collectedTurns || 0;
    const fresh = session.turns.filter((turn) => turn.turnIndex >= alreadyCollected);
    if (fresh.length === 0) {
      cursor.files[file] = { size: stat.size, collectedTurns: alreadyCollected };
      return;
    }

    const root = resolveProjectRoot(session.cwd);
    if (!root) {
      // No usable project directory — record cursor so we don't rescan, but
      // count it as skipped rather than inventing a home for it.
      result.skippedNoProject += fresh.length;
      cursor.files[file] = { size: stat.size, collectedTurns: session.turns.length };
      return;
    }

    const persisted = await persistTurns(root, session.host, fresh);
    result.newTurns += persisted;
    touchedProjects.add(root);
    cursor.files[file] = { size: stat.size, collectedTurns: session.turns.length };
  };

  for (const file of codexFiles) {
    await process_(file, parseCodexRollout);
  }
  for (const file of claudeFiles) {
    await process_(file, parseClaudeTranscript);
  }

  await writeCursor(cursor);
  result.projects = [...touchedProjects];
  return result;
}

async function persistTurns(
  root: string,
  host: AgentHost,
  turns: CollectedTurn[]
): Promise<number> {
  const config = await readProjectConfig(root);
  return mutateProjectState(root, async (state) => {
    // Baseline snapshot of current working tree; collected turns cannot
    // reconstruct historical file contents, so they share one baseline and
    // carry no fabricated diffs.
    const shadow = new ShadowRepo(root, config.maxFileSizeMB);
    let baseline: string | undefined;
    let added = 0;

    for (const turn of turns) {
      const scopedSession = `${host}:${turn.sessionId}`;
      const nodeId = `collected-${host}-${safeId(turn.sessionId)}-${turn.turnIndex}`;

      // Dedup: exact node id, or a hook-produced node with the same session +
      // prompt (+ response when known).
      const duplicate = state.nodes.some((node) => {
        if (node.id === nodeId) {
          return true;
        }
        if (node.sessionId !== scopedSession) {
          return false;
        }
        if (node.prompt !== turn.prompt) {
          return false;
        }
        return !turn.response || !node.response || node.response === turn.response;
      });
      if (duplicate) {
        continue;
      }

      if (!baseline) {
        baseline = (
          await shadow.capture(createId("collect-baseline"), `Collected: ${host}`)
        ).commit;
      }
      const parent = latestNodeOnBranch(state);
      const node: TimelineNode = {
        id: nodeId,
        kind: "collected",
        sessionId: scopedSession,
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
        source: {
          type: "rollout",
          host,
          rolloutPath: turn.rolloutPath,
          sessionId: turn.sessionId,
          turnIndex: turn.turnIndex,
          collectedAt: new Date().toISOString()
        }
      };
      state.nodes.push(node);
      added += 1;
    }
    return added;
  });
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}
