const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFile = promisify(childProcess.execFile);
const root = path.resolve(__dirname, "..");
const importer = path.join(root, "scripts/import-memory-history.cjs");
const { projectIdFor } = require("../out/storage.js");

test("history import preserves sessions, chronology, and idempotency", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-import-"));
  const workspace = path.join(sandbox, "workspace");
  const dataHome = path.join(sandbox, "data");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), "fixture\n");
  const sessionA = path.join(sandbox, "session_memory_A.jsonl");
  const sessionB = path.join(sandbox, "session_memory_B.jsonl");
  fs.writeFileSync(
    sessionA,
    `${JSON.stringify(record("a-late", "2026-09-03 10:00:00", "项目方案优化"))}\n`
  );
  fs.writeFileSync(
    sessionB,
    `${JSON.stringify(record("b-only", "2026-09-02 10:00:00", "Wayfinder"))}\n`
  );

  await runImport(workspace, dataHome, [sessionA, sessionB]);
  let state = readState(workspace, dataHome);
  const firstA = state.nodes.find(
    (node) => node.source?.messageId === "a-late"
  );
  const onlyB = state.nodes.find(
    (node) => node.source?.messageId === "b-only"
  );
  assert.equal(firstA.sessionId, "A");
  assert.equal(firstA.branchId, "imported-A");
  assert.equal(onlyB.sessionId, "B");
  assert.equal(onlyB.branchId, "imported-B");

  fs.writeFileSync(
    sessionA,
    [
      JSON.stringify(record("a-late", "2026-09-03 10:00:00", "项目方案优化")),
      JSON.stringify(record("a-early", "2026-09-01 10:00:00", "项目方案优化"))
    ].join("\n") + "\n"
  );
  await runImport(workspace, dataHome, [sessionA]);
  state = readState(workspace, dataHome);
  const branchA = state.nodes
    .filter((node) => node.branchId === "imported-A")
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  assert.deepEqual(
    branchA.map((node) => node.source.messageId),
    ["a-early", "a-late"]
  );
  assert.equal(branchA[0].parentId, undefined);
  assert.equal(branchA[1].parentId, branchA[0].id);

  const sessionC = path.join(sandbox, "session_memory_C.jsonl");
  fs.writeFileSync(
    sessionC,
    `${JSON.stringify(record("c-only", "2026-09-04 10:00:00", "插件开发"))}\n`
  );
  await Promise.all([
    runImport(workspace, dataHome, [sessionC]),
    runImport(workspace, dataHome, [sessionC])
  ]);
  state = readState(workspace, dataHome);
  const importedC = state.nodes.filter(
    (node) => node.source?.messageId === "c-only"
  );
  assert.equal(importedC.length, 1);
  assert.notEqual(importedC[0].parentId, importedC[0].id);

  const invalid = path.join(sandbox, "session_memory_invalid.jsonl");
  fs.writeFileSync(
    invalid,
    `${JSON.stringify({ message_id: "invalid", intent: "broken" })}\n`
  );
  await assert.rejects(
    runImport(workspace, dataHome, [invalid]),
    /Invalid message_summary_time.*session_memory_invalid\.jsonl:1/
  );
  state = readState(workspace, dataHome);
  assert.equal(
    state.nodes.some((node) => node.source?.messageId === "invalid"),
    false
  );
});

function record(messageId, timestamp, intent) {
  return {
    message_id: messageId,
    message_summary_time: timestamp,
    intent,
    outcome: "done",
    actions: [],
    learned: []
  };
}

function runImport(workspace, dataHome, files) {
  return execFile(
    process.execPath,
    [importer, "--root", workspace, ...files],
    {
      cwd: root,
      env: {
        ...process.env,
        WAYFINDER_HOME: dataHome
      }
    }
  );
}

function readState(workspace, dataHome) {
  const statePath = path.join(
    dataHome,
    "projects",
    projectIdFor(workspace),
    "timeline.json"
  );
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}
