const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const metadata = require("../package.json");
const version = metadata.version;
const base = `https://github.com/WBXWHT/wayfinder/releases/download/v${version}`;
const release = path.join(root, "release");
const plugin = path.join(root, "plugins", "wayfinder");
const runtime = path.join(release, "core", "wayfinder");
const mcpb = path.join(release, "mcpb");
fs.mkdirSync(release, { recursive: true });
for (const directory of [runtime, mcpb]) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  for (const file of ["bin", "mcp", "LICENSE", "THIRD_PARTY_LICENSES.txt"]) {
    fs.cpSync(path.join(plugin, file), path.join(directory, file), { recursive: true });
  }
}

const runtimeMetadata = {
  name: "@wbxwht/wayfinder",
  version,
  description: metadata.description,
  license: "MIT",
  author: "WBXWHT",
  repository: metadata.repository,
  homepage: metadata.homepage,
  bugs: metadata.bugs,
  engines: { node: ">=22.13.0" },
  bin: {
    wayfinder: "bin/wayfinder-cli.cjs",
    "wayfinder-mcp": "bin/wayfinder-mcp.cjs"
  },
  files: ["bin", "mcp", "LICENSE", "THIRD_PARTY_LICENSES.txt", "README.md"],
  publishConfig: { access: "public", registry: "https://registry.npmjs.org" }
};
json(path.join(runtime, "package.json"), runtimeMetadata);
fs.copyFileSync(path.join(root, "README.md"), path.join(runtime, "README.md"));
fs.writeFileSync(path.join(runtime, "wayfinder.cmd"),
  '@echo off\r\nnode "%~dp0bin\\wayfinder-cli.cjs" %*\r\n');
fs.writeFileSync(path.join(runtime, "wayfinder-mcp.cmd"),
  '@echo off\r\nnode "%~dp0bin\\wayfinder-mcp.cjs" %*\r\n');

json(path.join(mcpb, "manifest.json"), {
  manifest_version: "0.3",
  name: "wayfinder",
  display_name: "Wayfinder",
  version,
  description: "Read a local AI coding voyage map inside your MCP host.",
  author: { name: "WBXWHT", url: "https://github.com/WBXWHT" },
  repository: metadata.repository,
  homepage: metadata.homepage,
  support: metadata.bugs.url,
  license: "MIT",
  server: {
    type: "node",
    entry_point: "bin/wayfinder-mcp.cjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/bin/wayfinder-mcp.cjs"],
      env: { WAYFINDER_PROJECT_DIR: "${user_config.project_dir}" }
    }
  },
  tools: [{ name: "wayfinder_show_map", description: "Read the selected project's voyage map." }],
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: ">=22.13.0" }
  },
  user_config: {
    project_dir: {
      type: "directory",
      title: "Project directory",
      description: "The project whose existing Wayfinder history will be shown to this MCP host.",
      required: true
    }
  }
});
json(path.join(mcpb, "package.json"), {
  name: "wayfinder-mcp-bundle", version, private: true, license: "MIT"
});
const files = [];
const asset = (name) => { files.push(name); return path.join(release, name); };
const vsix = `wayfinder-${version}.vsix`;
fs.copyFileSync(path.join(root, vsix), asset(vsix));
const coreTar = `wayfinder-core-${version}.tar.gz`;
const coreZip = `wayfinder-core-${version}.zip`;
archive("tar", ["-czf", asset(coreTar), "-C", path.dirname(runtime), "wayfinder"]);
archive("zip", ["-qr", asset(coreZip), "wayfinder"], path.dirname(runtime));
archive("zip", ["-qr", asset(`wayfinder-plugin-${version}.zip`), "wayfinder"], path.dirname(plugin));
archive("zip", ["-qr", asset(`wayfinder-skill-${version}.zip`), "wayfinder"], path.join(root, "skills"));
const mcpbName = `wayfinder-${version}.mcpb`;
archive("zip", ["-qr", asset(mcpbName), "."], mcpb);
const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", release], {
  cwd: runtime, encoding: "utf8"
}));
files.push(packed[0].filename);

const channels = path.join(release, "channels");
fs.mkdirSync(path.join(channels, "Formula"), { recursive: true });
fs.mkdirSync(path.join(channels, "bucket"), { recursive: true });
fs.writeFileSync(path.join(channels, "Formula", "wayfinder.rb"),
  `class Wayfinder < Formula
  desc "Local voyage maps for AI coding sessions"
  homepage "https://wayfinder-ai.pages.dev"
  url "${base}/${coreTar}"
  sha256 "${sha(coreTar)}"
  license "MIT"
  version "${version}"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"wayfinder").write <<~SH
      #!/bin/sh
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/wayfinder-cli.cjs" "$@"
    SH
    (bin/"wayfinder-mcp").write <<~SH
      #!/bin/sh
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/wayfinder-mcp.cjs" "$@"
    SH
    chmod 0755, bin/"wayfinder"
    chmod 0755, bin/"wayfinder-mcp"
  end

  test do
    assert_equal "${version}", shell_output("#{bin}/wayfinder --version").strip
    assert_match "dataHome", shell_output("#{bin}/wayfinder doctor --root #{testpath}")
  end
end
`);
json(path.join(channels, "bucket", "wayfinder.json"), {
  version, description: metadata.description,
  homepage: "https://wayfinder-ai.pages.dev",
  license: "MIT", depends: ["nodejs-lts", "git"],
  url: `${base}/${coreZip}`, hash: sha(coreZip),
  extract_dir: "wayfinder",
  bin: [["wayfinder.cmd", "wayfinder"], ["wayfinder-mcp.cmd", "wayfinder-mcp"]]
});
json(asset("server.json"), {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.WBXWHT/wayfinder",
  title: "Wayfinder",
  description: "Read local AI coding paths, decisions, and branches as an in-host voyage map.",
  repository: { url: "https://github.com/WBXWHT/wayfinder", source: "github" },
  version,
  packages: [{
    registryType: "mcpb",
    identifier: `${base}/${mcpbName}`,
    fileSha256: sha(mcpbName),
    transport: { type: "stdio" }
  }]
});
const inventory = files.map((name) => ({
  name, sha256: sha(name), bytes: fs.statSync(path.join(release, name)).size
}));
json(path.join(release, "artifacts.json"), { version, files: inventory });
fs.writeFileSync(path.join(release, "SHA256SUMS"),
  inventory.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n");
console.log(JSON.stringify({ version, release, files: inventory }, null, 2));

function json(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function sha(name) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(release, name))).digest("hex");
}
function archive(command, args, cwd = root) {
  const target = args.find((arg) => arg.startsWith(release));
  if (target) fs.rmSync(target, { force: true });
  execFileSync(command, args, { cwd, stdio: "inherit" });
}
