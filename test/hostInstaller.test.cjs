const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  installGlobalHostHooks
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
