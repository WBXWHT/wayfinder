// Build a Single Executable Application (SEA) for Wayfinder.
//
// Steps (Node official SEA flow):
//   1. esbuild-bundle out/seaEntry.js -> build/sea/wayfinder-sea.cjs
//   2. write sea-config.json for the internal collector runtime
//   3. node --experimental-sea-config -> build/sea/wayfinder.blob
//   4. copy the running node binary -> build/sea/<binary name>
//   5. postject the blob into the copied binary
//
// The result needs neither a Node runtime nor the .cjs scripts. It still calls
// the system `git`.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "build", "sea");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const platform = process.platform === "win32" ? "win" : process.platform;
const binaryName = process.platform === "win32"
  ? "wayfinder.exe"
  : `wayfinder-${platform}-${process.arch}`;
const bundlePath = path.join(outDir, "wayfinder-sea.cjs");
const configPath = path.join(outDir, "sea-config.json");
const blobPath = path.join(outDir, "wayfinder.blob");
const binaryPath = path.join(outDir, binaryName);
const nodeLicensePath = path.join(outDir, "NODE_LICENSE.txt");
// 1. Bundle the unified entry into a single CommonJS file.
esbuild.buildSync({
  entryPoints: [path.join(root, "out", "seaEntry.js")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  // require("node:sea") is resolved by the embedded runtime at run time.
  external: ["node:sea"]
});

// 2. SEA config. The sidecar exposes collection only and needs no disk assets.
fs.writeFileSync(configPath, `${JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false
}, null, 2)}\n`);

// 3. Generate the SEA blob.
execFileSync(process.execPath, ["--experimental-sea-config", configPath], {
  stdio: "inherit"
});

// 4. Copy the current node binary as the target executable.
fs.copyFileSync(process.execPath, binaryPath);
fs.chmodSync(binaryPath, 0o755);
const nodeRoot = path.dirname(path.dirname(process.execPath));
const nodeLicense = [
  process.env.WAYFINDER_NODE_LICENSE_PATH,
  ...["LICENSE", "LICENSE.md"].map((name) => path.join(nodeRoot, name))
]
  .filter(Boolean)
  .find((candidate) => fs.existsSync(candidate));
if (!nodeLicense) {
  throw new Error(`Cannot find the Node.js license beside ${process.execPath}`);
}
fs.copyFileSync(nodeLicense, nodeLicensePath);

// 5. Inject the blob. macOS/Windows signed binaries need the sentinel fuse and
// (on macOS) a re-sign; we remove the signature first so postject can write.
if (process.platform === "darwin") {
  try {
    execFileSync("codesign", ["--remove-signature", binaryPath], {
      stdio: "inherit"
    });
  } catch {
    // Unsigned copy: nothing to remove.
  }
}
const postjectCli = require.resolve("postject/dist/cli.js");
const postjectArgs = [
  binaryPath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
];
if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}
execFileSync(process.execPath, [postjectCli, ...postjectArgs], {
  stdio: "inherit"
});

if (process.platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", binaryPath], { stdio: "inherit" });
}

const sizeMB = (fs.statSync(binaryPath).size / (1024 * 1024)).toFixed(1);
process.stdout.write(`\nBuilt ${binaryPath} (${sizeMB} MB)\n`);
