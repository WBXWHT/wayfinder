const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  installGlobalHostHooks,
  uninstallGlobalHostHooks
} = require("../out/hostInstaller.js");

function setupHostHome(t, prefix) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previousHome = process.env.WAYFINDER_HOST_HOME;
  process.env.WAYFINDER_HOST_HOME = sandbox;
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.WAYFINDER_HOST_HOME;
    } else {
      process.env.WAYFINDER_HOST_HOME = previousHome;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  });
  return sandbox;
}

test("a failed hook publish restores the previous configuration", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-restore-");
  const file = path.join(home, ".codex", "hooks.json");
  const original = `${JSON.stringify({
    custom: "keep-me",
    hooks: {}
  }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);

  const originalLink = fs.promises.link;
  fs.promises.link = async (source, destination) => {
    if (destination === file && String(source).endsWith(".tmp")) {
      const error = new Error("simulated publish failure");
      error.code = "EIO";
      throw error;
    }
    return originalLink(source, destination);
  };
  t.after(() => {
    fs.promises.link = originalLink;
  });

  await assert.rejects(
    installGlobalHostHooks("codex", "/Applications/Wayfinder/wayfinder"),
    /simulated publish failure/
  );
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).sort(),
    ["hooks.json"]
  );
});

test("an interrupted hook publish is recovered on the next update", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-interrupted-");
  const file = path.join(home, ".codex", "hooks.json");
  const backup = `${file}.123.interrupted.previous`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(backup, "{\"custom\":\"recover-me\",\"hooks\":{}}\n");
  fs.writeFileSync(
    `${file}.wayfinder-publish`,
    `${JSON.stringify({ backup })}\n`
  );

  await installGlobalHostHooks("codex", "/Applications/Wayfinder/wayfinder");

  const restored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(restored.custom, "recover-me");
  assert.match(JSON.stringify(restored), /--wayfinder-hook/);
  const files = fs.readdirSync(path.dirname(file));
  assert.ok(files.includes("hooks.json"));
  assert.equal(files.some((name) => name.endsWith(".wayfinder-publish")), false);
  assert.equal(files.filter((name) => name.endsWith(".previous")).length, 1);
});

test("an unmarked stale hook backup is never restored", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-stale-backup-");
  const file = path.join(home, ".codex", "hooks.json");
  const stale = `${file}.123.stale.previous`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    stale,
    "{\"disableAllHooks\":true,\"custom\":\"stale\",\"hooks\":{}}\n"
  );

  await installGlobalHostHooks("codex", "/Applications/Wayfinder/wayfinder");

  const installed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(installed.disableAllHooks, undefined);
  assert.equal(installed.custom, undefined);
  assert.match(JSON.stringify(installed), /--wayfinder-hook/);
  assert.equal(fs.existsSync(stale), true);
});

test("uninstall recovers an interrupted publish before removing Wayfinder", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-uninstall-recovery-");
  const file = path.join(home, ".codex", "hooks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{\"custom\":\"keep-me\",\"hooks\":{}}\n");
  await installGlobalHostHooks("codex", "/Applications/Wayfinder/wayfinder");

  const backup = `${file}.123.interrupted.previous`;
  fs.renameSync(file, backup);
  fs.writeFileSync(
    `${file}.wayfinder-publish`,
    `${JSON.stringify({ backup })}\n`
  );

  await uninstallGlobalHostHooks("codex");

  const restored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(restored.custom, "keep-me");
  assert.doesNotMatch(JSON.stringify(restored), /--wayfinder-hook/);
  const files = fs.readdirSync(path.dirname(file));
  assert.ok(files.includes("hooks.json"));
  assert.equal(files.some((name) => name.endsWith(".wayfinder-publish")), false);
  assert.ok(files.filter((name) => name.endsWith(".previous")).length <= 3);
});

test("interrupted publish preserves an externally recreated config", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-external-recreate-");
  const file = path.join(home, ".codex", "hooks.json");
  const backup = `${file}.123.interrupted.previous`;
  const original = "{\"custom\":\"original\",\"hooks\":{}}\n";
  const external = "{\"custom\":\"external\",\"hooks\":{}}\n";
  const intended = "{\"custom\":\"intended\",\"hooks\":{}}\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(backup, original);
  fs.writeFileSync(file, external);
  fs.writeFileSync(
    `${file}.wayfinder-publish`,
    `${JSON.stringify({
      backup,
      replacementHash: createHash("sha256").update(intended).digest("hex")
    })}\n`
  );

  await assert.rejects(
    installGlobalHostHooks("codex", "/Applications/Wayfinder/wayfinder"),
    /Concurrent hook configuration updates were preserved/
  );

  assert.equal(fs.readFileSync(file, "utf8"), external);
  const conflict = fs.readdirSync(path.dirname(file))
    .find((name) => name.startsWith("hooks.json.wayfinder-conflict-"));
  assert.ok(conflict);
  assert.equal(
    fs.readFileSync(path.join(path.dirname(file), conflict), "utf8"),
    original
  );
  assert.equal(fs.existsSync(`${file}.wayfinder-publish`), false);
});

test("live publish preserves the previous config if another writer wins", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-live-conflict-");
  const file = path.join(home, ".codex", "hooks.json");
  const original = "{\"custom\":\"original\",\"hooks\":{}}\n";
  const external = "{\"custom\":\"external\",\"hooks\":{}}\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);

  const originalLink = fs.promises.link;
  fs.promises.link = async (source, destination) => {
    await originalLink(source, destination);
    if (destination === file && String(source).endsWith(".tmp")) {
      const replacement = `${file}.external`;
      fs.writeFileSync(replacement, external);
      fs.renameSync(replacement, file);
    }
  };
  t.after(() => {
    fs.promises.link = originalLink;
  });

  await assert.rejects(
    installGlobalHostHooks("codex", "/Applications/Wayfinder/wayfinder"),
    /changed while publishing/
  );

  assert.equal(fs.readFileSync(file, "utf8"), external);
  const conflict = fs.readdirSync(path.dirname(file))
    .find((name) => name.startsWith("hooks.json.wayfinder-conflict-"));
  assert.ok(conflict);
  assert.equal(
    fs.readFileSync(path.join(path.dirname(file), conflict), "utf8"),
    original
  );
  assert.equal(fs.existsSync(`${file}.wayfinder-publish`), false);
});

test("successful hook updates retain at most three recovery backups", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-bounded-backups-");
  const file = path.join(home, ".codex", "hooks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{\"custom\":\"keep-me\",\"hooks\":{}}\n");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await installGlobalHostHooks(
      "codex",
      `/Applications/Wayfinder/wayfinder-${attempt}`
    );
  }

  const files = fs.readdirSync(path.dirname(file));
  assert.equal(files.filter((name) => name.endsWith(".previous")).length, 3);
  assert.equal(files.some((name) => name.endsWith(".wayfinder-publish")), false);
});

test("a permission failure happens before the previous config is moved", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not chmod the temporary hook file");
    return;
  }
  const home = setupHostHome(t, "wayfinder-hook-mode-");
  const file = path.join(home, ".codex", "hooks.json");
  const original = "{\"custom\":\"keep-mode\",\"hooks\":{}}\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);

  const originalChmod = fs.promises.chmod;
  fs.promises.chmod = async (target, mode) => {
    if (String(target).endsWith(".tmp")) {
      const error = new Error("simulated permission failure");
      error.code = "EIO";
      throw error;
    }
    return originalChmod(target, mode);
  };
  t.after(() => {
    fs.promises.chmod = originalChmod;
  });

  await assert.rejects(
    installGlobalHostHooks("codex", "/Applications/Wayfinder/wayfinder"),
    /simulated permission failure/
  );
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).sort(),
    ["hooks.json"]
  );
});

test("transient Windows-style hook publish failures are retried", async (t) => {
  const home = setupHostHome(t, "wayfinder-hook-retry-");
  const file = path.join(home, ".codex", "hooks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{\"hooks\":{}}\n");

  const originalLink = fs.promises.link;
  let attempts = 0;
  fs.promises.link = async (source, destination) => {
    if (destination === file && String(source).endsWith(".tmp")) {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("simulated transient sharing violation");
        error.code = "EPERM";
        throw error;
      }
    }
    return originalLink(source, destination);
  };
  t.after(() => {
    fs.promises.link = originalLink;
  });

  await installGlobalHostHooks(
    "codex",
    "C:\\Program Files\\Wayfinder\\wayfinder.exe"
  );
  assert.equal(attempts, 3);
  assert.match(fs.readFileSync(file, "utf8"), /--wayfinder-hook/);
});
