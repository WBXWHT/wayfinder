const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        joinPath: (...parts) => parts.join("/")
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { TimelineViewProvider } = require("../out/timelineView.js");
const {
  buildConversationForest
} = require("../out/conversationForest.js");

const statePath = process.argv[2];
const outputPath = process.argv[3] || path.join(__dirname, "../test/preview.html");
if (!statePath) {
  throw new Error("Usage: node scripts/generate-preview.cjs <timeline.json> [output]");
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

const provider = new TimelineViewProvider(
  ".",
  state.root,
  {}
);
const webview = {
  cspSource:
    process.env.WAYFINDER_PREVIEW_ORIGIN || "http://127.0.0.1:4173",
  asWebviewUri(uri) {
    return String(uri).endsWith("d3.min.js")
      ? "../media/d3.min.js"
      : "../node_modules/@vscode/codicons/dist/codicon.css";
  }
};

let html = provider.html(webview);
const previewSessionId = process.env.WAYFINDER_PREVIEW_EXPAND_SESSION === "1"
  ? forest.trees[0]?.sessions[0]?.id
  : undefined;
const previewTreeId = process.env.WAYFINDER_PREVIEW_TREE
  ? forest.trees.find((tree) => tree.title === process.env.WAYFINDER_PREVIEW_TREE)?.id
  : undefined;
const previewWidth = Number.parseInt(
  process.env.WAYFINDER_PREVIEW_WIDTH || "",
  10
);
html = html.replace(
  "const wayfinderApi = acquireVsCodeApi();",
  `const wayfinderApi = {
    postMessage() {},
    getState() {
      return ${JSON.stringify({
        expandedSessions: previewSessionId ? [previewSessionId] : [],
        selectedSessionId: previewSessionId || "",
        activeTreeId: previewTreeId || ""
      })};
    },
    setState() {}
  };`
);
const darkTheme = process.env.WAYFINDER_PREVIEW_THEME === "dark";
if (darkTheme) {
  html = html.replace("<body>", '<body class="vscode-dark">');
}
if (Number.isFinite(previewWidth) || darkTheme) {
  html = html.replace(
    "</head>",
    `<style>
      html { background: ${darkTheme ? "#171719" : "#ececef"}; }
      body {
        ${Number.isFinite(previewWidth) ? `width: ${previewWidth}px;` : ""}
        min-height: 100vh;
      }
      ${darkTheme ? `
      :root {
        --vscode-foreground: #f4f5f3;
        --vscode-descriptionForeground: #aeb4ad;
        --vscode-textLink-foreground: #69aef8;
        --vscode-testing-iconPassed: #55d49a;
        --vscode-testing-iconFailed: #ff7a70;
        --vscode-panel-border: rgba(255, 255, 255, .13);
        --vscode-sideBar-background: #202321;
        --vscode-editorWidget-background: #292d2a;
        --vscode-input-background: #2a2e2b;
        --vscode-list-hoverBackground: rgba(255, 255, 255, .08);
        --vscode-list-activeSelectionBackground: rgba(77, 159, 248, .2);
        --vscode-focusBorder: #69aef8;
      }` : ""}
    </style></head>`
  );
}
const payload = JSON.stringify({
  type: "render",
  state,
  forest,
  connected: true,
  validationCommand: "npm test"
}).replace(/</g, "\\u003c");
html = html.replace(
  "send('ready');",
  `send('ready'); setTimeout(() => render(${payload}), 0);`
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html);
console.log(outputPath);
