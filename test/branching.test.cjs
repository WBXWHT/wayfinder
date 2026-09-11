const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      window: {
        showWarningMessage: async () => "从这里重来",
        showInformationMessage: async () => undefined
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { restoreFromNode } = require("../out/extension.js");
const { ShadowRepo } = require("../out/shadowRepo.js");
const {
  ensureProjectState,
  latestNodeOnBranch,
  mutateProjectState,
  readProjectState
} = require("../out/storage.js");

test("restoring creates a new path without deleting the abandoned future", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-branch-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "value.txt"), "good\n");

  const shadow = new ShadowRepo(root);
  const good = await shadow.capture("good", "Good state");
  fs.writeFileSync(path.join(root, "value.txt"), "bad\n");
  const bad = await shadow.capture("bad", "Bad future", good.commit);

  const state = await ensureProjectState(root);
  state.nodes.push(
    node("good-node", "main", undefined, "Good path", good.commit, good.commit),
    node("bad-node", "main", "good-node", "Bad path", good.commit, bad.commit)
  );
  await mutateProjectState(root, (current) => {
    current.nodes = state.nodes;
  });

  const safety = await shadow.capture("safety", "Before restore", bad.commit);
  await shadow.restore(good.commit, safety.commit);
  await mutateProjectState(root, (current) => {
    current.branches.push({
      id: "branch-2",
      name: "path 2",
      parentNodeId: "good-node",
      createdAt: new Date().toISOString()
    });
    current.activeBranchId = "branch-2";
  });

  const restored = await readProjectState(root);
  assert.ok(restored);
  assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "good\n");
  assert.deepEqual(
    restored.nodes.map((item) => item.id),
    ["good-node", "bad-node"]
  );
  assert.equal(restored.activeBranchId, "branch-2");
  assert.equal(latestNodeOnBranch(restored).id, "good-node");
});

test("concurrent restore attempts create only one new path", async () => {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "wayfinder-restore-race-")
  );
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "value.txt"), "good\n");

  const shadow = new ShadowRepo(root);
  const good = await shadow.capture("good-race", "Good state");
  fs.writeFileSync(path.join(root, "value.txt"), "bad\n");
  const bad = await shadow.capture("bad-race", "Bad future", good.commit);
  const state = await ensureProjectState(root);
  state.nodes.push(
    node("good-race-node", "main", undefined, "Good", good.commit, good.commit),
    node(
      "bad-race-node",
      "main",
      "good-race-node",
      "Bad",
      good.commit,
      bad.commit
    )
  );
  await mutateProjectState(root, (current) => {
    current.nodes = state.nodes;
  });

  const results = await Promise.allSettled([
    restoreFromNode(root, "good-race-node"),
    restoreFromNode(root, "good-race-node")
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1
  );
  assert.match(
    results.find((result) => result.status === "rejected").reason.message,
    /项目路径已发生变化/
  );

  const restored = await readProjectState(root);
  assert.equal(restored.branches.length, 2);
  assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "good\n");
});

test("a timeline write failure rolls the restored files back", async () => {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "wayfinder-restore-rollback-")
  );
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  const valuePath = path.join(root, "value.txt");
  fs.writeFileSync(valuePath, "good\n");

  const shadow = new ShadowRepo(root);
  const good = await shadow.capture("good-rollback", "Good state");
  fs.writeFileSync(valuePath, "bad\n");
  const bad = await shadow.capture("bad-rollback", "Bad future", good.commit);
  const state = await ensureProjectState(root);
  state.nodes.push(
    node("good-rollback-node", "main", undefined, "Good", good.commit, good.commit),
    node(
      "bad-rollback-node",
      "main",
      "good-rollback-node",
      "Bad",
      good.commit,
      bad.commit
    )
  );
  await mutateProjectState(root, (current) => {
    current.nodes = state.nodes;
  });

  const originalRename = fs.promises.rename;
  let injected = false;
  fs.promises.rename = async (source, destination) => {
    if (
      !injected &&
      String(source).includes(".tmp") &&
      String(destination).endsWith("timeline.json")
    ) {
      injected = true;
      throw new Error("injected timeline commit failure");
    }
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(
      restoreFromNode(root, "good-rollback-node"),
      /injected timeline commit failure/
    );
  } finally {
    fs.promises.rename = originalRename;
  }

  assert.equal(fs.readFileSync(valuePath, "utf8"), "bad\n");
  const persisted = await readProjectState(root);
  assert.equal(persisted.activeBranchId, "main");
  assert.equal(persisted.branches.length, 1);
});

function node(id, branchId, parentId, prompt, before, after) {
  const now = new Date().toISOString();
  return {
    id,
    kind: "turn",
    sessionId: "test",
    branchId,
    parentId,
    prompt,
    startedAt: now,
    completedAt: now,
    snapshotBefore: before,
    snapshotAfter: after,
    files: [],
    actions: [],
    validation: { status: "passed" }
  };
}
