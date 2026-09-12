import { createHash } from "crypto";
import { z } from "zod/v4";
import {
  AgentHost,
  ProjectState,
  TimelineNode
} from "./models";
import {
  abandonedNodeIds,
  buildConversationForest,
  ConversationForest
} from "./conversationForest";
import {
  buildLocalTopicAssessments,
  LocalTopicAssessment
} from "./localExperience";
import { clipText } from "./storage";

export type FailureEvidenceKind =
  | "validation-failed"
  | "validation-timeout"
  | "tool-failed"
  | "user-rejected"
  | "route-abandoned";

export type DiagnosticCategory =
  | "abandoned"
  | "compile"
  | "dependency"
  | "network"
  | "permission"
  | "test"
  | "timeout"
  | "tool"
  | "user-rejected"
  | "unknown";

export interface FailureEvidence {
  id: string;
  nodeId: string;
  topicId: string;
  topicTitle: string;
  kind: FailureEvidenceKind;
  sourceHost?: AgentHost;
  occurredAt: string;
  promptExcerpt: string;
  failureExcerpt?: string;
  diagnosticCategory: DiagnosticCategory;
  exitCode?: number;
  fileTypes: string[];
}

export interface CloudFailureEvidence {
  id: string;
  nodeId: string;
  topicId: string;
  kind: FailureEvidenceKind;
  sourceHost?: AgentHost;
  occurredAt: string;
  diagnosticCategory: DiagnosticCategory;
  exitCode?: number;
  fileTypes: string[];
}

export interface CloudAnalysisRequest {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  policy: {
    rawConversationIncluded: false;
    sourceCodeIncluded: false;
    localEvidenceRequired: true;
  };
  topics: Array<{
    id: string;
    localStatus: LocalTopicAssessment["status"];
    evidence: CloudFailureEvidence[];
  }>;
}

export const CloudAnalysisResponseSchema = z.object({
  schemaVersion: z.literal(1),
  analyses: z.array(z.object({
    topicId: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    status: z.enum([
      "failed",
      "context-limited",
      "superseded",
      "conflicting",
      "unresolved"
    ]),
    summary: z.string().min(1).max(800),
    conditions: z.array(z.string().max(240)).max(8),
    confidence: z.enum(["high", "medium", "low"])
  }))
});

export type CloudAnalysisResponse = z.infer<
  typeof CloudAnalysisResponseSchema
>;

export function buildCloudAnalysisRequest(
  state: ProjectState,
  generatedAt = new Date().toISOString()
): CloudAnalysisRequest {
  const forest = buildConversationForest(state);
  const evidence = extractFailureEvidence(state, forest);
  const assessments = new Map(
    buildLocalTopicAssessments(state, forest).map((assessment) => [
      assessment.topicId,
      assessment.status
    ])
  );
  const topics = new Map<
    string,
    {
      id: string;
      localStatus: LocalTopicAssessment["status"];
      evidence: CloudFailureEvidence[];
    }
  >();
  for (const localItem of evidence) {
    const topicId = cloudTopicId(localItem.topicId);
    const item = {
      id: localItem.id,
      nodeId: localItem.nodeId,
      topicId,
      kind: localItem.kind,
      sourceHost: localItem.sourceHost,
      occurredAt: localItem.occurredAt,
      diagnosticCategory: localItem.diagnosticCategory,
      exitCode: localItem.exitCode,
      fileTypes: localItem.fileTypes
    };
    const topic = topics.get(topicId) || {
      id: topicId,
      localStatus: assessments.get(localItem.topicId) || "failed-candidate",
      evidence: []
    };
    topic.evidence.push(item);
    topics.set(topicId, topic);
  }
  return {
    schemaVersion: 1,
    projectId: state.projectId,
    generatedAt,
    policy: {
      rawConversationIncluded: false,
      sourceCodeIncluded: false,
      localEvidenceRequired: true
    },
    topics: [...topics.values()]
  };
}

export function extractFailureEvidence(
  state: ProjectState,
  forest: ConversationForest = buildConversationForest(state)
): FailureEvidence[] {
  const topicByNode = new Map<string, { id: string; title: string }>();
  for (const tree of forest.trees) {
    for (const session of tree.sessions) {
      for (const nodeId of session.nodeIds) {
        topicByNode.set(nodeId, { id: tree.id, title: tree.title });
      }
    }
  }
  const abandoned = abandonedNodeIds(state);
  const evidence: FailureEvidence[] = [];
  for (const node of state.nodes) {
    if (node.kind === "safety" || node.kind === "manual") {
      continue;
    }
    const topic = topicByNode.get(node.id) || {
      id: `unresolved:${node.id}`,
      title: "未归类任务"
    };
    if (
      node.validation?.status === "failed" ||
      node.validation?.status === "timeout"
    ) {
      evidence.push(evidenceFor(
        node,
        topic,
        node.validation.status === "timeout"
          ? "validation-timeout"
          : "validation-failed",
        node.validation.summary
      ));
    }
    const finalSuccess =
      node.validation?.status === "passed" ||
      (
        node.verdict === "success" &&
        node.validation?.status !== "failed" &&
        node.validation?.status !== "timeout"
      );
    const failedTools = finalSuccess
      ? []
      : (node.actions || []).filter((action) => action.ok === false);
    if (failedTools.length > 0) {
      evidence.push(evidenceFor(
        node,
        topic,
        "tool-failed",
        failedTools
          .map((action) => [action.tool, action.detail].filter(Boolean).join(": "))
          .join("\n")
      ));
    }
    if (node.verdict === "failure") {
      evidence.push(evidenceFor(
        node,
        topic,
        "user-rejected",
        node.note
      ));
    }
    if (abandoned.has(node.id)) {
      evidence.push(evidenceFor(
        node,
        topic,
        "route-abandoned",
        "The user restored an earlier snapshot and left this route."
      ));
    }
  }
  return evidence;
}

export function parseCloudAnalysisResponse(
  value: unknown,
  request: CloudAnalysisRequest
): CloudAnalysisResponse {
  const response = CloudAnalysisResponseSchema.parse(value);
  const topicsById = new Map(
    request.topics.map((topic) => [
      topic.id,
      {
        localStatus: topic.localStatus,
        evidenceIds: new Set(
          topic.evidence.map((evidence) => evidence.id)
        )
      }
    ])
  );
  const allEvidence = new Set(
    request.topics.flatMap((topic) =>
      topic.evidence.map((evidence) => evidence.id)
    )
  );
  for (const analysis of response.analyses) {
    const topic = topicsById.get(analysis.topicId);
    if (!topic) {
      throw new Error(`Analysis references unknown topic: ${analysis.topicId}`);
    }
    for (const evidenceId of analysis.evidenceIds) {
      if (!topic.evidenceIds.has(evidenceId)) {
        if (!allEvidence.has(evidenceId)) {
          throw new Error(
            `Analysis references unknown local evidence: ${evidenceId}`
          );
        }
        throw new Error(
          `Evidence ${evidenceId} does not belong to topic ${analysis.topicId}`
        );
      }
    }
    const localStateIsProven =
      topic.localStatus === "conflicting" ||
      topic.localStatus === "superseded";
    const cloudClaimsProvenState =
      analysis.status === "conflicting" ||
      analysis.status === "superseded";
    if (
      (localStateIsProven || cloudClaimsProvenState) &&
      analysis.status !== topic.localStatus
    ) {
      throw new Error(
        `Analysis status ${analysis.status} lacks matching local state evidence`
      );
    }
  }
  return response;
}

export function redactSensitiveText(value: string | undefined): string {
  let text = String(value || "");
  if (!text) {
    return "";
  }
  text = text
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gi,
      "[REDACTED_PRIVATE_KEY]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:sk|rk|ghp|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9._-]{12,}\b/g,
      "[REDACTED_TOKEN]"
    )
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]"
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[REDACTED_EMAIL]"
    )
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "~")
    .replace(/(?:~\/|\/(?:home|private|var|tmp)\/)[^\s,;]+/g, "[LOCAL_PATH]")
    .replace(/~\\[^\s,;]+/g, "[LOCAL_PATH]");
  return clipText(text, 1_200);
}

function cloudTopicId(localTopicId: string): string {
  return `topic:${createHash("sha256")
    .update(localTopicId)
    .digest("hex")
    .slice(0, 16)}`;
}

function evidenceFor(
  node: TimelineNode,
  topic: { id: string; title: string },
  kind: FailureEvidenceKind,
  failure?: string
): FailureEvidence {
  return {
    id: `evidence:${node.id}:${kind}`,
    nodeId: node.id,
    topicId: topic.id,
    topicTitle: topic.title,
    kind,
    sourceHost: node.sourceHost,
    occurredAt: node.completedAt,
    promptExcerpt: redactSensitiveText(node.prompt),
    failureExcerpt: redactSensitiveText(failure) || undefined,
    diagnosticCategory: diagnosticCategory(kind, failure),
    exitCode: kind.startsWith("validation-")
      ? node.validation?.exitCode
      : undefined,
    fileTypes: [...new Set(
      (node.files || [])
        .map((file) => file.path.split(".").slice(-1)[0]?.toLowerCase())
        .filter((extension): extension is string =>
          Boolean(extension && extension.length <= 12)
        )
    )].sort()
  };
}

function diagnosticCategory(
  kind: FailureEvidenceKind,
  failure: string | undefined
): DiagnosticCategory {
  if (kind === "validation-timeout") return "timeout";
  if (kind === "user-rejected") return "user-rejected";
  if (kind === "route-abandoned") return "abandoned";
  const text = String(failure || "");
  if (/typecheck|type checker|\btsc\b|compile|compiler/i.test(text)) {
    return "compile";
  }
  if (/test|assert|expect(?:ed)?|spec\b/i.test(text)) return "test";
  if (/network|connection|refused|dns|socket|http/i.test(text)) {
    return "network";
  }
  if (/permission|denied|eacces|eperm/i.test(text)) return "permission";
  if (/dependency|package|module not found|cannot find module/i.test(text)) {
    return "dependency";
  }
  if (kind === "tool-failed") return "tool";
  return "unknown";
}
