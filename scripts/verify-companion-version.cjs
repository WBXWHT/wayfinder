const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const prefixIndex = process.argv.indexOf("--prefix");
const prefix = prefixIndex >= 0 ? process.argv[prefixIndex + 1] : "";
if (!prefix) {
  throw new Error("Usage: verify-companion-version.cjs --prefix <tag-prefix>");
}

const packageVersion = require("../package.json").version;
const tauriVersion = require(
  "../companion/src-tauri/tauri.conf.json"
).version;
const cargo = fs.readFileSync(
  path.join(root, "companion", "src-tauri", "Cargo.toml"),
  "utf8"
);
const source = fs.readFileSync(path.join(root, "src", "version.ts"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const sourceVersion = source.match(/WAYFINDER_VERSION\s*=\s*"([^"]+)"/)?.[1];
const versions = {
  "package.json": packageVersion,
  "tauri.conf.json": tauriVersion,
  "Cargo.toml": cargoVersion,
  "src/version.ts": sourceVersion
};
const mismatched = Object.entries(versions)
  .filter(([, version]) => version !== packageVersion)
  .map(([file, version]) => `${file}=${version || "<missing>"}`);
if (mismatched.length) {
  throw new Error(
    `Companion versions do not match package.json=${packageVersion}: ` +
      mismatched.join(", ")
  );
}

const tag = `${prefix}${packageVersion}`;
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== tag
) {
  throw new Error(
    `Release tag ${process.env.GITHUB_REF_NAME} does not match ${tag}`
  );
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${packageVersion}\ntag=${tag}\n`
  );
}
process.stdout.write(`Verified Companion ${packageVersion} for ${tag}\n`);
