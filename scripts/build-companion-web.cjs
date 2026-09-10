const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "companion", "dist");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, "companion", "main.js")],
  bundle: true,
  platform: "browser",
  target: "safari15",
  format: "iife",
  write: false
}).outputFiles[0].text;

// The Companion and the extension must render the same final map. Generate the
// desktop page from ExperienceMapPanel instead of maintaining a second map.
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        joinPath: (...parts) => parts.map(String).join("/")
      },
      ViewColumn: { One: 1 }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let ExperienceMapPanel;
try {
  ({ ExperienceMapPanel } = require(
    path.join(root, "out", "forestMapPanel.js")
  ));
} finally {
  Module._load = originalLoad;
}

const webview = {
  cspSource: "wayfinder-desktop",
  asWebviewUri(value) {
    const resolved = String(value);
    return resolved.endsWith("d3.min.js")
      ? "__WAYFINDER_D3__"
      : "__WAYFINDER_CODICONS__";
  }
};

let html = new ExperienceMapPanel(".", ".", {}).html(webview);
const d3 = fs.readFileSync(path.join(root, "media", "d3.min.js"), "utf8");
const codiconCss = fs.readFileSync(
  path.join(
    root,
    "node_modules",
    "@vscode",
    "codicons",
    "dist",
    "codicon.css"
  ),
  "utf8"
).replace(/\.\/codicon\.ttf\?[^")]+/g, "./codicon.ttf");
fs.copyFileSync(
  path.join(
    root,
    "node_modules",
    "@vscode",
    "codicons",
    "dist",
    "codicon.ttf"
  ),
  path.join(output, "codicon.ttf")
);

const topbar = `<header class="topbar desktop-topbar">
  <div class="brand workspace-context">
    <button id="toggleProjects" class="icon-button project-toggle"
      title="切换项目" aria-label="切换项目">
      <span class="codicon codicon-list-tree"></span>
    </button>
    <div class="brand-copy">
      <div id="currentProjectLabel" class="brand-title">航海图</div>
      <div id="projectMeta" class="brand-meta">选择一个项目</div>
    </div>
  </div>
  <label class="search">
    <span class="codicon codicon-search" aria-hidden="true"></span>
    <input id="search" type="search" placeholder="搜索当前项目"
      aria-label="搜索当前项目">
  </label>
  <div class="top-actions">
    <button id="refresh" class="icon-button" title="刷新"
      aria-label="刷新">
      <span class="codicon codicon-refresh"></span>
    </button>
    <button id="fit" class="icon-button" title="适应画布"
      aria-label="适应画布">
      <span class="codicon codicon-screen-full"></span>
    </button>
    <button id="settings" class="icon-button" title="数据管理"
      aria-label="数据管理">
      <span class="codicon codicon-settings-gear"></span>
    </button>
  </div>
</header>`;

const desktopOpen = `<div class="desktop-shell">
  <aside id="projectSidebar" class="project-sidebar" aria-label="项目列表">
    <div class="sidebar-brand">
      <span class="brand-mark" aria-hidden="true">
        <span class="codicon codicon-compass"></span>
      </span>
      <strong>Wayfinder</strong>
      <button id="closeProjects" class="icon-button sidebar-close"
        title="关闭项目列表" aria-label="关闭项目列表">
        <span class="codicon codicon-close"></span>
      </button>
    </div>
    <div class="sidebar-heading">项目</div>
    <nav id="projectList" class="project-list"></nav>
    <div id="projectSummary" class="project-summary"></div>
  </aside>
  <div class="desktop-main">`;

const settingsDialog = `<dialog id="settingsDialog" aria-labelledby="settingsTitle">
  <div class="dialog-head">
    <div>
      <h2 id="settingsTitle">本地数据</h2>
      <span>~/.wayfinder</span>
    </div>
    <button id="closeSettings" class="icon-button" aria-label="关闭">
      <span class="codicon codicon-close"></span>
    </button>
  </div>
  <p>对话、航点和文件变更都保存在本机。</p>
  <div class="dialog-actions">
    <button id="checkUpdates">检查更新</button>
    <button id="openData">打开数据目录</button>
    <button id="archiveProject" class="danger-action">归档当前项目</button>
  </div>
</dialog>
<button id="sidebarScrim" class="sidebar-scrim" tabindex="-1"
  aria-label="关闭项目列表"></button>
<div id="toast" class="toast" role="status" aria-live="polite"></div>`;

const desktopStyles = `
  body.desktop-mode {
    --vscode-font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
      "Helvetica Neue", Arial, sans-serif;
    --vscode-editor-background: #ffffff;
    --vscode-sideBar-background: #f2f2f7;
    --vscode-foreground: #1c1c1e;
    --vscode-descriptionForeground: #636366;
    --vscode-panel-border: rgba(60, 60, 67, .16);
    --vscode-list-hoverBackground: rgba(118, 118, 128, .10);
    --vscode-list-activeSelectionBackground: rgba(0, 122, 255, .12);
    --vscode-input-background: rgba(118, 118, 128, .08);
    --vscode-focusBorder: #007aff;
    --vscode-textLink-foreground: #007aff;
    background: #f2f2f7;
  }
  .desktop-shell {
    display: grid;
    width: 100vw;
    height: 100vh;
    grid-template-columns: 236px minmax(0, 1fr);
    overflow: hidden;
  }
  .desktop-main { min-width: 0; min-height: 0; }
  .desktop-main .app { height: 100vh; }
  .project-sidebar {
    z-index: 8;
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-rows: 52px 30px minmax(0, 1fr) 36px;
    border-right: 1px solid var(--line);
    background: #f2f2f7;
  }
  .sidebar-brand {
    display: flex;
    min-width: 0;
    padding: 0 12px;
    align-items: center;
    gap: 9px;
    border-bottom: 1px solid var(--line);
  }
  .sidebar-brand strong {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sidebar-close { display: none; margin-left: auto; }
  .sidebar-heading {
    display: flex;
    padding: 10px 12px 4px;
    align-items: center;
    color: var(--muted);
    font-size: 9px;
    font-weight: 650;
    text-transform: uppercase;
  }
  .project-list {
    min-height: 0;
    overflow: auto;
    padding: 4px 7px 10px;
  }
  .project-item {
    display: grid;
    width: 100%;
    min-width: 0;
    min-height: 46px;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    color: var(--text);
    text-align: left;
    background: transparent;
    cursor: pointer;
  }
  .project-item:hover { background: var(--hover); }
  .project-item[aria-current="true"] { background: var(--selected); }
  .project-item .codicon {
    color: var(--muted);
    font-size: 15px;
    text-align: center;
  }
  .project-item[aria-current="true"] .codicon { color: var(--accent); }
  .project-copy { min-width: 0; }
  .project-name {
    display: block;
    overflow: hidden;
    font-size: 11px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project-meta {
    display: block;
    margin-top: 2px;
    color: var(--muted);
    font-size: 9px;
  }
  .project-empty {
    padding: 18px 10px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.55;
  }
  .project-summary {
    display: flex;
    padding: 0 14px;
    align-items: center;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 9px;
  }
  .desktop-topbar {
    grid-template-columns: minmax(150px, 230px) minmax(180px, 520px) 1fr;
  }
  .project-toggle { display: none; flex: 0 0 30px; }
  .desktop-topbar .brand-mark { display: none; }
  .top-actions .is-spinning { animation: desktop-spin 700ms linear infinite; }
  @keyframes desktop-spin { to { transform: rotate(360deg); } }
  .sidebar-scrim { display: none; }
  dialog {
    width: min(420px, calc(100% - 36px));
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 24px 80px rgba(24, 26, 29, .22);
  }
  dialog::backdrop { background: rgba(20, 22, 25, .28); }
  .dialog-head {
    display: flex;
    min-height: 56px;
    padding: 0 12px 0 18px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }
  .dialog-head > div { display: grid; gap: 2px; }
  .dialog-head h2 { margin: 0; font-size: 13px; }
  .dialog-head span { color: var(--muted); font: 9px ui-monospace, monospace; }
  dialog > p {
    margin: 0;
    padding: 18px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.6;
  }
  .dialog-actions {
    display: flex;
    padding: 0 18px 18px;
    justify-content: flex-end;
    gap: 8px;
  }
  .dialog-actions button {
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }
  .dialog-actions button:hover { background: var(--hover); }
  .dialog-actions .danger-action { color: var(--bad); }
  .toast {
    position: fixed;
    z-index: 20;
    right: 16px;
    bottom: 16px;
    max-width: min(360px, calc(100vw - 32px));
    padding: 9px 12px;
    border-radius: 6px;
    color: #ffffff;
    background: rgba(28, 28, 30, .92);
    font-size: 10px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(6px);
    transition: opacity 140ms ease, transform 140ms ease;
  }
  .toast.visible { opacity: 1; transform: translateY(0); }
  @media (max-width: 760px) {
    .desktop-shell { grid-template-columns: minmax(0, 1fr); }
    .project-sidebar {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      width: min(280px, calc(100vw - 42px));
      box-shadow: 14px 0 40px rgba(24, 26, 29, .16);
      transform: translateX(-102%);
      transition: transform 170ms ease;
    }
    body.projects-open .project-sidebar { transform: translateX(0); }
    .sidebar-close, .project-toggle { display: inline-grid; }
    .sidebar-scrim {
      position: fixed;
      z-index: 7;
      inset: 0;
      display: block;
      border: 0;
      background: rgba(20, 22, 25, .22);
      opacity: 0;
      pointer-events: none;
      transition: opacity 170ms ease;
    }
    body.projects-open .sidebar-scrim {
      opacity: 1;
      pointer-events: auto;
    }
    .desktop-topbar {
      grid-template-columns: auto minmax(100px, 1fr) auto;
      gap: 6px;
      padding: 0 8px;
    }
    .workspace-context { min-width: 30px; }
    .workspace-context .brand-copy { display: none; }
    .desktop-topbar .search { min-width: 0; }
    .top-actions { gap: 0; }
    .dialog-actions { flex-direction: column; }
  }
  @media (prefers-color-scheme: dark) {
    body.desktop-mode {
      --vscode-editor-background: #1c1c1e;
      --vscode-sideBar-background: #242426;
      --vscode-foreground: #f2f2f7;
      --vscode-descriptionForeground: #a1a1a6;
      --vscode-panel-border: rgba(235, 235, 245, .14);
      --vscode-list-hoverBackground: rgba(235, 235, 245, .08);
      --vscode-list-activeSelectionBackground: rgba(10, 132, 255, .22);
      --vscode-input-background: rgba(118, 118, 128, .18);
      background: #242426;
    }
    .project-sidebar { background: #242426; }
  }
`;

html = html
  .replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>\s*/,
    ""
  )
  .replace(
    '<link href="__WAYFINDER_CODICONS__" rel="stylesheet">',
    () => `<style>${codiconCss}</style>`
  )
  .replace(
    /(\s*<script nonce="[^"]+" src="__WAYFINDER_D3__"><\/script>)/,
    (match) => `${settingsDialog}</div></div>${match}`
  )
  .replace(
    /<script nonce="[^"]+" src="__WAYFINDER_D3__"><\/script>/,
    () => `<script>${d3}</script>`
  )
  .replace(/<header class="topbar">[\s\S]*?<\/header>/, () => topbar)
  .replace(
    "const wayfinderApi = acquireVsCodeApi();",
    `const wayfinderApi = {
      postMessage(message) {
        const handler = globalThis.__WAYFINDER_DESKTOP_HANDLE_MESSAGE__;
        if (handler) {
          handler(message);
        } else {
          (globalThis.__WAYFINDER_DESKTOP_MESSAGE_QUEUE__ ||= []).push(message);
        }
      }
    };`
  )
  .replace(
    "</head>",
    () => `<style>${desktopStyles}</style>
  <script>globalThis.__WAYFINDER_DESKTOP__ = true;</script>
</head>`
  )
  .replace("<body>", () => `<body class="desktop-mode">${desktopOpen}`)
  .replace("</body>", () => `<script>${bundle}</script>\n</body>`);

fs.writeFileSync(path.join(output, "index.html"), html);
process.stdout.write(`Built ${path.join(output, "index.html")}\n`);
