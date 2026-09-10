const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  parseCodexRollout,
  parseClaudeTranscript,
  parseApplyPatch,
  collectSessions
} = require("../out/sessionCollector.js");
const { readProjectState } = require("../out/storage.js");

// The real desktop-app "讲个冷笑话" rollout: a mid-turn model switch
// (gpt-5.2 -> gpt-5.5) replays the same user prompt, and no lifecycle hook
// fires for plain chat in the desktop client. This is the exact sample the
// collector must handle.
function coldJokeRollout(cwd) {
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T09:11:46.000Z", payload: {
      id: "01a08a96-cold-joke", cwd, model_provider: "gotocc", cli_version: "0.153.4" } },
    { type: "event_msg", timestamp: "2026-09-10T09:11:46.100Z", payload: { type: "task_started" } },
    { type: "response_item", timestamp: "2026-09-10T09:11:46.200Z", payload: {
      type: "message", role: "developer", content: [{ type: "text", text: "<app-context>desktop</app-context>" }] } },
    { type: "response_item", timestamp: "2026-09-10T09:11:46.300Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "<environment_context><cwd>" + cwd + "</cwd></environment_context>" }] } },
    { type: "turn_context", timestamp: "2026-09-10T09:11:46.400Z", payload: { model: "gpt-5.2" } },
    { type: "response_item", timestamp: "2026-09-10T09:11:46.500Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "讲个冷笑话" }] } },
    { type: "response_item", timestamp: "2026-09-10T09:12:00.000Z", payload: {
      type: "message", role: "developer", content: [{ type: "text", text: "<model_switch>switch to gpt-5.5</model_switch>" }] } },
    { type: "turn_context", timestamp: "2026-09-10T09:12:00.100Z", payload: { model: "gpt-5.5" } },
    { type: "response_item", timestamp: "2026-09-10T09:12:00.200Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "讲个冷笑话" }] } },
    { type: "response_item", timestamp: "2026-09-10T09:12:05.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "text", text: "为什么冰箱总是很冷静？\n\n因为它有“冷”处理能力。" }] } },
    { type: "event_msg", timestamp: "2026-09-10T09:12:05.100Z", payload: { type: "task_complete" } }
  ];
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function writeCodexRollout(codexHome, cwd) {
  const dir = path.join(codexHome, "sessions", "2026", "09", "10");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "rollout-2026-09-10T17-11-46-01a08a96-cold-joke.jsonl");
  fs.writeFileSync(file, coldJokeRollout(cwd));
  return file;
}

test("parses cold-joke rollout into a single deduped turn", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-parse-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = writeCodexRollout(sandbox, cwd);

  const session = parseCodexRollout(file);
  assert.equal(session.host, "codex");
  assert.equal(session.cwd, cwd);
  // The replayed prompt from the model switch must collapse to one turn.
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].prompt, "讲个冷笑话");
  assert.equal(
    session.turns[0].response,
    "为什么冰箱总是很冷静？\n\n因为它有“冷”处理能力。"
  );
  // Envelope/system messages must never become prompts.
  assert.ok(!session.turns.some((turn) => turn.prompt.includes("environment_context")));
});

test("collects desktop chat into the right project without hooks", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-run-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  writeCodexRollout(codexHome, cwd);

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const first = await collectSessions();
  assert.equal(first.newTurns, 1, "should collect exactly one chat turn");
  assert.equal(first.projects.length, 1);

  const state = await readProjectState(cwd);
  assert.ok(state, "project state should exist");
  const collected = state.nodes.filter((node) => node.kind === "collected");
  assert.equal(collected.length, 1);
  assert.equal(collected[0].prompt, "讲个冷笑话");
  assert.equal(collected[0].sourceHost, "codex");
  assert.equal(collected[0].source.type, "rollout");
  assert.equal(collected[0].source.host, "codex");
  assert.equal(collected[0].files.length, 0, "chat turns carry no fabricated diffs");

  // Second run must be idempotent (cursor + dedup).
  const second = await collectSessions();
  assert.equal(second.newTurns, 0, "re-running must not duplicate turns");
  const state2 = await readProjectState(cwd);
  assert.equal(
    state2.nodes.filter((node) => node.kind === "collected").length,
    1
  );
});

test("appends only new turns when a session grows", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-grow-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "10");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "rollout-grow.jsonl");

  const base = [
    { type: "session_meta", timestamp: "2026-09-10T10:00:00.000Z", payload: { id: "grow-1", cwd } },
    { type: "response_item", timestamp: "2026-09-10T10:00:01.000Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "第一个问题" }] } },
    { type: "response_item", timestamp: "2026-09-10T10:00:02.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "text", text: "第一个回答" }] } }
  ];
  fs.writeFileSync(file, base.map((l) => JSON.stringify(l)).join("\n") + "\n");

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const first = await collectSessions();
  assert.equal(first.newTurns, 1);

  // Append a second turn to the same session file.
  const more = [
    { type: "response_item", timestamp: "2026-09-10T10:05:00.000Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "第二个问题" }] } },
    { type: "response_item", timestamp: "2026-09-10T10:05:01.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "text", text: "第二个回答" }] } }
  ];
  fs.appendFileSync(file, more.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const second = await collectSessions();
  assert.equal(second.newTurns, 1, "only the newly appended turn is collected");

  const state = await readProjectState(cwd);
  const prompts = state.nodes
    .filter((node) => node.kind === "collected")
    .map((node) => node.prompt);
  assert.deepEqual(prompts, ["第一个问题", "第二个问题"]);
});

test("parses Claude transcript turns and skips tool-result envelopes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-claude-"));
  const cwd = path.join(sandbox, "proj");
  fs.mkdirSync(cwd, { recursive: true });
  const dir = path.join(sandbox, "claude", "projects", "encoded-proj");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "session-abc.jsonl");
  const lines = [
    { type: "user", timestamp: "2026-09-10T11:00:00.000Z", cwd, sessionId: "abc",
      message: { role: "user", content: "帮我看看这个 bug" } },
    { type: "assistant", timestamp: "2026-09-10T11:00:05.000Z",
      message: { role: "assistant", content: [
        { type: "text", text: "我来排查一下" },
        { type: "tool_use", name: "Read", input: { file_path: "/x/app.js" } }
      ] } },
    { type: "user", timestamp: "2026-09-10T11:00:06.000Z",
      message: { role: "user", content: [{ type: "tool_result", content: "file body" }] } },
    { type: "assistant", timestamp: "2026-09-10T11:00:10.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "找到了问题所在" }] } }
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const session = parseClaudeTranscript(file);
  assert.equal(session.host, "claude");
  assert.equal(session.cwd, cwd);
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].prompt, "帮我看看这个 bug");
  // One coding turn: both assistant texts (before and after the tool use)
  // belong to the same turn and are accumulated in order.
  assert.equal(session.turns[0].response, "我来排查一下\n找到了问题所在");
  assert.ok(session.turns[0].actions.some((action) => action.tool === "Read"));
});

test("parseApplyPatch counts additions/deletions per file and status", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: src/new.ts",
    "+export const a = 1;",
    "+export const b = 2;",
    "*** Update File: src/existing.ts",
    "@@ context",
    "-const old = 1;",
    "+const next = 2;",
    "+const extra = 3;",
    "*** Delete File: src/gone.ts",
    "*** End Patch"
  ].join("\n");
  const changes = parseApplyPatch(patch);
  const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));

  assert.equal(byPath["src/new.ts"].status, "A");
  assert.equal(byPath["src/new.ts"].additions, 2);
  assert.equal(byPath["src/new.ts"].deletions, 0);

  assert.equal(byPath["src/existing.ts"].status, "M");
  assert.equal(byPath["src/existing.ts"].additions, 2);
  assert.equal(byPath["src/existing.ts"].deletions, 1);

  assert.equal(byPath["src/gone.ts"].status, "D");
});

test("Codex apply_patch turn carries real file changes (not files:[])", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-codex-patch-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const dir = path.join(sandbox, "codex", "sessions", "2026", "09", "10");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "rollout-patch.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: app.js",
    "+console.log(1);",
    "+console.log(2);",
    "*** End Patch"
  ].join("\n");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z", payload: { id: "patch-1", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "创建 app.js" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z", payload: {
      type: "function_call", name: "apply_patch", call_id: "c1",
      arguments: JSON.stringify({ input: patch }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z", payload: {
      type: "function_call_output", call_id: "c1", output: "Success" } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "text", text: "已创建 app.js" }] } }
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const session = parseCodexRollout(file);
  assert.equal(session.turns.length, 1);
  const turn = session.turns[0];
  assert.equal(turn.files.length, 1);
  assert.equal(turn.files[0].path, "app.js");
  assert.equal(turn.files[0].status, "A");
  assert.equal(turn.files[0].additions, 2);
  assert.ok(turn.actions.some((action) => action.tool === "apply_patch"));
});

test("Claude Write/Edit/MultiEdit produce merged file changes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-claude-edit-"));
  const cwd = path.join(sandbox, "proj");
  fs.mkdirSync(cwd, { recursive: true });
  const dir = path.join(sandbox, "claude", "projects", "enc");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "s.jsonl");
  const lines = [
    { type: "user", timestamp: "2026-09-10T13:00:00.000Z", cwd, sessionId: "s",
      message: { role: "user", content: "改代码" } },
    { type: "assistant", timestamp: "2026-09-10T13:00:01.000Z",
      message: { role: "assistant", content: [
        { type: "tool_use", name: "Write", input: { file_path: "a.ts", content: "line1\nline2\nline3\n" } },
        { type: "tool_use", name: "Edit", input: { file_path: "b.ts", old_string: "x\ny", new_string: "z" } },
        { type: "tool_use", name: "MultiEdit", input: { file_path: "b.ts", edits: [
          { old_string: "p", new_string: "q\nr" }
        ] } }
      ] } },
    { type: "assistant", timestamp: "2026-09-10T13:00:02.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "完成" }] } }
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const session = parseClaudeTranscript(file);
  assert.equal(session.turns.length, 1);
  const byPath = Object.fromEntries(session.turns[0].files.map((c) => [c.path, c]));

  assert.equal(byPath["a.ts"].status, "A");
  assert.equal(byPath["a.ts"].additions, 3);

  // b.ts touched by Edit (2 del,1 add) then MultiEdit (1 del,2 add) → merged.
  assert.equal(byPath["b.ts"].status, "M");
  assert.equal(byPath["b.ts"].additions, 3);
  assert.equal(byPath["b.ts"].deletions, 3);
});
