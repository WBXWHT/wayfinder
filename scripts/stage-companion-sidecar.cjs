const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const platform = process.platform === "win32" ? "win32" : process.platform;
const sourceName = process.platform === "win32"
  ? "wayfinder.exe"
  : `wayfinder-${platform}-${process.arch}`;
const targetTriple = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc"
}[`${platform}-${process.arch}`];
if (!targetTriple) {
  throw new Error(`Unsupported companion platform: ${platform}-${process.arch}`);
}

const source = path.join(root, "build", "sea", sourceName);
if (!fs.existsSync(source)) {
  throw new Error(`Missing ${source}. Run node scripts/build-sea.cjs first.`);
}
const directory = path.join(root, "companion", "src-tauri", "binaries");
fs.mkdirSync(directory, { recursive: true });
const extension = process.platform === "win32" ? ".exe" : "";
const target = path.join(directory, `wayfinder-${targetTriple}${extension}`);
fs.copyFileSync(source, target);
if (process.platform !== "win32") {
  fs.chmodSync(target, 0o755);
}
process.stdout.write(`Staged ${target}\n`);
