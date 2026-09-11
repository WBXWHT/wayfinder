import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { FileChange, SnapshotResult } from "./models";
import { createId, projectDataDir, shadowGitDirFor } from "./storage";

const execFileAsync = promisify(execFile);

const DEFAULT_EXCLUDES = [
  ".git/",
  ".trae/",
  ".claude/",
  ".codex/",
  ".wayfinder/",
  "node_modules/",
  "dist/",
  "out/",
  "build/",
  ".next/",
  "coverage/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.vsix",
  "*.dmg",
  "*.iso",
  ".DS_Store"
];

export class ShadowRepo {
  readonly gitDir: string;
  private initialized = false;

  constructor(
    readonly root: string,
    private readonly maxFileSizeMB = 20
  ) {
    this.gitDir = shadowGitDirFor(root);
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await fs.promises.mkdir(path.dirname(this.gitDir), { recursive: true });
    if (!fs.existsSync(path.join(this.gitDir, "HEAD"))) {
      await execFileAsync(
        "git",
        ["--git-dir", this.gitDir, "--work-tree", this.root, "init"],
        { cwd: this.root }
      );
    }
    await this.run(["config", "user.name", "Wayfinder"]);
    await this.run(["config", "user.email", "wayfinder@localhost"]);
    await this.run(["config", "commit.gpgsign", "false"]);
    await this.run(["config", "core.autocrlf", "false"]);
    await this.run(["config", "core.hooksPath", path.join(this.gitDir, "no-hooks")]);

    const info = path.join(this.gitDir, "info");
    await fs.promises.mkdir(info, { recursive: true });
    await fs.promises.writeFile(
      path.join(info, "exclude"),
      `${DEFAULT_EXCLUDES.join("\n")}\n`,
      "utf8"
    );
    this.initialized = true;
  }

  async capture(
    id: string,
    label: string,
    parent?: string
  ): Promise<SnapshotResult> {
    await this.init();
    const indexDir = path.join(projectDataDir(this.root), "indexes");
    await fs.promises.mkdir(indexDir, { recursive: true });
    const indexPath = path.join(indexDir, createId("index"));
    const env = { GIT_INDEX_FILE: indexPath };

    try {
      if (parent) {
        await this.run(["read-tree", parent], env);
      } else {
        await this.run(["read-tree", "--empty"], env);
      }

      await this.run(["add", "-A"], env);
      await this.unstageLargeFiles(parent, env);
      const tree = (await this.run(["write-tree"], env)).trim();
      const parentTree = parent
        ? (await this.run(["rev-parse", `${parent}^{tree}`])).trim()
        : undefined;

      if (parent && parentTree === tree) {
        await this.updateRef(id, parent);
        return { commit: parent, parent, tree, changed: false };
      }

      const args = ["commit-tree", tree, "-m", label];
      if (parent) {
        args.push("-p", parent);
      }
      const now = new Date().toISOString();
      const commit = (
        await this.run(args, {
          ...env,
          GIT_AUTHOR_NAME: "Wayfinder",
          GIT_AUTHOR_EMAIL: "wayfinder@localhost",
          GIT_AUTHOR_DATE: now,
          GIT_COMMITTER_NAME: "Wayfinder",
          GIT_COMMITTER_EMAIL: "wayfinder@localhost",
          GIT_COMMITTER_DATE: now
        })
      ).trim();
      await this.updateRef(id, commit);
      return { commit, parent, tree, changed: true };
    } finally {
      await fs.promises.rm(indexPath, { force: true }).catch(() => undefined);
    }
  }

  async diffFiles(from: string, to: string): Promise<FileChange[]> {
    await this.init();
    if (from === to) {
      return [];
    }
    const [statusOutput, numstatOutput] = await Promise.all([
      this.run(["diff", "--name-status", "-z", "--find-renames", from, to]),
      this.run(["diff", "--numstat", "-z", "--find-renames", from, to])
    ]);
    const stats = new Map<
      string,
      { additions: number; deletions: number; binary: boolean }
    >();

    const numstatParts = numstatOutput.split("\0");
    for (let index = 0; index < numstatParts.length; index += 1) {
      const record = numstatParts[index];
      if (!record) {
        continue;
      }
      const firstTab = record.indexOf("\t");
      const secondTab = record.indexOf("\t", firstTab + 1);
      if (firstTab < 0 || secondTab < 0) {
        continue;
      }
      const added = record.slice(0, firstTab);
      const deleted = record.slice(firstTab + 1, secondTab);
      const filePathInRecord = record.slice(secondTab + 1);
      const renamed = filePathInRecord === "";
      const filePath = renamed
        ? numstatParts[index + 2]
        : filePathInRecord;
      if (renamed) {
        index += 2;
      }
      if (!filePath) {
        continue;
      }
      stats.set(filePath, {
        additions: added === "-" ? 0 : Number.parseInt(added, 10) || 0,
        deletions: deleted === "-" ? 0 : Number.parseInt(deleted, 10) || 0,
        binary: added === "-" || deleted === "-"
      });
    }

    const changes: FileChange[] = [];
    const statusParts = statusOutput.split("\0");
    for (let index = 0; index < statusParts.length; index += 1) {
      const rawStatus = statusParts[index];
      if (!rawStatus) {
        continue;
      }
      const status = rawStatus.charAt(0) as FileChange["status"];
      const firstPath = statusParts[index + 1];
      const filePath = status === "R"
        ? statusParts[index + 2]
        : firstPath;
      index += status === "R" ? 2 : 1;
      if (!filePath) {
        continue;
      }
      const stat = stats.get(filePath) || {
        additions: 0,
        deletions: 0,
        binary: false
      };
      changes.push({
        path: filePath,
        status,
        ...stat,
        ...(status === "R" && firstPath
          ? { previousPath: firstPath }
          : {})
      });
    }
    return changes;
  }

  async diffText(from: string, to: string, relPath?: string): Promise<string> {
    await this.init();
    const args = ["diff", "--no-color", "--unified=3", from, to];
    if (relPath) {
      args.push("--", relPath);
    }
    return this.run(args);
  }

  async fileAt(commit: string, relPath: string): Promise<Buffer | undefined> {
    await this.init();
    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "--git-dir",
          this.gitDir,
          "--work-tree",
          this.root,
          "show",
          `${commit}:${toPosix(relPath)}`
        ],
        {
          cwd: this.root,
          encoding: "buffer",
          maxBuffer: 64 * 1024 * 1024
        }
      );
      return stdout as unknown as Buffer;
    } catch {
      return undefined;
    }
  }

  async restore(target: string, current: string): Promise<void> {
    await this.init();
    const indexDir = path.join(projectDataDir(this.root), "indexes");
    await fs.promises.mkdir(indexDir, { recursive: true });
    const indexPath = path.join(indexDir, createId("restore"));
    const env = { GIT_INDEX_FILE: indexPath };
    try {
      await this.run(["read-tree", current], env);
      await this.run(["update-index", "--refresh"], env, true);
      const modified = (await this.run(
        ["diff-files", "--name-only", "-z"],
        env
      )).split("\0").filter(Boolean);
      const collisions: string[] = [];
      const targetWrites = (await this.run(
        ["diff", "--name-only", "--diff-filter=ACMR", "-z", current, target],
        env
      )).split("\0").filter(Boolean);
      for (const relPath of targetWrites) {
        if (
          !(await this.existsAt(current, relPath)) &&
          fs.existsSync(path.join(this.root, relPath))
        ) {
          collisions.push(relPath);
        }
      }
      const unsafe = [...new Set([...modified, ...collisions])];
      if (unsafe.length > 0) {
        throw new Error(
          `以下文件未被安全快照完整保存，已取消恢复：${unsafe.slice(0, 5).join(", ")}`
        );
      }
      await this.run(["read-tree", "-m", "-u", target], env);
    } finally {
      await fs.promises.rm(indexPath, { force: true }).catch(() => undefined);
    }
  }

  async deleteRef(id: string): Promise<void> {
    await this.init();
    await this.run(["update-ref", "-d", this.refName(id)], {}, true);
  }

  private async updateRef(id: string, commit: string): Promise<void> {
    await this.run(["update-ref", this.refName(id), commit]);
  }

  private refName(id: string): string {
    return `refs/wayfinder/${sanitizeRef(id)}`;
  }

  private async unstageLargeFiles(
    parent: string | undefined,
    env: NodeJS.ProcessEnv
  ): Promise<void> {
    const output = parent
      ? await this.run(
          ["diff", "--cached", "--name-only", "-z", parent],
          env,
          true
        )
      : await this.run(["ls-files", "-z"], env, true);
    if (!output) {
      return;
    }
    const limit = this.maxFileSizeMB * 1024 * 1024;
    for (const relPath of output.split("\0").filter(Boolean)) {
      try {
        const stat = await fs.promises.stat(path.join(this.root, relPath));
        if (!stat.isFile() || stat.size <= limit) {
          continue;
        }
        if (parent && (await this.existsAt(parent, relPath))) {
          await this.run(["reset", "-q", parent, "--", relPath], env, true);
        } else {
          await this.run(
            ["rm", "--cached", "-q", "--ignore-unmatch", "--", relPath],
            env,
            true
          );
        }
      } catch {
        // Deleted paths have no current file size and remain staged.
      }
    }
  }

  private async existsAt(commit: string, relPath: string): Promise<boolean> {
    try {
      await this.run(["cat-file", "-e", `${commit}:${toPosix(relPath)}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async run(
    args: string[],
    extraEnv: NodeJS.ProcessEnv = {},
    allowFail = false
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["--git-dir", this.gitDir, "--work-tree", this.root, ...args],
        {
          cwd: this.root,
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: "0",
            GIT_LITERAL_PATHSPECS: "1",
            ...extraEnv
          },
          maxBuffer: 64 * 1024 * 1024
        }
      );
      return String(stdout || "");
    } catch (error) {
      if (allowFail) {
        return "";
      }
      const message =
        (error as { stderr?: string; message?: string }).stderr ||
        (error as Error).message;
      throw new Error(`git ${args[0]} failed: ${message}`);
    }
  }
}

function sanitizeRef(value: string): string {
  return value.replace(/[^a-zA-Z0-9/_-]/g, "_");
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}
