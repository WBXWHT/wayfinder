export type NodeKind =
  | "turn"
  | "manual"
  | "safety"
  | "imported"
  | "collected";
export type AgentHost = "trae" | "claude" | "codex";
export type UserVerdict = "success" | "failure";
export type ValidationStatus =
  | "running"
  | "passed"
  | "failed"
  | "timeout"
  | "not-configured"
  | "skipped";

export interface ToolAction {
  id?: string;
  kind: "edit" | "write" | "run" | "other";
  tool: string;
  path?: string;
  detail?: string;
  ok?: boolean;
}

export interface FileChange {
  path: string;
  status: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
  binary?: boolean;
  lineCountsKnown?: boolean;
  previousPath?: string;
}

export interface ValidationResult {
  command?: string;
  status: ValidationStatus;
  exitCode?: number;
  durationMs?: number;
  summary?: string;
}

export interface TimelineNode {
  id: string;
  kind: NodeKind;
  sessionId: string;
  turnId?: string;
  sourceHost?: AgentHost;
  branchId: string;
  parentId?: string;
  prompt: string;
  response?: string;
  startedAt: string;
  completedAt: string;
  snapshotBefore: string;
  snapshotAfter: string;
  files: FileChange[];
  actions: ToolAction[];
  validation: ValidationResult;
  verdict?: UserVerdict;
  note?: string;
  source?:
    | {
        type: "trae-memory";
        messageId?: string;
        importedAt: string;
        chapter?: string;
        forest?: {
          tree: string;
          stage: string;
          stageOrder: number;
          parentStage?: string;
          branch?: string;
        };
      }
    | {
        type: "rollout";
        host: AgentHost;
        rolloutPath: string;
        sessionId: string;
        turnIndex: number;
        turnId?: string;
        collectedAt: string;
      }
    | {
        type: "folder-import";
        relativePath: string;
        importedAt: string;
        forest: {
          tree: string;
          stage: string;
          stageOrder: number;
          parentStage?: string;
          branch?: string;
        };
      };
}

export interface TimelineBranch {
  id: string;
  name: string;
  parentNodeId?: string;
  createdAt: string;
}

export interface PendingTurn {
  sessionId: string;
  turnId?: string;
  sourceHost?: AgentHost;
  branchId: string;
  parentId?: string;
  prompt: string;
  startedAt: string;
  snapshotBefore: string;
  actions: ToolAction[];
}

export interface ProjectState {
  version: 1;
  projectId: string;
  root: string;
  activeBranchId: string;
  branches: TimelineBranch[];
  nodes: TimelineNode[];
  pending: Record<string, PendingTurn>;
  updatedAt: string;
}

export interface ProjectConfig {
  validationCommand?: string;
  validationTimeoutSeconds: number;
  maxFileSizeMB: number;
}

export interface SnapshotResult {
  commit: string;
  parent?: string;
  tree: string;
  changed: boolean;
}

export interface HookPayload {
  wayfinder_host?: AgentHost;
  session_id?: string;
  turn_id?: string;
  transcript_path?: string | null;
  cwd?: string;
  workspace_roots?: string[];
  hook_event_name?: string;
  prompt?: string;
  tool_use_id?: string;
  tool_name?: string;
  llm_tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  last_assistant_message?: string;
}
