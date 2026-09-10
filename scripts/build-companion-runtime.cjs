const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const runtime = path.join(root, "build", "companion-runtime");
const metadata = require("../package.json");
const { WAYFINDER_VERSION } = require("../out/version.js");
if (metadata.version !== WAYFINDER_VERSION) {
  throw new Error("package.json and src/version.ts must use the same version");
}
const bundledInputs = new Set();
fs.rmSync(runtime, { recursive: true, force: true });
fs.mkdirSync(path.join(runtime, "bin"), { recursive: true });

for (const [entry, outfile] of [["out/cli.js", "bin/wayfinder-cli.cjs"]]) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(runtime, outfile),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    banner: { js: "#!/usr/bin/env node" },
    metafile: true
  });
  Object.keys(result.metafile.inputs).forEach((input) => bundledInputs.add(input));
  const bundledFile = path.join(runtime, outfile);
  const normalized = fs.readFileSync(bundledFile, "utf8")
    .replace(/[ \t]+$/gm, "");
  fs.writeFileSync(bundledFile, normalized);
  fs.chmodSync(bundledFile, 0o755);
}

const licenses = new Set();
for (const input of bundledInputs) {
  const marker = "node_modules/";
  const index = input.lastIndexOf(marker);
  if (index < 0) continue;
  const segments = input.slice(index + marker.length).split("/");
  const packageName = segments[0].startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
  const packageRoot = path.resolve(root, input.slice(0, index), marker, packageName);
  for (const file of fs.readdirSync(packageRoot)) {
    if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(file) &&
      fs.statSync(path.join(packageRoot, file)).isFile()) {
      licenses.add(path.join(packageRoot, file));
    }
  }
}
const licenseText = [...licenses].sort().map((file) =>
  `${path.relative(root, file)}\n\n${fs.readFileSync(file, "utf8")}\n`
).join("\n---\n\n");
fs.writeFileSync(
  path.join(runtime, "THIRD_PARTY_LICENSES.txt"),
  licenseText
);
fs.copyFileSync(path.join(root, "LICENSE"), path.join(runtime, "LICENSE"));
fs.copyFileSync(
  path.join(root, "node_modules/d3/LICENSE"),
  path.join(root, "media/D3-LICENSE.txt")
);
