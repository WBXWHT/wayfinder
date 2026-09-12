const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  claudeCoworkSessionRoots,
  claudeCoworkSessionsRoot,
  codexArchivedSessionsRoot,
  parseCodexRollout,
  parseClaudeCoworkTranscript,
  parseClaudeTranscript,
  parseApplyPatch,
  collectSessions,
  listCoworkAuditFiles,
  resolveClaudeCoworkSessionRoots,
  unfiledConversationsRoot
} = require("../out/sessionCollector.js");
const { processHookEvent } = require("../out/hook.js");
const {
  readProjectState,
  writeProjectConfig
} = require("../out/storage.js");

const missingCoworkRoot = path.join(
  os.tmpdir(),
  `wayfinder-test-no-cowork-${process.pid}`
);
process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;

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

function codexConversationRollout(cwd, sessionId, prompt, response) {
  return [
    {
      type: "session_meta",
      timestamp: "2026-09-10T09:00:00.000Z",
      payload: { id: sessionId, cwd }
    },
    {
      type: "response_item",
      timestamp: "2026-09-10T09:00:01.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: prompt }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-10T09:00:02.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: response }]
      }
    }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function writeCoworkTranscript(
  coworkRoot,
  cwd,
  sessionId = "cowork-session",
  prompt = "整理这份研究",
  response = "已经整理完成"
) {
  const profile = path.join(coworkRoot, "account", "organization");
  const sessionDir = path.join(profile, `local_${sessionId}`);
  const file = path.join(sessionDir, "audit.jsonl");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    `${sessionDir}.json`,
    JSON.stringify({
      sessionId: `local_${sessionId}`,
      title: "研究整理",
      userSelectedFolders: cwd ? [cwd] : [],
      cwd: "/sessions/cowork-sandbox"
    })
  );
  const lines = [
    {
      type: "user",
      uuid: `${sessionId}-user`,
      session_id: sessionId,
      _audit_timestamp: "2026-09-10T14:00:00.000Z",
      _audit_hmac: "must-not-leak",
      message: { role: "user", content: prompt }
    },
    {
      type: "assistant",
      uuid: `${sessionId}-assistant`,
      session_id: sessionId,
      _audit_timestamp: "2026-09-10T14:00:01.000Z",
      _audit_hmac: "must-not-leak",
      message: {
        id: `${sessionId}-message`,
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: response }]
      }
    }
  ];
  fs.writeFileSync(
    file,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`
  );
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

test("discovers archived Codex and Claude Cowork transcript roots", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-source-roots-"));
  const codexHome = path.join(sandbox, "codex");
  const coworkRoot = path.join(sandbox, "cowork");
  process.env.CODEX_HOME = codexHome;
  delete process.env.CODEX_SESSIONS_ROOT;
  delete process.env.CODEX_ARCHIVED_SESSIONS_ROOT;
  process.env.CLAUDE_COWORK_ROOT = coworkRoot;

  assert.equal(
    codexArchivedSessionsRoot(),
    path.join(codexHome, "archived_sessions")
  );
  assert.equal(claudeCoworkSessionsRoot(), coworkRoot);
  assert.deepEqual(claudeCoworkSessionRoots(), [coworkRoot]);

  const audit = writeCoworkTranscript(coworkRoot, undefined);
  const nested = path.join(path.dirname(audit), ".claude", "nested.jsonl");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, "{}\n");
  const deeperAudit = writeCoworkTranscript(
    path.join(coworkRoot, "account"),
    undefined,
    "deeper-cowork"
  );
  assert.deepEqual(
    listCoworkAuditFiles(coworkRoot),
    [deeperAudit, audit].sort()
  );

  process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;
});

test("discovers roaming, local, and Store Cowork roots on Windows", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-win-cowork-"));
  const appData = path.join(sandbox, "Roaming");
  const localAppData = path.join(sandbox, "Local");
  const storePackage = path.join(localAppData, "Packages", "Claude_test");
  fs.mkdirSync(storePackage, { recursive: true });

  const roots = resolveClaudeCoworkSessionRoots({
    platform: "win32",
    home: sandbox,
    appData,
    localAppData
  });
  assert.deepEqual(roots, [
    path.join(appData, "Claude", "local-agent-mode-sessions"),
    path.join(localAppData, "Claude", "local-agent-mode-sessions"),
    path.join(
      storePackage,
      "LocalCache",
      "Roaming",
      "Claude",
      "local-agent-mode-sessions"
    )
  ]);
});

test("parses Claude Cowork messages with their selected project", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cowork-parse-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const file = writeCoworkTranscript(
    path.join(sandbox, "cowork"),
    cwd,
    "cowork-parse"
  );

  const session = parseClaudeCoworkTranscript(file);
  assert.equal(session.host, "claude");
  assert.equal(session.sessionId, "cowork-parse");
  assert.equal(session.cwd, cwd);
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].turnId, "cowork-parse-user");
  assert.equal(session.turns[0].prompt, "整理这份研究");
  assert.equal(session.turns[0].response, "已经整理完成");
  assert.equal(session.turns[0].startedAt, "2026-09-10T14:00:00.000Z");
  assert.equal(session.turns[0].surface, "claude-cowork");
});

test("Cowork keeps its outer identity when nested agents use other ids", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cowork-identity-"));
  const file = writeCoworkTranscript(
    path.join(sandbox, "cowork"),
    undefined,
    "outer-session"
  );
  const records = fs.readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  records[0].session_id = "inner-agent-a";
  records[1].session_id = "inner-agent-b";
  fs.writeFileSync(
    file,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );

  const session = parseClaudeCoworkTranscript(file);
  assert.equal(session.sessionId, "outer-session");
  assert.equal(session.turns[0].sessionId, "outer-session");
});

test("Cowork parsing tolerates a missing sidecar and partial trailing line", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cowork-partial-"));
  const file = writeCoworkTranscript(
    path.join(sandbox, "cowork"),
    undefined,
    "cowork-partial"
  );
  fs.rmSync(`${path.dirname(file)}.json`);
  fs.appendFileSync(file, '{"type":"assistant","message":');

  const session = parseClaudeCoworkTranscript(file);
  assert.equal(session.sessionId, "cowork-partial");
  assert.equal(session.cwd, undefined);
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].response, "已经整理完成");
});

test("Cowork keeps successful tools but does not invent Write diffs", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cowork-tool-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const coworkRoot = path.join(sandbox, "cowork");
  const file = writeCoworkTranscript(coworkRoot, cwd, "cowork-tool");
  const records = fs.readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  records.splice(1, 1,
    {
      type: "assistant",
      session_id: "cowork-tool",
      _audit_timestamp: "2026-09-10T14:00:01.000Z",
      message: {
        id: "cowork-tool-call-message",
        role: "assistant",
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          id: "cowork-write",
          name: "Write",
          input: {
            file_path: path.join(cwd, "report.md"),
            content: "done"
          }
        }]
      }
    },
    {
      type: "user",
      session_id: "cowork-tool",
      _audit_timestamp: "2026-09-10T14:00:02.000Z",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "cowork-write",
          is_error: false,
          content: "created"
        }]
      }
    },
    {
      type: "assistant",
      session_id: "cowork-tool",
      _audit_timestamp: "2026-09-10T14:00:03.000Z",
      message: {
        id: "cowork-tool-final",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "文件已经创建" }]
      }
    }
  );
  fs.writeFileSync(
    file,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );

  const turn = parseClaudeCoworkTranscript(file).turns[0];
  assert.equal(turn.actions.length, 1);
  assert.equal(turn.actions[0].tool, "Write");
  assert.equal(turn.actions[0].ok, true);
  assert.deepEqual(turn.files, []);
});

test("first collection backfills active, archived, and Cowork history", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-history-backfill-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const activeDir = path.join(codexHome, "sessions", "2026", "09", "10");
  const archivedDir = path.join(codexHome, "archived_sessions");
  const coworkRoot = path.join(sandbox, "cowork");
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(archivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(activeDir, "active.jsonl"),
    codexConversationRollout(cwd, "active-history", "active", "done")
  );
  fs.writeFileSync(
    path.join(archivedDir, "archived.jsonl"),
    codexConversationRollout(cwd, "archived-history", "archived", "done")
  );
  writeCoworkTranscript(coworkRoot, cwd, "cowork-history");

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  delete process.env.CODEX_SESSIONS_ROOT;
  delete process.env.CODEX_ARCHIVED_SESSIONS_ROOT;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  process.env.CLAUDE_COWORK_ROOT = coworkRoot;

  const first = await collectSessions();
  assert.equal(first.newTurns, 3);
  const state = await readProjectState(cwd);
  assert.deepEqual(
    state.nodes.map((node) => node.prompt).sort(),
    ["active", "archived", "整理这份研究"]
  );
  assert.equal((await collectSessions()).newTurns, 0);

  process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;
});

test("Cowork without a selected folder is retained in the shared project", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cowork-unfiled-"));
  const coworkRoot = path.join(sandbox, "cowork");
  writeCoworkTranscript(coworkRoot, undefined, "cowork-unfiled");

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = path.join(sandbox, "no-codex");
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  process.env.CLAUDE_COWORK_ROOT = coworkRoot;

  const result = await collectSessions();
  assert.equal(result.newTurns, 1);
  assert.equal(result.skippedNoProject, 0);
  const state = await readProjectState(unfiledConversationsRoot());
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].sourceHost, "claude");
  assert.equal(state.nodes[0].prompt, "整理这份研究");

  process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;
});

test("Cowork history stays current through incremental collection", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cowork-grow-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const coworkRoot = path.join(sandbox, "cowork");
  const file = writeCoworkTranscript(coworkRoot, cwd, "cowork-grow");

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = path.join(sandbox, "no-codex");
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  process.env.CLAUDE_COWORK_ROOT = coworkRoot;

  assert.equal((await collectSessions()).newTurns, 1);
  const additional = [
    {
      type: "user",
      uuid: "cowork-grow-user-2",
      session_id: "cowork-grow",
      _audit_timestamp: "2026-09-10T14:05:00.000Z",
      message: { role: "user", content: "继续补充结论" }
    },
    {
      type: "assistant",
      uuid: "cowork-grow-assistant-2",
      session_id: "cowork-grow",
      _audit_timestamp: "2026-09-10T14:05:01.000Z",
      message: {
        id: "cowork-grow-message-2",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "补充完成" }]
      }
    }
  ];
  fs.appendFileSync(
    file,
    `${additional.map((record) => JSON.stringify(record)).join("\n")}\n`
  );

  assert.equal((await collectSessions()).newTurns, 1);
  assert.deepEqual(
    (await readProjectState(cwd)).nodes.map((node) => node.prompt),
    ["整理这份研究", "继续补充结论"]
  );

  process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;
});

test("Cowork sidecar changes move history out of the shared project", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cowork-route-"));
  const coworkRoot = path.join(sandbox, "cowork");
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const file = writeCoworkTranscript(coworkRoot, undefined, "cowork-route");

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = path.join(sandbox, "no-codex");
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  process.env.CLAUDE_COWORK_ROOT = coworkRoot;

  assert.equal((await collectSessions()).newTurns, 1);
  const sidecar = `${path.dirname(file)}.json`;
  const metadata = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  metadata.userSelectedFolders = [cwd];
  fs.writeFileSync(sidecar, JSON.stringify(metadata));

  assert.equal((await collectSessions()).newTurns, 1);
  assert.equal((await readProjectState(cwd)).nodes.length, 1);
  assert.equal(
    (await readProjectState(unfiledConversationsRoot())).nodes.length,
    0
  );
  assert.equal(
    (await readProjectState(cwd)).nodes[0].source.surface,
    "claude-cowork"
  );

  process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;
});

test("version-one cursors are rescanned so prior no-cwd history is recovered", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cursor-upgrade-"));
  const codexHome = path.join(sandbox, "codex");
  const file = writeCodexRollout(codexHome, undefined);
  const wayfinderHome = path.join(sandbox, "data");
  fs.mkdirSync(wayfinderHome, { recursive: true });
  fs.writeFileSync(
    path.join(wayfinderHome, "collector-state.json"),
    JSON.stringify({
      version: 1,
      files: {
        [file]: {
          size: fs.statSync(file).size,
          collectedTurns: 0,
          deferred: true
        }
      }
    })
  );

  process.env.WAYFINDER_HOME = wayfinderHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;

  assert.equal((await collectSessions()).newTurns, 1);
  assert.equal(
    (await readProjectState(unfiledConversationsRoot())).nodes.length,
    1
  );
  const cursor = JSON.parse(
    fs.readFileSync(path.join(wayfinderHome, "collector-state.json"), "utf8")
  );
  assert.equal(cursor.version, 2);
});

test("active and archived copies of one Codex turn remain deduplicated", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-archive-dedup-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const activeDir = path.join(codexHome, "sessions", "2026", "09", "10");
  const archivedDir = path.join(codexHome, "archived_sessions");
  const content = codexConversationRollout(
    cwd,
    "moved-history",
    "same turn",
    "same answer"
  );
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(archivedDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, "active.jsonl"), content);
  fs.writeFileSync(path.join(archivedDir, "archived.jsonl"), content);

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  delete process.env.CODEX_SESSIONS_ROOT;
  delete process.env.CODEX_ARCHIVED_SESSIONS_ROOT;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  process.env.CLAUDE_COWORK_ROOT = missingCoworkRoot;

  assert.equal((await collectSessions()).newTurns, 1);
  assert.equal((await readProjectState(cwd)).nodes.length, 1);
});

test("HTML and XML-looking user prompts are not discarded as envelopes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-html-prompt-"));
  const cwd = path.join(sandbox, "project");
  const file = path.join(sandbox, "html.jsonl");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(
    file,
    codexConversationRollout(
      cwd,
      "html-prompt",
      "<template><div>Keep this component</div></template>",
      "Kept."
    )
  );

  const session = parseCodexRollout(file);
  assert.equal(session.turns.length, 1);
  assert.equal(
    session.turns[0].prompt,
    "<template><div>Keep this component</div></template>"
  );
});

test("Codex task errors preserve structured failure messages", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-task-error-"));
  const cwd = path.join(sandbox, "project");
  const file = path.join(sandbox, "task-error.jsonl");
  fs.mkdirSync(cwd, { recursive: true });
  const lines = [
    {
      type: "session_meta",
      timestamp: "2026-09-10T09:00:00.000Z",
      payload: { id: "task-error", cwd }
    },
    {
      type: "response_item",
      timestamp: "2026-09-10T09:00:01.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Finish the task" }]
      }
    },
    {
      type: "event_msg",
      timestamp: "2026-09-10T09:00:02.000Z",
      payload: {
        type: "task_complete",
        error: {
          message: "The provider rejected the request.",
          codex_error_info: "rate_limit"
        }
      }
    }
  ];
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  const session = parseCodexRollout(file);
  assert.equal(session.turns.length, 1);
  assert.equal(
    session.turns[0].response,
    "The provider rejected the request."
  );
});

test("collects desktop chat into the right project without hooks", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-run-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const rollout = writeCodexRollout(codexHome, cwd);

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const originalPath = process.env.PATH;
  process.env.PATH = "";
  let first;
  try {
    first = await collectSessions();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
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
  assert.equal(collected[0].snapshotBefore, "");
  assert.equal(collected[0].snapshotAfter, "");

  // Second run must be idempotent (cursor + dedup).
  const originalOpen = fs.openSync;
  let unchangedTranscriptReads = 0;
  fs.openSync = (...args) => {
    if (args[0] === rollout) {
      unchangedTranscriptReads += 1;
    }
    return originalOpen(...args);
  };
  let second;
  try {
    second = await collectSessions();
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(second.newTurns, 0, "re-running must not duplicate turns");
  assert.equal(
    unchangedTranscriptReads,
    0,
    "unchanged transcripts should not be re-read for cursor hashes"
  );
  const state2 = await readProjectState(cwd);
  assert.equal(
    state2.nodes.filter((node) => node.kind === "collected").length,
    1
  );

  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "UserPromptSubmit",
    session_id: "after-collector",
    turn_id: "after-collector-turn",
    cwd,
    prompt: "Continue after collected history"
  });
  const state3 = await readProjectState(cwd);
  assert.match(
    state3.pending["codex:after-collector"].snapshotBefore,
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
  );
});

test("retries an unchanged transcript after its project becomes available", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-deferred-"));
  const cwd = path.join(sandbox, "external-project");
  const codexHome = path.join(sandbox, "codex");
  writeCodexRollout(codexHome, cwd);

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const first = await collectSessions();
  assert.equal(first.newTurns, 1);
  assert.equal(first.skippedNoProject, 0);
  assert.equal(
    (await readProjectState(unfiledConversationsRoot())).nodes.length,
    1
  );

  const unchanged = await collectSessions();
  assert.equal(unchanged.scannedFiles, 0);
  assert.equal(unchanged.newTurns, 0);

  fs.mkdirSync(cwd, { recursive: true });
  const retried = await collectSessions();
  assert.equal(retried.newTurns, 1);
  assert.equal(retried.skippedNoProject, 0);
  assert.equal((await readProjectState(cwd)).nodes.length, 1);
  assert.equal(
    (await readProjectState(unfiledConversationsRoot())).nodes.length,
    0
  );
});

test("collects a transcript with no cwd into the shared unfiled project", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-no-cwd-"));
  const codexHome = path.join(sandbox, "codex");
  writeCodexRollout(codexHome, undefined);

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const collected = await collectSessions();
  assert.equal(collected.skippedNoProject, 0);
  assert.equal(collected.newTurns, 1);
  const state = await readProjectState(unfiledConversationsRoot());
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].prompt, "讲个冷笑话");

  const unchanged = await collectSessions();
  assert.equal(unchanged.scannedFiles, 0);
  assert.equal(unchanged.newTurns, 0);
});

test("concurrent collectors serialize cursor and timeline updates", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-lock-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  writeCodexRollout(codexHome, cwd);

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const runs = await Promise.all([collectSessions(), collectSessions()]);
  assert.equal(
    runs.reduce((total, run) => total + run.newTurns, 0),
    1,
    "parallel runs must persist the new turn once"
  );
  const state = await readProjectState(cwd);
  assert.equal(
    state.nodes.filter((node) => node.kind === "collected").length,
    1
  );
});

test("active Codex and Claude turns remain collectable after they finish", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-active-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const codexDir = path.join(codexHome, "sessions", "2026", "09", "10");
  const claudeRoot = path.join(sandbox, "claude");
  const claudeDir = path.join(claudeRoot, "projects", "project");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  const codexFile = path.join(codexDir, "active.jsonl");
  const claudeFile = path.join(claudeDir, "active.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: codex.txt",
    "+done",
    "*** End Patch"
  ].join("\n");
  fs.writeFileSync(codexFile, [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z", payload: { id: "active-codex", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "Codex active" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z", payload: {
      type: "function_call", name: "apply_patch", call_id: "active-codex-call",
      arguments: JSON.stringify({ input: patch }) } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  fs.writeFileSync(claudeFile, [
    { type: "user", timestamp: "2026-09-10T13:00:00.000Z", cwd, sessionId: "active-claude",
      message: { role: "user", content: "Claude active" } },
    { type: "assistant", timestamp: "2026-09-10T13:00:01.000Z",
      message: { role: "assistant", content: [{
        type: "tool_use",
        id: "active-claude-call",
        name: "Write",
        input: { file_path: "claude.txt", content: "done" }
      }] } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = claudeRoot;

  const first = await collectSessions();
  assert.equal(first.newTurns, 0);

  fs.appendFileSync(codexFile, [
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z", payload: {
      type: "function_call_output", call_id: "active-codex-call", output: "Success" } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "text", text: "Codex done" }] } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  fs.appendFileSync(claudeFile, [
    { type: "user", timestamp: "2026-09-10T13:00:02.000Z", message: {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "active-claude-call",
        is_error: false,
        content: "ok"
      }]
    } },
    { type: "assistant", timestamp: "2026-09-10T13:00:03.000Z", message: {
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Claude done" }]
    } }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");

  const second = await collectSessions();
  assert.equal(second.newTurns, 2);
  const state = await readProjectState(cwd);
  const files = state.nodes
    .filter((node) => node.kind === "collected")
    .flatMap((node) => node.files.map((file) => file.path))
    .sort();
  assert.deepEqual(files, ["codex.txt"]);
  const claudeTurn = state.nodes.find(
    (node) => node.sessionId === "claude:active-claude"
  );
  assert.ok(claudeTurn.actions.some(
    (action) => action.tool === "Write" && action.path === "claude.txt"
  ));
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

test("preserves genuinely repeated prompt and response turns", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-repeat-turn-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "10");
  const file = path.join(dir, "repeated.jsonl");
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    {
      type: "session_meta",
      timestamp: "2026-09-10T10:00:00.000Z",
      payload: { id: "repeated", cwd }
    },
    {
      type: "response_item",
      timestamp: "2026-09-10T10:00:01.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "continue" }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-10T10:00:02.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "done" }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-10T10:05:01.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "continue" }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-10T10:05:02.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "done" }]
      }
    }
  ];
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const result = await collectSessions();
  assert.equal(result.newTurns, 2);
  const state = await readProjectState(cwd);
  assert.equal(
    state.nodes.filter((node) => node.prompt === "continue").length,
    2
  );
});

test("hook and rollout capture of one stable turn remain one node", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-hook-rollout-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "12");
  const file = path.join(dir, "hooked.jsonl");
  const turnId = "turn-stable-1";
  fs.mkdirSync(dir, { recursive: true });
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  await writeProjectConfig(cwd, {
    validationCommand: "",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });

  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "UserPromptSubmit",
    session_id: "hooked",
    turn_id: turnId,
    cwd,
    prompt: "Capture this once"
  });
  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "Stop",
    session_id: "hooked",
    turn_id: turnId,
    cwd,
    last_assistant_message: "Captured once."
  });
  const lines = [
    {
      type: "session_meta",
      timestamp: "2026-09-12T00:00:00.000Z",
      payload: { id: "hooked", cwd }
    },
    {
      type: "event_msg",
      timestamp: "2026-09-12T00:00:01.000Z",
      payload: { type: "task_started", turn_id: turnId }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:02.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Capture this once" }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:03.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Captured once." }]
      }
    }
  ];
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  assert.equal((await collectSessions()).newTurns, 0);
  const state = await readProjectState(cwd);
  const matching = state.nodes.filter(
    (node) => node.prompt === "Capture this once"
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].turnId, turnId);
  assert.equal(matching[0].source.type, "rollout");
  assert.equal(matching[0].source.turnId, turnId);
});

test("a Stop event upgrades a turn already persisted by the collector", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-collect-stop-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "12");
  const file = path.join(dir, "collect-before-stop.jsonl");
  const turnId = "collect-before-stop-turn";
  fs.mkdirSync(dir, { recursive: true });
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");
  await writeProjectConfig(cwd, {
    validationCommand: "",
    validationTimeoutSeconds: 10,
    maxFileSizeMB: 20
  });
  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "UserPromptSubmit",
    session_id: "collect-before-stop",
    turn_id: turnId,
    cwd,
    prompt: "Collector wins the race"
  });
  const lines = [
    {
      type: "session_meta",
      timestamp: "2026-09-12T00:00:00.000Z",
      payload: { id: "collect-before-stop", cwd }
    },
    {
      type: "event_msg",
      timestamp: "2026-09-12T00:00:01.000Z",
      payload: { type: "task_started", turn_id: turnId }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:02.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Collector wins the race" }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:03.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Collected response" }]
      }
    }
  ];
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  assert.equal((await collectSessions()).newTurns, 1);
  await processHookEvent({
    wayfinder_host: "codex",
    hook_event_name: "Stop",
    session_id: "collect-before-stop",
    turn_id: turnId,
    cwd,
    last_assistant_message: "Hook response"
  });

  const state = await readProjectState(cwd);
  const matching = state.nodes.filter((node) => node.turnId === turnId);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].kind, "collected");
  assert.equal(matching[0].response, "Hook response");
  assert.equal(state.pending["codex:collect-before-stop"], undefined);
});

test("the same stable turn copied across rollover files is collected once", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-rollover-dedup-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "12");
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    {
      type: "session_meta",
      timestamp: "2026-09-12T00:00:00.000Z",
      payload: { id: "rollover-session", cwd }
    },
    {
      type: "event_msg",
      timestamp: "2026-09-12T00:00:01.000Z",
      payload: { type: "task_started", turn_id: "rollover-turn" }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:02.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "One logical turn" }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:03.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "One answer" }]
      }
    }
  ];
  const raw = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "part-a.jsonl"), raw);
  fs.writeFileSync(path.join(dir, "part-b.jsonl"), raw);
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  assert.equal((await collectSessions()).newTurns, 1);
  const state = await readProjectState(cwd);
  assert.equal(
    state.nodes.filter((node) => node.turnId === "rollover-turn").length,
    1
  );
});

test("a complete rollover copy upgrades an earlier partial turn", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-rollover-upgrade-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "12");
  fs.mkdirSync(dir, { recursive: true });
  const turnId = "rollover-upgrade-turn";
  const base = [
    {
      type: "session_meta",
      timestamp: "2026-09-12T00:00:00.000Z",
      payload: { id: "rollover-upgrade", cwd }
    },
    {
      type: "event_msg",
      timestamp: "2026-09-12T00:00:01.000Z",
      payload: { type: "task_started", turn_id: turnId }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:02.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Apply the complete patch" }]
      }
    }
  ];
  const partial = [...base, {
    type: "response_item",
    timestamp: "2026-09-12T00:00:03.000Z",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Starting." }]
    }
  }];
  const patch = [
    "*** Begin Patch",
    "*** Add File: complete.txt",
    "+complete",
    "*** End Patch"
  ].join("\n");
  const complete = [
    ...base,
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:03.000Z",
      payload: {
        type: "custom_tool_call",
        name: "apply_patch",
        call_id: "rollover-patch",
        input: patch
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:04.000Z",
      payload: {
        type: "custom_tool_call_output",
        call_id: "rollover-patch",
        output: JSON.stringify({ exit_code: 0 })
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:05.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "The complete patch was applied." }]
      }
    }
  ];
  fs.writeFileSync(
    path.join(dir, "part-a.jsonl"),
    partial.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );
  fs.writeFileSync(
    path.join(dir, "part-b.jsonl"),
    complete.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  assert.equal((await collectSessions()).newTurns, 1);
  const matching = (await readProjectState(cwd)).nodes.filter(
    (node) => node.turnId === turnId
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].response, "The complete patch was applied.");
  assert.equal(matching[0].actions[0].ok, true);
  assert.equal(matching[0].files[0].path, "complete.txt");
  assert.match(matching[0].source.rolloutPath, /part-b\.jsonl$/);
});

test("same-size tail rewrites beyond the prefix reset the cursor", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-tail-rewrite-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "12");
  const file = path.join(dir, "tail.jsonl");
  fs.mkdirSync(dir, { recursive: true });
  const padding = {
    type: "response_item",
    timestamp: "2026-09-12T00:00:00.500Z",
    payload: {
      type: "message",
      role: "developer",
      content: [{ type: "text", text: "x".repeat(70_000) }]
    }
  };
  const rollout = (turnId, prompt, response) => [
    {
      type: "session_meta",
      timestamp: "2026-09-12T00:00:00.000Z",
      payload: { id: "tail-session", cwd }
    },
    padding,
    {
      type: "event_msg",
      timestamp: "2026-09-12T00:00:01.000Z",
      payload: { type: "task_started", turn_id: turnId }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:02.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: prompt }]
      }
    },
    {
      type: "response_item",
      timestamp: "2026-09-12T00:00:03.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: response }]
      }
    }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
  const first = rollout("tail-turn-a", "first", "doneA");
  const second = rollout("tail-turn-b", "other", "doneB");
  assert.equal(Buffer.byteLength(first), Buffer.byteLength(second));
  fs.writeFileSync(file, first);
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  assert.equal((await collectSessions()).newTurns, 1);
  fs.writeFileSync(file, second);
  assert.equal((await collectSessions()).newTurns, 1);
  assert.deepEqual(
    (await readProjectState(cwd)).nodes
      .filter((node) => node.kind === "collected")
      .map((node) => node.prompt),
    ["first", "other"]
  );
});

test("resets the cursor after same-size replacement and truncation", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cursor-reset-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "10");
  const file = path.join(dir, "rotating.jsonl");
  fs.mkdirSync(dir, { recursive: true });
  const first = codexConversationRollout(cwd, "rotate-a", "first", "doneA");
  const replacement = codexConversationRollout(
    cwd,
    "rotate-b",
    "other",
    "doneB"
  );
  assert.equal(Buffer.byteLength(first), Buffer.byteLength(replacement));
  fs.writeFileSync(file, first);
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  assert.equal((await collectSessions()).newTurns, 1);

  const replacementFile = `${file}.replacement`;
  fs.writeFileSync(replacementFile, replacement);
  fs.rmSync(file);
  fs.renameSync(replacementFile, file);
  assert.equal((await collectSessions()).newTurns, 1);

  const inPlaceReplacement = codexConversationRollout(
    cwd,
    "rotate-c",
    "again",
    "doneC"
  );
  assert.equal(
    Buffer.byteLength(replacement),
    Buffer.byteLength(inPlaceReplacement)
  );
  fs.writeFileSync(file, inPlaceReplacement);
  assert.equal((await collectSessions()).newTurns, 1);

  fs.writeFileSync(
    file,
    codexConversationRollout(cwd, "trim-d", "new", "short")
  );
  assert.equal((await collectSessions()).newTurns, 1);

  const prompts = (await readProjectState(cwd)).nodes
    .filter((node) => node.kind === "collected")
    .map((node) => node.prompt);
  assert.deepEqual(prompts, ["first", "other", "again", "new"]);
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
      message: { role: "assistant", stop_reason: "end_turn",
        content: [{ type: "text", text: "找到了问题所在" }] } }
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
    "*** Update File: src/old-name.ts",
    "*** Move to: src/new-name.ts",
    "@@ context",
    "-oldName();",
    "+newName();",
    "*** Add File: src/../../outside.txt",
    "+must not escape",
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
  assert.equal(byPath["src/gone.ts"].lineCountsKnown, false);
  assert.equal(byPath["src/new-name.ts"].status, "R");
  assert.equal(byPath["src/new-name.ts"].previousPath, "src/old-name.ts");
  assert.equal(byPath["src/new-name.ts"].additions, 1);
  assert.equal(byPath["src/new-name.ts"].deletions, 1);
  assert.equal(byPath["../outside.txt"], undefined);
});

test("Codex custom tool calls retain successful apply_patch facts", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-custom-patch-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "custom-patch.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: custom.txt",
    "+recorded",
    "*** End Patch"
  ].join("\n");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z", payload: {
      id: "custom-patch", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z", payload: {
      type: "message", role: "user",
      content: [{ type: "text", text: "创建 custom.txt" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z", payload: {
      type: "custom_tool_call", name: "apply_patch", call_id: "custom-call",
      input: patch } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z", payload: {
      type: "custom_tool_call_output", call_id: "custom-call",
      output: JSON.stringify({ exit_code: 0, output: "Done!" }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z", payload: {
      type: "message", role: "assistant",
      content: [{ type: "text", text: "已创建" }] } }
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const turn = parseCodexRollout(file).turns[0];
  assert.equal(turn.actions[0].tool, "apply_patch");
  assert.equal(turn.actions[0].ok, true);
  assert.deepEqual(turn.files, [{
    path: "custom.txt",
    status: "A",
    additions: 1,
    deletions: 0
  }]);
});

test("Codex commentary waits for the final answer and later tool facts", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-commentary-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wf-project-")));
  const codexHome = path.join(sandbox, "codex");
  const dir = path.join(codexHome, "sessions", "2026", "09", "10");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "commentary.jsonl");
  const initial = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z",
      payload: { id: "commentary", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z",
      payload: { type: "message", role: "user",
        content: [{ type: "text", text: "继续修复" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z",
      payload: { type: "message", role: "assistant", phase: "commentary",
        content: [{ type: "text", text: "正在检查文件。" }] } }
  ];
  fs.writeFileSync(
    file,
    initial.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = path.join(sandbox, "no-claude");

  const beforeFinal = await collectSessions();
  assert.equal(beforeFinal.newTurns, 0);

  const patch = [
    "*** Begin Patch",
    "*** Add File: commentary.txt",
    "+captured",
    "*** End Patch"
  ].join("\n");
  const completed = [
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z",
      payload: { type: "custom_tool_call", name: "apply_patch",
        call_id: "commentary-call", input: patch } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z",
      payload: { type: "custom_tool_call_output", call_id: "commentary-call",
        output: JSON.stringify({ exit_code: 0 }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:05.000Z",
      payload: { type: "message", role: "assistant", phase: "final_answer",
        content: [{ type: "text", text: "修复完成。" }] } }
  ];
  fs.appendFileSync(
    file,
    completed.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  const afterFinal = await collectSessions();
  assert.equal(afterFinal.newTurns, 1);
  const [turn] = parseCodexRollout(file).turns;
  assert.equal(turn.response, "正在检查文件。\n修复完成。");
  assert.equal(turn.actions[0].ok, true);
  assert.equal(turn.files[0].path, "commentary.txt");
});

test("successful text output can mention errors without discarding changes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-output-text-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "output-text.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: src/error-handler.ts",
    "+export const ok = true;",
    "*** End Patch"
  ].join("\n");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z",
      payload: { id: "output-text", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z",
      payload: { type: "message", role: "user",
        content: [{ type: "text", text: "更新错误处理" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z",
      payload: { type: "custom_tool_call", name: "apply_patch",
        call_id: "output-text-call", input: patch } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z",
      payload: { type: "custom_tool_call_output", call_id: "output-text-call",
        output: "Process exited with code 0\nFinal output:\n" +
          "Regression fixture: process exited with code 1 as expected" } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z",
      payload: { type: "message", role: "assistant",
        content: [{ type: "text", text: "完成" }] } }
  ];
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  const turn = parseCodexRollout(file).turns[0];
  assert.equal(turn.actions[0].ok, true);
  assert.equal(turn.files[0].path, "src/error-handler.ts");
});

test("failed Codex custom tool calls never retain file facts", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-custom-failed-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "custom-failed.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: phantom.txt",
    "+not applied",
    "*** End Patch"
  ].join("\n");
  const failures = [
    JSON.stringify({ exit_code: 1 }),
    JSON.stringify({ success: true, exit_code: 1 }),
    JSON.stringify({ success: false, exit_code: 0 }),
    JSON.stringify({ success: false }),
    JSON.stringify({
      metadata: { exit_code: 1 },
      output: "patch rejected"
    }),
    JSON.stringify({
      result: [{ exit_code: 1, output: "patch rejected" }]
    }),
    "Error: patch failed"
  ];
  const lines = [{
    type: "session_meta",
    timestamp: "2026-09-10T12:00:00.000Z",
    payload: { id: "custom-failed", cwd }
  }];
  failures.forEach((output, index) => {
    const minute = String(index * 2 + 1).padStart(2, "0");
    const resultMinute = String(index * 2 + 2).padStart(2, "0");
    lines.push(
      { type: "response_item", timestamp: `2026-09-10T12:${minute}:00.000Z`,
        payload: { type: "message", role: "user",
          content: [{ type: "text", text: `失败测试 ${index}` }] } },
      { type: "response_item", timestamp: `2026-09-10T12:${minute}:01.000Z`,
        payload: { type: "custom_tool_call", name: "apply_patch",
          call_id: `failed-${index}`, input: patch } },
      { type: "response_item", timestamp: `2026-09-10T12:${minute}:02.000Z`,
        payload: { type: "custom_tool_call_output",
          call_id: `failed-${index}`, output } },
      { type: "response_item", timestamp: `2026-09-10T12:${resultMinute}:00.000Z`,
        payload: { type: "message", role: "assistant",
          content: [{ type: "text", text: "未应用" }] } }
    );
  });
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  const turns = parseCodexRollout(file).turns;
  assert.equal(turns.length, failures.length);
  for (const turn of turns) {
    assert.equal(turn.actions[0].ok, false);
    assert.deepEqual(turn.files, []);
  }
});

test("renaming preserves earlier edits without a duplicate source entry", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-rename-merge-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "rename-merge.jsonl");
  const renamePatch = [
    "*** Begin Patch",
    "*** Update File: old.ts",
    "*** Move to: new.ts",
    "@@",
    "-oldValue",
    "+newValue",
    "*** End Patch"
  ].join("\n");
  const editPatch = [
    "*** Begin Patch",
    "*** Update File: old.ts",
    "@@",
    "-initialValue",
    "+oldValue",
    "*** End Patch"
  ].join("\n");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z", payload: {
      id: "rename-merge", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z", payload: {
      type: "message", role: "user",
      content: [{ type: "text", text: "重命名后继续修改" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z", payload: {
      type: "custom_tool_call", name: "apply_patch", call_id: "edit-call",
      input: editPatch } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z", payload: {
      type: "custom_tool_call_output", call_id: "edit-call",
      output: JSON.stringify({ exit_code: 0 }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z", payload: {
      type: "custom_tool_call", name: "apply_patch", call_id: "rename-call",
      input: renamePatch } },
    { type: "response_item", timestamp: "2026-09-10T12:00:05.000Z", payload: {
      type: "custom_tool_call_output", call_id: "rename-call",
      output: JSON.stringify({ exit_code: 0 }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:06.000Z", payload: {
      type: "message", role: "assistant",
      content: [{ type: "text", text: "完成" }] } }
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  assert.deepEqual(parseCodexRollout(file).turns[0].files, [{
    path: "new.ts",
    status: "R",
    additions: 2,
    deletions: 2,
    previousPath: "old.ts"
  }]);
});

test("rename then delete resolves to the baseline path and add then delete cancels", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-rename-delete-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "rename-delete.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Update File: old.ts",
    "*** Move to: new.ts",
    "@@",
    "-oldValue",
    "+newValue",
    "*** Delete File: new.ts",
    "*** Add File: temporary.ts",
    "+temporary",
    "*** Delete File: temporary.ts",
    "*** End Patch"
  ].join("\n");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z",
      payload: { id: "rename-delete", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z",
      payload: { type: "message", role: "user",
        content: [{ type: "text", text: "重命名后删除" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z",
      payload: { type: "custom_tool_call", name: "apply_patch",
        call_id: "rename-delete-call", input: patch } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z",
      payload: { type: "custom_tool_call_output",
        call_id: "rename-delete-call", output: JSON.stringify({ exit_code: 0 }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z",
      payload: { type: "message", role: "assistant",
        content: [{ type: "text", text: "完成" }] } }
  ];
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  assert.deepEqual(parseCodexRollout(file).turns[0].files, [{
    path: "old.ts",
    status: "D",
    additions: 0,
    deletions: 0,
    lineCountsKnown: false
  }]);
});

test("round-trip renames collapse to the net file change", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-rename-roundtrip-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "rename-roundtrip.jsonl");
  const patches = [
    [
      "*** Begin Patch",
      "*** Update File: old.ts",
      "*** Move to: middle.ts",
      "@@",
      "-before",
      "+after",
      "*** End Patch"
    ].join("\n"),
    [
      "*** Begin Patch",
      "*** Update File: middle.ts",
      "*** Move to: old.ts",
      "*** End Patch"
    ].join("\n")
  ];
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z",
      payload: { id: "rename-roundtrip", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z",
      payload: { type: "message", role: "user",
        content: [{ type: "text", text: "往返重命名" }] } }
  ];
  patches.forEach((patch, index) => {
    lines.push(
      { type: "response_item", timestamp: `2026-09-10T12:00:0${index + 2}.000Z`,
        payload: { type: "custom_tool_call", name: "apply_patch",
          call_id: `roundtrip-${index}`, input: patch } },
      { type: "response_item", timestamp: `2026-09-10T12:00:0${index + 4}.000Z`,
        payload: { type: "custom_tool_call_output",
          call_id: `roundtrip-${index}`,
          output: JSON.stringify({ exit_code: 0 }) } }
    );
  });
  lines.push({
    type: "response_item",
    timestamp: "2026-09-10T12:00:07.000Z",
    payload: { type: "message", role: "assistant",
      content: [{ type: "text", text: "完成" }] }
  });
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  assert.deepEqual(parseCodexRollout(file).turns[0].files, [{
    path: "old.ts",
    status: "M",
    additions: 1,
    deletions: 1
  }]);
});

test("macOS path aliases retain edits inside the same project", {
  skip: process.platform !== "darwin"
}, () => {
  const cwd = fs.mkdtempSync("/tmp/wf-path-alias-");
  const realCwd = fs.realpathSync(cwd);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-alias-rollout-"));
  const file = path.join(sandbox, "alias.jsonl");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z",
      payload: { id: "alias", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z",
      payload: { type: "message", role: "user",
        content: [{ type: "text", text: "修改别名路径" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z",
      payload: { type: "function_call", name: "Edit", call_id: "alias-edit",
        arguments: JSON.stringify({
          file_path: path.join(realCwd, "src", "alias.ts"),
          old_string: "old",
          new_string: "new"
        }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z",
      payload: { type: "function_call_output", call_id: "alias-edit",
        output: JSON.stringify({ exit_code: 0 }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z",
      payload: { type: "message", role: "assistant",
        content: [{ type: "text", text: "完成" }] } }
  ];
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  );

  const turn = parseCodexRollout(file).turns[0];
  assert.equal(turn.actions[0].path, "src/alias.ts");
  assert.deepEqual(turn.files, [{
    path: "src/alias.ts",
    status: "M",
    additions: 1,
    deletions: 1
  }]);
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
      type: "function_call_output", call_id: "c1",
      output: JSON.stringify({ success: true, code: 200 }) } },
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

test("failed Codex apply_patch keeps the action but drops phantom file changes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-codex-failed-patch-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "failed-patch.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: phantom.txt",
    "+not written",
    "*** End Patch"
  ].join("\n");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z", payload: { id: "failed-patch", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "创建文件" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z", payload: {
      type: "function_call", name: "apply_patch", call_id: "failed-call",
      arguments: JSON.stringify({ input: patch }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z", payload: {
      type: "function_call_output", call_id: "failed-call",
      output: "Error: patch failed" } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "text", text: "写入失败" }] } }
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const turn = parseCodexRollout(file).turns[0];
  assert.equal(turn.actions[0].ok, false);
  assert.deepEqual(turn.files, []);
});

test("nonzero textual exit codes never become Codex file facts", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-codex-exit-code-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "nonzero-exit.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: phantom.txt",
    "+not written",
    "*** End Patch"
  ].join("\n");
  const lines = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z",
      payload: { id: "nonzero-exit", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z",
      payload: { type: "message", role: "user",
        content: [{ type: "text", text: "创建文件" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z",
      payload: { type: "function_call", name: "apply_patch", call_id: "exit-call",
        arguments: JSON.stringify({ input: patch }) } },
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z",
      payload: { type: "function_call_output", call_id: "exit-call",
        output: "Process exited with code 1\nFinal output:\nNo matches" } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z",
      payload: { type: "message", role: "assistant",
        content: [{ type: "text", text: "未修改文件" }] } }
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const turn = parseCodexRollout(file).turns[0];
  assert.equal(turn.actions[0].ok, false);
  assert.deepEqual(turn.files, []);
});

test("unresolved or invalid-context Codex edits never become file facts", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-codex-pending-patch-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "pending-patch.jsonl");
  const patch = [
    "*** Begin Patch",
    "*** Add File: phantom.txt",
    "+not written",
    "*** End Patch"
  ].join("\n");
  const base = [
    { type: "session_meta", timestamp: "2026-09-10T12:00:00.000Z", payload: { id: "pending-patch", cwd } },
    { type: "response_item", timestamp: "2026-09-10T12:00:01.000Z", payload: {
      type: "message", role: "user", content: [{ type: "text", text: "创建文件" }] } },
    { type: "response_item", timestamp: "2026-09-10T12:00:02.000Z", payload: {
      type: "function_call", name: "apply_patch", call_id: "pending-call",
      arguments: JSON.stringify({ input: patch }) } }
  ];
  fs.writeFileSync(file, base.map((line) => JSON.stringify(line)).join("\n") + "\n");
  assert.equal(parseCodexRollout(file).turns.length, 0);

  const failed = [
    ...base,
    { type: "response_item", timestamp: "2026-09-10T12:00:03.000Z", payload: {
      type: "function_call_output",
      call_id: "pending-call",
      output: "Invalid Context 0:\nmissing source line"
    } },
    { type: "response_item", timestamp: "2026-09-10T12:00:04.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "text", text: "补丁未应用" }] } }
  ];
  fs.writeFileSync(file, failed.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const turn = parseCodexRollout(file).turns[0];
  assert.equal(turn.actions[0].ok, false);
  assert.deepEqual(turn.files, []);
});

test("Claude records only file changes with provable before and after text", () => {
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
        { type: "tool_use", id: "write-1", name: "Write", input: {
          file_path: path.join(cwd, "a.ts"),
          content: "line1\nline2\nline3\n"
        } },
        { type: "tool_use", id: "edit-1", name: "Edit", input: {
          file_path: path.join(cwd, "b.ts"),
          old_string: "x\ny",
          new_string: "z"
        } },
        { type: "tool_use", id: "multi-edit-1", name: "MultiEdit", input: { file_path: path.join(cwd, "b.ts"), edits: [
          { old_string: "p", new_string: "q\nr" }
        ] } }
      ] } },
    { type: "user", timestamp: "2026-09-10T13:00:02.000Z",
      message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "write-1", is_error: false, content: "ok" },
        { type: "tool_result", tool_use_id: "edit-1", is_error: false, content: "ok" },
        { type: "tool_result", tool_use_id: "multi-edit-1", is_error: false, content: "ok" }
      ] } },
    { type: "assistant", timestamp: "2026-09-10T13:00:03.000Z",
      message: { role: "assistant", stop_reason: "end_turn",
        content: [{ type: "text", text: "完成" }] } }
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const session = parseClaudeTranscript(file);
  assert.equal(session.turns.length, 1);
  const byPath = Object.fromEntries(session.turns[0].files.map((c) => [c.path, c]));

  assert.equal(byPath["a.ts"], undefined);
  assert.equal(session.turns[0].actions[0].path, "a.ts");

  // b.ts touched by Edit (2 del,1 add) then MultiEdit (1 del,2 add) → merged.
  assert.equal(byPath["b.ts"].status, "M");
  assert.equal(byPath["b.ts"].additions, 3);
  assert.equal(byPath["b.ts"].deletions, 3);
});

test("Claude transcript paths never expose files outside the project root", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-claude-path-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "outside-path.jsonl");
  const outside = path.join(sandbox, "private", "secret.txt");
  const lines = [
    { type: "user", timestamp: "2026-09-10T13:00:00.000Z", cwd,
      sessionId: "outside-path", message: { role: "user", content: "检查文件" } },
    { type: "assistant", timestamp: "2026-09-10T13:00:01.000Z",
      message: { role: "assistant", content: [{
        type: "tool_use",
        id: "outside-edit",
        name: "Edit",
        input: {
          file_path: outside,
          old_string: "secret",
          new_string: "changed"
        }
      }] } },
    { type: "user", timestamp: "2026-09-10T13:00:02.000Z",
      message: { role: "user", content: [{
        type: "tool_result",
        tool_use_id: "outside-edit",
        is_error: false,
        content: "ok"
      }] } },
    { type: "assistant", timestamp: "2026-09-10T13:00:03.000Z",
      message: { role: "assistant", stop_reason: "end_turn",
        content: [{ type: "text", text: "完成" }] } }
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const turn = parseClaudeTranscript(file).turns[0];
  assert.equal(turn.actions[0].path, undefined);
  assert.deepEqual(turn.files, []);
  assert.doesNotMatch(JSON.stringify(turn), /private\/secret/);
});

test("failed Claude edit keeps the action but drops phantom file changes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-claude-failed-edit-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "failed-edit.jsonl");
  const lines = [
    { type: "user", timestamp: "2026-09-10T13:00:00.000Z", cwd, sessionId: "failed-edit",
      message: { role: "user", content: "修改文件" } },
    { type: "assistant", timestamp: "2026-09-10T13:00:01.000Z",
      message: { role: "assistant", content: [{
        type: "tool_use",
        id: "tool-failed",
        name: "Edit",
        input: { file_path: "phantom.ts", old_string: "old", new_string: "new" }
      }] } },
    { type: "user", timestamp: "2026-09-10T13:00:02.000Z",
      message: { role: "user", content: [{
        type: "tool_result",
        tool_use_id: "tool-failed",
        is_error: true,
        content: "Edit failed"
      }] } },
    { type: "assistant", timestamp: "2026-09-10T13:00:03.000Z",
      message: { role: "assistant", stop_reason: "end_turn",
        content: [{ type: "text", text: "修改失败" }] } }
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const turn = parseClaudeTranscript(file).turns[0];
  assert.equal(turn.actions[0].ok, false);
  assert.deepEqual(turn.files, []);
});

test("unresolved Claude writes never become file facts", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wf-claude-pending-edit-"));
  const cwd = path.join(sandbox, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(sandbox, "pending-edit.jsonl");
  const lines = [
    { type: "user", timestamp: "2026-09-10T13:00:00.000Z", cwd, sessionId: "pending-edit",
      message: { role: "user", content: "修改文件" } },
    { type: "assistant", timestamp: "2026-09-10T13:00:01.000Z",
      message: { role: "assistant", content: [{
        type: "tool_use",
        id: "tool-pending",
        name: "Write",
        input: { file_path: "phantom.ts", content: "not written" }
      }] } }
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  assert.equal(parseClaudeTranscript(file).turns.length, 0);
});
