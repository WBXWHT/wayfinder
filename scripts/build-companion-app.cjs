const childProcess = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const environment = { ...process.env };

if (process.platform === "darwin" && !environment.APPLE_SIGNING_IDENTITY) {
  environment.APPLE_SIGNING_IDENTITY = "-";
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run this build through npm run companion:build");
}
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");

run(process.execPath, [npmCli, "run", "companion:prepare"]);
run(cargo, ["test", "--manifest-path", "companion/src-tauri/Cargo.toml"]);
run(process.execPath, [
  tauriCli,
  "build",
  "--config",
  "companion/src-tauri/tauri.conf.json"
]);
