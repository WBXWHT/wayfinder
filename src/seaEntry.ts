// Single Executable Application entry point.
//
// A SEA has no `require.main === module` signal, so this module unconditionally
// runs the app's internal collection dispatcher. Node itself is embedded, so
// users do not install a Node runtime; the binary still shells out to the
// system `git`.
import { runCli } from "./cli";

void runCli().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
