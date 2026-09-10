const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { execFileSync, spawnSync } = require("node:child_process");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const root = path.resolve(__dirname, "..");
const release = path.resolve(process.argv[2] || path.join(root, "release"));
const metadata = require("../package.json");
const inventory = JSON.parse(fs.readFileSync(path.join(release, "artifacts.json"), "utf8"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-release-"));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(temp, { recursive: true, force: true }));

async function main() {
  assert.equal(inventory.version, metadata.version);
  for (const asset of inventory.files) {
    const bytes = fs.readFileSync(path.join(release, asset.name));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.name);
    if (/\.(zip|mcpb|vsix)$/.test(asset.name)) {
      const listing = execFileSync("unzip", ["-Z1", path.join(release, asset.name)], { encoding: "utf8" });
      assert.doesNotMatch(listing, /(^|\/)(\.env[^/]*|\.npmrc|timeline\.json|shadow\.git|session_memory_[^/]+)(\/|$)/m);
      assert.doesNotMatch(listing, /(^\/|\.\.\/)/m);
    }
  }
  execFileSync("tar", ["-xzf", path.join(release, `wayfinder-core-${metadata.version}.tar.gz`), "-C", temp]);
  const core = path.join(temp, "wayfinder");
  scan(core);
  const cli = path.join(core, "bin", "wayfinder-cli.cjs");
  const project = path.join(temp, "project with spaces");
  fs.mkdirSync(project);
  const env = { ...process.env, WAYFINDER_HOME: path.join(temp, "data") };
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], {
    env, cwd: project, encoding: "utf8"
  });
  assert.equal(run("--version").trim(), metadata.version);
  assert.equal(spawnSync(process.execPath, [cli, "install", "typo"], { env, cwd: project }).status, 1);
  assert.equal(fs.existsSync(path.join(project, ".trae")), false);
  run("install", "all", "--root", project);
  run("install", "all", "--root", project);
  assert.ok(JSON.parse(run("doctor", "--root", project)).hosts.every((host) => host.configured));
  const locations = { trae: ".trae/hooks.json", claude: ".claude/settings.json", codex: ".codex/hooks.json" };
  for (const host of Object.keys(locations)) {
    const config = JSON.parse(fs.readFileSync(path.join(project, locations[host]), "utf8"));
    for (const event of ["UserPromptSubmit", "PostToolUse", "Stop"]) {
      assert.equal(config.hooks[event].length, 1, `${host} ${event} duplicate`);
    }
    const prompt = config.hooks.UserPromptSubmit[0].hooks[0].command;
    const stop = config.hooks.Stop[0].hooks[0].command;
    const payload = { session_id: "same-session", cwd: project, wayfinder_host: host };
    execFileSync(prompt, { shell: true, env, cwd: project, input: JSON.stringify({
      ...payload, hook_event_name: "UserPromptSubmit", prompt: `Inspect ${host} sample project`
    }) });
    fs.writeFileSync(path.join(project, `${host}.txt`), host);
    execFileSync(stop, { shell: true, env, cwd: project, input: JSON.stringify({
      ...payload, hook_event_name: "Stop", last_assistant_message: `Completed ${host}`
    }) });
  }
  const client = new Client({ name: "wayfinder-release-check", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(core, "bin", "wayfinder-mcp.cjs")],
    env: { ...env, WAYFINDER_PROJECT_DIR: project }
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "wayfinder_show_map"));
    const result = await client.callTool({ name: "wayfinder_show_map", arguments: {} });
    const nodes = result.structuredContent.state.nodes;
    assert.equal(nodes.filter((node) => node.kind === "turn").length, 3);
    assert.deepEqual([...new Set(nodes.map((node) => node.sourceHost).filter(Boolean))].sort(), ["claude", "codex", "trae"]);
    const resource = await client.readResource({ uri: "ui://wayfinder/map" });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    const html = resource.contents[0].text;
    assert.match(html, /charset="UTF-8"/);
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  } finally {
    await client.close();
    await transport.close();
  }
  assert.match(run("map", "--root", project), /Wayfinder/);
  run("uninstall", "all", "--root", project);
  assert.ok(JSON.parse(run("doctor", "--root", project)).hosts.every((host) => !host.configured));
  const skill = path.join(root, "skills/wayfinder/scripts/wayfinder-cli.cjs");
  assert.equal(fs.readFileSync(skill, "utf8"), fs.readFileSync(cli, "utf8"));
  console.log("Release verified: hashes, isolated CLI install/uninstall, three host Hook processes, stdio MCP data/resource, Skill Core, privacy scan.");
}

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, file);
    if (entry.isDirectory()) { scan(file); continue; }
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!text.includes(os.homedir() + "/"), `Local home path in ${file}`);
    assert.doesNotMatch(text, /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|gh[ops]_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9]{24,}/);
  }
}
