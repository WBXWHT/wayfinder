const fs = require("node:fs");
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

const header = `<header class="desktop-header">
  <div class="desktop-brand">
    <span class="desktop-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M4 5.5 7.2 18 12 9.3 16.8 18 20 5.5"/>
        <path class="mark-branch" d="M12 9.3 17.5 6.8"/>
        <circle cx="12" cy="9.3" r="1.5"/>
      </svg>
    </span>
    <div>
      <strong id="title">Wayfinder</strong>
      <span id="connectionStatus">本地航迹</span>
    </div>
  </div>
  <label class="project-picker">
    <span>项目</span>
    <select id="projectPicker" aria-label="选择项目"></select>
  </label>
  <nav aria-label="航海图切换与连接">
    <button id="previous" title="上一张航海图" aria-label="上一张航海图">‹</button>
    <span id="treeCount"></span>
    <button id="next" title="下一张航海图" aria-label="下一张航海图">›</button>
    <button id="refresh" title="刷新航海图" aria-label="刷新航海图">↻</button>
    <button class="connect-button" data-connect-host="codex">
      <span class="host-dot"></span><span class="host-label">Codex</span>
    </button>
    <button class="connect-button" data-connect-host="claude">
      <span class="host-dot"></span><span class="host-label">Claude Code</span>
    </button>
    <button id="settings" title="数据管理" aria-label="数据管理">···</button>
    <button id="expand" hidden aria-hidden="true"></button>
  </nav>
</header>`;

const settingsDialog = `<dialog id="settingsDialog" aria-labelledby="settingsTitle">
  <div class="dialog-head">
    <div><h2 id="settingsTitle">本地数据</h2><span>~/.wayfinder</span></div>
    <button id="closeSettings" aria-label="关闭">×</button>
  </div>
  <p>完整会话、快照和航海图保存在本机。归档会把当前项目移出列表，但不会立即删除文件。</p>
  <div class="dialog-actions">
    <button id="checkUpdates">检查更新</button>
    <button id="openData">打开数据目录</button>
    <button id="archiveProject" class="danger-action">归档当前项目</button>
  </div>
</dialog>`;

const desktopStyles = `
  header.desktop-header {
    height: 60px;
    gap: 16px;
    padding: 0 14px;
    border-bottom-color: var(--line);
    background: rgba(255, 255, 255, .94);
    backdrop-filter: blur(18px);
  }
  .desktop-brand {
    display: flex;
    min-width: 180px;
    align-items: center;
    gap: 10px;
  }
  .desktop-brand > div { display: grid; gap: 2px; }
  .desktop-brand #title { max-width: 270px; }
  .desktop-brand #connectionStatus {
    max-width: 270px;
    overflow: hidden;
    color: var(--muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desktop-mark {
    display: grid;
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    place-items: center;
    border-radius: 8px;
    background: #16181b;
  }
  .desktop-mark svg { width: 22px; height: 22px; overflow: visible; }
  .desktop-mark path {
    fill: none;
    stroke: #f7f8fa;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .desktop-mark .mark-branch { stroke: #35a7c9; stroke-width: 1.8; }
  .desktop-mark circle {
    fill: #35a7c9;
    stroke: #16181b;
    stroke-width: 1;
  }
  .project-picker {
    display: grid;
    min-width: 0;
    flex: 1;
    grid-template-columns: auto minmax(160px, 330px);
    gap: 8px;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 11px;
  }
  .project-picker select {
    width: 100%;
    height: 30px;
    padding: 0 28px 0 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--ink);
    background: var(--background);
    font: inherit;
  }
  .desktop-header nav { gap: 3px; }
  .desktop-header .connect-button {
    display: inline-flex;
    width: auto;
    min-width: 66px;
    padding: 0 9px;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--line);
    color: var(--ink);
    background: var(--background);
    font-size: 10px;
  }
  .desktop-header .connect-button:hover { background: #eef0f3; }
  .host-dot {
    width: 6px;
    height: 6px;
    min-width: 6px;
    flex: 0 0 6px;
    border-radius: 50%;
    background: #a7adb5;
  }
  .connect-button[data-connected="true"] .host-dot {
    background: var(--success);
    box-shadow: 0 0 0 3px rgba(47, 143, 101, .14);
  }
  .connect-button[data-configured="true"] .host-dot {
    background: var(--route-3);
    box-shadow: 0 0 0 3px rgba(180, 122, 35, .14);
  }
  .desktop-header button:disabled { cursor: default; opacity: .5; }
  .desktop-header + #map { height: calc(100vh - 60px); }
  dialog {
    width: min(420px, calc(100% - 36px));
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--ink);
    background: var(--surface);
    box-shadow: 0 24px 80px rgba(24, 26, 29, .22);
  }
  dialog::backdrop { background: rgba(20, 22, 25, .28); }
  .dialog-head {
    display: flex;
    min-height: 56px;
    padding: 0 14px 0 18px;
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
    width: auto;
    min-width: 100px;
    padding: 0 10px;
    border: 1px solid var(--line);
    font-size: 10px;
  }
  .dialog-actions .danger-action { color: var(--danger); }
  @media (max-width: 760px) {
    header.desktop-header {
      display: grid;
      height: 96px;
      padding: 4px 8px;
      grid-template-columns: minmax(0, 1fr) minmax(120px, 176px);
      grid-template-rows: 44px 44px;
      gap: 0 8px;
    }
    .desktop-brand {
      min-width: 0;
      grid-column: 1;
      grid-row: 1;
    }
    .desktop-brand #connectionStatus { display: none; }
    .project-picker {
      width: 100%;
      grid-column: 2;
      grid-row: 1;
      grid-template-columns: minmax(0, 1fr);
    }
    .project-picker > span { display: none; }
    .desktop-header nav {
      grid-column: 1 / -1;
      grid-row: 2;
      justify-self: center;
    }
    .desktop-header .connect-button { min-width: 30px; padding: 0 7px; }
    .desktop-header .host-label { display: none; }
    .desktop-header + #map { height: calc(100vh - 96px); }
    .dialog-actions {
      flex-direction: column;
      align-items: stretch;
    }
    .dialog-actions button {
      width: 100%;
      min-width: 0;
    }
  }
  @media (prefers-color-scheme: dark) {
    header.desktop-header { background: rgba(32, 35, 40, .94); }
    .desktop-header .connect-button:hover { background: #2a2e34; }
  }
`;

const template = fs.readFileSync(
  path.join(root, "mcp", "wayfinder-app.template.html"),
  "utf8"
);
const appStyles = fs.readFileSync(
  path.join(root, "mcp", "wayfinder-app.css"),
  "utf8"
);
const html = template
  .replace(/<header>[\s\S]*?<\/header>/, header)
  .replace("</main>", `${settingsDialog}\n</main>`)
  .replace(
    "/* WAYFINDER_STYLES */",
    () => `${appStyles}\n${desktopStyles}`
  )
  .replace("/* WAYFINDER_APP */", () => bundle);
fs.writeFileSync(path.join(output, "index.html"), html);
process.stdout.write(`Built ${path.join(output, "index.html")}\n`);
