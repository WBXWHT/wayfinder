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
  promptTokens?: string[];
  genericHandoff?: boolean;
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
  "en:proceed", "en:retry", "en:review", "en:run", "en:setup", "en:support",
  "en:system", "en:task", "en:test", "en:tests", "en:update",
  "en:updated", "en:updating", "en:work"
]);
const GENERIC_HANDOFF_TOKENS = new Set([
  "en:continue",
  "en:proceed",
  "继续",
  "接着"
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

function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  return (
    /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(normalized) ||
    /\.(?:test|spec)\.[^/.]+$/.test(normalized)
  );
}

function comparableFileStem(filePath: string, testFile: boolean): string {
  let normalized = filePath
    .replaceAll("\\", "/")
    .toLowerCase()
    .replace(/\.(?:test|spec)(?=\.[^/.]+$)/, "")
    .replace(/\.[^/.]+$/, "")
    .replace(/^(?:src|lib)\//, "");
  if (testFile) {
    normalized = normalized
      .replace(/^(?:test|tests|__tests__)\//, "")
      .replace(/^(?:unit|integration|e2e|functional|acceptance)\//, "");
  }
  return normalized;
}

function hasSourceTestCounterpart(
  previousFiles: Set<string>,
  nextFiles: Set<string>
): boolean {
  return [...previousFiles].some((previous) =>
    [...nextFiles].some((next) => {
      const previousIsTest = isTestFilePath(previous);
      const nextIsTest = isTestFilePath(next);
      return (
        previousIsTest !== nextIsTest &&
        comparableFileStem(previous, previousIsTest) ===
          comparableFileStem(next, nextIsTest)
      );
    })
  );
}

function hasConflictingThemes(
  previous: { tokens: string[]; genericHandoff?: boolean },
  next: { tokens: string[]; genericHandoff?: boolean }
): boolean {
  if (previous.genericHandoff || next.genericHandoff) {
    return false;
  }
  const conflicts = (
    previousTerms: Set<string>,
    nextTerms: Set<string>
  ): boolean =>
    previousTerms.size >= 2 &&
    nextTerms.size >= 2 &&
    [...previousTerms].every((term) => !nextTerms.has(term));
  return conflicts(
    distinctiveThemeTerms(previous.tokens, true),
    distinctiveThemeTerms(next.tokens, true)
  ) || conflicts(
    distinctiveThemeTerms(previous.tokens, false),
    distinctiveThemeTerms(next.tokens, false)
  );
}

function distinctiveThemeTerms(
  tokens: string[],
  english: boolean
): Set<string> {
  return new Set(
    tokens.filter((token) =>
      token.startsWith("en:") === english &&
      !CROSS_CONVERSATION_STOPWORDS.has(token) &&
      !GENERIC_HANDOFF_TOKENS.has(token)
    )
  );
}

function distinctiveEnglishTerms(tokens: string[]): Set<string> {
  return new Set(
    tokens.filter((token) =>
      token.startsWith("en:") &&
      !CROSS_CONVERSATION_STOPWORDS.has(token)
    )
  );
}

function hasSourceTestBridge(
  previous: {
    files: Set<string>;
    tokens: string[];
    genericHandoff?: boolean;
  },
  next: {
    files: Set<string>;
    tokens: string[];
    genericHandoff?: boolean;
  }
): boolean {
  return (
    hasSourceTestCounterpart(previous.files, next.files) &&
    !hasConflictingThemes(previous, next)
  );
}

function hasPathSemanticBridge(
  previous: {
    files: Set<string>;
    pathTerms: Set<string>;
    promptTokens?: string[];
    genericHandoff?: boolean;
    tokens: string[];
    timestamp?: number;
    startedAt?: number;
    completedAt?: number;
  },
  next: {
    files: Set<string>;
    pathTerms: Set<string>;
    promptTokens?: string[];
    genericHandoff?: boolean;
    tokens: string[];
    timestamp?: number;
    startedAt?: number;
    completedAt?: number;
  }
): boolean {
  const exactFiles =
    previous.files.size > 0 &&
    previous.files.size === next.files.size &&
    jaccard(previous.files, next.files) === 1;
  const previousTime =
    previous.timestamp ?? previous.completedAt ?? previous.startedAt ?? 0;
  const nextTime =
    next.timestamp ?? next.startedAt ?? next.completedAt ?? 0;
  const closeInTime =
    Math.abs(previousTime - nextTime) <= IDLE_HARD_MS;
  const nextIsGeneric = next.genericHandoff ??
    isGenericHandoff(next.promptTokens || next.tokens);
  if (
    exactFiles &&
    closeInTime &&
    nextIsGeneric
  ) {
    return true;
  }
  const sharedPathTerms = [...previous.pathTerms].filter((term) =>
    next.pathTerms.has(term)
  );
  if (sharedPathTerms.length === 0) {
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
  const bothReferencePath = sharedPathTerms.some((term) =>
    previousText.has(term) && nextText.has(term)
  );
  if (
    bothReferencePath ||
    (!exactFiles && hasSourceTestBridge(previous, next))
  ) {
    return true;
  }
  return false;
}

function isGenericHandoff(tokens: string[]): boolean {
  return (
    tokens.some((token) => GENERIC_HANDOFF_TOKENS.has(token)) &&
    tokens.every((token) =>
      CROSS_CONVERSATION_STOPWORDS.has(token) ||
      GENERIC_HANDOFF_TOKENS.has(token)
    )
  );
}

export function isGenericHandoffText(text: string): boolean {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[。！？!?.,，:：;；]+$/g, "");
  return (
    /^(?:continue|proceed)(?:\s+(?:the\s+)?(?:implementation|work|task))?$/.test(
      normalized
    ) ||
    /^(?:继续|接着)(?:处理|进行|完成|下去|吧)?$/.test(normalized)
  );
}

function hasDistinctiveSemanticBridge(
  previous: Pick<TurnSignal, "tokens" | "vector">,
  next: Pick<TurnSignal, "tokens" | "vector">
): boolean {
  return distinctiveSemanticSimilarity(previous, next) >= 0.3;
}

function distinctiveSemanticSimilarity(
  previous: Pick<TurnSignal, "tokens" | "vector">,
  next: Pick<TurnSignal, "tokens" | "vector">
): number {
  const previousTerms = new Set(
    previous.tokens.filter((token) =>
      !CROSS_CONVERSATION_STOPWORDS.has(token)
    )
  );
  const nextTerms = new Set(
    next.tokens.filter((token) => !CROSS_CONVERSATION_STOPWORDS.has(token))
  );
  const sharedTerms = [...previousTerms].filter((term) => nextTerms.has(term));
  const overlap = jaccard(previousTerms, nextTerms);
  if (
    sharedTerms.length < 2 ||
    overlap < 0.6 ||
    (
      Math.max(previousTerms.size, nextTerms.size) > 6 &&
      overlap !== 1
    )
  ) {
    return 0;
  }
  return 1;
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
  const promptTokens = tokenize(node.prompt || "");
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
    promptTokens,
    genericHandoff: isGenericHandoffText(node.prompt || ""),
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
  const file = hasSourceTestBridge(previous, next)
    ? 1
    : jaccard(previous.files, next.files);
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
  promptTokens?: string[];
  genericHandoff?: boolean;
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
  const ordered = [...signals].sort((a, b) =>
    a.timestamp - b.timestamp || a.id.localeCompare(b.id)
  );
  const waypoints: Waypoint[] = [];
  for (const signal of ordered) {
    const current = waypoints[waypoints.length - 1];
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
      promptTokens: waypoint.promptTokens || waypoint.tokens,
      genericHandoff: waypoint.genericHandoff,
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
    promptTokens: [...(signal.promptTokens || signal.tokens)],
    genericHandoff: signal.genericHandoff,
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
  waypoint.promptTokens = [...(signal.promptTokens || signal.tokens)];
  waypoint.genericHandoff = signal.genericHandoff;
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
const RECENT_PARENT_CANDIDATES = 32;
const EXHAUSTIVE_PARENT_THRESHOLD = 256;
const MAX_FUZZY_SEMANTIC_TERMS = 6;
const MAX_STRUCTURAL_SUBSET_ITEMS = 6;
const MAX_RELATION_SCORE = 0.7;

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface CounterpartCandidates {
  sourceLatest?: number;
  testLatest?: number;
  sourceAmbiguous?: number;
  testAmbiguous?: number;
  sourceByTerm: Map<string, number>;
  testByTerm: Map<string, number>;
}

function tokenFrequencySignature(
  tokens: string[],
  omitStopwords = false
): string {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (!omitStopwords || !CROSS_CONVERSATION_STOPWORDS.has(token)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts]
    .sort()
    .map(([token, count]) => `${token}:${count}`)
    .join("\u0000");
}

function fileSignature(waypoint: Waypoint): string {
  return [...waypoint.files].sort().join("\u0000");
}

function structuralSignature(waypoint: Waypoint): string {
  return [
    fileSignature(waypoint),
    [...waypoint.pathTerms].sort().join("\u0000")
  ].join("\u0005");
}

function relationProfile(waypoint: Waypoint): string {
  return (
    `${fileSignature(waypoint)}\u0001` +
    tokenFrequencySignature(waypoint.tokens)
  );
}

function distinctiveSetSignature(waypoint: Waypoint): string {
  return [...new Set(
    waypoint.tokens.filter((token) =>
      !CROSS_CONVERSATION_STOPWORDS.has(token)
    )
  )]
    .sort()
    .join("\u0000");
}

function exactRelationSignature(
  waypoint: Waypoint,
  profile = relationProfile(waypoint)
): string {
  return [
    profile,
    [...waypoint.sourceHosts].sort().join("\u0000"),
    [...waypoint.sessionIds].sort().join("\u0000")
  ].join("\u0002");
}

export interface RelationDiagnostics {
  scoredCandidates: number;
}

/** Relatedness of a waypoint to a candidate ancestor (Yeh & Harnly FindParent).
 * Parent-finding balances file overlap and theme evenly: a topic-divergence
 * child changes files by definition, so if file overlap alone dominated it could
 * never find the parent it diverged from. The divergence *type* decision (below)
 * still relies on the structural file-change signal, so themes never invent forks.
 */
export function relatedness(current: Waypoint, candidate: Waypoint): number {
  const timeGap = Math.abs(current.startedAt - candidate.completedAt);
  const lexical = distinctiveSemanticSimilarity(current, candidate);
  const time = Math.exp(-timeGap / RELATE_TAU_MS);
  const sameContext = !crossesConversation(current, candidate);
  const continuity = sameContext && timeGap <= RELATE_TAU_MS
    ? RELATE_MIN + 0.08 * time
    : 0;
  if (
    !sameContext &&
    !hasDistinctiveSemanticBridge(current, candidate) &&
    !hasPathSemanticBridge(candidate, current)
  ) {
    return 0;
  }
  if (current.hasFileSignal && candidate.hasFileSignal) {
    const counterpart = hasSourceTestBridge(current, candidate);
    const fileOverlap = jaccard(current.files, candidate.files);
    const pathOverlap = jaccard(current.pathTerms, candidate.pathTerms);
    const file =
      Math.max(current.files.size, candidate.files.size) >
          MAX_STRUCTURAL_SUBSET_ITEMS &&
        fileOverlap !== 1
        ? 0
        : fileOverlap;
    const path =
      Math.max(current.pathTerms.size, candidate.pathTerms.size) >
          MAX_STRUCTURAL_SUBSET_ITEMS &&
        pathOverlap !== 1
        ? 0
        : pathOverlap;
    return Math.max(
      continuity,
      counterpart ? 0.6 : 0,
      0.35 * file + 0.2 * path,
      0.7 * lexical,
      0.1 * time
    );
  }
  return Math.max(continuity, 0.7 * lexical, 0.3 * time);
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
export function classifyRelations(
  waypoints: Waypoint[],
  diagnostics?: RelationDiagnostics
): Map<string, WaypointRelation> {
  const ordered = [...waypoints].sort((a, b) =>
    a.startedAt - b.startedAt ||
    a.completedAt - b.completedAt ||
    compareStableIds(a.id, b.id)
  );
  const relations = new Map<string, WaypointRelation>();
  const laneTip = new Map<string, string>(); // parentId -> latest child id
  const sessionFileIndex = new Map<string, number[]>();
  const sessionPathIndex = new Map<string, number[]>();
  const sessionStructuralIndex = new Map<string, number[]>();
  const contextFileIndex = new Map<string, number[]>();
  const contextPathIndex = new Map<string, number[]>();
  const contextStructuralIndex = new Map<string, number[]>();
  const pathTextBridgeIndex = new Map<string, number[]>();
  const sessionRecent = new Map<string, number[]>();
  const contextRecent = new Map<string, number[]>();
  const sessionCompletionIndex = new Map<string, number[]>();
  const contextCompletionIndex = new Map<string, number[]>();
  const fileContextLatest = new Map<string, number>();
  const counterpartIndex = new Map<string, CounterpartCandidates>();
  const fileSetIndex = new Map<string, number[]>();
  const pathSetIndex = new Map<string, number[]>();
  const structuralSetIndex = new Map<string, number[]>();
  const structuralSemanticIndex = new Map<string, number[]>();
  const filePathPairIndex = new Map<string, number[]>();
  const fileSubsetIndex = new Map<string, Map<number, number[]>>();
  const pathSubsetIndex = new Map<string, Map<number, number[]>>();
  const semanticSetIndex = new Map<string, number[]>();
  const semanticSubsetIndex =
    new Map<string, Map<number, number[]>>();
  const relationSignatureIndex = new Map<string, number[]>();

  const compareCompleted = (left: number, right: number): number =>
    ordered[left].completedAt - ordered[right].completedAt ||
    compareStableIds(ordered[left].id, ordered[right].id);

  const rememberPreferred = <Key>(
    target: Map<Key, number>,
    key: Key,
    index: number
  ): void => {
    const previous = target.get(key);
    if (previous === undefined || compareCompleted(previous, index) <= 0) {
      target.set(key, index);
    }
  };

  const addIndex = (
    target: Map<string, number[]>,
    values: Iterable<string>,
    waypointIndex: number
  ): void => {
    for (const value of new Set(values)) {
      const candidates = target.get(value) || [];
      indexByCompletion(candidates, waypointIndex);
      target.set(value, candidates);
    }
  };

  const rememberRecent = (
    target: Map<string, number[]>,
    key: string,
    index: number
  ): void => {
    const recent = target.get(key) || [];
    recent.push(index);
    if (recent.length > RECENT_PARENT_CANDIDATES) {
      recent.shift();
    }
    target.set(key, recent);
  };

  const semanticIndexTokens = (waypoint: Waypoint): string[] =>
    [...new Set(
      waypoint.tokens.filter((token) =>
        !CROSS_CONVERSATION_STOPWORDS.has(token)
      )
    )]
      .sort();

  const referencedPathTerms = (waypoint: Waypoint): string[] => {
    const englishTerms = new Set(
      waypoint.tokens
        .filter((token) => token.startsWith("en:"))
        .map((token) => token.slice(3))
    );
    return [...waypoint.pathTerms].filter((term) => englishTerms.has(term));
  };

  const contextualSignals = (
    context: string,
    values: Iterable<string>
  ): string[] =>
    [...new Set(values)].map((value) => `${context}\u0006${value}`);

  const indexedSubsets = (
    values: string[],
    maximumItems: number,
    minimumItems = 2
  ): string[] => {
    if (
      values.length < minimumItems ||
      values.length > maximumItems
    ) {
      return [];
    }
    const subsets: string[] = [];
    const visit = (start: number, selected: string[]): void => {
      if (selected.length >= minimumItems) {
        subsets.push(selected.join("\u0004"));
      }
      for (let index = start; index < values.length; index += 1) {
        selected.push(values[index]);
        visit(index + 1, selected);
        selected.pop();
      }
    };
    visit(0, []);
    return subsets;
  };

  const indexSubsets = (
    target: Map<string, Map<number, number[]>>,
    values: string[],
    maximumItems: number,
    index: number,
    minimumItems = 2
  ): void => {
    for (
      const subset of indexedSubsets(
        values,
        maximumItems,
        minimumItems
      )
    ) {
      const bySize = target.get(subset) || new Map<number, number[]>();
      const indexed = bySize.get(values.length) || [];
      indexByCompletion(indexed, index);
      bySize.set(values.length, indexed);
      target.set(subset, bySize);
    }
  };

  const indexByCompletion = (indexed: number[], index: number): void => {
    if (
      indexed.length === 0 ||
      compareCompleted(indexed[indexed.length - 1], index) <= 0
    ) {
      indexed.push(index);
    } else {
      let low = 0;
      let high = indexed.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareCompleted(indexed[middle], index) <= 0) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      indexed.splice(low, 0, index);
    }
  };

  const indexCompletionCandidate = <Key>(
    target: Map<Key, number[]>,
    key: Key,
    index: number
  ): void => {
    const indexed = target.get(key) || [];
    indexByCompletion(indexed, index);
    target.set(key, indexed);
  };

  const includeCompletionCandidates = (
    indexed: number[] | undefined,
    startedAt: number,
    candidates: Set<number>
  ): void => {
    if (!indexed?.length) {
      return;
    }

    let low = 0;
    let high = indexed.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ordered[indexed[middle]].completedAt < startedAt) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    if (low > 0) {
      candidates.add(indexed[low - 1]);
    }
    if (low < indexed.length) {
      const completedAt = ordered[indexed[low]].completedAt;
      let endLow = low + 1;
      let endHigh = indexed.length;
      while (endLow < endHigh) {
        const middle = (endLow + endHigh) >>> 1;
        if (ordered[indexed[middle]].completedAt <= completedAt) {
          endLow = middle + 1;
        } else {
          endHigh = middle;
        }
      }
      candidates.add(indexed[endLow - 1]);
    }
    candidates.add(indexed[indexed.length - 1]);
  };

  const includeSubsets = (
    target: Map<string, Map<number, number[]>>,
    values: string[],
    maximumItems: number,
    startedAt: number,
    candidates: Set<number>,
    minimumItems = 2
  ): void => {
    for (
      const subset of indexedSubsets(
        values,
        maximumItems,
        minimumItems
      )
    ) {
      for (const indexed of target.get(subset)?.values() || []) {
        includeCompletionCandidates(indexed, startedAt, candidates);
      }
    }
  };

  const includePostings = (
    source: Map<string, number[]>,
    values: Iterable<string>,
    startedAt: number,
    candidates: Set<number>
  ): void => {
    for (const value of new Set(values)) {
      includeCompletionCandidates(
        source.get(value),
        startedAt,
        candidates
      );
    }
  };

  const includeCounterpartCandidates = (
    waypoint: Waypoint,
    candidates: Set<number>
  ): void => {
    for (const file of waypoint.files) {
      const testFile = isTestFilePath(file);
      const counterpart = counterpartIndex.get(
        comparableFileStem(file, testFile)
      );
      if (!counterpart) {
        continue;
      }
      const englishTerms = distinctiveEnglishTerms(waypoint.tokens);
      const latest = testFile
        ? counterpart.sourceLatest
        : counterpart.testLatest;
      const ambiguous = testFile
        ? counterpart.sourceAmbiguous
        : counterpart.testAmbiguous;
      const byTerm = testFile
        ? counterpart.sourceByTerm
        : counterpart.testByTerm;
      if (englishTerms.size < 2 && latest !== undefined) {
        candidates.add(latest);
      }
      if (ambiguous !== undefined) {
        candidates.add(ambiguous);
      }
      for (const term of englishTerms) {
        const candidate = byTerm.get(term);
        if (candidate !== undefined) {
          candidates.add(candidate);
        }
      }
    }
  };

  const indexWaypoint = (
    waypoint: Waypoint,
    index: number,
    exactSignature: string
  ): void => {
    const semanticTokens = semanticIndexTokens(waypoint);
    const semanticSet = distinctiveSetSignature(waypoint);
    addIndex(pathTextBridgeIndex, referencedPathTerms(waypoint), index);
    for (const sessionId of waypoint.sessionIds) {
      rememberRecent(sessionRecent, sessionId, index);
      indexCompletionCandidate(sessionCompletionIndex, sessionId, index);
      addIndex(
        sessionFileIndex,
        contextualSignals(sessionId, waypoint.files),
        index
      );
      addIndex(
        sessionPathIndex,
        contextualSignals(sessionId, waypoint.pathTerms),
        index
      );
      if (waypoint.hasFileSignal) {
        indexCompletionCandidate(
          sessionStructuralIndex,
          `${sessionId}\u0006${structuralSignature(waypoint)}`,
          index
        );
      }
      if (waypoint.sourceHosts.size === 0) {
        const context = `${sessionId}\u0003`;
        rememberRecent(contextRecent, context, index);
        indexCompletionCandidate(contextCompletionIndex, context, index);
        addIndex(
          contextFileIndex,
          contextualSignals(context, waypoint.files),
          index
        );
        addIndex(
          contextPathIndex,
          contextualSignals(context, waypoint.pathTerms),
          index
        );
        if (waypoint.hasFileSignal) {
          indexCompletionCandidate(
            contextStructuralIndex,
            `${context}\u0006${structuralSignature(waypoint)}`,
            index
          );
        }
        for (const file of waypoint.files) {
          rememberPreferred(
            fileContextLatest,
            `${file}\u0003${context}`,
            index
          );
        }
      } else {
        for (const host of waypoint.sourceHosts) {
          const context = `${sessionId}\u0003${host}`;
          rememberRecent(
            contextRecent,
            context,
            index
          );
          indexCompletionCandidate(contextCompletionIndex, context, index);
          addIndex(
            contextFileIndex,
            contextualSignals(context, waypoint.files),
            index
          );
          addIndex(
            contextPathIndex,
            contextualSignals(context, waypoint.pathTerms),
            index
          );
          if (waypoint.hasFileSignal) {
            indexCompletionCandidate(
              contextStructuralIndex,
              `${context}\u0006${structuralSignature(waypoint)}`,
              index
            );
          }
          for (const file of waypoint.files) {
            rememberPreferred(
              fileContextLatest,
              `${file}\u0003${context}`,
              index
            );
          }
        }
      }
    }
    for (const file of waypoint.files) {
      const testFile = isTestFilePath(file);
      const stem = comparableFileStem(file, testFile);
      const counterpart = counterpartIndex.get(stem) || {
        sourceByTerm: new Map<string, number>(),
        testByTerm: new Map<string, number>()
      };
      const englishTerms = distinctiveEnglishTerms(waypoint.tokens);
      if (testFile) {
        counterpart.testLatest =
          counterpart.testLatest === undefined ||
          compareCompleted(counterpart.testLatest, index) <= 0
            ? index
            : counterpart.testLatest;
        if (englishTerms.size < 2) {
          counterpart.testAmbiguous =
            counterpart.testAmbiguous === undefined ||
            compareCompleted(counterpart.testAmbiguous, index) <= 0
              ? index
              : counterpart.testAmbiguous;
        }
        for (const term of englishTerms) {
          rememberPreferred(counterpart.testByTerm, term, index);
        }
      } else {
        counterpart.sourceLatest =
          counterpart.sourceLatest === undefined ||
          compareCompleted(counterpart.sourceLatest, index) <= 0
            ? index
            : counterpart.sourceLatest;
        if (englishTerms.size < 2) {
          counterpart.sourceAmbiguous =
            counterpart.sourceAmbiguous === undefined ||
            compareCompleted(counterpart.sourceAmbiguous, index) <= 0
              ? index
              : counterpart.sourceAmbiguous;
        }
        for (const term of englishTerms) {
          rememberPreferred(counterpart.sourceByTerm, term, index);
        }
      }
      counterpartIndex.set(stem, counterpart);
    }
    indexSubsets(
      fileSubsetIndex,
      [...waypoint.files].sort(),
      MAX_STRUCTURAL_SUBSET_ITEMS,
      index,
      1
    );
    indexCompletionCandidate(
      fileSetIndex,
      [...waypoint.files].sort().join("\u0004"),
      index
    );
    indexCompletionCandidate(
      pathSetIndex,
      [...waypoint.pathTerms].sort().join("\u0004"),
      index
    );
    if (waypoint.hasFileSignal) {
      indexCompletionCandidate(
        structuralSetIndex,
        structuralSignature(waypoint),
        index
      );
      if (semanticSet) {
        indexCompletionCandidate(
          structuralSemanticIndex,
          `${structuralSignature(waypoint)}\u0006${semanticSet}`,
          index
        );
      }
      if (
        waypoint.files.size <= MAX_STRUCTURAL_SUBSET_ITEMS &&
        waypoint.pathTerms.size <= MAX_STRUCTURAL_SUBSET_ITEMS
      ) {
        for (const file of waypoint.files) {
          for (const term of waypoint.pathTerms) {
            indexCompletionCandidate(
              filePathPairIndex,
              `${file}\u0006${term}`,
              index
            );
          }
        }
      }
    }
    indexSubsets(
      pathSubsetIndex,
      [...waypoint.pathTerms].sort(),
      MAX_STRUCTURAL_SUBSET_ITEMS,
      index,
      1
    );
    if (semanticSet) {
      indexCompletionCandidate(semanticSetIndex, semanticSet, index);
    }
    indexSubsets(
      semanticSubsetIndex,
      semanticTokens,
      MAX_FUZZY_SEMANTIC_TERMS,
      index
    );
    indexCompletionCandidate(relationSignatureIndex, exactSignature, index);
  };

  ordered.forEach((waypoint, index) => {
    const profile = relationProfile(waypoint);
    const exactSignature = exactRelationSignature(waypoint, profile);
    if (index === 0) {
      relations.set(waypoint.id, { type: "root" });
      indexWaypoint(waypoint, index, exactSignature);
      return;
    }
    let bestParent: Waypoint | undefined;
    let bestScore = 0;
    const exactRelations = relationSignatureIndex.get(exactSignature);
    const candidates = new Set<number>();
    const exactCandidates = new Set<number>();
    includeCompletionCandidates(
      exactRelations,
      waypoint.startedAt,
      exactCandidates
    );
    const hasDominatingExact = [...exactCandidates].some((candidate) =>
      relatedness(waypoint, ordered[candidate]) >=
        MAX_RELATION_SCORE - Number.EPSILON
    );
    for (const candidate of exactCandidates) {
      candidates.add(candidate);
    }
    includeCompletionCandidates(
      semanticSetIndex.get(
      distinctiveSetSignature(waypoint)
      ),
      waypoint.startedAt,
      candidates
    );
    includeSubsets(
      semanticSubsetIndex,
      semanticIndexTokens(waypoint),
      MAX_FUZZY_SEMANTIC_TERMS,
      waypoint.startedAt,
      candidates
    );
    includeCounterpartCandidates(waypoint, candidates);
    includePostings(
      pathTextBridgeIndex,
      referencedPathTerms(waypoint),
      waypoint.startedAt,
      candidates
    );
    const exactFiles = fileSetIndex.get(
      [...waypoint.files].sort().join("\u0004")
    );
    includeCompletionCandidates(
      exactFiles,
      waypoint.startedAt,
      candidates
    );
    includeCompletionCandidates(
      structuralSetIndex.get(structuralSignature(waypoint)),
      waypoint.startedAt,
      candidates
    );
    const semanticSet = distinctiveSetSignature(waypoint);
    if (waypoint.hasFileSignal && semanticSet) {
      includeCompletionCandidates(
        structuralSemanticIndex.get(
          `${structuralSignature(waypoint)}\u0006${semanticSet}`
        ),
        waypoint.startedAt,
        candidates
      );
    }
    if (
      waypoint.files.size <= MAX_STRUCTURAL_SUBSET_ITEMS &&
      waypoint.pathTerms.size <= MAX_STRUCTURAL_SUBSET_ITEMS
    ) {
      for (const file of waypoint.files) {
        for (const term of waypoint.pathTerms) {
          includeCompletionCandidates(
            filePathPairIndex.get(`${file}\u0006${term}`),
            waypoint.startedAt,
            candidates
          );
        }
      }
    }
    for (const sessionId of waypoint.sessionIds) {
      if (waypoint.sourceHosts.size === 0) {
        includeCompletionCandidates(
          sessionStructuralIndex.get(
            `${sessionId}\u0006${structuralSignature(waypoint)}`
          ),
          waypoint.startedAt,
          candidates
        );
      } else {
        const unknownHostContext = `${sessionId}\u0003`;
        includeCompletionCandidates(
          contextStructuralIndex.get(
            `${unknownHostContext}\u0006${structuralSignature(waypoint)}`
          ),
          waypoint.startedAt,
          candidates
        );
        for (const host of waypoint.sourceHosts) {
          const context = `${sessionId}\u0003${host}`;
          includeCompletionCandidates(
            contextStructuralIndex.get(
              `${context}\u0006${structuralSignature(waypoint)}`
            ),
            waypoint.startedAt,
            candidates
          );
        }
      }
    }
    const strongestIndexedScore = Math.max(
      0,
      ...[...candidates].map((candidate) =>
        relatedness(waypoint, ordered[candidate])
      )
    );
    const hasDominatingCandidate =
      hasDominatingExact ||
      strongestIndexedScore >= MAX_RELATION_SCORE - Number.EPSILON ||
      strongestIndexedScore >= 0.6 - Number.EPSILON ||
      (
        waypoint.hasFileSignal &&
        strongestIndexedScore >= 0.55 - Number.EPSILON
      );
    if (!hasDominatingCandidate && index <= EXHAUSTIVE_PARENT_THRESHOLD) {
      for (let j = 0; j < index; j += 1) {
        candidates.add(j);
      }
    } else if (!hasDominatingCandidate) {
      for (
        let j = Math.max(0, index - RECENT_PARENT_CANDIDATES);
        j < index;
        j += 1
      ) {
        candidates.add(j);
      }
      for (const sessionId of waypoint.sessionIds) {
        includeCompletionCandidates(
          sessionCompletionIndex.get(sessionId),
          waypoint.startedAt,
          candidates
        );
        for (const candidate of sessionRecent.get(sessionId) || []) {
          candidates.add(candidate);
        }
        if (waypoint.sourceHosts.size === 0) {
          const context = `${sessionId}\u0003`;
          includePostings(
            sessionFileIndex,
            contextualSignals(sessionId, waypoint.files),
            waypoint.startedAt,
            candidates
          );
          includePostings(
            sessionPathIndex,
            contextualSignals(sessionId, waypoint.pathTerms),
            waypoint.startedAt,
            candidates
          );
          includeCompletionCandidates(
            contextCompletionIndex.get(context),
            waypoint.startedAt,
            candidates
          );
          for (const candidate of contextRecent.get(context) || []) {
            candidates.add(candidate);
          }
          for (const file of waypoint.files) {
            const sameFile = fileContextLatest.get(`${file}\u0003${context}`);
            if (sameFile !== undefined) {
              candidates.add(sameFile);
            }
          }
        } else {
          const unknownHostContext = `${sessionId}\u0003`;
          includePostings(
            contextFileIndex,
            contextualSignals(unknownHostContext, waypoint.files),
            waypoint.startedAt,
            candidates
          );
          includePostings(
            contextPathIndex,
            contextualSignals(unknownHostContext, waypoint.pathTerms),
            waypoint.startedAt,
            candidates
          );
          includeCompletionCandidates(
            contextCompletionIndex.get(unknownHostContext),
            waypoint.startedAt,
            candidates
          );
          for (const host of waypoint.sourceHosts) {
            const context = `${sessionId}\u0003${host}`;
            includePostings(
              contextFileIndex,
              contextualSignals(context, waypoint.files),
              waypoint.startedAt,
              candidates
            );
            includePostings(
              contextPathIndex,
              contextualSignals(context, waypoint.pathTerms),
              waypoint.startedAt,
              candidates
            );
            includeCompletionCandidates(
              contextCompletionIndex.get(context),
              waypoint.startedAt,
              candidates
            );
            for (
              const candidate of
                contextRecent.get(context) || []
            ) {
              candidates.add(candidate);
            }
            for (const file of waypoint.files) {
              const sameFile = fileContextLatest.get(
                `${file}\u0003${context}`
              );
              if (sameFile !== undefined) {
                candidates.add(sameFile);
              }
            }
          }
        }
      }
      includeSubsets(
        fileSubsetIndex,
        [...waypoint.files].sort(),
        MAX_STRUCTURAL_SUBSET_ITEMS,
        waypoint.startedAt,
        candidates,
        1
      );
      includeCompletionCandidates(
        fileSetIndex.get(
          [...waypoint.files].sort().join("\u0004")
        ),
        waypoint.startedAt,
        candidates
      );
      includeCompletionCandidates(
        pathSetIndex.get(
          [...waypoint.pathTerms].sort().join("\u0004")
        ),
        waypoint.startedAt,
        candidates
      );
      includeSubsets(
        pathSubsetIndex,
        [...waypoint.pathTerms].sort(),
        MAX_STRUCTURAL_SUBSET_ITEMS,
        waypoint.startedAt,
        candidates,
        1
      );
    }
    for (const j of [...candidates].sort((a, b) => a - b)) {
      const candidate = ordered[j];
      if (diagnostics) {
        diagnostics.scoredCandidates += 1;
      }
      const score = relatedness(waypoint, candidate);
      if (
        score > bestScore ||
        (
          score === bestScore &&
          bestParent &&
          (
            candidate.completedAt > bestParent.completedAt ||
            (
              candidate.completedAt === bestParent.completedAt &&
              compareStableIds(candidate.id, bestParent.id) > 0
            )
          )
        )
      ) {
        bestScore = score;
        bestParent = candidate;
      }
    }
    if (!bestParent || bestScore < RELATE_MIN) {
      relations.set(waypoint.id, { type: "root" });
      indexWaypoint(waypoint, index, exactSignature);
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
    indexWaypoint(waypoint, index, exactSignature);
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
