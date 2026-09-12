// Single Executable Application entry point.
//
// A SEA has no `require.main === module` signal, so this module unconditionally
// runs the app's internal collection dispatcher. Node itself is embedded, and
// the desktop collection path has no external runtime dependency.
import { runCli } from "./cli";

void runCli().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
