const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const plugin = path.join(root, "plugins", "wayfinder");
const metadata = require("../package.json");
const { WAYFINDER_VERSION } = require("../out/version.js");
if (metadata.version !== WAYFINDER_VERSION) {
  throw new Error("package.json and src/version.ts must use the same version");
}
const bundledInputs = new Set();
fs.mkdirSync(path.join(plugin, "bin"), { recursive: true });
fs.mkdirSync(path.join(plugin, "mcp"), { recursive: true });

for (const [entry, outfile] of [
  ["out/hook.js", "bin/wayfinder-hook.cjs"],
  ["out/cli.js", "bin/wayfinder-cli.cjs"],
  ["out/mcpServer.js", "bin/wayfinder-mcp.cjs"]
]) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(plugin, outfile),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    banner: { js: "#!/usr/bin/env node" },
    metafile: true
  });
  Object.keys(result.metafile.inputs).forEach((input) => bundledInputs.add(input));
  const bundledFile = path.join(plugin, outfile);
  const normalized = fs.readFileSync(bundledFile, "utf8")
    .replace(/[ \t]+$/gm, "");
  fs.writeFileSync(bundledFile, normalized);
  fs.chmodSync(bundledFile, 0o755);
}

const app = esbuild.buildSync({
  entryPoints: [path.join(root, "mcp", "wayfinder-app.js")],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  write: false,
  metafile: true
});
Object.keys(app.metafile.inputs).forEach((input) => bundledInputs.add(input));
const template = fs.readFileSync(
  path.join(root, "mcp", "wayfinder-app.template.html"),
  "utf8"
);
const appStyles = fs.readFileSync(
  path.join(root, "mcp", "wayfinder-app.css"),
  "utf8"
);
fs.writeFileSync(
  path.join(plugin, "mcp", "wayfinder-app.html"),
  template
    .replace("/* WAYFINDER_STYLES */", () => appStyles)
    .replace("/* WAYFINDER_APP */", () => app.outputFiles[0].text)
);

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
fs.writeFileSync(path.join(plugin, "THIRD_PARTY_LICENSES.txt"), licenseText);
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  fs.copyFileSync(path.join(root, file), path.join(plugin, file));
}
fs.copyFileSync(
  path.join(root, "node_modules/d3/LICENSE"),
  path.join(root, "media/D3-LICENSE.txt")
);
for (const host of ["claude", "codex"]) {
  const manifestPath = path.join(plugin, `.${host}-plugin`, "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  Object.assign(manifest, {
    version: metadata.version,
    author: { name: "WBXWHT" },
    repository: metadata.repository.url,
    license: metadata.license,
    skills: "./skills/"
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
const skillTarget = path.join(plugin, "skills", "wayfinder");
fs.mkdirSync(path.join(skillTarget, "scripts"), { recursive: true });
fs.copyFileSync(
  path.join(root, "skills", "wayfinder", "SKILL.md"),
  path.join(skillTarget, "SKILL.md")
);
fs.copyFileSync(
  path.join(plugin, "bin", "wayfinder-cli.cjs"),
  path.join(skillTarget, "scripts", "wayfinder-cli.cjs")
);
const sourceSkill = path.join(root, "skills", "wayfinder");
fs.mkdirSync(path.join(sourceSkill, "scripts"), { recursive: true });
fs.copyFileSync(
  path.join(plugin, "bin", "wayfinder-cli.cjs"),
  path.join(sourceSkill, "scripts", "wayfinder-cli.cjs")
);
for (const destination of [skillTarget, sourceSkill]) {
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(destination, "LICENSE"));
  fs.writeFileSync(path.join(destination, "THIRD_PARTY_LICENSES.txt"), licenseText);
}
