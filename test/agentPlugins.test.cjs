const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createWayfinderMcpServer } = require("../out/mcpServer.js");
const {
  hostHooksInstalled,
  installHostHooks
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
  assert.match(app, /Wayfinder 航海图/);
  assert.match(app, /pointerdown/);
  assert.match(app, /wheel/);
  assert.match(app, /data-id/);
  assert.match(app, /class="waves far"/);
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
    assert.match(resource.contents[0].text, /Wayfinder 航海图/);
  } finally {
    await client.close();
    await server.close();
  }
});
