const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const stateFile = process.argv[2];
const outputFile = process.argv[3];
if (!stateFile || !outputFile) {
  throw new Error(
    "Usage: node scripts/generate-companion-preview.cjs <timeline.json> <output.html>"
  );
}

execFileSync(process.execPath, [path.join(root, "scripts", "build-companion-web.cjs")], {
  cwd: root,
  stdio: "inherit"
});
const state = JSON.parse(fs.readFileSync(path.resolve(stateFile), "utf8"));
const projectId = state.projectId || "preview-project";
const projectName = path.basename(state.root || "Preview project");
const previewProjectCount = Math.max(
  1,
  Number(process.env.WAYFINDER_PREVIEW_PROJECTS || 1)
);
const previewProjects = Array.from(
  { length: previewProjectCount },
  (_, index) => ({
    id: index === 0 ? projectId : `${projectId}-${index + 1}`,
    name: index === 0 ? projectName : `${projectName} ${index + 1}`,
    root: state.root || "",
    updatedAt: state.updatedAt || "",
    nodeCount: Array.isArray(state.nodes) ? state.nodes.length : 0
  })
);
const mock = `<script>
globalThis.__TAURI__ = {
  core: {
    invoke: async (command) => {
      if (command === "list_projects") {
        return ${JSON.stringify(previewProjects)};
      }
      if (command === "read_project_state") {
        return ${JSON.stringify(state)};
      }
      if (command === "host_status") {
        return {
          git: { available: true },
          hosts: [
            {
              host: "codex",
              available: true,
              configured: true,
              enabled: true,
              healthy: true
            },
            {
              host: "claude",
              available: true,
              configured: true,
              enabled: true,
              healthy: true
            }
          ]
        };
      }
      if (command === "connect_host") {
        return "Preview mode";
      }
      if (command === "disconnect_host") {
        return "Preview mode";
      }
      if (command === "open_data_folder") {
        return "~/.wayfinder";
      }
      if (command === "open_release_page") {
        return null;
      }
      if (command === "archive_project") {
        return "~/.wayfinder/archive/preview";
      }
      throw new Error("Unknown preview command: " + command);
    }
  }
};
</script>`;
const html = fs.readFileSync(
  path.join(root, "companion", "dist", "index.html"),
  "utf8"
);
const resolvedOutput = path.resolve(outputFile);
fs.writeFileSync(resolvedOutput, html.replace("<script>", `${mock}\n<script>`));
const fontSource = path.join(root, "companion", "dist", "codicon.ttf");
const fontTarget = path.join(path.dirname(resolvedOutput), "codicon.ttf");
if (fontSource !== fontTarget) {
  fs.copyFileSync(fontSource, fontTarget);
}
process.stdout.write(`Generated ${resolvedOutput}\n`);
