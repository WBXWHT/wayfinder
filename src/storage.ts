import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import {
  ProjectConfig,
  ProjectState,
  TimelineBranch,
  TimelineNode
} from "./models";

const STATE_VERSION = 1;
const DEFAULT_CONFIG: ProjectConfig = {
  validationTimeoutSeconds: 60,
  maxFileSizeMB: 20
};

export function normalizeRoot(root: string): string {
  try {
    return fs.realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
}

export function wayfinderHome(): string {
  return process.env.WAYFINDER_HOME || path.join(os.homedir(), ".wayfinder");
}

export function projectIdFor(root: string): string {
  return createHash("sha256")
    .update(normalizeRoot(root))
    .digest("hex")
    .slice(0, 20);
}

export function projectDataDir(root: string): string {
  return path.join(wayfinderHome(), "projects", projectIdFor(root));
}

export function statePathFor(root: string): string {
  return path.join(projectDataDir(root), "timeline.json");
}

export function configPathFor(root: string): string {
  return path.join(projectDataDir(root), "config.json");
}

export function shadowGitDirFor(root: string): string {
  return path.join(projectDataDir(root), "shadow.git");
}

export async function ensureProjectState(root: string): Promise<ProjectState> {
  const normalized = normalizeRoot(root);
  const existing = await readProjectState(normalized);
  if (existing) {
    return existing;
  }

  const main: TimelineBranch = {
    id: "main",
    name: "main",
    createdAt: new Date().toISOString()
  };
  const state: ProjectState = {
    version: STATE_VERSION,
    projectId: projectIdFor(normalized),
    root: normalized,
    activeBranchId: main.id,
    branches: [main],
    nodes: [],
    pending: {},
    updatedAt: new Date().toISOString()
  };
  await writeProjectState(normalized, state);
  return state;
}

export async function readProjectState(
  root: string
): Promise<ProjectState | undefined> {
  const file = statePathFor(root);
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ProjectState;
    if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.nodes)) {
      throw new Error(`Unsupported or invalid Wayfinder state: ${file}`);
    }
    parsed.pending ||= {};
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw new Error(
      `Unable to read Wayfinder state ${file}: ${errorMessage(error)}`
    );
  }
}

export async function writeProjectState(
  root: string,
  state: ProjectState
): Promise<void> {
  const file = statePathFor(root);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  state.updatedAt = new Date().toISOString();
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.promises.rename(temp, file);
}

export async function mutateProjectState<T>(
  root: string,
  mutate: (state: ProjectState) => Promise<T> | T
): Promise<T> {
  const normalized = normalizeRoot(root);
  return withProjectLock(normalized, async () => {
    const state = await ensureProjectState(normalized);
    const result = await mutate(state);
    await writeProjectState(normalized, state);
    return result;
  });
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  const file = configPathFor(root);
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    const config = {
      ...DEFAULT_CONFIG,
      ...(JSON.parse(raw) as Partial<ProjectConfig>)
    };
    return config;
  } catch (error) {
    if (isMissingFile(error)) {
      return { ...DEFAULT_CONFIG };
    }
    throw new Error(
      `Unable to read Wayfinder config ${file}: ${errorMessage(error)}`
    );
  }
}

export async function writeProjectConfig(
  root: string,
  config: ProjectConfig
): Promise<void> {
  const file = configPathFor(root);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.promises.rename(temp, file);
}

export function latestNodeOnBranch(
  state: ProjectState,
  branchId = state.activeBranchId
): TimelineNode | undefined {
  const branchNodes = state.nodes.filter((node) => node.branchId === branchId);
  if (branchNodes.length > 0) {
    return branchNodes.sort((a, b) =>
      a.completedAt.localeCompare(b.completedAt)
    )[branchNodes.length - 1];
  }
  const branch = state.branches.find((item) => item.id === branchId);
  return branch?.parentNodeId
    ? state.nodes.find((node) => node.id === branch.parentNodeId)
    : undefined;
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export function clip(text: string | undefined, max = 500): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function clipText(text: string | undefined, max = 500): string {
  const clean = (text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withProjectLock<T>(
  root: string,
  operation: () => Promise<T>
): Promise<T> {
  const dir = projectDataDir(root);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = statePathFor(root);
  const release = await lockfile.lock(target, {
    realpath: false,
    stale: 8_000,
    update: 2_000,
    retries: {
      retries: 300,
      factor: 1,
      minTimeout: 40,
      maxTimeout: 40
    }
  });
  try {
    return await operation();
  } finally {
    await release().catch(() => undefined);
  }
}
