const assert = require("node:assert/strict");
const test = require("node:test");

const {
  abandonedNodeIds,
  buildConversationForest,
  forestMetadataForChapter,
  summarizeSessionTitle
} = require("../out/conversationForest.js");

test("conversation forest joins related stages into two task trees", () => {
  const state = projectState([
    node("resume", "2026-09-03T09:00:00.000Z", "需求与设计"),
    node("ai", "2026-09-03T09:05:00.000Z", "AI 助手"),
    node("api-1", "2026-09-03T09:10:00.000Z", "API 动态分成"),
    node("tips", "2026-09-03T09:15:00.000Z", "AI 助手 · Tips"),
    node("api-2", "2026-09-03T09:20:00.000Z", "API 动态分成"),
    node("ideas", "2026-09-04T09:00:00.000Z", "项目方向探索"),
    node("life", "2026-09-05T09:00:00.000Z", "Wayfinder 产品"),
    node("plugin", "2026-09-05T10:00:00.000Z", "TRAE 插件开发")
  ]);

  const forest = buildConversationForest(state);

  assert.equal(forest.trees.length, 2);
  assert.equal(forest.nodeCount, 8);
  assert.deepEqual(
    forest.trees.map((tree) => tree.title).sort(),
    ["Wayfinder", "示例应用"]
  );

  const resume = forest.trees.find((tree) => tree.title === "示例应用");
  assert.ok(resume);
  const api = resume.sessions.find((session) => session.stage === "API 动态分成");
  const ai = resume.sessions.find((session) => session.stage === "AI 助手");
  const tips = resume.sessions.find((session) => session.stage === "用户 Tips");
  const root = resume.sessions.find((session) => session.stage === "需求结构");
  assert.equal(api.nodeIds.length, 2);
  assert.equal(api.parentId, root.id);
  assert.equal(ai.parentId, root.id);
  assert.equal(tips.parentId, ai.id);

  const life = forest.trees.find((tree) => tree.title === "Wayfinder");
  assert.ok(life);
  const exploration = life.sessions.find(
    (session) => session.stage === "项目方向探索"
  );
  const product = life.sessions.find((session) => session.stage === "产品定义");
  const plugin = life.sessions.find(
    (session) => session.stage === "TRAE 插件实现"
  );
  assert.equal(product.parentId, exploration.id);
  assert.equal(plugin.parentId, product.id);
});

test("conversation forest splits sessions by day and chains continuations", () => {
  const first = node(
    "api-day-1",
    "2026-09-03T09:00:00.000Z",
    "API 动态分成"
  );
  const second = node(
    "api-day-2",
    "2026-09-04T09:00:00.000Z",
    "API 动态分成"
  );
  second.verdict = "failure";
  const forest = buildConversationForest(projectState([first, second]));
  const sessions = forest.trees[0].sessions;

  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].parentId, sessions[0].id);
  assert.equal(sessions[1].verdict, "failure");
});

test("a new unreviewed turn makes its session verdict neutral", () => {
  const first = node(
    "reviewed",
    "2026-09-03T09:00:00.000Z",
    "API 动态分成"
  );
  first.verdict = "success";
  const second = node(
    "unreviewed",
    "2026-09-03T09:10:00.000Z",
    "API 动态分成"
  );

  const session = buildConversationForest(
    projectState([first, second])
  ).trees[0].sessions[0];

  assert.equal(session.verdict, "neutral");
  assert.equal(session.successCount, 1);
});

test("future parent stages cannot create a cycle", () => {
  const first = node(
    "stage-a",
    "2026-09-03T09:00:00.000Z",
    "custom-a"
  );
  first.source.forest = {
    tree: "cycle-test",
    stage: "A",
    stageOrder: 0,
    parentStage: "B"
  };
  const second = node(
    "stage-b",
    "2026-09-03T09:10:00.000Z",
    "custom-b"
  );
  second.source.forest = {
    tree: "cycle-test",
    stage: "B",
    stageOrder: 1,
    parentStage: "A"
  };

  const sessions = buildConversationForest(
    projectState([first, second])
  ).trees[0].sessions;
  const stageA = sessions.find((session) => session.stage === "A");
  const stageB = sessions.find((session) => session.stage === "B");

  assert.equal(stageA.parentId, undefined);
  assert.equal(stageB.parentId, stageA.id);
});

test("chapter metadata maps related subtopics onto one forest", () => {
  assert.deepEqual(forestMetadataForChapter("AI 助手 · Tags"), {
    tree: "示例应用",
    stage: "内容 Tags",
    stageOrder: 2,
    parentStage: "AI 助手",
    branch: "Tags"
  });
});

test("session titles are summarized without ellipses", () => {
  const cases = [
    [
      "获取一份技术可实现的《Wayfinder》最终版详细产品方案",
      "制定 Wayfinder 最终方案"
    ],
    [
      "优化现有单线时间轴可视化方案，使其更直观地展示用户决策过程和任务进度。",
      "重构决策可视化"
    ],
    [
      "开始“Task Helper（实时AI教练）”模块的开发，旨在设计并实现能自主判断应用策略的Agent原型",
      "设计实时 AI 教练"
    ],
    [
      "优化项目方案中 API 和 AI 助手的描述并区分两个项目",
      "区分 API 与助手"
    ],
    [
      "将AI助手与Task合并为实时AI助手产品",
      "整合 Tips 与 Tags"
    ],
    [
      "解释 Tips 项目的核心定义与功能",
      "明确 Tips 定位"
    ],
    [
      "排查新版本发布后侧栏无法刷新的问题",
      "修复实时任务"
    ]
  ];

  for (const [input, expected] of cases) {
    const summary = summarizeSessionTitle(input, "实时任务");
    assert.equal(summary, expected);
    assert.doesNotMatch(summary, /…|\.{3}/);
  }
});

test("linear imported history is never auto-marked as failed", () => {
  const state = projectState([
    node("resume", "2026-09-03T09:00:00.000Z", "需求与设计"),
    node("ai", "2026-09-03T09:05:00.000Z", "AI 助手"),
    node("api", "2026-09-03T09:10:00.000Z", "API 动态分成")
  ]);

  assert.equal(abandonedNodeIds(state).size, 0);
  const forest = buildConversationForest(state);
  const failures = forest.trees
    .flatMap((tree) => tree.sessions)
    .filter((session) => session.verdict === "failure");
  assert.equal(failures.length, 0);
});

test("a restore fork auto-marks the abandoned route as failed", () => {
  const base = node("root", "2026-09-03T09:00:00.000Z", "需求与设计");
  const abandonedTurn = node("wrong", "2026-09-03T09:05:00.000Z", "AI 助手");
  const safety = node("before-restore", "2026-09-03T09:06:00.000Z", "AI 助手");
  safety.kind = "safety";
  const state = projectState([base, abandonedTurn, safety]);
  // A restore forked a new path back at "root", abandoning "wrong".
  state.branches.push({
    id: "branch-2",
    name: "path 2",
    parentNodeId: "root",
    createdAt: "2026-09-03T09:07:00.000Z"
  });
  state.activeBranchId = "branch-2";

  const abandoned = abandonedNodeIds(state);
  assert.ok(abandoned.has("wrong"));
  assert.ok(!abandoned.has("root"));
  // The safety checkpoint created by the restore is never a failure.
  assert.ok(!abandoned.has("before-restore"));

  const forest = buildConversationForest(state);
  const wrongSession = forest.trees
    .flatMap((tree) => tree.sessions)
    .find((session) => session.nodeIds.includes("wrong"));
  assert.ok(wrongSession);
  assert.equal(wrongSession.verdict, "failure");
});

test("live voyages with file signal route through the content engine", () => {
  const nodes = [
    liveTurn("a1", "10:00", "实现 AI 助手 登录接口", ["src/auth/login.ts"]),
    liveTurn("a2", "10:01", "修复 AI 助手 登录 token", ["src/auth/login.ts"]),
    liveTurn("tips", "10:04", "AI 助手 加用户 Tips 提示", ["src/tips/tips.ts"])
  ];
  const forest = buildConversationForest(projectState(nodes));
  const sessions = forest.trees.flatMap((tree) => tree.sessions);
  // Content-driven titles come from the prompt, not the hardcoded regex table.
  const authSession = sessions.find((session) => session.nodeIds.includes("a1"));
  assert.ok(authSession);
  assert.equal(authSession.nodeIds.length, 2); // a1+a2 merged (same file)
  const tipsSession = sessions.find((session) => session.nodeIds.includes("tips"));
  assert.ok(tipsSession);
  // Tips diverged onto its own lane (different file, related theme).
  assert.equal(tipsSession.parentId, authSession.id);
  // No invented failures on healthy live continuation/divergence.
  assert.equal(sessions.filter((s) => s.verdict === "failure").length, 0);
});

test("imported-only history keeps its curated chapter forest", () => {
  const state = projectState([
    node("resume", "2026-09-03T09:00:00.000Z", "需求与设计"),
    node("api", "2026-09-03T09:10:00.000Z", "API 动态分成")
  ]);
  const forest = buildConversationForest(state);
  // Curated path: chapter stages, not engine-derived stages.
  const stages = forest.trees.flatMap((tree) =>
    tree.sessions.map((session) => session.stage)
  );
  assert.ok(stages.includes("需求结构"));
  assert.ok(stages.includes("API 动态分成"));
});

function projectState(nodes) {
  return {
    version: 1,
    projectId: "test",
    root: "/tmp/test",
    activeBranchId: "main",
    branches: [{ id: "main", name: "main", createdAt: nodes[0].completedAt }],
    nodes,
    pending: {},
    updatedAt: nodes.at(-1).completedAt
  };
}

function node(id, completedAt, chapter) {
  return {
    id,
    kind: "imported",
    sessionId: "history",
    branchId: "history",
    prompt: `${chapter} ${id}`,
    response: "",
    startedAt: completedAt,
    completedAt,
    snapshotBefore: "same",
    snapshotAfter: "same",
    files: [],
    actions: [],
    validation: { status: "skipped" },
    source: {
      type: "trae-memory",
      importedAt: completedAt,
      chapter,
      forest: forestMetadataForChapter(chapter)
    }
  };
}

function liveTurn(id, hhmm, prompt, files) {
  const at = `2026-09-07T${hhmm}:00.000Z`;
  return {
    id,
    kind: "turn",
    sessionId: "live",
    branchId: "main",
    prompt,
    response: "",
    startedAt: at,
    completedAt: at,
    snapshotBefore: "a",
    snapshotAfter: "b",
    files: files.map((path) => ({
      path,
      status: "M",
      additions: 4,
      deletions: 1
    })),
    actions: [],
    validation: { status: "skipped" }
  };
}
