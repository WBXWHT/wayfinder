const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createWayfinderMcpServer } = require("../out/mcpServer.js");
const {
  globalHostHooksEnabled,
  globalHostHooksInstalled,
  hostHooksInstalled,
  installGlobalHostHooks,
  installHostHooks,
  uninstallGlobalHostHooks
} = require("../out/hostInstaller.js");

const root = path.resolve(__dirname, "..");

test("Claude and Codex plugins package the shared Wayfinder hook", () => {
  const plugin = path.join(root, "plugins", "wayfinder");
  const claude = JSON.parse(
    fs.readFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), "utf8")
  );
  const codex = JSON.parse(
    fs.readFileSync(path.join(plugin, ".codex-plugin", "plugin.json"), "utf8")
  );
  const claudeHooks = fs.readFileSync(
    path.join(plugin, "hooks", "claude.json"),
    "utf8"
  );
  const codexHooks = fs.readFileSync(
    path.join(plugin, "hooks", "codex.json"),
    "utf8"
  );

  assert.equal(claude.name, "wayfinder");
  assert.equal(codex.name, "wayfinder");
  assert.match(claudeHooks, /--host claude/);
  assert.match(codexHooks, /--host codex/);
  assert.match(claudeHooks, /SessionStart/);
  assert.match(claudeHooks, /SessionEnd/);
  assert.match(claudeHooks, /PostToolUseFailure/);
  assert.match(codexHooks, /SessionStart/);
  assert.match(codexHooks, /SessionEnd/);
  assert.match(codexHooks, /apply_patch/);
  assert.equal(
    fs.existsSync(path.join(plugin, "bin", "wayfinder-hook.cjs")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(plugin, "bin", "wayfinder-mcp.cjs")),
    true
  );
  const app = fs.readFileSync(
    path.join(plugin, "mcp", "wayfinder-app.html"),
    "utf8"
  );
  assert.match(app, /ui\/request-display-mode/);
  assert.match(app, /<strong id="title">Wayfinder<\/strong>/);
  assert.match(app, /pointerdown/);
  assert.match(app, /wheel/);
  assert.match(app, /data-id/);
  assert.match(app, /class="grid-line"/);
  assert.match(app, /class="root-ring"/);
  assert.match(app, /class="route-bed/);
  assert.match(app, /\.nodeSize\(\[CARD_WIDTH \+ CARD_GAP/);
  const scripts = [...app.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});

test("host installer preserves settings and installs isolated hook commands", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-host-install-"));
  fs.mkdirSync(path.join(rootDir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, ".claude", "settings.json"),
    JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        Stop: [{
          hooks: [
            { type: "command", command: "node custom-hook.cjs" },
            {
              type: "command",
              command: "node stale-wayfinder.cjs --wayfinder-hook"
            }
          ]
        }]
      }
    })
  );
  const cli = path.join(root, "plugins", "wayfinder", "bin", "wayfinder-cli.cjs");
  await installHostHooks(rootDir, "claude", cli);
  await installHostHooks(rootDir, "codex", cli);

  const claude = JSON.parse(
    fs.readFileSync(path.join(rootDir, ".claude", "settings.json"), "utf8")
  );
  assert.deepEqual(claude.permissions, { allow: ["Read"] });
  assert.equal("version" in claude, false);
  assert.equal(await hostHooksInstalled(rootDir, "claude"), true);
  assert.equal(await hostHooksInstalled(rootDir, "codex"), true);
  assert.match(JSON.stringify(claude.hooks), /--host claude/);
  assert.match(JSON.stringify(claude.hooks), /custom-hook\.cjs/);
  assert.doesNotMatch(JSON.stringify(claude.hooks), /stale-wayfinder/);
  assert.match(JSON.stringify(claude.hooks), /wayfinder-cli\.cjs/);
  assert.match(
    JSON.stringify(
      JSON.parse(
        fs.readFileSync(path.join(rootDir, ".codex", "hooks.json"), "utf8")
      ).hooks
    ),
    /SessionEnd/
  );
  assert.equal(
    "version" in JSON.parse(
      fs.readFileSync(path.join(rootDir, ".codex", "hooks.json"), "utf8")
    ),
    false
  );
});

test("global connector installs a native binary hook without Node", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-global-"));
  const previousHome = process.env.WAYFINDER_HOST_HOME;
  process.env.WAYFINDER_HOST_HOME = home;
  try {
    const binary = "/Applications/Wayfinder.app/Contents/MacOS/wayfinder";
    const file = await installGlobalHostHooks("codex", binary);
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const serialized = JSON.stringify(config.hooks);

    assert.equal(await globalHostHooksInstalled("codex", binary), true);
    assert.equal("version" in config, false);
    assert.match(serialized, /Wayfinder\.app/);
    assert.match(serialized, /--host codex/);
    assert.doesNotMatch(serialized, /env node|node "/);
  } finally {
    if (previousHome === undefined) {
      delete process.env.WAYFINDER_HOST_HOME;
    } else {
      process.env.WAYFINDER_HOST_HOME = previousHome;
    }
  }
});

test("global connector preserves private permissions and serializes updates", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-global-mode-"));
  const previousHome = process.env.WAYFINDER_HOST_HOME;
  process.env.WAYFINDER_HOST_HOME = home;
  try {
    const settings = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: ["Read"] } }), {
      mode: 0o600
    });
    const binary = "/Applications/Wayfinder.app/Contents/MacOS/wayfinder";
    await Promise.all([
      installGlobalHostHooks("claude", binary),
      installGlobalHostHooks("claude", binary)
    ]);
    const config = JSON.parse(fs.readFileSync(settings, "utf8"));
    assert.deepEqual(config.permissions, { allow: ["Read"] });
    assert.equal(await globalHostHooksInstalled("claude", binary), true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(settings).mode & 0o777, 0o600);
    }
    await uninstallGlobalHostHooks("claude");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(settings).mode & 0o777, 0o600);
    }
  } finally {
    if (previousHome === undefined) {
      delete process.env.WAYFINDER_HOST_HOME;
    } else {
      process.env.WAYFINDER_HOST_HOME = previousHome;
    }
  }
});

test("Codex hook enablement follows the features setting", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-codex-feature-"));
  const previousHome = process.env.WAYFINDER_HOST_HOME;
  process.env.WAYFINDER_HOST_HOME = home;
  try {
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".codex", "config.toml"),
      "[features]\nhooks = false\n"
    );
    assert.equal(await globalHostHooksEnabled("codex"), false);
    fs.writeFileSync(
      path.join(home, ".codex", "config.toml"),
      "features.hooks = true\n"
    );
    assert.equal(await globalHostHooksEnabled("codex"), true);
  } finally {
    if (previousHome === undefined) {
      delete process.env.WAYFINDER_HOST_HOME;
    } else {
      process.env.WAYFINDER_HOST_HOME = previousHome;
    }
  }
});

test("Claude hook enablement honors disableAllHooks", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-claude-feature-"));
  const previousHome = process.env.WAYFINDER_HOST_HOME;
  process.env.WAYFINDER_HOST_HOME = home;
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({ disableAllHooks: true })
    );
    assert.equal(await globalHostHooksEnabled("claude"), false);
  } finally {
    if (previousHome === undefined) {
      delete process.env.WAYFINDER_HOST_HOME;
    } else {
      process.env.WAYFINDER_HOST_HOME = previousHome;
    }
  }
});

test("global doctor separates configuration, enablement, and health", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-doctor-"));
  const cli = path.join(root, "out", "cli.js");
  const env = { ...process.env, WAYFINDER_HOST_HOME: home };
  childProcess.execFileSync(
    process.execPath,
    [cli, "connect", "codex"],
    { env, stdio: "pipe" }
  );
  const readStatus = () => JSON.parse(childProcess.execFileSync(
    process.execPath,
    [cli, "doctor", "--global"],
    { env, encoding: "utf8" }
  ));
  let codex = readStatus().hosts.find((item) => item.host === "codex");
  assert.equal(codex.configured, true);
  assert.equal(codex.enabled, true);
  assert.equal(codex.runtimeMatches, true);
  assert.equal(codex.approvalRequired, true);
  assert.equal(codex.healthy, false);
  assert.equal("connected" in codex, false);

  fs.writeFileSync(
    path.join(home, ".codex", "config.toml"),
    "[features]\nhooks = false\n"
  );
  codex = readStatus().hosts.find((item) => item.host === "codex");
  assert.equal(codex.configured, true);
  assert.equal(codex.enabled, false);
  assert.equal(codex.approvalRequired, false);
  assert.equal(codex.healthy, false);
});

test("MCP server exposes an interactive map with a text fallback", async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createWayfinderMcpServer();
  const client = new Client(
    { name: "wayfinder-test", version: "1.0.0" },
    {
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"]
          }
        }
      }
    }
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  try {
    const tools = await client.listTools();
    const showMap = tools.tools.find(
      (tool) => tool.name === "wayfinder_show_map"
    );
    assert.ok(showMap);
    assert.equal(showMap._meta["ui/resourceUri"], "ui://wayfinder/map");

    const resource = await client.readResource({
      uri: "ui://wayfinder/map"
    });
    assert.equal(
      resource.contents[0].mimeType,
      "text/html;profile=mcp-app"
    );
    assert.match(
      resource.contents[0].text,
      /<strong id="title">Wayfinder<\/strong>/
    );
  } finally {
    await client.close();
    await server.close();
  }
});
