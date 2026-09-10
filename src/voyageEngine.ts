import { AgentHost, FileChange, TimelineNode, ToolAction } from "./models";

/**
 * Voyage content engine — the content-driven layer that decides how raw turns
 * become waypoints (nodes) and how waypoints relate (continuation vs the two
 * kinds of divergence). It is deliberately dependency-free and pure so it can
 * be unit-tested and reused by both the live sidebar and the full map.
 *
 * Design (agreed model):
 *   - Q1 aggregation: consecutive turns solving the same sub-goal merge into one
 *     waypoint. Cohesion blends touched-file overlap, directory overlap, lexical
 *     (prompt+response) overlap, and time proximity. When file signal is absent
 *     (imported history), its weight is redistributed to text + time so the same
 *     engine still works on text-only data.
 *   - Q2 relations, structure-first (conservative):
 *       * revert/restore  -> divergence, and the abandoned older route is failed
 *                            (coral + reef). This is the hard structural signal.
 *       * topic switch     -> divergence when the touched-file set clearly changes
 *                            (strong, live-only) — never invented from text alone.
 *       * otherwise        -> continuation on the same lane.
 *   - Q3 lossless titles: parse the 结果/行动/沉淀 memory structure when present,
 *     else build a Conventional-Commit-style title from actions + keyphrases.
 *     Structured facts (files, ±lines, commands, validation) ride along so no
 *     core information is dropped.
 */

// ---------------------------------------------------------------------------
// Tokenization (CN bigrams + latin identifiers), IDF, cosine — all local.
// ---------------------------------------------------------------------------

const CN_STOPWORDS = new Set([
  "的", "了", "和", "与", "及", "并", "在", "为", "对", "中", "以", "其", "将",
  "把", "让", "使", "更", "加", "个", "并且", "要求", "进行", "以及", "相关",
  "一个", "这个", "基于", "用户", "提供", "需要", "侧重", "明确", "区分", "优化",
  "撰写", "描述", "策略", "逻辑", "设计", "方案", "内容", "项目", "经历", "实习",
  "实现", "功能", "问题", "调整", "确认", "当前", "完整", "核心", "效果", "视觉",
  "风格", "以达到", "使其", "能够", "我们", "现在", "这样", "或者", "一下", "帮我"
]);

const EN_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "please", "help",
  "can", "you", "make", "add", "use", "using", "our", "its", "are", "was"
]);

/** Break text into weighted tokens: latin words + Chinese bigrams. */
export function tokenize(text: string): string[] {
  const lower = String(text || "").toLowerCase();
  const tokens: string[] = [];
  for (const match of lower.match(/[a-z][a-z0-9+.#_-]*/gi) || []) {
    if (match.length >= 2 && !EN_STOPWORDS.has(match)) {
      tokens.push("en:" + match);
    }
  }
  for (const run of lower.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) {
      if (!CN_STOPWORDS.has(run)) tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (!CN_STOPWORDS.has(bigram)) tokens.push(bigram);
    }
  }
  return tokens;
}

export type SparseVector = Map<string, number>;

/** Build IDF weights over a token-document collection. */
export function buildIdf(documents: string[][]): (token: string) => number {
  const documentFrequency = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  const total = documents.length || 1;
  return (token: string) =>
    Math.log((total + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1;
}

/** TF-IDF vector; latin anchors (API, LaTeX, TRAE…) get a small boost. */
export function vectorize(
  tokens: string[],
  idf: (token: string) => number
): SparseVector {
  const termFrequency = new Map<string, number>();
  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
  }
  const vector: SparseVector = new Map();
  for (const [token, count] of termFrequency) {
    const anchorBoost = token.startsWith("en:") ? 1.6 : 1;
    vector.set(token, (1 + Math.log(count)) * idf(token) * anchorBoost);
  }
  return vector;
}

export function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [token, value] of small) {
    const other = large.get(token);
    if (other) dot += value * other;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Q1 — signal extraction + cohesion + waypoint aggregation
// ---------------------------------------------------------------------------

export interface TurnSignal {
  id: string;
  sourceHosts: Set<AgentHost>;
  sessionIds: Set<string>;
  timestamp: number;
  files: Set<string>;
  dirs: Set<string>;
  pathTerms: Set<string>;
  tokens: string[];
  vector: SparseVector;
  isRevert: boolean;
  verifyFailed: boolean;
  hasFileSignal: boolean;
}

const REVERT_PATTERN =
  /revert|restore|rollback|回退|回滚|还原|恢复到|checkout\s+--|git\s+reset/i;

function directoryOf(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  return slash > 0 ? filePath.slice(0, slash) : filePath;
}

function actionText(actions: ToolAction[]): string {
  return actions
    .map((action) => [action.tool, action.detail].filter(Boolean).join(" "))
    .join(" ");
}

const PATH_STOPWORDS = new Set([
  "src", "test", "tests", "spec", "index", "lib", "app", "main", "ts", "tsx",
  "js", "jsx", "json", "md", "go", "rs", "py", "config", "configuration",
  "shared", "common", "utils", "types", "constants", "service", "services"
]);

const CROSS_CONVERSATION_STOPWORDS = new Set([
  "en:add", "en:change", "en:changes", "en:code", "en:config",
  "en:configuration", "en:continue", "en:create", "en:discuss",
  "en:feature", "en:file", "en:fix", "en:fixed", "en:flow",
  "en:handling", "en:implement", "en:implementation", "en:improve",
  "en:issue", "en:module", "en:plan", "en:process", "en:refactor",
  "en:retry", "en:review", "en:run", "en:setup", "en:support",
  "en:system", "en:task", "en:test", "en:tests", "en:update",
  "en:updated", "en:updating", "en:work"
]);

function fileTerms(files: Set<string>): Set<string> {
  const terms = new Set<string>();
  for (const file of files) {
    for (const term of file.toLowerCase().split(/[/_.-]+/)) {
      if (term.length > 1 && !PATH_STOPWORDS.has(term)) {
        terms.add(term);
      }
    }
  }
  return terms;
}

function hasPathSemanticBridge(
  previous: Pick<TurnSignal, "pathTerms" | "tokens">,
  next: Pick<TurnSignal, "pathTerms" | "tokens">
): boolean {
  if (jaccard(previous.pathTerms, next.pathTerms) < 0.25) {
    return false;
  }
  const previousText = new Set(
    previous.tokens
      .filter((token) => token.startsWith("en:"))
      .map((token) => token.slice(3))
  );
  const nextText = new Set(
    next.tokens
      .filter((token) => token.startsWith("en:"))
      .map((token) => token.slice(3))
  );
  return (
    jaccard(previous.pathTerms, previousText) > 0 ||
    jaccard(next.pathTerms, nextText) > 0
  );
}

function hasDistinctiveSemanticBridge(
  previous: Pick<TurnSignal, "tokens" | "vector">,
  next: Pick<TurnSignal, "tokens" | "vector">
): boolean {
  const previousTerms = new Set(
    previous.tokens.filter((token) =>
      !CROSS_CONVERSATION_STOPWORDS.has(token)
    )
  );
  const nextTerms = new Set(
    next.tokens.filter((token) => !CROSS_CONVERSATION_STOPWORDS.has(token))
  );
  const sharedTerms = [...previousTerms].filter((term) => nextTerms.has(term));
  return sharedTerms.length >= 2 &&
    jaccard(previousTerms, nextTerms) >= 0.6 &&
    cosineSimilarity(previous.vector, next.vector) >= 0.3;
}

function crossesConversation(
  previous: Pick<TurnSignal, "sourceHosts" | "sessionIds">,
  next: Pick<TurnSignal, "sourceHosts" | "sessionIds">
): boolean {
  const hostsAreKnown =
    previous.sourceHosts.size > 0 && next.sourceHosts.size > 0;
  return (hostsAreKnown &&
      jaccard(previous.sourceHosts, next.sourceHosts) === 0) ||
    jaccard(previous.sessionIds, next.sessionIds) === 0;
}

/** Turn a raw TimelineNode into the multi-modal signal the engine reasons on. */
export function signalForNode(
  node: TimelineNode,
  idf: (token: string) => number
): TurnSignal {
  const files = new Set((node.files || []).map((file: FileChange) => file.path));
  const dirs = new Set([...files].map(directoryOf));
  const pathTerms = fileTerms(files);
  const tokens = tokenize(
    [node.prompt, node.response, actionText(node.actions || [])]
      .filter(Boolean)
      .join(" ")
  );
  const isRevert =
    node.kind === "safety" ||
    REVERT_PATTERN.test(node.prompt || "") ||
    (node.actions || []).some((action) =>
      REVERT_PATTERN.test([action.tool, action.detail].join(" "))
    );
  return {
    id: node.id,
    sourceHosts: new Set(node.sourceHost ? [node.sourceHost] : []),
    sessionIds: new Set([node.sessionId]),
    timestamp: Date.parse(node.completedAt) || 0,
    files,
    dirs,
    pathTerms,
    tokens,
    vector: vectorize(tokens, idf),
    isRevert,
    verifyFailed: node.validation?.status === "failed",
    hasFileSignal: files.size > 0
  };
}

const GAP_TAU_MS = 120_000; // time-proximity decay (2 min) for cohesion
const IDLE_HARD_MS = 30 * 60_000; // hard boundary: >30 min idle starts a waypoint

/**
 * Cohesion between two adjacent turns, in [0,1] — higher means "merge".
 * With file signal:   0.40 file + 0.15 dir + 0.25 lexical + 0.20 time.
 * Without file signal: weight collapses onto lexical + time (imported history).
 */
export function cohesion(previous: TurnSignal, next: TurnSignal): number {
  const lexical = cosineSimilarity(previous.vector, next.vector);
  const timeGap = Math.abs(next.timestamp - previous.timestamp);
  const time = Math.exp(-timeGap / GAP_TAU_MS);
  const crossedConversation = crossesConversation(previous, next);
  if (
    crossedConversation &&
    !hasDistinctiveSemanticBridge(previous, next) &&
    !hasPathSemanticBridge(previous, next)
  ) {
    return 0;
  }
  if (!previous.hasFileSignal || !next.hasFileSignal) {
    return 0.68 * lexical + 0.32 * time;
  }
  const file = jaccard(previous.files, next.files);
  const dir = jaccard(previous.dirs, next.dirs);
  return 0.4 * file + 0.15 * dir + 0.25 * lexical + 0.2 * time;
}

export interface Waypoint {
  id: string;
  nodeIds: string[];
  sourceHosts: Set<AgentHost>;
  sessionIds: Set<string>;
  files: Set<string>;
  dirs: Set<string>;
  pathTerms: Set<string>;
  tokens: string[];
  vector: SparseVector;
  startedAt: number;
  completedAt: number;
  isRevert: boolean;
  verifyFailed: boolean;
  hasFileSignal: boolean;
}

const MERGE_COHESION = 0.34; // adjacent turns above this fold into one waypoint

/**
 * Q1: aggregate a chronologically ordered signal stream into waypoints.
 * A turn folds into the current waypoint when cohesion is high AND no hard
 * boundary (long idle, or a revert that must start its own waypoint) fires.
 */
export function aggregateWaypoints(
  signals: TurnSignal[],
  idf: (token: string) => number
): Waypoint[] {
  const ordered = [...signals].sort((a, b) => a.timestamp - b.timestamp);
  const waypoints: Waypoint[] = [];
  for (const signal of ordered) {
    const current = waypoints.at(-1);
    const previousNode = current ? lastNodeSignal(current) : undefined;
    const idle =
      previousNode &&
      signal.timestamp - previousNode.timestamp > IDLE_HARD_MS;
    const hardBreak = signal.isRevert || idle;
    if (
      !current ||
      hardBreak ||
      (previousNode && cohesion(previousNode, signal) < MERGE_COHESION)
    ) {
      waypoints.push(waypointFromSignal(signal, idf));
    } else {
      mergeSignal(current, signal, idf);
    }
  }
  return waypoints;

  function lastNodeSignal(waypoint: Waypoint): TurnSignal {
    // Reconstruct a lightweight signal view of the waypoint's trailing edge so
    // cohesion compares against accumulated context, not just the first turn.
    return {
      id: waypoint.id,
      sourceHosts: waypoint.sourceHosts,
      sessionIds: waypoint.sessionIds,
      timestamp: waypoint.completedAt,
      files: waypoint.files,
      dirs: waypoint.dirs,
      pathTerms: waypoint.pathTerms,
      tokens: waypoint.tokens,
      vector: waypoint.vector,
      isRevert: waypoint.isRevert,
      verifyFailed: waypoint.verifyFailed,
      hasFileSignal: waypoint.hasFileSignal
    };
  }
}

function waypointFromSignal(
  signal: TurnSignal,
  idf: (token: string) => number
): Waypoint {
  return {
    id: signal.id,
    nodeIds: [signal.id],
    sourceHosts: new Set(signal.sourceHosts),
    sessionIds: new Set(signal.sessionIds),
    files: new Set(signal.files),
    dirs: new Set(signal.dirs),
    pathTerms: new Set(signal.pathTerms),
    tokens: [...signal.tokens],
    vector: vectorize(signal.tokens, idf),
    startedAt: signal.timestamp,
    completedAt: signal.timestamp,
    isRevert: signal.isRevert,
    verifyFailed: signal.verifyFailed,
    hasFileSignal: signal.hasFileSignal
  };
}

function mergeSignal(
  waypoint: Waypoint,
  signal: TurnSignal,
  idf: (token: string) => number
): void {
  waypoint.nodeIds.push(signal.id);
  for (const host of signal.sourceHosts) waypoint.sourceHosts.add(host);
  for (const sessionId of signal.sessionIds) waypoint.sessionIds.add(sessionId);
  for (const file of signal.files) waypoint.files.add(file);
  for (const dir of signal.dirs) waypoint.dirs.add(dir);
  for (const term of signal.pathTerms) waypoint.pathTerms.add(term);
  waypoint.tokens.push(...signal.tokens);
  waypoint.vector = vectorize(waypoint.tokens, idf);
  waypoint.completedAt = Math.max(waypoint.completedAt, signal.timestamp);
  waypoint.verifyFailed = waypoint.verifyFailed || signal.verifyFailed;
  waypoint.hasFileSignal = waypoint.hasFileSignal || signal.hasFileSignal;
}

// ---------------------------------------------------------------------------
// Q2 — relation classification (continuation vs two divergences)
// ---------------------------------------------------------------------------

export type RelationType = "continuation" | "topic-divergence" | "revert-divergence";

export interface WaypointRelation {
  parentId?: string;
  type: RelationType | "root";
}

const RELATE_TAU_MS = 300_000; // 5 min — FindParent time term
const RELATE_MIN = 0.12; // below this, nothing relates → new root (new boat)
const FILE_DIVERGE = 0.2; // touched-file overlap under this = changed battleground

/** Relatedness of a waypoint to a candidate ancestor (Yeh & Harnly FindParent).
 * Parent-finding balances file overlap and theme evenly: a topic-divergence
 * child changes files by definition, so if file overlap alone dominated it could
 * never find the parent it diverged from. The divergence *type* decision (below)
 * still relies on the structural file-change signal, so themes never invent forks.
 */
export function relatedness(current: Waypoint, candidate: Waypoint): number {
  const lexical = cosineSimilarity(current.vector, candidate.vector);
  const time = Math.exp(
    -Math.abs(current.startedAt - candidate.completedAt) / RELATE_TAU_MS
  );
  if (
    crossesConversation(current, candidate) &&
    !hasDistinctiveSemanticBridge(current, candidate) &&
    !hasPathSemanticBridge(current, candidate)
  ) {
    return 0;
  }
  if (current.hasFileSignal && candidate.hasFileSignal) {
    const file = jaccard(current.files, candidate.files);
    const path = jaccard(current.pathTerms, candidate.pathTerms);
    return 0.35 * file + 0.35 * lexical + 0.2 * path + 0.1 * time;
  }
  return 0.7 * lexical + 0.3 * time;
}

/**
 * Q2: classify each waypoint against everything before it.
 *   - revert  -> revert-divergence (the abandoned older route is failed elsewhere)
 *   - parent is not the current lane tip, OR touched files clearly changed
 *              -> topic-divergence (new lane, not marked failed)
 *   - else     -> continuation
 * Conservative: topic divergence needs the file signal to actually change; we
 * never invent a branch from text alone (imported history stays linear).
 */
export function classifyRelations(waypoints: Waypoint[]): Map<string, WaypointRelation> {
  const ordered = [...waypoints].sort((a, b) => a.startedAt - b.startedAt);
  const relations = new Map<string, WaypointRelation>();
  const laneTip = new Map<string, string>(); // parentId -> latest child id

  ordered.forEach((waypoint, index) => {
    if (index === 0) {
      relations.set(waypoint.id, { type: "root" });
      return;
    }
    let bestParent: Waypoint | undefined;
    let bestScore = 0;
    for (let j = 0; j < index; j += 1) {
      const candidate = ordered[j];
      const score = relatedness(waypoint, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestParent = candidate;
      }
    }
    if (!bestParent || bestScore < RELATE_MIN) {
      relations.set(waypoint.id, { type: "root" });
      return;
    }

    let type: RelationType = "continuation";
    if (waypoint.isRevert) {
      type = "revert-divergence";
    } else {
      const parentIsTip = laneTip.get(bestParent.id) === undefined;
      const changedBattleground =
        waypoint.hasFileSignal &&
        bestParent.hasFileSignal &&
        jaccard(waypoint.files, bestParent.files) < FILE_DIVERGE;
      if (!parentIsTip || changedBattleground) {
        type = "topic-divergence";
      }
    }
    relations.set(waypoint.id, { parentId: bestParent.id, type });
    if (type === "continuation") {
      laneTip.set(bestParent.id, waypoint.id);
    }
  });
  return relations;
}

// ---------------------------------------------------------------------------
// Q3 — lossless title/summary extraction (no hardcoded regex table)
// ---------------------------------------------------------------------------

/** Parse the 结果/行动/沉淀 memory sections a response may carry. */
export function parseMemorySections(response: string): {
  outcome?: string;
  actions: string[];
  learned: string[];
} {
  const text = String(response || "");
  const section = (label: string): string => {
    const match = text.match(
      new RegExp(label + "\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:结果|行动|沉淀)\\s*\\n|$)")
    );
    return match ? match[1].trim() : "";
  };
  const listOf = (block: string): string[] =>
    block
      .split(/\n/)
      .map((line) => line.replace(/^[-•\s]+/, "").trim())
      .filter(Boolean);
  return {
    outcome: section("结果") || undefined,
    actions: listOf(section("行动")),
    learned: listOf(section("沉淀"))
  };
}

/**
 * Keyphrase extraction (YAKE-inspired, dependency-free): score candidate tokens
 * by IDF × earliness, prefer distinctive latin anchors, return top phrases.
 */
export function keyphrases(
  tokens: string[],
  idf: (token: string) => number,
  limit = 3
): string[] {
  const firstSeen = new Map<string, number>();
  const frequency = new Map<string, number>();
  tokens.forEach((token, index) => {
    if (!firstSeen.has(token)) firstSeen.set(token, index);
    frequency.set(token, (frequency.get(token) || 0) + 1);
  });
  const total = tokens.length || 1;
  const scored = [...frequency.keys()].map((token) => {
    const earliness = 1 - (firstSeen.get(token) || 0) / total;
    const anchor = token.startsWith("en:") ? 1.5 : 1;
    return { token, score: idf(token) * (0.5 + 0.5 * earliness) * anchor };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.token.replace(/^en:/, ""));
}

const IMPERATIVE_TRIM = /^(请|帮我|麻烦|我想|我要|需要|希望|can you|please|help me)\s*/i;

/** First-sentence imperative head of a prompt, politeness stripped. */
export function imperativeHead(prompt: string): string {
  let first = String(prompt || "").split(/[。.!?！？\n]/)[0].trim();
  // Politeness can stack ("请帮我…"), so strip leading markers until stable.
  let previous: string;
  do {
    previous = first;
    first = first.replace(IMPERATIVE_TRIM, "").trim();
  } while (first !== previous);
  return first.length > 24 ? first.slice(0, 24) : first;
}
