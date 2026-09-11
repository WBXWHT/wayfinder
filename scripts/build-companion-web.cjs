const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const esbuild = require("esbuild");
const lockfile = require("proper-lockfile");

const root = path.resolve(__dirname, "..");
const companionRoot = path.join(root, "companion");
const finalOutput = path.join(companionRoot, "dist");
const output = path.join(
  companionRoot,
  `.dist-${process.pid}-${Date.now()}.tmp`
);
const backupOutput = path.join(companionRoot, ".dist-previous");

async function exists(target) {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

async function build() {
  const releaseBuildLock = await lockfile.lock(companionRoot, {
    realpath: false,
    lockfilePath: path.join(companionRoot, ".dist-build.lock"),
    stale: 60_000,
    update: 20_000,
    retries: {
      retries: 600,
      factor: 1,
      minTimeout: 50,
      maxTimeout: 50
    }
  });
  try {
    if (!(await exists(finalOutput)) && await exists(backupOutput)) {
      await fs.promises.rename(backupOutput, finalOutput);
    } else if (await exists(backupOutput)) {
      await fs.promises.rm(backupOutput, { recursive: true, force: true });
    }
    await fs.promises.rm(output, { recursive: true, force: true });
    await fs.promises.mkdir(output, { recursive: true });

  const bundle = (await esbuild.build({
  entryPoints: [path.join(root, "companion", "main.js")],
  bundle: true,
  platform: "browser",
  target: "safari15",
  format: "iife",
  write: false
  })).outputFiles[0].text;

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
const d3 = await fs.promises.readFile(
  path.join(root, "media", "d3.min.js"),
  "utf8"
);
const codiconCss = (await fs.promises.readFile(
  path.join(
    root,
    "node_modules",
    "@vscode",
    "codicons",
    "dist",
    "codicon.css"
  ),
  "utf8"
)).replace(/\.\/codicon\.ttf\?[^")]+/g, "./codicon.ttf");
await fs.promises.copyFile(
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
await fs.promises.copyFile(
  path.join(root, "companion", "src-tauri", "icons", "icon.png"),
  path.join(output, "wayfinder-icon.png")
);

const topbar = `<header class="topbar desktop-topbar">
  <div class="brand workspace-context">
    <button id="toggleProjects" class="icon-button project-toggle"
      title="切换项目" aria-label="切换项目"
      aria-controls="projectSidebar" aria-expanded="false">
      <span class="codicon codicon-list-tree"></span>
    </button>
    <div class="brand-copy">
      <div id="currentProjectLabel" class="brand-title">航海图</div>
      <div id="projectMeta" class="brand-meta">选择一个项目</div>
    </div>
  </div>
</header>`;

const desktopOpen = `<div class="desktop-shell">
  <aside id="projectSidebar" class="project-sidebar" aria-label="项目列表">
    <div class="sidebar-brand">
      <img class="brand-logo" src="./wayfinder-icon.png" alt="">
      <strong>Wayfinder</strong>
      <button id="closeProjects" class="icon-button sidebar-close"
        title="关闭项目列表" aria-label="关闭项目列表">
        <span class="codicon codicon-close"></span>
      </button>
    </div>
    <div class="sidebar-heading">项目</div>
    <nav id="projectList" class="project-list"></nav>
    <div class="project-footer">
      <span id="projectSummary" class="project-summary"></span>
      <button id="openData" class="local-data-button" type="button"
        title="打开 Wayfinder 本地数据目录">
        <span class="codicon codicon-database" aria-hidden="true"></span>
        <span>本地数据</span>
      </button>
    </div>
  </aside>
  <div class="desktop-main">`;

const desktopUtilities = `<button id="sidebarScrim" class="sidebar-scrim" tabindex="-1"
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
    grid-template-rows: 56px 32px minmax(0, 1fr) 46px;
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
  .brand-logo {
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
    border-radius: 7px;
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
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 9px;
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
  .project-item[aria-current="true"] {
    background: color-mix(
      in srgb,
      var(--project-accent) 13%,
      transparent
    );
  }
  .project-icon {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    color: var(--project-accent);
    background: transparent;
  }
  .project-folder-route {
    width: 21px;
    height: 21px;
    overflow: visible;
    filter: drop-shadow(0 1px 0 rgba(255, 255, 255, .82));
  }
  .project-item[aria-current="true"] .project-icon {
    color: var(--project-accent);
  }
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
    overflow: hidden;
    margin-top: 2px;
    color: var(--muted);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project-empty {
    padding: 18px 10px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.55;
  }
  .project-footer {
    display: flex;
    min-width: 0;
    padding: 0 8px 0 14px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-top: 1px solid var(--line);
  }
  .project-summary {
    overflow: hidden;
    color: var(--muted);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .local-data-button {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 9px;
    border: 0;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;
    font: inherit;
    font-size: 9px;
    font-weight: 600;
    cursor: pointer;
  }
  .local-data-button:hover {
    color: var(--text);
    background: var(--hover);
  }
  .desktop-topbar {
    justify-content: flex-start;
  }
  .project-toggle { display: none; flex: 0 0 30px; }
  .desktop-topbar .brand-mark { display: none; }
  .sidebar-scrim { display: none; }
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
      gap: 6px;
      padding: 0 8px;
    }
    .workspace-context { min-width: 30px; }
    .desktop-topbar .workspace-context { display: flex; }
    .workspace-context .brand-copy { display: none; }
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
    (match) => `${desktopUtilities}</div></div>${match}`
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

  await fs.promises.writeFile(path.join(output, "index.html"), html);
  if (await exists(finalOutput)) {
    await fs.promises.rename(finalOutput, backupOutput);
  }
  try {
    await fs.promises.rename(output, finalOutput);
  } catch (error) {
    if (!(await exists(finalOutput)) && await exists(backupOutput)) {
      await fs.promises.rename(backupOutput, finalOutput);
    }
    throw error;
  }
  await fs.promises.rm(backupOutput, { recursive: true, force: true });
  process.stdout.write(`Built ${path.join(finalOutput, "index.html")}\n`);
  } finally {
    await fs.promises.rm(output, { recursive: true, force: true });
    await releaseBuildLock();
  }
}

void build().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
