import { WAYFINDER_VERSION } from "./version";
import { AgentHost } from "./models";

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const [command = "help"] = args;
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${WAYFINDER_VERSION}\n`);
    return;
  }
  if (command === "hook") {
    const hostIndex = args.indexOf("--host");
    const requestedHost = hostIndex >= 0 ? args[hostIndex + 1] : undefined;
    if (
      requestedHost !== undefined &&
      requestedHost !== "trae" &&
      requestedHost !== "claude" &&
      requestedHost !== "codex"
    ) {
      throw new Error(`Unsupported hook host: ${requestedHost}`);
    }
    const { runHookCli } = await import("./hook");
    await runHookCli(requestedHost as AgentHost | undefined);
    return;
  }
  if (command === "collect") {
    const { collectSessions } = await import("./sessionCollector");
    const result = await collectSessions();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    "Wayfinder internal companion runtime\n" +
    "Usage: wayfinder hook --host <claude|codex>\n" +
    "       wayfinder collect\n" +
    "       wayfinder --version\n"
  );
}

if (require.main === module) {
  void runCli().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
