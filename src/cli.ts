import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildConversationForest } from "./conversationForest";
import {
  globalHostHooksEnabled,
  globalHostHooksInstalled,
  installGlobalHostHooks,
  installHostHooks,
  hostHooksInstalled,
  uninstallGlobalHostHooks,
  uninstallHostHooks
} from "./hostInstaller";
import { AgentHost } from "./models";
import { runHookCli } from "./hook";
import { readProjectState, wayfinderHome } from "./storage";
import { renderTerminalMap } from "./terminalMap";
import { WAYFINDER_VERSION } from "./version";

export async function runCli(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  const root = path.resolve(valueAfter(args, "--root") || process.cwd());
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${WAYFINDER_VERSION}\n`);
    return;
  }
  if (command === "hook") {
    await runHookCli(hostAfter(args));
    return;
  }
  if (command === "mcp") {
    const { runMcpServer } = await import("./mcpServer");
    await runMcpServer();
    return;
  }
  if (command === "connect" || command === "disconnect") {
    const host = args[0];
    if (host !== "claude" && host !== "codex") {
      throw new Error(`Select a host: ${command} <claude|codex>`);
    }
    const file = command === "connect"
      ? await installGlobalHostHooks(host, currentExecutable())
      : await uninstallGlobalHostHooks(host);
    process.stdout.write(
      `${command === "connect" ? "Configured" : "Disconnected"} ${host}: ${file}\n`
    );
    return;
  }
  if (command === "install" || command === "uninstall") {
    const requested = args[0];
    if (!["trae", "claude", "codex", "all"].includes(requested)) {
      throw new Error(
        `Select a host: ${command} <trae|claude|codex|all> --root <project>`
      );
    }
    const hosts: AgentHost[] = requested === "all"
      ? ["trae", "claude", "codex"]
      : [requested as AgentHost];
    for (const host of hosts) {
      const file = command === "install"
        ? await installHostHooks(root, host, __filename)
        : await uninstallHostHooks(root, host);
      process.stdout.write(
        `${command === "install" ? "Installed" : "Removed"} ${host} hooks: ${file}\n`
      );
    }
    return;
  }
  if (command === "doctor") {
    if (args.includes("--global")) {
      const hosts = await Promise.all(
        (["claude", "codex"] as const).map(async (host) => {
          const [configured, expectedRuntime, enabled] = await Promise.all([
            globalHostHooksInstalled(host),
            globalHostHooksInstalled(host, currentExecutable()),
            globalHostHooksEnabled(host)
          ]);
          return {
            host,
            available: executableAvailable(host),
            configured,
            enabled,
            runtimeMatches: expectedRuntime,
            approvalRequired: configured && expectedRuntime && enabled,
            healthy: false
          };
        })
      );
      process.stdout.write(`${JSON.stringify({
        dataHome: wayfinderHome(),
        git: { available: executableAvailable("git") },
        hosts
      }, null, 2)}\n`);
      return;
    }
    const checks = await Promise.all(
      (["trae", "claude", "codex"] as AgentHost[]).map(async (host) => {
        const configured = await hostHooksInstalled(root, host);
        return { host, configured };
      })
    );
    process.stdout.write(`${JSON.stringify({
      root,
      dataHome: wayfinderHome(),
      hosts: checks
    }, null, 2)}\n`);
    return;
  }
  if (command === "map") {
    const state = await readProjectState(root);
    const forest = state ? buildConversationForest(state) : undefined;
    if (!state || !forest?.trees.length) {
      process.stdout.write("Wayfinder: no voyage data for this project.\n");
      return;
    }
    process.stdout.write(renderTerminalMap(root, state, forest));
    return;
  }
  process.stdout.write(
    "Usage: wayfinder <install|uninstall> <trae|claude|codex|all> [--root <project>]\n" +
    "       wayfinder <connect|disconnect> <claude|codex>\n" +
    "       wayfinder <doctor|map> [--root <project>]\n" +
    "       wayfinder doctor --global\n" +
    "       wayfinder --version\n"
  );
}

function currentExecutable(): string {
  return /\.(?:c?js|mjs)$/i.test(__filename) ? __filename : process.execPath;
}

function executableAvailable(name: "claude" | "codex" | "git"): boolean {
  const home = os.homedir();
  const directories = new Set([
    ...(process.env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".bun", "bin")
  ]);
  return [...directories]
    .filter(Boolean)
    .some((directory) => {
      const executable = path.join(
        directory,
        process.platform === "win32" ? `${name}.exe` : name
      );
      try {
        fs.accessSync(executable, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hostAfter(args: string[]): AgentHost | undefined {
  const value = valueAfter(args, "--host");
  return value === "trae" || value === "claude" || value === "codex"
    ? value
    : undefined;
}

if (require.main === module) {
  void runCli().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
