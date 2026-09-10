import { AgentHost, ProjectState, TimelineNode, UserVerdict } from "./models";
import {
  aggregateWaypoints,
  buildIdf,
  classifyRelations,
  imperativeHead,
  keyphrases,
  parseMemorySections,
  signalForNode,
  tokenize,
  Waypoint
} from "./voyageEngine";

export interface ForestMetadata {
  tree: string;
  stage: string;
  stageOrder: number;
  parentStage?: string;
  branch?: string;
}

export interface ForestSession {
  id: string;
  treeId: string;
  sourceHosts: AgentHost[];
  stage: string;
  stageOrder: number;
  branch?: string;
  parentId?: string;
  title: string;
  shortTitle: string;
  preview: string;
  startedAt: string;
  completedAt: string;
  nodeIds: string[];
  verdict: UserVerdict | "neutral";
  successCount: number;
  failureCount: number;
  lessonCount: number;
  depth: number;
}

export interface ForestTree {
  id: string;
  title: string;
  sessions: ForestSession[];
  nodeCount: number;
  successCount: number;
  failureCount: number;
  lessonCount: number;
  startedAt: string;
  completedAt: string;
}

export interface ConversationForest {
  trees: ForestTree[];
  sessionCount: number;
  nodeCount: number;
}

const SESSION_GAP_MS = 4 * 60 * 60 * 1_000;

export function forestMetadataForChapter(chapter: string): ForestMetadata {
  switch (chapter) {
    case "需求与设计":
      return {
        tree: "示例应用",
        stage: "需求结构",
        stageOrder: 0
      };
    case "API 动态分成":
      return {
        tree: "示例应用",
        stage: "API 动态分成",
        stageOrder: 1,
        parentStage: "需求结构"
      };
    case "AI 助手":
      return {
        tree: "示例应用",
        stage: "AI 助手",
        stageOrder: 1,
        parentStage: "需求结构"
      };
    case "AI 助手 · Tips":
      return {
        tree: "示例应用",
        stage: "用户 Tips",
        stageOrder: 2,
        parentStage: "AI 助手",
        branch: "Tips"
      };
    case "AI 助手 · Tags":
      return {
        tree: "示例应用",
        stage: "内容 Tags",
        stageOrder: 2,
        parentStage: "AI 助手",
        branch: "Tags"
      };
    case "项目方向探索":
      return {
        tree: "Wayfinder",
        stage: "项目方向探索",
        stageOrder: 0
      };
    case "Wayfinder 产品":
      return {
        tree: "Wayfinder",
        stage: "产品定义",
        stageOrder: 1,
        parentStage: "项目方向探索"
      };
    case "TRAE 插件开发":
      return {
        tree: "Wayfinder",
        stage: "TRAE 插件实现",
        stageOrder: 2,
        parentStage: "产品定义"
      };
    default:
      return {
        tree: chapter || "其他讨论",
        stage: chapter || "其他讨论",
        stageOrder: 0
      };
  }
}

export function buildConversationForest(
  state: ProjectState
): ConversationForest {
  // Live voyages (real turns that touched files, or a restore fork) carry the
  // structural + file signal the content engine needs, so they flow through the
  // content-driven path. Purely imported history has no such signal — text-only
  // clustering fragments it far worse than its curated chapters — so it keeps
  // the chapter-based grouping below. This split is deliberate: we never invent
  // structure from text alone.
  if (hasLiveSignal(state)) {
    return buildLiveForest(state);
  }
  const abandoned = abandonedNodeIds(state);
  const nodes = [...state.nodes]
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    // Structure rule: a turn that a later restore/branch abandoned is marked
    // as a failed route (coral + reef) unless the user already judged it.
    // This only fires on real in-app voyages that forked away from a path;
    // linear imported history has no such structure and stays neutral.
    .map((node) =>
      abandoned.has(node.id) && !node.verdict
        ? { ...node, verdict: "failure" as UserVerdict }
        : node
    );
  const firstBySession = new Map<string, TimelineNode>();
  for (const node of nodes) {
    if (!firstBySession.has(node.sessionId)) {
      firstBySession.set(node.sessionId, node);
    }
  }

  const grouped = new Map<
    string,
    {
      title: string;
      metadata: ForestMetadata;
      nodes: TimelineNode[];
    }
  >();
  for (const node of nodes) {
    const metadata = metadataForNode(node, firstBySession);
    const key = [
      metadata.tree,
      metadata.stage,
      metadata.branch || ""
    ].join("\u0000");
    const group = grouped.get(key) || {
      title: metadata.tree,
      metadata,
      nodes: []
    };
    group.nodes.push(node);
    grouped.set(key, group);
  }

  const sessionsByTree = new Map<string, ForestSession[]>();
  for (const group of grouped.values()) {
    const runs = splitIntoSessions(group.nodes);
    for (const run of runs) {
      const session = sessionFor(group.metadata, run);
      const sessions = sessionsByTree.get(group.title) || [];
      sessions.push(session);
      sessionsByTree.set(group.title, sessions);
    }
  }

  const trees = [...sessionsByTree.entries()].map(([title, sessions]) => {
    sessions.sort(compareSessions);
    connectSessions(sessions);
    const allNodeIds = sessions.flatMap((session) => session.nodeIds);
    const startedAt = sessions.reduce(
      (earliest, session) =>
        !earliest || session.startedAt < earliest
          ? session.startedAt
          : earliest,
      ""
    );
    const completedAt = sessions.reduce(
      (latest, session) =>
        session.completedAt > latest ? session.completedAt : latest,
      ""
    );
    return {
      id: treeId(title),
      title,
      sessions,
      nodeCount: allNodeIds.length,
      successCount: sessions.reduce(
        (sum, session) => sum + session.successCount,
        0
      ),
      failureCount: sessions.reduce(
        (sum, session) => sum + session.failureCount,
        0
      ),
      lessonCount: sessions.reduce(
        (sum, session) => sum + session.lessonCount,
        0
      ),
      startedAt,
      completedAt
    };
  });

  trees.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return {
    trees,
    sessionCount: trees.reduce(
      (sum, tree) => sum + tree.sessions.length,
      0
    ),
    nodeCount: nodes.length
  };
}

/**
 * True when the state carries live-voyage signal the content engine can reason
 * on: a real turn that touched files, or a restore fork. Imported history has
 * neither (files are empty, no parentNodeId branches), so it never qualifies.
 */
function hasLiveSignal(state: ProjectState): boolean {
  const hasFileTurn = state.nodes.some(
    (node) => node.kind !== "imported" && (node.files || []).length > 0
  );
  const hasRestoreFork = (state.branches || []).some(
    (branch) => typeof branch.parentNodeId === "string"
  );
  return hasFileTurn || hasRestoreFork;
}

/**
 * Content-driven forest for live voyages. Turns are aggregated into waypoints
 * (Q1) and classified into continuation / topic-divergence / revert-divergence
 * (Q2) by the voyage engine; here we turn those into the ForestTree shape the
 * renderer consumes. Titles/summaries are extracted from content (Q3), not a
 * hardcoded table. A revert's abandoned older route is failed (coral + reef).
 */
function buildLiveForest(state: ProjectState): ConversationForest {
  const abandoned = abandonedNodeIds(state);
  const nodes = [...state.nodes].sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt)
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const idf = buildIdf(
    nodes.map((node) => tokenize([node.prompt, node.response].join(" ")))
  );
  const signals = nodes.map((node) => signalForNode(node, idf));
  const waypoints = aggregateWaypoints(signals, idf);
  const relations = classifyRelations(waypoints);

  // Waypoints connect into trees by their engine relations. A waypoint that is
  // a root (nothing related) opens a new tree (a new boat from the same port).
  const resolveRoot = (id: string): string => {
    let cursor = id;
    const seen = new Set<string>();
    while (!seen.has(cursor)) {
      seen.add(cursor);
      const parent = relations.get(cursor)?.parentId;
      if (!parent) return cursor;
      cursor = parent;
    }
    return cursor;
  };

  const sessionByWaypoint = new Map<string, ForestSession>();
  const sessionsByRoot = new Map<string, ForestSession[]>();
  for (const waypoint of waypoints) {
    const session = liveSessionFor(waypoint, relations, nodeById, idf, abandoned);
    sessionByWaypoint.set(waypoint.id, session);
    const root = resolveRoot(waypoint.id);
    const group = sessionsByRoot.get(root) || [];
    group.push(session);
    sessionsByRoot.set(root, group);
  }
  // The engine keyed relations by waypoint id (= first node id); rewrite each
  // parentId to the parent's session id so the renderer's parentId-based tree
  // builder links them, then compute depth.
  for (const waypoint of waypoints) {
    const session = sessionByWaypoint.get(waypoint.id);
    if (!session) continue;
    const parentWaypoint = relations.get(waypoint.id)?.parentId;
    session.parentId = parentWaypoint
      ? sessionByWaypoint.get(parentWaypoint)?.id
      : undefined;
  }
  setDepths([...sessionByWaypoint.values()]);

  const trees = [...sessionsByRoot.entries()].map(([root, sessions]) => {
    sessions.sort(compareSessions);
    const rootSession = sessionByWaypoint.get(root);
    const title = rootSession?.shortTitle || sessions[0].shortTitle;
    const allNodeIds = sessions.flatMap((session) => session.nodeIds);
    const startedAt = sessions.reduce(
      (earliest, session) =>
        !earliest || session.startedAt < earliest ? session.startedAt : earliest,
      ""
    );
    const completedAt = sessions.reduce(
      (latest, session) =>
        session.completedAt > latest ? session.completedAt : latest,
      ""
    );
    return {
      id: treeId(title + ":" + root),
      title,
      sessions,
      nodeCount: allNodeIds.length,
      successCount: sessions.reduce((sum, s) => sum + s.successCount, 0),
      failureCount: sessions.reduce((sum, s) => sum + s.failureCount, 0),
      lessonCount: sessions.reduce((sum, s) => sum + s.lessonCount, 0),
      startedAt,
      completedAt
    };
  });

  trees.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return {
    trees,
    sessionCount: trees.reduce((sum, tree) => sum + tree.sessions.length, 0),
    nodeCount: nodes.length
  };
}

function liveSessionFor(
  waypoint: Waypoint,
  relations: ReturnType<typeof classifyRelations>,
  nodeById: Map<string, TimelineNode>,
  idf: (token: string) => number,
  abandoned: Set<string>
): ForestSession {
  const waypointNodes = waypoint.nodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is TimelineNode => Boolean(node));
  const first = waypointNodes[0];
  const latest = waypointNodes.at(-1) || first;
  const relation = relations.get(waypoint.id);
  const isRevertRoute =
    relation?.type === "revert-divergence" ||
    waypointNodes.some((node) => abandoned.has(node.id));
  const verdict: UserVerdict | "neutral" = waypointNodes.some(
    (node) => node.verdict === "failure"
  )
    ? "failure"
    : isRevertRoute
      ? "failure"
      : latest.verdict || "neutral";
  const { title, stage } = liveTitleFor(waypoint, waypointNodes, idf);
  return {
    id: `forest-session:${first.id}`,
    treeId: "",
    sourceHosts: sourceHostsFor(waypointNodes),
    stage,
    stageOrder: 0,
    branch: undefined,
    title: normalizeText(first.prompt || stage),
    shortTitle: title,
    preview: normalizeText(latest.prompt || first.prompt || stage),
    startedAt: first.startedAt || first.completedAt,
    completedAt: latest.completedAt,
    nodeIds: waypoint.nodeIds,
    verdict,
    successCount: waypointNodes.filter((node) => node.verdict === "success").length,
    failureCount: waypointNodes.filter((node) => node.verdict === "failure").length,
    lessonCount: waypointNodes.filter((node) => Boolean(node.note)).length,
    depth: 0
  };
}

/**
 * Q3: content-driven title + stage label — no hardcoded regex table. Prefer the
 * imperative head of the first prompt; fall back to distinctive keyphrases. The
 * stage kicker is a compact action + top keyphrase.
 */
function liveTitleFor(
  waypoint: Waypoint,
  waypointNodes: TimelineNode[],
  idf: (token: string) => number
): { title: string; stage: string } {
  const first = waypointNodes[0];
  const head = imperativeHead(first?.prompt || "");
  const keys = keyphrases(waypoint.tokens, idf, 3).filter(
    (key) => key.length > 1
  );
  const title = head || keys.slice(0, 2).join(" · ") || "实时航段";
  const action = actionLabel(waypointNodes);
  const stage = keys.length > 0 ? `${action}·${keys[0]}` : action;
  return { title: normalizeText(title), stage };
}

function actionLabel(nodes: TimelineNode[]): string {
  const text = nodes.map((node) => node.prompt || "").join(" ");
  const learned = nodes.some((node) =>
    parseMemorySections(node.response || "").learned.length > 0
  );
  if (/回退|回滚|revert|restore/.test(text)) return "回退";
  if (/修复|解决|排查|fix/i.test(text)) return "修复";
  if (/重构|改造|refactor/i.test(text)) return "重构";
  if (/优化|完善|打磨/.test(text)) return "优化";
  if (/实现|开发|新增|搭建|feat/i.test(text)) return "实现";
  if (/测试|test|单测/i.test(text)) return "测试";
  return learned ? "沉淀" : "推进";
}

function setDepths(sessions: ForestSession[]): void {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const cache = new Map<string, number>();
  const depthFor = (session: ForestSession, stack = new Set<string>()): number => {
    const cached = cache.get(session.id);
    if (cached !== undefined) return cached;
    if (!session.parentId || stack.has(session.id)) {
      cache.set(session.id, 0);
      return 0;
    }
    stack.add(session.id);
    const parent = byId.get(session.parentId);
    const depth = parent ? depthFor(parent, stack) + 1 : 0;
    stack.delete(session.id);
    cache.set(session.id, depth);
    return depth;
  };
  for (const session of sessions) session.depth = depthFor(session);
}


function metadataForNode(
  node: TimelineNode,
  firstBySession: Map<string, TimelineNode>
): ForestMetadata {
  if (node.source?.type === "trae-memory" && node.source.forest) {
    return node.source.forest;
  }
  if (node.source?.type === "trae-memory" && node.source.chapter) {
    return forestMetadataForChapter(node.source.chapter);
  }
  const first = firstBySession.get(node.sessionId);
  const title =
    node.sessionId === "initial" ||
    node.sessionId === "manual" ||
    node.sessionId === "restore"
      ? "当前项目"
      : summarizeSessionTitle(
          first?.prompt || node.prompt || "实时任务",
          "实时任务"
        );
  return {
    tree: title,
    stage: "实时会话",
    stageOrder: 0
  };
}

function splitIntoSessions(nodes: TimelineNode[]): TimelineNode[][] {
  const ordered = [...nodes].sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt)
  );
  const sessions: TimelineNode[][] = [];
  for (const node of ordered) {
    const current = sessions.at(-1);
    const previous = current?.at(-1);
    const changedSession =
      previous &&
      previous.sessionId !== node.sessionId &&
      previous.kind !== "imported" &&
      node.kind !== "imported";
    const changedDay =
      previous && dayKey(previous.completedAt) !== dayKey(node.completedAt);
    const gap =
      previous &&
      Date.parse(node.completedAt) - Date.parse(previous.completedAt) >
        SESSION_GAP_MS;
    if (!current || changedSession || changedDay || gap) {
      sessions.push([node]);
    } else {
      current.push(node);
    }
  }
  return sessions;
}

function sessionFor(
  metadata: ForestMetadata,
  nodes: TimelineNode[]
): ForestSession {
  const first = nodes[0];
  const latest = nodes.at(-1) || first;
  const verdict = lastVerdict(nodes);
  return {
    id: `forest-session:${first.id}`,
    treeId: treeId(metadata.tree),
    sourceHosts: sourceHostsFor(nodes),
    stage: metadata.stage,
    stageOrder: metadata.stageOrder,
    branch: metadata.branch,
    title: normalizeText(first.prompt || metadata.stage),
    shortTitle: summarizeSessionTitle(
      first.prompt || metadata.stage,
      metadata.stage
    ),
    preview: normalizeText(latest.prompt || first.prompt || metadata.stage),
    startedAt: first.startedAt || first.completedAt,
    completedAt: latest.completedAt,
    nodeIds: nodes.map((node) => node.id),
    verdict,
    successCount: nodes.filter((node) => node.verdict === "success").length,
    failureCount: nodes.filter((node) => node.verdict === "failure").length,
    lessonCount: nodes.filter((node) => Boolean(node.note)).length,
    depth: 0,
    ...(metadata.parentStage
      ? { parentStage: metadata.parentStage }
      : {})
  } as ForestSession & { parentStage?: string };
}

function sourceHostsFor(nodes: TimelineNode[]): AgentHost[] {
  return [...new Set(
    nodes
      .map((node) => node.sourceHost)
      .filter((host): host is AgentHost => Boolean(host))
  )];
}

function connectSessions(sessions: ForestSession[]): void {
  const byStage = new Map<string, ForestSession[]>();
  for (const session of sessions) {
    const key = stageKey(session.stage, session.branch);
    const group = byStage.get(key) || [];
    group.push(session);
    byStage.set(key, group);
  }
  for (const group of byStage.values()) {
    group.sort(compareSessions);
    for (let index = 1; index < group.length; index += 1) {
      group[index].parentId = group[index - 1].id;
    }
  }

  for (const session of sessions) {
    if (session.parentId) {
      continue;
    }
    const parentStage = (
      session as ForestSession & { parentStage?: string }
    ).parentStage;
    if (!parentStage) {
      continue;
    }
    const candidates = sessions
      .filter(
        (candidate) =>
          candidate.id !== session.id &&
          candidate.stage === parentStage &&
          compareSessions(candidate, session) < 0
      )
      .sort(compareSessions);
    const parent = candidates.at(-1);
    if (parent) {
      session.parentId = parent.id;
    }
  }

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const depthCache = new Map<string, number>();
  const depthFor = (session: ForestSession, stack = new Set<string>()): number => {
    const cached = depthCache.get(session.id);
    if (cached !== undefined) {
      return cached;
    }
    if (!session.parentId || stack.has(session.id)) {
      depthCache.set(session.id, 0);
      return 0;
    }
    stack.add(session.id);
    const parent = byId.get(session.parentId);
    const depth = parent ? depthFor(parent, stack) + 1 : 0;
    stack.delete(session.id);
    depthCache.set(session.id, depth);
    return depth;
  };
  for (const session of sessions) {
    session.depth = depthFor(session);
    delete (session as ForestSession & { parentStage?: string }).parentStage;
  }
}

function lastVerdict(
  nodes: TimelineNode[]
): UserVerdict | "neutral" {
  // A route that contains an abandoned/failed turn reads as failed, even if a
  // trailing safety checkpoint or later neutral turn follows it.
  if (nodes.some((node) => node.verdict === "failure")) {
    return "failure";
  }
  return nodes.at(-1)?.verdict || "neutral";
}

/**
 * Structure rule for automatic failure detection.
 *
 * When a user restores an earlier snapshot, the app forks a new TimelineBranch
 * whose `parentNodeId` is the node they returned to, and leaves the original
 * downstream nodes in place. Those abandoned downstream nodes are the tell-tale
 * "this path was walked back from" signal — a route that turned out wrong.
 *
 * We return the ids of every node that was abandoned this way: on the forked
 * parent's branch, any node that comes chronologically after the fork point.
 * Purely structural — no content analysis — so it never fires on linear
 * imported history (which has no fork points) and cannot misjudge live text.
 */
export function abandonedNodeIds(state: ProjectState): Set<string> {
  const abandoned = new Set<string>();
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const forkParents = (state.branches || [])
    .map((branch) => branch.parentNodeId)
    .filter((id): id is string => typeof id === "string" && byId.has(id));
  if (forkParents.length === 0) {
    return abandoned;
  }
  for (const parentId of forkParents) {
    const parent = byId.get(parentId);
    if (!parent) {
      continue;
    }
    // Everything later on the same branch as the fork point was walked back
    // from — that is the abandoned (failed) route. Safety checkpoints created
    // by the restore itself are excluded so they never show as failures.
    for (const node of state.nodes) {
      if (
        node.branchId === parent.branchId &&
        node.kind !== "safety" &&
        node.id !== parent.id &&
        node.completedAt > parent.completedAt
      ) {
        abandoned.add(node.id);
      }
    }
  }
  return abandoned;
}

function compareSessions(a: ForestSession, b: ForestSession): number {
  return (
    a.startedAt.localeCompare(b.startedAt) ||
    a.stageOrder - b.stageOrder ||
    a.stage.localeCompare(b.stage)
  );
}

function treeId(title: string): string {
  return `forest-tree:${encodeURIComponent(title)}`;
}

function stageKey(stage: string, branch?: string): string {
  return `${stage}\u0000${branch || ""}`;
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function summarizeSessionTitle(
  value: string,
  fallback = "未命名会话"
): string {
  const text = normalizeText(value);
  const rules: Array<[RegExp, string]> = [
    [/极具趣味性.*AI\s*产品创意/i, "寻找惊艳 AI 创意"],
    [/(?:确认并回顾).*Wayfinder.*核心逻辑/i, "确认 Wayfinder 核心逻辑"],
    [/(?:技术可实现).*Wayfinder.*最终版.*方案/i, "制定 Wayfinder 最终方案"],
    [/轻量美观.*VS\s*Code\s*插件.*安全回退/i, "开发可回退的 TRAE 插件"],
    [/安装及使用\s*Wayfinder/i, "安装并试用 Wayfinder"],
    [/单线时间轴.*可视化方案/i, "重构决策可视化"],
    [/重构\s*Wayfinder\s*可视化/i, "升级 Wayfinder 决策图"],
    [/新版布局未生效/i, "修复新版布局未生效"],
    [/多个示例需求文档/i, "整理项目方案"],
    [/Example\s*App.*创作者激励.*AI\s*助手/i, "打磨应用项目方案"],
    [/API\s*和\s*AI\s*助手.*区分/i, "区分 API 与助手"],
    [/三个项目.*API.*Task\s*Helper/i, "理清应用策略"],
    [/API\s*动态分成激励.*组成结构/i, "拆解 API 激励"],
    [/项目方案描述.*策略感/i, "强化项目方案表达"],
    [/Task\s*Helper.*实时AI教练/i, "设计实时 AI 教练"],
    [/AI助手与Task合并/i, "整合 Tips 与 Tags"],
    [/Tips\s*项目.*核心定义/i, "明确 Tips 定位"]
  ];
  for (const [pattern, summary] of rules) {
    if (pattern.test(text)) {
      return summary;
    }
  }

  const domain = summaryDomain(text, fallback);
  const action =
    /修复|解决|排查|未生效/.test(text) ? "修复" :
    /重构|改造|升级/.test(text) ? "重构" :
    /优化|完善|打磨/.test(text) ? "优化" :
    /开发|实现|搭建|构建/.test(text) ? "实现" :
    /确认|回顾/.test(text) ? "确认" :
    /理解|了解|解释|理清|分析/.test(text) ? "理清" :
    /寻找|探索|调研/.test(text) ? "探索" :
    /撰写|重写|写/.test(text) ? "撰写" :
    "推进";
  return `${action}${domain}`.replace(/[.…。；，、]+$/g, "");
}

function summaryDomain(text: string, fallback: string): string {
  const domains: Array<[RegExp, string]> = [
    [/Wayfinder.*(?:可视化|界面|决策图)/i, " Wayfinder 决策图"],
    [/Wayfinder.*插件/i, " Wayfinder 插件"],
    [/Wayfinder/i, "Wayfinder"],
    [/API.*AI\s*助手/i, " API 与 AI 助手"],
    [/API/i, " API 激励"],
    [/(?:内容\s*)?Tags/i, "内容 Tags"],
    [/(?:用户\s*)?Tips/i, "用户 Tips"],
    [/Task\s*Helper/i, "实时 AI 教练"],
    [/AI\s*助手/i, " AI 助手"],
    [/项目方案/i, "项目方案表达"],
    [/可视化|图谱|谱系/i, "决策可视化"]
  ];
  for (const [pattern, domain] of domains) {
    if (pattern.test(text)) {
      return domain;
    }
  }
  return fallback === "未命名会话" ? "当前任务" : fallback;
}

function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[，。；、\s]+|[，。；、\s]+$/g, "")
    .trim();
}
