const assert = require("node:assert/strict");
const test = require("node:test");

const {
  aggregateWaypoints,
  buildIdf,
  classifyRelations,
  cohesion,
  cosineSimilarity,
  imperativeHead,
  isGenericHandoffText,
  jaccard,
  keyphrases,
  parseMemorySections,
  relatedness,
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

function relationWaypoint({
  id,
  startedAt,
  completedAt = startedAt,
  tokens = [],
  files = [],
  pathTerms = [],
  session = "shared-session",
  host = "codex"
}) {
  return {
    id,
    nodeIds: [id],
    sourceHosts: new Set(host ? [host] : []),
    sessionIds: new Set(session ? [session] : []),
    files: new Set(files),
    dirs: new Set(),
    pathTerms: new Set(pathTerms),
    promptTokens: [...tokens],
    tokens: [...tokens],
    vector: new Map(tokens.map((token) => [token, 1])),
    startedAt,
    completedAt,
    isRevert: false,
    verifyFailed: false,
    hasFileSignal: files.length > 0
  };
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

test("cross-tool path overlap requires evidence from both topics", () => {
  const auth = turn(
    "auth",
    0,
    "Repair auth token validation",
    ["src/auth/config.ts"]
  );
  auth.sourceHost = "codex";
  auth.sessionId = "codex-auth";
  const invoice = turn(
    "invoice",
    1,
    "Adjust invoice rounding rules",
    ["src/auth/config.ts"]
  );
  invoice.sourceHost = "claude";
  invoice.sessionId = "claude-invoice";
  const idf = buildIdf([auth, invoice].map((node) => tokenize(node.prompt)));
  const [authSignal, invoiceSignal] = [auth, invoice].map(
    (node) => signalForNode(node, idf)
  );

  assert.equal(cohesion(authSignal, invoiceSignal), 0);
  assert.equal(aggregateWaypoints([authSignal, invoiceSignal], idf).length, 2);
});

test("generic cross-tool handoff on the exact same files stays together", () => {
  const first = turn("handoff-a", 0, "Continue", ["src/index.ts"], {
    response: "Done"
  });
  first.sourceHost = "codex";
  first.sessionId = "codex-handoff";
  const second = turn("handoff-b", 1, "Proceed", ["src/index.ts"], {
    response: "Done"
  });
  second.sourceHost = "claude";
  second.sessionId = "claude-handoff";
  const idf = buildIdf([first, second].map((node) => tokenize(node.prompt)));
  const signals = [first, second].map((node) => signalForNode(node, idf));

  assert.ok(cohesion(signals[0], signals[1]) > .34);
  assert.equal(aggregateWaypoints(signals, idf).length, 1);
});

test("one generic handoff cannot merge an unrelated same-file task", () => {
  const first = turn("handoff-only", 0, "Continue", ["src/auth/config.ts"]);
  first.sourceHost = "codex";
  first.sessionId = "codex-handoff-only";
  const second = turn(
    "invoice-task",
    1,
    "Rewrite invoice rounding rules",
    ["src/auth/config.ts"]
  );
  second.sourceHost = "claude";
  second.sessionId = "claude-invoice";
  const idf = buildIdf([first, second].map((node) => tokenize(node.prompt)));
  const signals = [first, second].map((node) => signalForNode(node, idf));

  assert.equal(cohesion(signals[0], signals[1]), 0);
  assert.equal(aggregateWaypoints(signals, idf).length, 2);
});

test("a substantive turn followed by a generic handoff stays together", () => {
  const first = turn(
    "handoff-substantive",
    0,
    "Implement OAuth callback",
    ["src/auth/callback.ts"],
    { response: "Implementation is ready" }
  );
  first.sourceHost = "codex";
  first.sessionId = "codex-oauth";
  const second = turn(
    "handoff-continue",
    1,
    "Continue",
    ["src/auth/callback.ts"],
    { response: "Done" }
  );
  second.sourceHost = "claude";
  second.sessionId = "claude-oauth";
  const idf = buildIdf([first, second].map((node) =>
    tokenize([node.prompt, node.response].join(" "))
  ));
  const signals = [first, second].map((node) => signalForNode(node, idf));

  assert.ok(cohesion(signals[0], signals[1]) >= .34);
  assert.equal(aggregateWaypoints(signals, idf).length, 1);
});

test("parent lookup applies generic handoff semantics to the current turn", () => {
  const file = "src/auth/callback.ts";
  const genericHistory = relationWaypoint({
    id: "historical-generic",
    startedAt: 0,
    completedAt: 0,
    files: [file],
    pathTerms: ["auth", "callback"],
    tokens: ["en:continue"],
    session: "historical-session",
    host: "codex"
  });
  genericHistory.genericHandoff = true;
  const substantiveCurrent = relationWaypoint({
    id: "substantive-current",
    startedAt: 60_000,
    files: [file],
    pathTerms: ["auth", "callback"],
    tokens: ["en:invoice"],
    session: "current-session",
    host: "claude"
  });
  assert.equal(relatedness(substantiveCurrent, genericHistory), 0);

  const substantiveHistory = {
    ...genericHistory,
    id: "historical-substantive",
    genericHandoff: false,
    promptTokens: ["en:invoice"],
    tokens: ["en:invoice"],
    vector: new Map([["en:invoice", 1]])
  };
  const genericCurrent = {
    ...substantiveCurrent,
    id: "generic-current",
    genericHandoff: true,
    promptTokens: ["en:continue"],
    tokens: ["en:continue"],
    vector: new Map([["en:continue", 1]])
  };
  assert.equal(relatedness(genericCurrent, substantiveHistory), 0.55);
});

test("matching src and lib stems are not source-test counterparts", () => {
  const source = turn(
    "src-oauth",
    0,
    "Implement OAuth callback",
    ["src/auth/callback.ts"]
  );
  source.sourceHost = "codex";
  source.sessionId = "codex-oauth";
  const library = turn(
    "lib-invoice",
    1,
    "Rewrite invoice rounding",
    ["lib/auth/callback.ts"]
  );
  library.sourceHost = "claude";
  library.sessionId = "claude-invoice";
  const idf = buildIdf([source, library].map((node) =>
    tokenize(node.prompt)
  ));
  const signals = [source, library].map((node) => signalForNode(node, idf));

  assert.equal(cohesion(signals[0], signals[1]), 0);
  assert.equal(aggregateWaypoints(signals, idf).length, 2);
});

test("source-test paths cannot override explicit topic conflict", () => {
  const source = turn(
    "source-oauth",
    0,
    "Implement OAuth callback",
    ["src/auth/callback.ts"]
  );
  source.sourceHost = "codex";
  source.sessionId = "codex-oauth";
  const unrelatedTest = turn(
    "test-invoice",
    1,
    "Verify invoice rounding totals",
    ["tests/unit/auth/callback.test.ts"]
  );
  unrelatedTest.sourceHost = "claude";
  unrelatedTest.sessionId = "claude-invoice";
  const idf = buildIdf([source, unrelatedTest].map((node) =>
    tokenize(node.prompt)
  ));
  const signals = [source, unrelatedTest].map((node) =>
    signalForNode(node, idf)
  );

  assert.equal(cohesion(signals[0], signals[1]), 0);
  assert.equal(aggregateWaypoints(signals, idf).length, 2);
});

test("source-test paths cannot override a Chinese topic conflict", () => {
  const source = turn(
    "source-login",
    0,
    "实现登录回调处理",
    ["src/auth/callback.ts"]
  );
  source.sourceHost = "codex";
  source.sessionId = "codex-login";
  const unrelatedTest = turn(
    "test-invoice-cn",
    1,
    "验证发票舍入金额",
    ["tests/unit/auth/callback.test.ts"]
  );
  unrelatedTest.sourceHost = "claude";
  unrelatedTest.sessionId = "claude-invoice";
  const idf = buildIdf([source, unrelatedTest].map((node) =>
    tokenize(node.prompt)
  ));
  const signals = [source, unrelatedTest].map((node) =>
    signalForNode(node, idf)
  );

  assert.equal(cohesion(signals[0], signals[1]), 0);
  assert.equal(aggregateWaypoints(signals, idf).length, 2);
});

test("a Chinese generic handoff keeps a source-test pair together", () => {
  const source = turn(
    "source-login-generic",
    0,
    "实现登录回调",
    ["src/auth/callback.ts"]
  );
  source.sourceHost = "codex";
  source.sessionId = "codex-login-generic";
  const followUp = turn(
    "test-login-generic",
    1,
    "继续处理",
    ["tests/unit/auth/callback.test.ts"]
  );
  followUp.sourceHost = "claude";
  followUp.sessionId = "claude-login-generic";
  const idf = buildIdf([source, followUp].map((node) =>
    tokenize(node.prompt)
  ));
  const signals = [source, followUp].map((node) =>
    signalForNode(node, idf)
  );

  assert.ok(cohesion(signals[0], signals[1]) >= .34);
  assert.equal(aggregateWaypoints(signals, idf).length, 1);
});

test("Chinese generic handoff detection uses the original prompt", () => {
  assert.equal(isGenericHandoffText("继续处理"), true);
  assert.equal(isGenericHandoffText("接着进行"), true);
  assert.equal(isGenericHandoffText("继续处理发票计算"), false);
});

test("partial file overlap cannot replace cross-tool semantic evidence", () => {
  const first = turn(
    "oauth-partial",
    0,
    "Repair OAuth token validation",
    ["src/oauth/token.ts", "src/oauth/session.ts"]
  );
  first.sourceHost = "codex";
  first.sessionId = "codex-oauth";
  const second = turn(
    "invoice-partial",
    1,
    "Rewrite invoice rounding rules",
    ["src/oauth/token.ts", "src/billing/invoice.ts"]
  );
  second.sourceHost = "claude";
  second.sessionId = "claude-invoice";
  const idf = buildIdf([first, second].map((node) => tokenize(node.prompt)));
  const signals = [first, second].map((node) => signalForNode(node, idf));

  assert.equal(cohesion(signals[0], signals[1]), 0);
});

test("nested test directories remain linked to their source file", () => {
  const source = turn(
    "callback-source",
    0,
    "Implement callback handler",
    ["src/auth/callback.ts"]
  );
  source.sourceHost = "codex";
  source.sessionId = "codex-callback";
  const unit = turn(
    "callback-test",
    1,
    "补充登录回跳单测",
    ["tests/unit/auth/callback.test.ts"]
  );
  unit.sourceHost = "claude";
  unit.sessionId = "claude-callback";
  const idf = buildIdf([source, unit].map((node) =>
    tokenize([node.prompt, node.response].join(" "))
  ));
  const signals = [source, unit].map((node) => signalForNode(node, idf));

  assert.ok(cohesion(signals[0], signals[1]) >= .34);
  assert.equal(aggregateWaypoints(signals, idf).length, 1);
});

test("indexed parent lookup finds an old related waypoint", () => {
  const make = ({
    id,
    timestamp,
    file,
    tokens = []
  }) => ({
    id,
    nodeIds: [id],
    sourceHosts: new Set([id === "return" ? "claude" : "codex"]),
    sessionIds: new Set([id]),
    files: new Set(file ? [file] : []),
    dirs: new Set(file ? [file.split("/").slice(0, -1).join("/")] : []),
    pathTerms: new Set(file ? ["auth", "token"] : []),
    tokens,
    vector: new Map(tokens.map((token) => [token, 1])),
    startedAt: timestamp,
    completedAt: timestamp,
    isRevert: false,
    verifyFailed: false,
    hasFileSignal: Boolean(file)
  });
  const root = make({
    id: "historical-auth",
    timestamp: 0,
    file: "src/auth/token.ts",
    tokens: ["en:auth", "en:token"]
  });
  const unrelated = Array.from({ length: 600 }, (_, index) =>
    make({
      id: `unrelated-${index}`,
      timestamp: (index + 1) * 1_000
    })
  );
  const returning = make({
    id: "return",
    timestamp: 700_000,
    file: "src/auth/token.ts",
    tokens: ["en:auth", "en:token"]
  });

  const relations = classifyRelations([root, ...unrelated, returning]);
  assert.equal(relations.get(returning.id).parentId, root.id);
});

test("indexed parent lookup retains a rich middle-history candidate", () => {
  const terms = Array.from({ length: 5 }, (_, index) => `en:topic-${index}`);
  const waypoint = (id, index, tokens) => ({
    id,
    nodeIds: [id],
    sourceHosts: new Set(["codex"]),
    sessionIds: new Set(["shared-session"]),
    files: new Set(),
    dirs: new Set(),
    pathTerms: new Set(),
    promptTokens: tokens,
    tokens,
    vector: new Map(tokens.map((token) => [token, 1])),
    startedAt: index * 1_000,
    completedAt: index * 1_000,
    isRevert: false,
    verifyFailed: false,
    hasFileSignal: false
  });
  const history = terms.map((token, index) =>
    waypoint(`first-${index}`, index, [token])
  );
  const intended = waypoint("intended", history.length, terms);
  history.push(intended);
  for (let round = 0; round < 130; round += 1) {
    for (const [termIndex, token] of terms.entries()) {
      history.push(waypoint(
        `noise-${round}-${termIndex}`,
        history.length,
        [token]
      ));
    }
  }
  while (history.length < 2_100) {
    history.push(waypoint(
      `padding-${history.length}`,
      history.length,
      [`en:padding-${history.length}`]
    ));
  }
  const returning = waypoint(
    "returning-rich-topic",
    history.length,
    [...terms, "en:follow-up"]
  );

  const oracle = history.reduce((best, candidate) =>
    relatedness(returning, candidate) > relatedness(returning, best)
      ? candidate
      : best
  );
  const relations = classifyRelations([...history, returning]);
  assert.equal(oracle.id, intended.id);
  assert.equal(relations.get(returning.id).parentId, intended.id);
});

test("indexed exact profiles retain the closest completion", () => {
  const history = [
    relationWaypoint({
      id: "long-running-earlier",
      startedAt: 0,
      completedAt: 2_999_000
    }),
    relationWaypoint({
      id: "immediate-exact-profile",
      startedAt: 100_000,
      completedAt: 100_000
    })
  ];
  for (let index = 0; index < 2_047; index += 1) {
    history.push(relationWaypoint({
      id: `exact-padding-${index}`,
      startedAt: 101_000 + index * 1_000,
      tokens: [`en:padding-${index}`],
      session: `padding-session-${index}`
    }));
  }
  const returning = relationWaypoint({
    id: "exact-profile-return",
    startedAt: 3_000_000
  });

  const relations = classifyRelations([...history, returning]);
  assert.equal(
    relations.get(returning.id).parentId,
    "long-running-earlier"
  );
});

test("indexed structural lookup retains singleton overlap by set size", () => {
  const targetFile = "src/deep/alpha/beta/gamma/delta/target.ts";
  const history = [
    relationWaypoint({
      id: "file-singleton-intended",
      startedAt: 0,
      files: [targetFile],
      pathTerms: [
        "deep",
        "alpha",
        "beta",
        "gamma",
        "delta",
        "target",
        "extra"
      ]
    })
  ];
  for (let index = 1; index <= 1_900; index += 1) {
    history.push(relationWaypoint({
      id: `file-prefix-${index}`,
      startedAt: index * 1_000_000,
      tokens: [`en:file-prefix-${index}`]
    }));
  }
  for (let index = 0; index < 129; index += 1) {
    history.push(relationWaypoint({
      id: `file-posting-noise-${index}`,
      startedAt: history.length * 1_000_000,
      files: [
        targetFile,
        `src/noise/a${index}.ts`,
        `src/noise/b${index}.ts`,
        `src/noise/c${index}.ts`,
        `src/noise/d${index}.ts`,
        `src/noise/e${index}.ts`
      ],
      pathTerms: [
        "deep",
        "alpha",
        "beta",
        "gamma",
        "delta",
        "target",
        "extra",
        `noise${index}`
      ]
    }));
  }
  while (history.length < 2_100) {
    const index = history.length;
    history.push(relationWaypoint({
      id: `file-suffix-${index}`,
      startedAt: index * 1_000_000,
      tokens: [`en:file-suffix-${index}`]
    }));
  }
  const returning = relationWaypoint({
    id: "file-singleton-return",
    startedAt: history.length * 1_000_000,
    files: [targetFile, "src/current/other.ts"],
    pathTerms: [
      "deep",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "target",
      "other"
    ]
  });

  const relations = classifyRelations([...history, returning]);
  assert.equal(
    relations.get(returning.id).parentId,
    "file-singleton-intended"
  );
});

test("indexed structural lookup retains the closest completion", () => {
  const targetFile = "src/auth/token.ts";
  const currentStartedAt = 3_000_000;
  const history = [
    relationWaypoint({
      id: "near-completion",
      startedAt: 0,
      completedAt: currentStartedAt - 1_000,
      files: [targetFile]
    })
  ];
  for (let index = 1; index <= 1_950; index += 1) {
    history.push(relationWaypoint({
      id: `completion-padding-${index}`,
      startedAt: index * 1_000,
      tokens: [`en:completion-padding-${index}`]
    }));
  }
  for (let index = 0; index < 129; index += 1) {
    history.push(relationWaypoint({
      id: `future-completion-${index}`,
      startedAt: 2_000_000 + index * 1_000,
      completedAt: currentStartedAt + 1_000_000 + index,
      files: [targetFile]
    }));
  }
  const returning = relationWaypoint({
    id: "completion-return",
    startedAt: currentStartedAt,
    files: [targetFile, "src/auth/session.ts"]
  });

  const relations = classifyRelations([...history, returning]);
  assert.equal(relations.get(returning.id).parentId, "near-completion");
});

test("indexed lookup retains the joint file and path optimum", () => {
  const history = [
    relationWaypoint({
      id: "balanced-intended",
      startedAt: 0,
      files: ["src/shared.ts"],
      pathTerms: ["shared"]
    })
  ];
  for (let index = 1; index <= 1_840; index += 1) {
    history.push(relationWaypoint({
      id: `joint-padding-${index}`,
      startedAt: index * 1_000_000,
      tokens: [`en:joint-padding-${index}`]
    }));
  }
  for (let index = 0; index < 129; index += 1) {
    history.push(relationWaypoint({
      id: `file-only-${index}`,
      startedAt: history.length * 1_000_000,
      files: ["src/shared.ts"],
      pathTerms: [`file-only-${index}`]
    }));
  }
  for (let index = 0; index < 129; index += 1) {
    history.push(relationWaypoint({
      id: `path-only-${index}`,
      startedAt: history.length * 1_000_000,
      files: [`src/path-only-${index}.ts`],
      pathTerms: ["shared"]
    }));
  }
  while (history.length < 2_100) {
    const index = history.length;
    history.push(relationWaypoint({
      id: `joint-suffix-${index}`,
      startedAt: index * 1_000_000,
      tokens: [`en:joint-suffix-${index}`]
    }));
  }
  const returning = relationWaypoint({
    id: "joint-return",
    startedAt: history.length * 1_000_000,
    files: ["src/shared.ts", "src/current.ts"],
    pathTerms: ["shared", "current"]
  });

  const relations = classifyRelations([...history, returning]);
  assert.equal(relations.get(returning.id).parentId, "balanced-intended");
});

test("structural-semantic lookup rejects a newer conflicting blocker", () => {
  const intended = relationWaypoint({
    id: "intended",
    startedAt: 0,
    files: ["src/alpha.ts", "src/beta.ts"],
    pathTerms: ["alpha", "beta"],
    tokens: ["en:alpha"],
    session: "intended-session",
    host: "codex"
  });
  const history = [
    intended,
    relationWaypoint({
      id: "intended-child",
      startedAt: 1_000,
      session: "intended-session",
      host: "codex"
    }),
    relationWaypoint({
      id: "exact-blocker",
      startedAt: 2_000,
      files: ["src/alpha.ts", "src/beta.ts"],
      pathTerms: ["alpha", "beta"],
      tokens: ["en:blocker"],
      session: "blocker-session",
      host: "claude"
    }),
    ...Array.from({ length: 253 }, (_, index) =>
      relationWaypoint({
        id: `semantic-noise-${index}`,
        startedAt: 10_000 + index * 1_000,
        session: `noise-session-${index}`,
        host: "claude"
      })
    ),
    relationWaypoint({
      id: "partial-decoy",
      startedAt: 900_000,
      files: ["src/alpha.ts"],
      pathTerms: ["alpha"],
      tokens: ["en:alpha"],
      session: "partial-session",
      host: "claude"
    })
  ];
  const query = relationWaypoint({
    id: "semantic-query",
    startedAt: 1_300_000,
    files: ["src/alpha.ts", "src/beta.ts"],
    pathTerms: ["alpha", "beta"],
    tokens: ["en:alpha"],
    session: "query-session",
    host: "codex"
  });

  const relations = classifyRelations([...history, query]);
  assert.equal(relations.get(query.id).parentId, intended.id);
  assert.equal(relations.get(query.id).type, "topic-divergence");
});

test("known-host lookup retains unknown-host continuity", () => {
  const currentStartedAt = 3_000_000;
  const history = [
    relationWaypoint({
      id: "unknown-host-intended",
      startedAt: 0,
      completedAt: currentStartedAt - 1_000,
      session: "mixed-host-session",
      host: ""
    })
  ];
  for (let index = 1; index <= 2_100; index += 1) {
    history.push(relationWaypoint({
      id: `known-host-padding-${index}`,
      startedAt: index * 1_000,
      completedAt: currentStartedAt + 1_000_000 + index,
      session: "mixed-host-session",
      host: "claude",
      tokens: [`en:known-host-padding-${index}`]
    }));
  }
  const returning = relationWaypoint({
    id: "known-host-return",
    startedAt: currentStartedAt,
    session: "mixed-host-session",
    host: "codex"
  });

  const relations = classifyRelations([...history, returning]);
  assert.equal(
    relations.get(returning.id).parentId,
    "unknown-host-intended"
  );
});

test("equal-score parent ids use binary ordering consistently", () => {
  const parents = [
    relationWaypoint({
      id: "Z-parent",
      startedAt: 0,
      completedAt: 0,
      tokens: ["en:oauth", "en:callback"]
    }),
    relationWaypoint({
      id: "a-parent",
      startedAt: 0,
      completedAt: 0,
      tokens: ["en:oauth", "en:callback"]
    })
  ];
  const returning = relationWaypoint({
    id: "tie-return",
    startedAt: 1_000,
    completedAt: 1_000,
    tokens: ["en:oauth", "en:callback"]
  });

  const relations = classifyRelations([...parents, returning]);
  assert.equal(relations.get(returning.id).parentId, "a-parent");
});

test("structural fast path retains every cross-context path tie", () => {
  const sharedFile = "src/ui/panel.ts";
  const sharedPathTerms = ["ui", "panel"];
  const history = [
    relationWaypoint({
      id: "Z-path-parent",
      startedAt: 0,
      completedAt: 20_470_044,
      files: [sharedFile],
      pathTerms: sharedPathTerms,
      tokens: ["en:panel"],
      session: "other-session",
      host: "codex"
    }),
    relationWaypoint({
      id: "a-nearest-parent",
      startedAt: 1_000_000,
      completedAt: 2_559_328,
      files: [sharedFile],
      pathTerms: sharedPathTerms,
      tokens: ["en:oauth", "en:continue", "en:panel"],
      session: "near-session",
      host: ""
    }),
    relationWaypoint({
      id: "invalid-latest",
      startedAt: 2_000_000,
      completedAt: 30_000_000,
      files: [sharedFile],
      pathTerms: sharedPathTerms,
      tokens: ["en:invoice"],
      session: "invalid-session",
      host: "codex"
    })
  ];
  const returning = relationWaypoint({
    id: "path-tie-return",
    startedAt: 3_000_000,
    completedAt: 4_000_000,
    files: [sharedFile],
    pathTerms: sharedPathTerms,
    tokens: ["en:continue", "en:panel"],
    session: "current-session",
    host: "claude"
  });

  const relations = classifyRelations([...history, returning]);
  assert.equal(relations.get(returning.id).parentId, "Z-path-parent");
});

test("relation ordering is stable and parent lookup remains bounded", () => {
  const waypoint = (id, index) => ({
    id,
    nodeIds: [id],
    sourceHosts: new Set(["codex"]),
    sessionIds: new Set(["shared-session"]),
    files: new Set(),
    dirs: new Set(),
    pathTerms: new Set(),
    tokens: [],
    vector: new Map(),
    startedAt: index === undefined ? 1_000 : index * 1_000,
    completedAt: index === undefined ? 1_000 : index * 1_000,
    isRevert: false,
    verifyFailed: false,
    hasFileSignal: false
  });
  const sameTime = [waypoint("c"), waypoint("a"), waypoint("b")];
  const first = [...classifyRelations(sameTime).entries()];
  const second = [...classifyRelations([...sameTime].reverse()).entries()];
  assert.deepEqual(second, first);

  const sharedTokens = Array.from(
    { length: 100 },
    (_, index) => `en:shared-${index}`
  );
  const large = Array.from({ length: 10_000 }, (_, index) =>
    ({
      ...waypoint(`scale-${String(index).padStart(5, "0")}`, index),
      tokens: sharedTokens,
      vector: new Map(sharedTokens.map((token) => [token, 1]))
    })
  );
  const diagnostics = { scoredCandidates: 0 };
  const relations = classifyRelations(large, diagnostics);
  assert.equal(relations.size, large.length);
  assert.ok(
    diagnostics.scoredCandidates <= large.length * 2,
    `scored ${diagnostics.scoredCandidates} candidates`
  );

  const varied = Array.from({ length: 10_000 }, (_, index) => {
    const tokens = ["en:shared-topic", `en:unique-${index}`];
    return {
      ...waypoint(`varied-${String(index).padStart(5, "0")}`, index),
      sessionIds: new Set([`session-${index}`]),
      promptTokens: tokens,
      tokens,
      vector: new Map(tokens.map((token) => [token, 1]))
    };
  });
  const variedDiagnostics = { scoredCandidates: 0 };
  assert.equal(classifyRelations(varied, variedDiagnostics).size, varied.length);
  assert.ok(
    variedDiagnostics.scoredCandidates < 3_000_000,
    `scored ${variedDiagnostics.scoredCandidates} varied candidates`
  );

  const genericFileless = Array.from({ length: 5_000 }, (_, index) => {
    const tokens = ["en:continue"];
    return {
      ...waypoint(`generic-${String(index).padStart(5, "0")}`, index),
      sessionIds: new Set([`generic-session-${index}`]),
      promptTokens: tokens,
      genericHandoff: true,
      tokens,
      vector: new Map([["en:continue", 1]])
    };
  });
  const genericDiagnostics = { scoredCandidates: 0 };
  assert.equal(
    classifyRelations(genericFileless, genericDiagnostics).size,
    genericFileless.length
  );
  assert.ok(
    genericDiagnostics.scoredCandidates < 3_000_000,
    `scored ${genericDiagnostics.scoredCandidates} generic candidates`
  );
});

test("high-frequency file and path indexes keep parent scoring bounded", () => {
  const count = 3_000;
  const sameFile = Array.from({ length: count }, (_, index) => {
    const waypoint = relationWaypoint({
      id: `same-file-${String(index).padStart(5, "0")}`,
      startedAt: index * 1_000,
      files: ["src/shared/panel.ts"],
      pathTerms: ["shared", "panel"],
      tokens: ["en:continue"],
      session: `same-file-session-${index}`
    });
    waypoint.genericHandoff = true;
    return waypoint;
  });
  const fileDiagnostics = { scoredCandidates: 0 };
  assert.equal(
    classifyRelations(sameFile, fileDiagnostics).size,
    sameFile.length
  );
  assert.ok(
    fileDiagnostics.scoredCandidates < count * 12,
    `scored ${fileDiagnostics.scoredCandidates} same-file candidates`
  );

  const sharedPath = Array.from({ length: count }, (_, index) =>
    relationWaypoint({
      id: `shared-path-${String(index).padStart(5, "0")}`,
      startedAt: index * 1_000,
      files: [`src/shared/file-${index}.ts`],
      pathTerms: ["shared"],
      tokens: ["en:shared", `en:topic-${index}`],
      session: `shared-path-session-${index}`
    })
  );
  const pathDiagnostics = { scoredCandidates: 0 };
  assert.equal(
    classifyRelations(sharedPath, pathDiagnostics).size,
    sharedPath.length
  );
  assert.ok(
    pathDiagnostics.scoredCandidates < count * 50,
    `scored ${pathDiagnostics.scoredCandidates} shared-path candidates`
  );
});
