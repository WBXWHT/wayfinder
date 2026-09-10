import { WAYFINDER_VERSION } from "./version";

export async function runCli(): Promise<void> {
  const [command = "help"] = process.argv.slice(2);
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${WAYFINDER_VERSION}\n`);
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
    "Usage: wayfinder collect\n" +
    "       wayfinder --version\n"
  );
}

if (require.main === module) {
  void runCli().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
