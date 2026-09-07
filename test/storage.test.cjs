const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  configPathFor,
  ensureProjectState,
  mutateProjectState,
  projectDataDir,
  readProjectConfig,
  readProjectState,
  statePathFor
} = require("../out/storage.js");

test("concurrent callers recover one dead lock without losing updates", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-lock-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  await ensureProjectState(root);

  const lockPath = path.join(projectDataDir(root), "timeline.json.lock");
  fs.mkdirSync(lockPath);
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, stale, stale);

  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      mutateProjectState(root, (state) => {
        state.branches.push({
          id: `concurrent-${index}`,
          name: `concurrent ${index}`,
          createdAt: new Date().toISOString()
        });
      })
    )
  );

  const state = await readProjectState(root);
  assert.ok(state);
  assert.equal(
    state.branches.filter((branch) => branch.id.startsWith("concurrent-")).length,
    8
  );
});

test("corrupt state is reported and never overwritten as a new project", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-state-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  await ensureProjectState(root);
  const statePath = statePathFor(root);
  fs.writeFileSync(statePath, "{ broken state", "utf8");

  await assert.rejects(
    ensureProjectState(root),
    /Unable to read Wayfinder state/
  );
  assert.equal(fs.readFileSync(statePath, "utf8"), "{ broken state");
});

test("corrupt config is reported instead of replaced with defaults", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-config-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  const configPath = configPathFor(root);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "{ broken config", "utf8");

  await assert.rejects(
    readProjectConfig(root),
    /Unable to read Wayfinder config/
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), "{ broken config");
});
