const assert = require("node:assert/strict");
const test = require("node:test");

const {
  aggregateWaypoints,
  buildIdf,
  classifyRelations,
  cosineSimilarity,
  imperativeHead,
  jaccard,
  keyphrases,
  parseMemorySections,
  signalForNode,
  tokenize,
  vectorize
} = require("../out/voyageEngine.js");

function turn(id, minute, prompt, files, opts = {}) {
  return {
    id,
    kind: opts.kind || "turn",
    sessionId: "live",
    branchId: opts.branchId || "main",
    prompt,
    response: opts.response || "",
    startedAt: `2026-09-07T10:${String(minute).padStart(2, "0")}:00.000Z`,
    completedAt: `2026-09-07T10:${String(minute).padStart(2, "0")}:30.000Z`,
    snapshotBefore: "a",
    snapshotAfter: "b",
    files: (files || []).map((path) => ({
      path,
      status: "M",
      additions: 4,
      deletions: 1
    })),
    actions: opts.actions || [],
    validation: { status: opts.verify || "skipped" }
  };
}

function engineFor(nodes) {
  const idf = buildIdf(
    nodes.map((node) => tokenize([node.prompt, node.response].join(" ")))
  );
  const signals = nodes.map((node) => signalForNode(node, idf));
  const waypoints = aggregateWaypoints(signals, idf);
  const relations = classifyRelations(waypoints);
  return { idf, waypoints, relations };
}

test("tokenize splits latin identifiers and Chinese bigrams", () => {
  const tokens = tokenize("优化 API 动态分成");
  assert.ok(tokens.includes("en:api"));
  assert.ok(tokens.includes("动态"));
  // Ubiquitous stopword bigrams like 优化 are dropped.
  assert.ok(!tokens.includes("优化"));
});

test("jaccard and cosine behave on empty and overlapping inputs", () => {
  assert.equal(jaccard(new Set(), new Set()), 0);
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
  const idf = () => 1;
  const a = vectorize(tokenize("API 动态分成"), idf);
  const b = vectorize(tokenize("API 动态分成"), idf);
  assert.ok(cosineSimilarity(a, b) > 0.99);
});

test("Q1 aggregates same-sub-goal turns sharing files into one waypoint", () => {
  const nodes = [
    turn("a1", 0, "实现登录接口", ["src/auth/login.ts", "src/auth/token.ts"]),
    turn("a2", 1, "修复登录 token 过期", ["src/auth/token.ts"]),
    turn("a3", 2, "补充登录单测", ["src/auth/login.test.ts", "src/auth/login.ts"])
  ];
  const { waypoints } = engineFor(nodes);
  assert.equal(waypoints.length, 1);
  assert.deepEqual(waypoints[0].nodeIds.sort(), ["a1", "a2", "a3"]);
});

test("Q1 starts a new waypoint after a long idle gap", () => {
  const nodes = [
    turn("a1", 0, "实现登录接口", ["src/auth/login.ts"]),
    turn("a2", 45, "继续登录", ["src/auth/login.ts"]) // >30 min later
  ];
  const { waypoints } = engineFor(nodes);
  assert.equal(waypoints.length, 2);
});

test("Q2 classifies revert as revert-divergence off its ancestor", () => {
  const nodes = [
    turn("a1", 0, "实现登录接口", ["src/auth/login.ts", "src/auth/token.ts"]),
    turn("rev", 6, "restore 回退登录改动，换 JWT 重做", ["src/auth/login.ts"], {
      kind: "safety"
    })
  ];
  const { waypoints, relations } = engineFor(nodes);
  const revert = waypoints.find((wp) => wp.nodeIds.includes("rev"));
  assert.equal(relations.get(revert.id).type, "revert-divergence");
});

test("Q2 classifies a related-but-different-files switch as topic-divergence", () => {
  const nodes = [
    turn("a1", 0, "AI 助手 实现登录接口", ["src/auth/login.ts"]),
    turn("a2", 1, "AI 助手 修复登录 token", ["src/auth/login.ts"]),
    turn("tips", 4, "AI 助手 加用户 Tips 提示", ["src/tips/tips.ts"])
  ];
  const { waypoints, relations } = engineFor(nodes);
  const tips = waypoints.find((wp) => wp.nodeIds.includes("tips"));
  assert.equal(relations.get(tips.id).type, "topic-divergence");
});

test("Q2 opens a new root for a wholly unrelated topic (new boat)", () => {
  const nodes = [
    turn("a1", 0, "实现登录接口", ["src/auth/login.ts"]),
    turn("doc", 50, "写一篇完全无关的用户手册文档", ["docs/manual.md"])
  ];
  const { waypoints, relations } = engineFor(nodes);
  const doc = waypoints.find((wp) => wp.nodeIds.includes("doc"));
  assert.equal(relations.get(doc.id).type, "root");
});

test("Q3 parses the 结果/行动/沉淀 memory structure", () => {
  const sections = parseMemorySections(
    "结果\n完成登录\n\n行动\n- 写接口\n- 加测试\n\n沉淀\n- 分位数更准确"
  );
  assert.equal(sections.outcome, "完成登录");
  assert.deepEqual(sections.actions, ["写接口", "加测试"]);
  assert.deepEqual(sections.learned, ["分位数更准确"]);
});

test("Q3 keyphrases favour distinctive anchors and imperativeHead strips politeness", () => {
  const docs = [
    tokenize("优化 API 动态分成 门槛"),
    tokenize("优化 项目方案 表达"),
    tokenize("优化 AI 助手 描述")
  ];
  const idf = buildIdf(docs);
  const keys = keyphrases(tokenize("优化 API 动态分成 门槛"), idf, 3);
  assert.ok(keys.includes("api"));
  assert.equal(imperativeHead("请帮我实现登录接口。后面还有别的"), "实现登录接口");
});
