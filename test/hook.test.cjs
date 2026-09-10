const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");

const { processHookEvent } = require("../out/hook.js");
const { ShadowRepo } = require("../out/shadowRepo.js");
const {
  readProjectState,
  writeProjectConfig
} = require("../out/storage.js");

test("TRAE hooks bind one prompt to actions, files, and validation", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-hook-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "app.js"), "module.exports = 1;\n");
  await writeProjectConfig(root, {
    validationCommand: "node -e \"process.exit(0)\"",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });

  await processHookEvent({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-1",
    cwd: root,
    prompt: "Add the second implementation"
  });
  fs.writeFileSync(path.join(root, "app.js"), "module.exports = 2;\n");
  await processHookEvent({
    hook_event_name: "PostToolUse",
    session_id: "session-1",
    cwd: root,
    tool_use_id: "tool-1",
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "app.js") },
    tool_response: { ok: true }
  });
  await processHookEvent({
    hook_event_name: "Stop",
    session_id: "session-1",
    cwd: root,
    last_assistant_message: "Updated the implementation."
  });

  const state = await readProjectState(root);
  assert.ok(state);
  assert.equal(state.nodes.length, 2);
  assert.equal(state.nodes[0].prompt, "初始状态");
  const turn = state.nodes[1];
  assert.equal(turn.prompt, "Add the second implementation");
  assert.equal(turn.response, "Updated the implementation.");
  assert.equal(turn.files[0].path, "app.js");
  assert.equal(turn.actions[0].tool, "Edit");
  assert.equal(turn.validation.status, "passed");
  assert.equal(turn.sourceHost, "trae");
  assert.equal(Object.keys(state.pending).length, 0);
});

test("Claude and Codex sessions with the same id remain isolated", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-hosts-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "app.js"), "one\n");
  await writeProjectConfig(root, {
    validationCommand: "",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });

  await processHookEvent({
    wayfinder_host: "claude",
    hook_event_name: "UserPromptSubmit",
    session_id: "shared",
    cwd: root,
    prompt: "Claude turn"
  });
  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "UserPromptSubmit",
    session_id: "shared",
    cwd: root,
    prompt: "Codex turn"
  });
  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "PostToolUse",
    session_id: "shared",
    tool_use_id: "codex-edit-1",
    cwd: root,
    tool_name: "apply_patch",
    tool_input: { file_path: path.join(root, "app.js") },
    tool_response: { ok: true }
  });
  // A Plugin and the Companion connector may both deliver the same Hook.
  // Host tool ids make that delivery idempotent.
  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "PostToolUse",
    session_id: "shared",
    tool_use_id: "codex-edit-1",
    cwd: root,
    tool_name: "apply_patch",
    tool_input: { file_path: path.join(root, "app.js") },
    tool_response: { ok: true }
  });

  const state = await readProjectState(root);
  assert.ok(state);
  assert.equal(state.pending["claude:shared"].sourceHost, "claude");
  assert.equal(state.pending["codex:shared"].sourceHost, "codex");
  assert.equal(state.pending["codex:shared"].actions[0].kind, "edit");
  assert.equal(state.pending["codex:shared"].actions.length, 1);
});

test("Claude PostToolUseFailure is recorded as failed action evidence", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-tool-fail-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "app.js"), "one\n");
  await writeProjectConfig(root, {
    validationCommand: "",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });

  await processHookEvent({
    wayfinder_host: "claude",
    hook_event_name: "UserPromptSubmit",
    session_id: "failed-tool",
    cwd: root,
    prompt: "Run a failing command"
  });
  await processHookEvent({
    wayfinder_host: "claude",
    hook_event_name: "PostToolUseFailure",
    session_id: "failed-tool",
    tool_use_id: "failed-bash-1",
    cwd: root,
    tool_name: "Bash",
    tool_input: { command: "exit 2" },
    error: "command failed"
  });

  const pending = (await readProjectState(root)).pending["claude:failed-tool"];
  assert.equal(pending.actions.length, 1);
  assert.equal(pending.actions[0].tool, "Bash");
  assert.equal(pending.actions[0].ok, false);
});

test("session lifecycle writes only local companion activity", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-lifecycle-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });

  await processHookEvent({
    wayfinder_host: "claude",
    hook_event_name: "SessionStart",
    session_id: "claude-new",
    cwd: root
  });
  let activity = JSON.parse(fs.readFileSync(
    path.join(process.env.WAYFINDER_HOME, "activity.json"),
    "utf8"
  ));
  assert.equal(activity.status, "active");
  assert.equal(activity.sourceHost, "claude");

  await processHookEvent({
    wayfinder_host: "claude",
    hook_event_name: "SessionEnd",
    session_id: "claude-new",
    cwd: root
  });
  activity = JSON.parse(fs.readFileSync(
    path.join(process.env.WAYFINDER_HOME, "activity.json"),
    "utf8"
  ));
  assert.equal(activity.status, "ended");
  assert.equal(activity.root, fs.realpathSync(root));
});

test("a failed command becomes a failed validation node", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-fail-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "app.js"), "ok\n");
  await writeProjectConfig(root, {
    validationCommand:
      "node -e \"console.error('expected failure'); process.exit(2)\"",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });

  await processHookEvent({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-2",
    cwd: root,
    prompt: "Break the implementation"
  });
  fs.writeFileSync(path.join(root, "app.js"), "broken\n");
  await processHookEvent({
    hook_event_name: "Stop",
    session_id: "session-2",
    cwd: root,
    last_assistant_message: "Done."
  });

  const state = await readProjectState(root);
  assert.ok(state);
  const turn = state.nodes.find((node) => node.kind === "turn");
  assert.ok(turn);
  assert.equal(turn.validation.status, "failed");
  assert.equal(turn.validation.exitCode, 2);
  assert.match(turn.validation.summary, /expected failure/);
});

test("a new prompt does not erase a turn that is still validating", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-overlap-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "app.js"), "one\n");
  await writeProjectConfig(root, {
    validationCommand: "node -e \"setTimeout(() => {}, 250)\"",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });

  await processHookEvent({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-overlap",
    cwd: root,
    prompt: "First turn"
  });
  fs.writeFileSync(path.join(root, "app.js"), "two\n");
  const stopping = processHookEvent({
    hook_event_name: "Stop",
    session_id: "session-overlap",
    cwd: root,
    last_assistant_message: "First done."
  });

  await waitFor(async () => {
    const state = await readProjectState(root);
    return state?.nodes.some(
      (node) => node.kind === "turn" && node.validation.status === "running"
    );
  });
  await processHookEvent({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-overlap",
    cwd: root,
    prompt: "Second turn"
  });
  await stopping;

  const state = await readProjectState(root);
  assert.ok(state);
  const firstTurn = state.nodes.find((node) => node.prompt === "First turn");
  assert.ok(firstTurn);
  assert.equal(
    state.nodes.filter((node) => node.prompt === "Manual changes").length,
    0
  );
  assert.equal(state.pending["session-overlap"].prompt, "Second turn");
  assert.equal(state.pending["session-overlap"].parentId, firstTurn.id);
});

test("a capture failure is recorded even when the next prompt has started", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-capture-fail-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "app.js"), "one\n");
  await writeProjectConfig(root, {
    validationCommand: "",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });

  await processHookEvent({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-failure",
    cwd: root,
    prompt: "First turn"
  });
  fs.writeFileSync(path.join(root, "app.js"), "two\n");

  const originalCapture = ShadowRepo.prototype.capture;
  ShadowRepo.prototype.capture = async function capture(id, ...args) {
    if (id.startsWith("turn-")) {
      await delay(100);
      throw new Error("simulated capture failure");
    }
    return originalCapture.call(this, id, ...args);
  };

  try {
    const stopping = processHookEvent({
      hook_event_name: "Stop",
      session_id: "session-failure",
      cwd: root,
      last_assistant_message: "First done."
    });
    const stoppingFailed = assert.rejects(
      stopping,
      /simulated capture failure/
    );
    await delay(20);
    await processHookEvent({
      hook_event_name: "UserPromptSubmit",
      session_id: "session-failure",
      cwd: root,
      prompt: "Second turn"
    });
    await stoppingFailed;
  } finally {
    ShadowRepo.prototype.capture = originalCapture;
  }

  const state = await readProjectState(root);
  assert.ok(state);
  const failed = state.nodes.find((node) => node.prompt === "First turn");
  assert.ok(failed);
  assert.equal(
    state.nodes.filter((node) => node.prompt === "First turn").length,
    1
  );
  assert.equal(failed.validation.status, "failed");
  assert.match(failed.validation.summary, /文件变化未归档/);
  assert.equal(state.pending["session-failure"].prompt, "Second turn");
  const manual = state.nodes.find((node) => node.prompt === "Manual changes");
  assert.ok(manual);
  assert.equal(state.pending["session-failure"].parentId, manual.id);
});

async function waitFor(predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(20);
  }
  throw new Error("condition was not met");
}
