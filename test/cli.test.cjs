const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cli = path.resolve(__dirname, "..", "out", "cli.js");

test("the bundled CLI dispatches installed Codex hook commands", (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-cli-hook-"));
  const root = path.join(sandbox, "project");
  const home = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  childProcess.execFileSync(
    process.execPath,
    [cli, "hook", "--host", "codex", "--wayfinder-hook"],
    {
      cwd: root,
      env: { ...process.env, WAYFINDER_HOME: home },
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "cli-session",
        cwd: root
      }),
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  const activity = JSON.parse(
    fs.readFileSync(path.join(home, "activity.json"), "utf8")
  );
  assert.equal(activity.status, "active");
  assert.equal(activity.sourceHost, "codex");
  assert.equal(activity.root, fs.realpathSync.native(root));
});

test("the bundled CLI rejects unknown hook hosts", () => {
  assert.throws(
    () => childProcess.execFileSync(
      process.execPath,
      [cli, "hook", "--host", "unknown"],
      { input: "{}", stdio: ["pipe", "pipe", "pipe"] }
    ),
    /Unsupported hook host/
  );
});
