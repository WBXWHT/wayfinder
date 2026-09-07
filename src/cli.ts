import * as path from "path";
import { buildConversationForest } from "./conversationForest";
import {
  installHostHooks,
  hostHooksInstalled,
  uninstallHostHooks
} from "./hostInstaller";
import { AgentHost } from "./models";
import { runHookCli } from "./hook";
import { readProjectState, wayfinderHome } from "./storage";
import { renderTerminalMap } from "./terminalMap";
import { WAYFINDER_VERSION } from "./version";

async function main(): Promise<void> {
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
    const checks = await Promise.all(
      (["trae", "claude", "codex"] as AgentHost[]).map(async (host) => ({
        host,
        connected: await hostHooksInstalled(root, host)
      }))
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
    "       wayfinder <doctor|map> [--root <project>]\n" +
    "       wayfinder --version\n"
  );
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
  void main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
