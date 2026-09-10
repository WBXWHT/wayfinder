const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("companion web bundle reuses the final map and project navigation", () => {
  childProcess.execFileSync(
    process.execPath,
    [path.join(root, "scripts", "build-companion-web.cjs")],
    { cwd: root, stdio: "pipe" }
  );
  const html = fs.readFileSync(
    path.join(root, "companion", "dist", "index.html"),
    "utf8"
  );
  const builder = fs.readFileSync(
    path.join(root, "scripts", "build-companion-web.cjs"),
    "utf8"
  );
  assert.match(html, /id="projectSidebar"/);
  assert.match(html, /id="projectList"/);
  assert.match(html, /id="toggleProjects"/);
  assert.doesNotMatch(html, /id="projectPicker"/);
  assert.doesNotMatch(html, /data-connect-host=/);
  assert.doesNotMatch(html, /Hook 已配置/);
  assert.match(html, /__WAYFINDER_DESKTOP_HANDLE_MESSAGE__/);
  assert.match(html, /invoke\("list_projects"\)/);
  assert.match(html, /trail-start-pole/);
  assert.match(html, /forest-node/);
  assert.match(html, /src="\.\/wayfinder-icon\.png"/);
  assert.match(html, /iconGlyph\.className = "codicon codicon-map"/);
  assert.match(html, /id="openData" class="local-data-button"/);
  assert.match(html, /id="fit" class="tool-button"/);
  assert.doesNotMatch(html, /id="refresh"/);
  assert.doesNotMatch(html, /id="settingsDialog"/);
  assert.match(html, /const focusedProjectId =/);
  assert.match(html, /data-project-id="\$\{focusedProjectId\}"/);
  assert.match(html, /setInterval\(\(\) => \{[\s\S]*refreshIfChanged/);
  assert.match(builder, /await lockfile\.lock\(companionRoot/);
  assert.match(builder, /await fs\.promises\.rename\(output, finalOutput\)/);
  assert.match(builder, /await fs\.promises\.rename\(backupOutput, finalOutput\)/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 3);
  for (const script of scripts) {
    assert.doesNotThrow(() => new vm.Script(script[1]));
  }
});

test("desktop companion bundles one native sidecar and platform icons", () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(root, "companion", "src-tauri", "tauri.conf.json"),
    "utf8"
  ));
  assert.equal(config.identifier, "io.github.WBXWHT.wayfinder");
  assert.deepEqual(config.bundle.targets, ["dmg"]);
  assert.equal(config.app.windows[0].minWidth, 320);
  assert.equal(config.app.windows[0].minHeight, 480);
  assert.deepEqual(config.bundle.externalBin, ["binaries/wayfinder"]);
  assert.equal(config.bundle.macOS.signingIdentity, null);
  assert.equal(config.bundle.macOS.entitlements, "Entitlements.plist");
  assert.ok(config.bundle.icon.includes("icons/icon.ico"));
  assert.ok(fs.existsSync(
    path.join(root, "companion", "src-tauri", "icons", "icon.ico")
  ));
  assert.doesNotMatch(config.app.security.csp, /127\.0\.0\.1|connect-src/);
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
    "../../build/companion-runtime/THIRD_PARTY_LICENSES.txt",
    "../generated/RUST_THIRD_PARTY_LICENSES.txt"
  ]) {
    assert.ok(config.bundle.resources.includes(license));
  }
});

test("companion uses a stale-aware archive lock", () => {
  const source = fs.readFileSync(
    path.join(root, "companion", "src-tauri", "src", "main.rs"),
    "utf8"
  );

  assert.match(source, /PROJECT_LOCK_STALE/);
  assert.match(source, /impl Drop for ProjectLock/);
  assert.match(source, /lock_is_stale/);
  assert.match(source, /lock\.join\("owner"\)/);
  assert.doesNotMatch(source, /std::os::unix/);
});

test("release map contains no local debug telemetry", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "forestMapPanel.ts"),
    "utf8"
  );

  assert.doesNotMatch(source, /debug-point|map-pan-stall|127\.0\.0\.1:7777/);
});

test("companion keeps projects that only have pending work", () => {
  const rust = fs.readFileSync(
    path.join(root, "companion", "src-tauri", "src", "main.rs"),
    "utf8"
  );
  const browser = fs.readFileSync(
    path.join(root, "companion", "main.js"),
    "utf8"
  );

  assert.match(rust, /pending_count: usize/);
  assert.match(browser, /project\.pendingCount > 0/);
  assert.match(
    browser,
    /project\.nodeCount <= 0 && project\.pendingCount <= 0/
  );
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
  assert.match(workflow, /RELEASE_ID: \$\{\{ needs\.prepare\.outputs\.release_id \}\}/);
  assert.match(workflow, /group: release-desktop-alpha\b/);
  assert.match(workflow, /Release tag points to/);
  assert.match(workflow, /github\.rest\.repos\.getReleaseByTag/);
  assert.match(workflow, /if \(!release\?\.draft\)/);
  assert.match(workflow, /github\.rest\.git\.updateRef/);
  assert.match(workflow, /force: true/);
  assert.doesNotMatch(workflow, /Draft release exists without its expected tag/);
  assert.match(workflow, /candidate-\$\{context\.runId\}/);
  assert.match(workflow, /backup-\$\{context\.runId\}/);
  assert.match(workflow, /catch \(error\)/);
  assert.match(workflow, /for \(const promotion of promotions\.reverse\(\)\)/);
  assert.match(workflow, /rollbackErrors\.push/);
  assert.match(workflow, /new AggregateError/);
  assert.match(workflow, /const deleteEvery = async \(assets\)/);
  assert.match(workflow, /const finalAssets = await listAssets\(\)/);
  assert.match(workflow, /finalNames\.length !== expectedNames\.length/);
  assert.match(workflow, /Publish verified release assets/);
  assert.match(workflow, /target_commitish: context\.sha/);
  assert.match(workflow, /SHA256SUMS/);
  assert.match(workflow, /prerelease: true/);
  assert.doesNotMatch(workflow, /APPLE_CERTIFICATE/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /hdiutil attach -nobrowse -readonly/);
  assert.match(workflow, /CFBundleShortVersionString/);
  assert.match(workflow, /Contents\/MacOS\/wayfinder-companion/);
  assert.match(workflow, /Contents\/MacOS\/wayfinder"/);
  assert.match(workflow, /build_windows:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /x86_64-pc-windows-msvc/);
  assert.match(workflow, /--bundles nsis/);
  assert.match(workflow, /Windows-x86_64\.exe/);
  assert.match(workflow, /WAYFINDER_NODE_LICENSE_PATH/);
  assert.ok(
    workflow.indexOf("npm run build:companion:sidecar") <
      workflow.indexOf("cargo test --manifest-path"),
    "alpha workflow must stage the sidecar before cargo test"
  );
  assert.ok(
    workflow.indexOf("Verify the packaged app") <
      workflow.indexOf("Publish verified release assets"),
    "alpha workflow must verify both DMGs before mutating the draft release"
  );
  assert.ok(
    workflow.indexOf("Verify the packaged installer") <
      workflow.indexOf("Publish verified release assets"),
    "alpha workflow must verify Windows before mutating the draft release"
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
  assert.match(script, /WAYFINDER_NODE_LICENSE_PATH/);
  assert.doesNotMatch(script, /npx|--yes/);
});

test("companion release version declarations match", () => {
  const verifier = fs.readFileSync(
    path.join(root, "scripts", "verify-companion-version.cjs"),
    "utf8"
  );
  assert.match(verifier, /package-lock\.json/);
  assert.match(verifier, /packageLock\.packages\?\.\[""\]\?\.version/);
  assert.match(verifier, /Cargo\.lock/);
  assert.match(verifier, /wayfinder-companion/);
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
