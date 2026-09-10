import { AgentHost, ProjectState, TimelineNode } from "./models";
import {
  abandonedNodeIds,
  buildConversationForest,
  ConversationForest
} from "./conversationForest";

export interface LocalTopicAssessment {
  topicId: string;
  status: "failed-candidate" | "conflicting" | "superseded";
  evidenceNodeIds: string[];
  sourceHosts: AgentHost[];
}

export function buildLocalTopicAssessments(
  state: ProjectState,
  forest: ConversationForest = buildConversationForest(state)
): LocalTopicAssessment[] {
  const abandoned = abandonedNodeIds(state);
  const nodes = new Map(state.nodes.map((node) => [node.id, node]));
  const assessments: LocalTopicAssessment[] = [];
  for (const tree of forest.trees) {
    const topicNodes = tree.sessions
      .flatMap((session) => session.nodeIds)
      .map((nodeId) => nodes.get(nodeId))
      .filter((node): node is TimelineNode => Boolean(node))
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const evidenceNodeIds = topicNodes
      .filter((node) => isFailureNode(node, abandoned))
      .map((node) => node.id);
    if (evidenceNodeIds.length === 0) {
      continue;
    }

    const unresolvedFailures = new Map<AgentHost, string>();
    const recoveredHosts = new Set<AgentHost>();
    const healthyAttempts = new Map<AgentHost, string>();
    const sourceHosts = new Set<AgentHost>();
    for (const node of topicNodes) {
      if (
        !node.sourceHost ||
        node.kind === "manual" ||
        node.kind === "safety"
      ) {
        continue;
      }
      sourceHosts.add(node.sourceHost);
      if (isFailureNode(node, abandoned)) {
        unresolvedFailures.set(node.sourceHost, node.completedAt);
        healthyAttempts.delete(node.sourceHost);
        continue;
      }
      if (isResolvedAttempt(node)) {
        healthyAttempts.set(node.sourceHost, node.completedAt);
        if (unresolvedFailures.delete(node.sourceHost)) {
          recoveredHosts.add(node.sourceHost);
        }
      }
    }
    const conflicting = [...unresolvedFailures].some(
      ([failedHost, failedAt]) =>
        [...healthyAttempts].some(([healthyHost, healthyAt]) =>
          healthyHost !== failedHost && healthyAt > failedAt
        )
    );
    const superseded =
      !conflicting &&
      unresolvedFailures.size === 0 &&
      recoveredHosts.size > 0;
    assessments.push({
      topicId: tree.id,
      status: conflicting
        ? "conflicting"
        : superseded
          ? "superseded"
          : "failed-candidate",
      evidenceNodeIds,
      sourceHosts: [...sourceHosts]
    });
  }
  return assessments;
}

function isFailureNode(
  node: TimelineNode,
  abandoned: Set<string>
): boolean {
  return (
    node.verdict === "failure" ||
    node.validation?.status === "failed" ||
    node.validation?.status === "timeout" ||
    (node.actions || []).some((action) => action.ok === false) ||
    abandoned.has(node.id)
  );
}

function isResolvedAttempt(node: TimelineNode): boolean {
  return node.validation?.status !== "running";
}
