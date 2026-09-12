const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ShadowRepo } = require("../out/shadowRepo.js");

test("shadow snapshots capture, diff, and restore the complete workspace", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-shadow-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "alpha.txt"), "one\n");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "ignored.txt"), "keep\n");

  const shadow = new ShadowRepo(root, 20);
  const first = await shadow.capture("first", "Initial state");

  fs.writeFileSync(path.join(root, "alpha.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(root, "beta.txt"), "new\n");
  const second = await shadow.capture("second", "Changed state", first.commit);

  assert.equal(second.changed, true);
  assert.deepEqual(
    (await shadow.diffFiles(first.commit, second.commit)).map((file) => [
      file.status,
      file.path
    ]),
    [
      ["M", "alpha.txt"],
      ["A", "beta.txt"]
    ]
  );

  fs.writeFileSync(path.join(root, "node_modules", "ignored.txt"), "untouched\n");
  await shadow.restore(first.commit, second.commit);

  assert.equal(fs.readFileSync(path.join(root, "alpha.txt"), "utf8"), "one\n");
  assert.equal(fs.existsSync(path.join(root, "beta.txt")), false);
  assert.equal(
    fs.readFileSync(path.join(root, "node_modules", "ignored.txt"), "utf8"),
    "untouched\n"
  );
});

test("unchanged snapshots reuse their parent commit", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-dedupe-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "file.txt"), "stable\n");

  const shadow = new ShadowRepo(root);
  const first = await shadow.capture("first", "Initial state");
  const second = await shadow.capture("second", "No changes", first.commit);

  assert.equal(second.changed, false);
  assert.equal(second.commit, first.commit);
});

test("non-Git snapshot markers start a fresh snapshot chain", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-marker-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "file.txt"), "current\n");

  const snapshot = await new ShadowRepo(root).capture(
    "after-collected",
    "After collected history",
    "collected-without-snapshot"
  );

  assert.equal(snapshot.parent, undefined);
  assert.match(snapshot.commit, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
});

test("diff paths preserve unicode and special characters", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-paths-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  const names = process.platform === "win32"
    ? ["中文.txt", "space name.txt", "bracket[name].txt"]
    : ["中文.txt", "tab\tname.txt", 'quote"name.txt'];
  for (const name of names) {
    fs.writeFileSync(path.join(root, name), "before\n");
  }

  const shadow = new ShadowRepo(root);
  const first = await shadow.capture("first", "Initial state");
  for (const name of names) {
    fs.writeFileSync(path.join(root, name), "after\n");
  }
  const second = await shadow.capture("second", "Changed state", first.commit);
  const files = await shadow.diffFiles(first.commit, second.commit);

  assert.deepEqual(
    files.map((file) => file.path).sort(),
    [...names].sort()
  );
  for (const file of files) {
    assert.equal(file.additions, 1);
    assert.equal(file.deletions, 1);
    assert.equal(
      (await shadow.fileAt(second.commit, file.path)).toString("utf8"),
      "after\n"
    );
  }
});

test("renames preserve both source and destination paths", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-rename-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "before.txt"), "stable content\n");

  const shadow = new ShadowRepo(root);
  const first = await shadow.capture("rename-before", "Before rename");
  fs.renameSync(
    path.join(root, "before.txt"),
    path.join(root, "after.txt")
  );
  const second = await shadow.capture(
    "rename-after",
    "After rename",
    first.commit
  );

  assert.deepEqual(await shadow.diffFiles(first.commit, second.commit), [{
    path: "after.txt",
    previousPath: "before.txt",
    status: "R",
    additions: 0,
    deletions: 0,
    binary: false
  }]);
  assert.equal(
    (await shadow.fileAt(first.commit, "before.txt")).toString("utf8"),
    "stable content\n"
  );
  assert.equal(
    (await shadow.fileAt(second.commit, "after.txt")).toString("utf8"),
    "stable content\n"
  );
});

test("case-only renames remain visible on case-insensitive filesystems", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-case-rename-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "name.txt"), "stable content\n");

  const shadow = new ShadowRepo(root);
  const first = await shadow.capture("case-before", "Before case rename");
  fs.renameSync(
    path.join(root, "name.txt"),
    path.join(root, "NAME.txt")
  );
  const second = await shadow.capture(
    "case-after",
    "After case rename",
    first.commit
  );

  assert.deepEqual(await shadow.diffFiles(first.commit, second.commit), [{
    path: "NAME.txt",
    previousPath: "name.txt",
    status: "R",
    additions: 0,
    deletions: 0,
    binary: false
  }]);
});

test("restore refuses to overwrite a modified file excluded by the size limit", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-large-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "large.txt");
  fs.writeFileSync(file, "old\n");

  const fullShadow = new ShadowRepo(root, 20);
  const target = await fullShadow.capture("target", "Target");
  fs.writeFileSync(file, "new content that must survive\n");
  const limitedShadow = new ShadowRepo(root, 0.000001);
  const safety = await limitedShadow.capture(
    "safety",
    "Safety with exclusion",
    target.commit
  );

  await assert.rejects(
    limitedShadow.restore(target.commit, safety.commit),
    /已取消恢复/
  );
  assert.equal(fs.readFileSync(file, "utf8"), "new content that must survive\n");
});

test("restore refuses to overwrite an ignored untracked collision", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-ignored-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "victim.txt"), "target\n");

  const shadow = new ShadowRepo(root);
  const target = await shadow.capture("target", "Target");
  fs.unlinkSync(path.join(root, "victim.txt"));
  const current = await shadow.capture("current", "Without victim", target.commit);
  fs.writeFileSync(path.join(root, ".gitignore"), "victim.txt\n");
  fs.writeFileSync(path.join(root, "victim.txt"), "local ignored content\n");

  await assert.rejects(
    shadow.restore(target.commit, current.commit),
    /已取消恢复/
  );
  assert.equal(
    fs.readFileSync(path.join(root, "victim.txt"), "utf8"),
    "local ignored content\n"
  );
});
