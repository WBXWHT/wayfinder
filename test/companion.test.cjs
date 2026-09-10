const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("companion web bundle reuses the map and exposes host connections", () => {
  childProcess.execFileSync(
    process.execPath,
    [path.join(root, "scripts", "build-companion-web.cjs")],
    { cwd: root, stdio: "pipe" }
  );
  const html = fs.readFileSync(
    path.join(root, "companion", "dist", "index.html"),
    "utf8"
  );
  assert.match(html, /id="projectPicker"/);
  assert.match(html, /data-connect-host="codex"/);
  assert.match(html, /data-connect-host="claude"/);
  assert.match(html, /__WAYFINDER_SET_PAYLOAD__/);
  assert.match(html, /invoke\("list_projects"\)/);
  assert.match(html, /class="grid-line"/);
  assert.match(
    html,
    /id="settingsDialog" aria-labelledby="settingsTitle"/
  );
  assert.match(html, /id="settingsTitle">本地数据<\/h2>/);
  assert.match(html, /setInterval\(\(\) => \{[\s\S]*updateHostStatus/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});

test("macOS companion bundle is a DMG with one native sidecar", () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(root, "companion", "src-tauri", "tauri.conf.json"),
    "utf8"
  ));
  assert.equal(config.identifier, "io.github.WBXWHT.wayfinder");
  assert.deepEqual(config.bundle.targets, ["dmg"]);
  assert.deepEqual(config.bundle.externalBin, ["binaries/wayfinder"]);
  assert.equal(config.bundle.macOS.signingIdentity, null);
  assert.equal(config.bundle.macOS.entitlements, "Entitlements.plist");
  const entitlements = fs.readFileSync(
    path.join(root, "companion", "src-tauri", "Entitlements.plist"),
    "utf8"
  );
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(
    entitlements,
    /com\.apple\.security\.cs\.allow-unsigned-executable-memory/
  );
  for (const license of [
    "../../build/sea/NODE_LICENSE.txt",
    "../../plugins/wayfinder/THIRD_PARTY_LICENSES.txt",
    "../generated/RUST_THIRD_PARTY_LICENSES.txt"
  ]) {
    assert.ok(config.bundle.resources.includes(license));
  }
});

test("companion rejects transient app paths and uses a stale-aware archive lock", () => {
  const source = fs.readFileSync(
    path.join(root, "companion", "src-tauri", "src", "main.rs"),
    "utf8"
  );

  assert.match(source, /AppTranslocation/);
  assert.match(source, /PROJECT_LOCK_STALE/);
  assert.match(source, /impl Drop for ProjectLock/);
  assert.match(source, /lock_is_stale/);
});

test("release workflow requires signing and notarization credentials", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "release-macos-companion.yml"),
    "utf8"
  );
  for (const secret of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_API_ISSUER",
    "APPLE_API_KEY",
    "APPLE_API_PRIVATE_KEY"
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.match(workflow, /tauri-apps\/tauri-action@[a-f0-9]{40}/);
  assert.match(workflow, /releaseId: \$\{\{ needs\.prepare\.outputs\.release_id \}\}/);
  assert.match(workflow, /verify-companion-version\.cjs --prefix companion-v/);
  assert.match(workflow, /group: release-macos-companion\b/);
  assert.match(workflow, /Release tag points to/);
  assert.match(workflow, /SHA256SUMS/);
  assert.match(workflow, /releaseDraft: true/);
  assert.ok(
    workflow.indexOf("npm run build:companion:sidecar") <
      workflow.indexOf("cargo test --manifest-path"),
    "release workflow must stage the sidecar before cargo test"
  );
});

test("zero-cost alpha workflow uses ad-hoc signing and a prerelease tag", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "release-macos-alpha.yml"),
    "utf8"
  );
  assert.match(workflow, /APPLE_SIGNING_IDENTITY: "-"/);
  assert.match(workflow, /verify-companion-version\.cjs --prefix alpha-v/);
  assert.match(workflow, /releaseId: \$\{\{ needs\.prepare\.outputs\.release_id \}\}/);
  assert.match(workflow, /group: release-macos-alpha\b/);
  assert.match(workflow, /Release tag points to/);
  assert.match(workflow, /SHA256SUMS/);
  assert.match(workflow, /prerelease: true/);
  assert.doesNotMatch(workflow, /APPLE_CERTIFICATE/);
  assert.ok(
    workflow.indexOf("npm run build:companion:sidecar") <
      workflow.indexOf("cargo test --manifest-path"),
    "alpha workflow must stage the sidecar before cargo test"
  );
});

test("SEA build uses the lockfile-pinned local postject CLI", () => {
  const script = fs.readFileSync(
    path.join(root, "scripts", "build-sea.cjs"),
    "utf8"
  );
  const metadata = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );

  assert.equal(metadata.devDependencies.postject, "1.0.0-alpha.6");
  assert.equal(metadata.devDependencies["spdx-license-list"], "6.12.0");
  assert.match(script, /require\.resolve\("postject\/dist\/cli\.js"\)/);
  assert.doesNotMatch(script, /npx|--yes/);
});

test("companion release version declarations match", () => {
  assert.doesNotThrow(() => childProcess.execFileSync(
    process.execPath,
    [
      path.join(root, "scripts", "verify-companion-version.cjs"),
      "--prefix",
      "alpha-v"
    ],
    { cwd: root, stdio: "pipe" }
  ));
  assert.throws(() => childProcess.execFileSync(
    process.execPath,
    [
      path.join(root, "scripts", "verify-companion-version.cjs"),
      "--prefix",
      "alpha-v"
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "alpha-v9.9.9"
      },
      stdio: "pipe"
    }
  ));
});

test("companion development prepares its generated sidecar", () => {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );

  assert.match(metadata.scripts["companion:dev"], /companion:prepare/);
  assert.match(metadata.scripts["companion:prepare"], /build-sea\.cjs/);
  assert.match(metadata.scripts["companion:prepare"], /build:companion:sidecar/);
});
