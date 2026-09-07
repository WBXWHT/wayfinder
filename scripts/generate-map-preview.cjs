const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        joinPath: (...parts) => parts.join("/")
      },
      ViewColumn: { One: 1 }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ExperienceMapPanel } = require("../out/experienceMapPanel.js");
const {
  buildConversationForest
} = require("../out/conversationForest.js");

const statePath = process.argv[2];
const outputPath =
  process.argv[3] || path.join(__dirname, "../test/map-preview.html");
if (!statePath) {
  throw new Error(
    "Usage: node scripts/generate-map-preview.cjs <timeline.json> [output]"
  );
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
if (process.env.WAYFINDER_PREVIEW_STATUS_SAMPLE === "1") {
  const nodes = state.nodes || [];
  if (nodes[0]) {
    nodes[0].verdict = "success";
  }
  if (nodes[1]) {
    nodes[1].verdict = "failure";
  }
}
const forest = buildConversationForest(state);
const previewTree = process.env.WAYFINDER_PREVIEW_TREE || "";
const previewTreeId = forest.trees.find(
  (tree) => tree.title === previewTree
)?.id;
const map = new ExperienceMapPanel(".", state.root, {});
const webview = {
  cspSource:
    process.env.WAYFINDER_PREVIEW_ORIGIN || "http://127.0.0.1:4176",
  asWebviewUri(value) {
    return String(value).endsWith("d3.min.js")
      ? "../node_modules/d3/dist/d3.min.js"
      : "../node_modules/@vscode/codicons/dist/codicon.css";
  }
};

let html = map.html(webview);
if (process.env.WAYFINDER_PREVIEW_THEME === "dark") {
  html = html.replace("<body>", '<body class="vscode-dark">');
  html = html.replace(
    "</head>",
    `<style>
      :root {
        --vscode-foreground: #f4f5f3;
        --vscode-descriptionForeground: #aeb4ad;
        --vscode-textLink-foreground: #69aef8;
        --vscode-testing-iconPassed: #55d49a;
        --vscode-testing-iconFailed: #ff7a70;
        --vscode-panel-border: rgba(255, 255, 255, .13);
        --vscode-editor-background: #1c1f1d;
        --vscode-sideBar-background: #232724;
        --vscode-input-background: #2a2e2b;
        --vscode-list-hoverBackground: rgba(255, 255, 255, .08);
        --vscode-list-activeSelectionBackground: rgba(77, 159, 248, .2);
        --vscode-focusBorder: #69aef8;
      }
    </style></head>`
  );
}
html = html.replace(
  "const wayfinderApi = acquireVsCodeApi();",
  "const wayfinderApi = { postMessage() {} };"
);
const payload = JSON.stringify({
  type: "render",
  projectName: path.basename(state.root),
  state,
  forest,
  focusTreeId: previewTreeId
}).replace(/</g, "\\u003c");
html = html.replace("send('ready');", `send('ready'); renderPreview(${payload});`);
html = html.replace(
  "window.addEventListener('message', (event) => {",
  `function renderPreview(data) {
    state = data.state;
    forest = data.forest;
    projectName = data.projectName;
    activeTreeId = data.focusTreeId || '';
    document.getElementById('projectMeta').textContent =
      projectName + ' · ' + forest.trees.length + ' 个项目 · ' +
      forest.nodeCount + ' 轮';
    renderGraph();
  }
  window.addEventListener('message', (event) => {`
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html);
console.log(outputPath);
