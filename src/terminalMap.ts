import * as path from "path";
import {
  ConversationForest,
  ForestSession,
  ForestTree
} from "./conversationForest";
import { AgentHost, ProjectState } from "./models";

export function renderTerminalMap(
  root: string,
  state: ProjectState,
  forest: ConversationForest
): string {
  const lines = [
    `Wayfinder - ${path.basename(root)}`,
    `${forest.nodeCount} nodes | ${forest.trees.length} voyages | ` +
      `${forest.sessionCount} waypoints`
  ];
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  forest.trees.forEach((tree, index) => {
    lines.push("", `[${index + 1}/${forest.trees.length}] ${tree.title}`);
    lines.push(...renderTree(tree, (session) => {
      const hosts = new Set(
        session.nodeIds
          .map((id) => nodeById.get(id)?.sourceHost)
          .filter((host): host is AgentHost => Boolean(host))
      );
      return [...hosts].map(hostLabel).join("+");
    }));
  });
  return `${lines.join("\n")}\n`;
}

function renderTree(
  tree: ForestTree,
  sourcesFor: (session: ForestSession) => string
): string[] {
  const rootKey = "\u0000wayfinder-root";
  const byId = new Map(tree.sessions.map((session) => [session.id, session]));
  const children = new Map<string, ForestSession[]>();
  for (const session of tree.sessions) {
    const parent = session.parentId && byId.has(session.parentId)
      ? session.parentId
      : rootKey;
    const items = children.get(parent) || [];
    items.push(session);
    children.set(parent, items);
  }
  children.forEach((items) =>
    items.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  );
  const lines: string[] = [];
  const visited = new Set<string>();
  const visit = (
    session: ForestSession,
    prefix: string,
    isLast: boolean
  ): void => {
    if (visited.has(session.id)) {
      return;
    }
    visited.add(session.id);
    const source = sourcesFor(session);
    lines.push(
      `${prefix}${isLast ? "\\-" : "+-"} ${verdictMark(session)} ` +
      `${session.shortTitle}${source ? ` [${source}]` : ""}`
    );
    const descendants = children.get(session.id) || [];
    descendants.forEach((child, index) => {
      visit(
        child,
        `${prefix}${isLast ? "  " : "| "}`,
        index === descendants.length - 1
      );
    });
  };
  const roots = children.get(rootKey) || [];
  roots.forEach((session, index) =>
    visit(session, "", index === roots.length - 1)
  );
  tree.sessions
    .filter((session) => !visited.has(session.id))
    .forEach((session) => visit(session, "", true));
  return lines;
}

function verdictMark(session: ForestSession): string {
  if (session.verdict === "failure") return "[blocked]";
  if (session.verdict === "success") return "[ok]";
  return "[open]";
}

function hostLabel(host: AgentHost): string {
  return host === "trae"
    ? "TraeCode"
    : host === "claude"
      ? "Claude"
      : "Codex";
}
