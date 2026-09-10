import * as path from "path";
import * as vscode from "vscode";
import { buildConversationForest } from "./conversationForest";
import { UserVerdict } from "./models";
import { readProjectState } from "./storage";

export interface ExperienceMapHandlers {
  setVerdict(nodeId: string, verdict?: UserVerdict): Promise<void>;
  setNote(nodeId: string): Promise<void>;
  openDiff(nodeId: string): Promise<void>;
  restore(nodeId: string): Promise<void>;
}

export class ExperienceMapPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private focusTreeId?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly root: string,
    private readonly handlers: ExperienceMapHandlers
  ) {}

  show(treeId?: string): void {
    this.focusTreeId = treeId;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      void this.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "wayfinder.experienceMap",
      "Wayfinder 航海图",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          this.extensionUri,
          vscode.Uri.joinPath(this.extensionUri, "media"),
          vscode.Uri.joinPath(this.extensionUri, "node_modules")
        ]
      }
    );
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    let operationInFlight = false;
    panel.webview.onDidReceiveMessage(async (message: any) => {
      const isOperation = message?.type !== "ready";
      if (isOperation && operationInFlight) {
        return;
      }
      if (isOperation) {
        operationInFlight = true;
        await panel.webview.postMessage({ type: "operation", status: "busy" });
      }
      let failed = false;
      try {
        switch (message?.type) {
          case "ready":
            await this.refresh();
            break;
          case "verdict":
            await this.handlers.setVerdict(message.nodeId, message.verdict);
            await this.refresh();
            break;
          case "note":
            await this.handlers.setNote(message.nodeId);
            await this.refresh();
            break;
          case "diff":
            await this.handlers.openDiff(message.nodeId);
            break;
          case "restore":
            await this.handlers.restore(message.nodeId);
            await this.refresh();
            break;
          default:
            break;
        }
      } catch (error) {
        failed = true;
        const detail = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Wayfinder 操作失败：${detail}`);
        await panel.webview.postMessage({
          type: "operation",
          status: "error",
          message: "操作失败，请查看通知"
        });
      } finally {
        if (isOperation) {
          operationInFlight = false;
          if (!failed) {
            await panel.webview.postMessage({
              type: "operation",
              status: "idle"
            });
          }
        }
      }
    });
  }

  async refresh(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const state = await readProjectState(this.root);
    if (!state) {
      return;
    }
    const focusTreeId = this.focusTreeId;
    this.focusTreeId = undefined;
    await this.panel.webview.postMessage({
      type: "render",
      projectName: path.basename(this.root),
      focusTreeId,
      state,
      forest: buildConversationForest(state)
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const d3 = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "d3.min.js")
    );
    const codicons = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "node_modules",
        "@vscode",
        "codicons",
        "dist",
        "codicon.css"
      )
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`
    ].join("; ");

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${codicons}" rel="stylesheet">
  <style>
    :root {
      color-scheme: light dark;
      --accent: var(--vscode-textLink-foreground, #0a66c2);
      --good: var(--vscode-testing-iconPassed, #2f9e62);
      --bad: var(--vscode-testing-iconFailed, #d84a4a);
      --muted: var(--vscode-descriptionForeground, #777);
      --line: var(--vscode-panel-border, rgba(128,128,128,.24));
      --surface: var(--vscode-editor-background, #fff);
      --surface-2: var(--vscode-sideBar-background, #f7f7f8);
      --hover: var(--vscode-list-hoverBackground, rgba(128,128,128,.08));
      --selected: var(--vscode-list-activeSelectionBackground, rgba(0,122,255,.12));
      --text: var(--vscode-foreground, #1d1d1f);
      --ocean: #e9f7fb;
      --ocean-line: #8bd2e3;
      --route: #2f9fbd;
      --route-dark: #176f89;
      --route-trunk: #2f9fbd;
      --route-blue: #4d9ff8;
      --route-violet: #8c72db;
      --route-gold: #d79b32;
      --wake: #ffffff;
      --sand: #f4d28a;
      --shore: #b98236;
      --sun: #f3bd4f;
      --coral: #ee7469;
      --paper: #fffdf7;
      --ink: #254852;
      --sticker-muted: #647980;
      --sticker-shadow: rgba(25, 92, 108, .24);
      --port-roof: #b98236;
    }
    * { box-sizing: border-box; }
    html {
      width: 100%;
      max-width: 100%;
      overflow: hidden;
    }
    body {
      width: 100%;
      max-width: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--text);
      background: var(--surface);
      font-family: var(--vscode-font-family);
      letter-spacing: 0;
    }
    body.busy button { pointer-events: none; opacity: .55; }
    button, input { color: inherit; font: inherit; letter-spacing: 0; }
    .app {
      display: grid;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      height: 100vh;
      grid-template-rows: 52px minmax(0, 1fr);
    }
    .topbar {
      display: grid;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      grid-template-columns:
        minmax(0, 220px)
        minmax(0, 520px)
        minmax(30px, 1fr);
      gap: 18px;
      align-items: center;
      padding: 0 18px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }
    .brand { display: flex; min-width: 0; align-items: center; gap: 9px; }
    .brand-mark {
      display: grid;
      width: 24px;
      height: 24px;
      flex: 0 0 24px;
      place-items: center;
      border-radius: 50%;
      color: var(--route-dark);
      background: color-mix(in srgb, var(--sun) 30%, var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sun) 62%, transparent);
    }
    .brand-mark .codicon { font-size: 14px; }
    .brand-copy { min-width: 0; }
    .brand-title { font-size: 13px; font-weight: 650; }
    .brand-meta { overflow: hidden; margin-top: 1px; color: var(--muted); font-size: 10px; white-space: nowrap; }
    .search { display: flex; min-width: 0; height: 32px; overflow: hidden; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 6px; color: var(--muted); background: var(--vscode-input-background, var(--surface-2)); }
    .search:focus-within { border-color: var(--accent); color: var(--text); }
    .search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; color: var(--vscode-input-foreground, var(--text)); background: transparent; font-size: 11px; }
    .top-actions { display: flex; justify-content: flex-end; gap: 4px; }
    .icon-button { display: inline-grid; width: 30px; height: 30px; padding: 0; place-items: center; border: 0; border-radius: 5px; color: var(--muted); background: transparent; cursor: pointer; }
    .icon-button:hover { color: var(--text); background: var(--hover); }
    .icon-button.active-good { color: var(--good); }
    .icon-button.active-bad { color: var(--bad); }
    .layout {
      position: relative;
      display: grid;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      min-height: 0;
      grid-template-columns: minmax(0, 1fr);
    }
    .canvas-shell { position: relative; min-width: 0; min-height: 0; overflow: hidden; contain: layout paint; background: var(--ocean); }
    .canvas-head {
      position: absolute;
      top: 12px;
      left: 50%;
      z-index: 3;
      display: grid;
      min-width: min(390px, calc(100% - 28px));
      grid-template-columns: 32px minmax(0, 1fr) 32px;
      gap: 10px;
      align-items: center;
      transform: translateX(-50%);
    }
    .canvas-page-copy { min-width: 0; text-align: center; }
    .canvas-head.single-voyage {
      grid-template-columns: minmax(0, 1fr);
    }
    .canvas-head.single-voyage .project-pager-button { display: none; }
    .canvas-title {
      display: block;
      color: var(--ink);
      font-size: 13px;
      font-weight: 750;
      line-height: 17px;
    }
    .canvas-meta { display: block; margin-top: 2px; color: var(--sticker-muted); font-size: 9px; }
    .project-pager-button {
      display: grid;
      width: 32px;
      height: 32px;
      padding: 0;
      place-items: center;
      border: 2px solid white;
      border-radius: 50%;
      color: var(--ink);
      background: var(--paper);
      box-shadow: 2px 3px 0 var(--sticker-shadow);
      cursor: pointer;
      transition: transform 130ms ease, box-shadow 130ms ease;
    }
    .project-pager-button:not(:disabled):hover { transform: translateY(-1px) rotate(-2deg); box-shadow: 3px 4px 0 var(--sticker-shadow); }
    .project-pager-button:disabled { opacity: .3; box-shadow: none; cursor: default; }
    .project-pager-button:focus-visible { outline: 2px solid var(--vscode-focusBorder, var(--accent)); outline-offset: 2px; }
    .canvas-page-label {
      min-width: 0;
      padding: 7px 14px;
      border: 2px solid white;
      border-radius: 9px;
      background: var(--paper);
      box-shadow: 2px 3px 0 var(--sticker-shadow);
    }
    #graph {
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      cursor: default;
      touch-action: none;
      user-select: none;
    }
    .forest-path-bed,
    .forest-edge {
      fill: none;
      stroke-linecap: round;
    }
    .forest-path-bed {
      stroke: color-mix(in srgb, var(--wake) 88%, var(--ocean));
      stroke-width: 25;
      filter: drop-shadow(2px 3px 0 var(--sticker-shadow));
    }
    .forest-path-bed.main {
      stroke-width: 26;
    }
    .forest-edge {
      stroke: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 42%,
        var(--ocean)
      );
      stroke-width: 19;
      opacity: 1;
      animation: channel-reveal 260ms ease-out both;
    }
    .forest-edge.main {
      stroke-width: 20;
    }
    .forest-edge.route-trunk,
    .session-node.route-trunk {
      --route-accent: var(--route-trunk);
    }
    .forest-edge.route-0,
    .forest-edge.route-3,
    .session-node.route-0,
    .session-node.route-3,
    .session-card.route-0,
    .session-card.route-3 {
      --route-accent: var(--route-blue);
    }
    .forest-edge.route-1,
    .forest-edge.route-4,
    .session-node.route-1,
    .session-node.route-4,
    .session-card.route-1,
    .session-card.route-4 {
      --route-accent: var(--route-violet);
    }
    .forest-edge.route-2,
    .forest-edge.route-5,
    .session-node.route-2,
    .session-node.route-5,
    .session-card.route-2,
    .session-card.route-5 {
      --route-accent: var(--route-gold);
    }
    .forest-edge.good {
      stroke: color-mix(in srgb, var(--good) 58%, var(--ocean));
      stroke-width: 20;
    }
    .forest-edge.bad {
      stroke: color-mix(in srgb, var(--coral) 62%, var(--ocean));
      stroke-width: 19;
      stroke-dasharray: none;
    }
    .channel-decoration {
      pointer-events: none;
      filter: drop-shadow(1px 1px 0 var(--sticker-shadow));
    }
    .channel-decoration.dimmed { opacity: .12; }
    .channel-decoration path {
      fill: none;
      stroke: white;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .channel-decoration circle {
      fill: white;
      stroke: color-mix(in srgb, var(--route-dark) 60%, transparent);
      stroke-width: .9;
    }
    .forest-path-bed.dimmed,
    .forest-edge.dimmed { opacity: .12; }
    .forest-node,
    .forest-card { transition: opacity 150ms ease; }
    .forest-node { pointer-events: none; }
    .forest-card { cursor: pointer; outline: 0; }
    .forest-node.dimmed,
    .forest-card.dimmed { opacity: .18; }
    .node-card-shadow {
      fill: var(--sticker-shadow);
    }
    .node-card-bg {
      fill: color-mix(in srgb, var(--paper) 96%, transparent);
      stroke: white;
      stroke-width: 2;
      transition: fill 130ms ease, stroke 130ms ease;
    }
    .node-card-accent {
      fill: color-mix(
        in srgb,
        var(--node-accent, var(--route-accent, var(--route))) 78%,
        white
      );
      stroke: white;
      stroke-width: 1;
    }
    .session-card.good { --node-accent: var(--good); }
    .session-card.bad { --node-accent: var(--coral); }
    .session-card:hover .node-card-bg { fill: var(--paper); }
    .session-card.selected .node-card-bg {
      fill: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 12%,
        var(--paper)
      );
      stroke: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 46%,
        white
      );
    }
    .forest-card:focus-visible .node-card-bg {
      stroke: var(--vscode-focusBorder, var(--accent));
      stroke-width: 3;
    }
    .node-title {
      fill: var(--ink);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      font-weight: 700;
      pointer-events: none;
    }
    .node-summary {
      fill: var(--sticker-muted);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      font-weight: 500;
      pointer-events: none;
    }
    .node-card-meta {
      fill: color-mix(in srgb, var(--sticker-muted) 84%, transparent);
      font-family: var(--vscode-font-family);
      font-size: 11.5px;
      font-weight: 600;
      pointer-events: none;
    }
    .journey-disc {
      fill: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 22%,
        var(--surface)
      );
      stroke: var(--route-accent, var(--route));
      stroke-width: 2.5;
    }
    .journey-sticker-shadow { fill: var(--sticker-shadow); }
    .journey-sticker-outline { fill: white; }
    .session-node.good .journey-disc { fill: var(--good); stroke: color-mix(in srgb, var(--good) 72%, black); }
    .session-node.bad .journey-disc { fill: var(--coral); stroke: color-mix(in srgb, var(--coral) 72%, black); }
    .journey-status { fill: color-mix(in srgb, var(--muted) 68%, var(--surface)); }
    .session-node.good .journey-status,
    .session-node.bad .journey-status {
      fill: none;
      stroke: white;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .journey-current-ring {
      fill: none;
      stroke: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 66%,
        var(--ink)
      );
      stroke-width: 2;
      animation: bud-breathe 1.8s ease-in-out infinite;
    }
    .journey-selected-ring {
      fill: none;
      stroke: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 38%,
        transparent
      );
      stroke-width: 6;
    }
    .ocean-current { fill: none; stroke: color-mix(in srgb, var(--ocean-line) 58%, transparent); stroke-width: 1.2; stroke-dasharray: 4 11; stroke-linecap: round; }
    .shore-fill { fill: var(--sand); opacity: .94; }
    .shore-line { fill: none; stroke: white; stroke-width: 7; filter: drop-shadow(2px 3px 0 var(--sticker-shadow)); }
    .shore-ink { fill: none; stroke: var(--shore); stroke-width: 1.5; }
    .trail-start-pole { fill: none; stroke: var(--shore); stroke-width: 2; stroke-linecap: round; }
    .trail-start-flag { fill: var(--sun); stroke: color-mix(in srgb, var(--sun) 65%, var(--shore)); stroke-width: 1.2; stroke-linejoin: round; }
    .sailboat { filter: drop-shadow(2px 3px 0 var(--sticker-shadow)); animation: boat-bob 1.9s ease-in-out infinite; }
    .sailboat-mast { stroke: var(--route-dark); stroke-width: 1.5; stroke-linecap: round; }
    .sailboat-sail { fill: color-mix(in srgb, var(--sun) 82%, white); stroke: var(--shore); stroke-width: 1; stroke-linejoin: round; }
    .sailboat-hull { fill: var(--route-accent, var(--route)); stroke: var(--route-dark); stroke-width: 1.2; stroke-linejoin: round; }
    .session-node.good .sailboat-hull { fill: var(--good); }
    .session-node.bad .sailboat-hull { fill: var(--coral); }
    .sailboat-wake { fill: none; stroke: color-mix(in srgb, white 72%, var(--ocean-line)); stroke-width: 1.5; stroke-linecap: round; }
    .sailboat-sticker-outline { fill: none; stroke: white; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
    .port-sticker { filter: drop-shadow(2px 3px 0 var(--sticker-shadow)); }
    .port-outline { fill: white; stroke: white; stroke-width: 6; stroke-linejoin: round; }
    .port-tower { fill: var(--paper); stroke: var(--ink); stroke-width: 1.4; }
    .port-roof { fill: var(--port-roof); stroke: var(--ink); stroke-width: 1.4; }
    .port-light { fill: var(--sun); stroke: var(--ink); stroke-width: 1.2; }
    .reef-sticker { filter: drop-shadow(2px 3px 0 var(--sticker-shadow)); }
    .reef-outline { fill: white; stroke: white; stroke-width: 6; stroke-linejoin: round; }
    .reef-rock { fill: var(--coral); stroke: var(--ink); stroke-width: 1.4; stroke-linejoin: round; }
    .reef-cross { fill: none; stroke: white; stroke-width: 2; stroke-linecap: round; }
    .current-status-badge { stroke: white; stroke-width: 1; }
    .session-node.good .current-status-badge { fill: var(--good); }
    .session-node.bad .current-status-badge { fill: var(--coral); }
    .tree-card { pointer-events: none; }
    .tree-card .node-card-bg { fill: var(--paper); }
    .tree-node-title {
      fill: var(--ink);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      font-weight: 700;
      text-anchor: middle;
    }
    .tree-node-meta {
      fill: var(--sticker-muted);
      font-family: var(--vscode-font-family);
      font-size: 9px;
      text-anchor: middle;
    }
    .inspector { position: absolute; z-index: 5; top: 0; right: 0; bottom: 0; display: none; width: min(350px, 42vw); overflow: auto; padding: 18px; border-left: 1px solid var(--line); background: var(--surface-2); box-shadow: -8px 0 22px color-mix(in srgb, var(--text) 8%, transparent); animation: inspector-in 150ms ease-out; }
    .inspector.open { display: block; }
    .inspector-close { float: right; margin: -6px -6px 3px 8px; }
    .inspector-empty { display: grid; min-height: 100%; place-content: center; color: var(--muted); text-align: center; font-size: 11px; line-height: 1.6; }
    .detail-kicker { color: var(--accent); font-size: 10px; font-weight: 650; }
    .detail-title { margin: 7px 0 13px; font-size: 14px; font-weight: 650; line-height: 1.45; }
    .detail-session-meta { margin-bottom: 12px; color: var(--muted); font-size: 10px; }
    .detail-turn { padding: 10px 0; border-top: 1px solid var(--line); }
    .detail-turn-head { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; gap: 7px; align-items: start; }
    .detail-turn-dot { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--muted); opacity: .65; }
    .detail-turn.good .detail-turn-dot { background: var(--good); opacity: 1; }
    .detail-turn.bad .detail-turn-dot { background: var(--bad); opacity: 1; }
    .detail-turn-title { font-size: 11px; font-weight: 600; line-height: 1.45; }
    .detail-turn-time { color: var(--muted); font-size: 9px; white-space: nowrap; }
    .detail-source { margin: 6px 0 0 14px; color: var(--muted); font-size: 9px; }
    .detail-text { margin: 7px 0 0 14px; overflow-wrap: anywhere; color: var(--muted); font-size: 10px; line-height: 1.55; white-space: pre-wrap; }
    .detail-note { margin: 8px 0 0 14px; padding-left: 8px; border-left: 2px solid var(--accent); font-size: 10px; line-height: 1.5; }
    .detail-files { display: grid; gap: 4px; margin: 8px 0 0 14px; }
    .detail-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; color: var(--muted); font-size: 9px; }
    .detail-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-file-count { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .detail-file-add { color: var(--good); }
    .detail-file-delete { color: var(--bad); }
    .detail-actions { display: flex; justify-content: flex-end; gap: 2px; margin-top: 7px; }
    @keyframes inspector-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes channel-reveal { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bud-breathe {
      0%, 100% { opacity: .8; r: 16px; }
      50% { opacity: .18; r: 21px; }
    }
    @keyframes boat-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-1.5px); }
    }
    .empty-graph { display: grid; min-height: 100%; place-content: center; color: var(--muted); font-size: 11px; }
    @media (max-width: 860px) {
      .topbar { grid-template-columns: 170px 1fr auto; gap: 10px; padding: 0 12px; }
      .inspector { width: min(330px, 68vw); }
    }
    @media (max-width: 520px) {
      .topbar { grid-template-columns: minmax(0, 1fr) auto; }
      .brand { display: none; }
      .inspector { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
    body.vscode-dark {
      --ocean: #173f4c;
      --ocean-line: #4c91a3;
      --wake: #d8f3f8;
      --sticker-shadow: rgba(0, 0, 0, .36);
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><span class="codicon codicon-compass"></span></span>
        <div class="brand-copy">
          <div class="brand-title">Wayfinder</div>
          <div id="projectMeta" class="brand-meta">航海图</div>
        </div>
      </div>
      <label class="search" title="搜索航点、对话或文件">
        <span class="codicon codicon-search" aria-hidden="true"></span>
        <input id="search" type="search" placeholder="搜索航点、对话或文件" aria-label="搜索航点、对话或文件">
      </label>
      <div class="top-actions">
        <button id="fit" class="icon-button" title="回到默认视图" aria-label="回到默认视图"><span class="codicon codicon-target"></span></button>
      </div>
    </header>
    <div class="layout">
      <main class="canvas-shell">
        <nav class="canvas-head" aria-label="切换项目航海图">
          <button id="projectPrevious" class="project-pager-button" type="button"><span class="codicon codicon-chevron-left"></span></button>
          <div class="canvas-page-label">
            <span id="canvasTitle" class="canvas-title" tabindex="-1"></span>
            <span id="canvasMeta" class="canvas-meta"></span>
          </div>
          <button id="projectNext" class="project-pager-button" type="button"><span class="codicon codicon-chevron-right"></span></button>
        </nav>
        <svg id="graph" role="application" aria-label="Wayfinder 航海图"></svg>
      </main>
      <aside id="inspector" class="inspector" aria-label="航点详情">
        <div class="inspector-empty">选择一个航点<br>查看按时间排列的全部对话</div>
      </aside>
    </div>
  </div>
  <script nonce="${nonce}" src="${d3}"></script>
  <script nonce="${nonce}">
    const wayfinderApi = acquireVsCodeApi();
    const graph = d3.select('#graph');
    const inspector = document.getElementById('inspector');
    const searchInput = document.getElementById('search');
    const canvasTitle = document.getElementById('canvasTitle');
    const canvasMeta = document.getElementById('canvasMeta');
    const projectPrevious = document.getElementById('projectPrevious');
    const projectNext = document.getElementById('projectNext');
    let state;
    let forest;
    let projectName = '';
    let activeTreeId = '';
    let selectedSessionId = '';
    let lastFocusedSessionId = '';
    let graphLayer;
    let zoomBehavior;
    let fitAllRequested = false;
    let composingSearch = false;
    let viewportSignature = '';
    let wheelFrame = 0;
    let pendingPanX = 0;
    let pendingPanY = 0;
    let pendingScale = 1;
    let pendingZoomPoint = null;
    let graphBounds = null;
    let viewportTabTimer = 0;
    let currentNodeById = new Map();
    const nodeCardWidth = 240;
    const nodeCardHeight = 120;
    const nodeCardTop = 24;
    const nodeVerticalPitch = 216;
    const nodeHorizontalPitch = 324;
    const mapStartX = 184;
    const mapTopInset = 112;
    const minimumReadableScale = .86;

    function normalizedWheelDelta(value, deltaMode, pageSize) {
      if (!Number.isFinite(value)) return 0;
      const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageSize : 1;
      return Math.max(-160, Math.min(160, value * unit));
    }

    function scheduleViewportFrame() {
      if (wheelFrame) return;
      wheelFrame = requestAnimationFrame(flushViewportFrame);
    }

    function scheduleVisibleCardTabStops() {
      clearTimeout(viewportTabTimer);
      viewportTabTimer = setTimeout(() => {
        if (!graphLayer) return;
        const viewport = graph.node().getBoundingClientRect();
        const query = searchInput.value.trim().toLocaleLowerCase('zh-CN');
        graphLayer.selectAll('.session-card').attr(
          'tabindex',
          function({ tree, node }) {
            if (!node.data.session) return -1;
            const matches =
              !query ||
              tree.title.toLocaleLowerCase('zh-CN').includes(query) ||
              sessionMatches(node.data.session, currentNodeById, query);
            if (!matches) return -1;
            const rect = this.getBoundingClientRect();
            const visible =
              rect.right > viewport.left &&
              rect.left < viewport.right &&
              rect.bottom > viewport.top &&
              rect.top < viewport.bottom;
            return visible ? 0 : -1;
          }
        );
      }, 140);
    }

    function flushViewportFrame() {
      wheelFrame = 0;
      if (!zoomBehavior || !graphLayer) return;
      const current = d3.zoomTransform(graph.node());
      let nextX = current.x;
      let nextY = current.y;
      let nextScale = current.k;
      const queuedPanX = pendingPanX;
      const queuedPanY = pendingPanY;
      const queuedScale = pendingScale;
      const framePanX = Math.max(-240, Math.min(240, queuedPanX));
      const framePanY = Math.max(-240, Math.min(240, queuedPanY));
      const frameScale = Math.max(.72, Math.min(1.4, queuedScale));
      const zoomPoint = pendingZoomPoint;
      pendingPanX -= framePanX;
      pendingPanY -= framePanY;
      pendingScale = queuedScale / frameScale;
      if (Math.abs(pendingScale - 1) < .0001) pendingScale = 1;
      pendingZoomPoint = null;

      if (frameScale !== 1 && zoomPoint) {
        nextScale = Math.max(.4, Math.min(3.2, current.k * frameScale));
        const ratio = nextScale / current.k;
        nextX = zoomPoint[0] - (zoomPoint[0] - current.x) * ratio;
        nextY = zoomPoint[1] - (zoomPoint[1] - current.y) * ratio;
        if (
          (nextScale === 3.2 && pendingScale > 1) ||
          (nextScale === .4 && pendingScale < 1)
        ) {
          pendingScale = 1;
        }
        if (pendingScale !== 1) pendingZoomPoint = zoomPoint;
      }
      nextX = Math.min(0, nextX - framePanX);
      nextY -= framePanY;
      if (nextX === 0 && framePanX < 0 && pendingPanX < 0) {
        pendingPanX = 0;
      }
      const next = d3.zoomIdentity
        .translate(nextX, nextY)
        .scale(nextScale);
      const changed =
        Math.abs(next.x - current.x) > .001 ||
        Math.abs(next.y - current.y) > .001 ||
        Math.abs(next.k - current.k) > .0001;
      if (changed) {
        graph.call(zoomBehavior.transform, next);
      }

      if (
        Math.abs(pendingPanX) > .001 ||
        Math.abs(pendingPanY) > .001 ||
        Math.abs(pendingScale - 1) > .0001
      ) {
        scheduleViewportFrame();
      }
    }

    function renderGraph() {
      const resumePendingWheel = Boolean(wheelFrame);
      if (wheelFrame) {
        cancelAnimationFrame(wheelFrame);
        wheelFrame = 0;
      }
      clearTimeout(viewportTabTimer);
      const previousTransform = d3.zoomTransform(graph.node());
      const query = searchInput.value.trim().toLocaleLowerCase('zh-CN');
      if (!forest.trees.some((tree) => tree.id === activeTreeId)) {
        activeTreeId = forest.trees[0]?.id || '';
      }
      const activeIndex = Math.max(
        0,
        forest.trees.findIndex((tree) => tree.id === activeTreeId)
      );
      const activeTree = forest.trees[activeIndex];
      document.querySelector('.canvas-head')?.classList.toggle(
        'single-voyage',
        forest.trees.length <= 1 || Boolean(query)
      );
      projectPrevious.disabled = activeIndex === 0;
      projectPrevious.title = projectPrevious.disabled
        ? '已经是第一条航程'
        : '上一条航程：' + forest.trees[activeIndex - 1].title;
      projectPrevious.setAttribute('aria-label', projectPrevious.title);
      projectNext.disabled =
        !activeTree || activeIndex === forest.trees.length - 1;
      projectNext.title = projectNext.disabled
        ? '已经是最后一条航程'
        : '下一条航程：' + forest.trees[activeIndex + 1].title;
      projectNext.setAttribute('aria-label', projectNext.title);
      const nextViewportSignature = activeTreeId + '|' + query;
      const preserveViewport =
        viewportSignature === nextViewportSignature && !fitAllRequested;
      graph.selectAll('*').remove();
      const viewportWidth = Math.max(
        1,
        document.getElementById('graph').clientWidth
      );
      const width = Math.max(420, viewportWidth);
      const height = Math.max(340, document.getElementById('graph').clientHeight);
      graphBounds = graph.node().getBoundingClientRect();
      const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
      currentNodeById = nodeById;
      const cardContentBySessionId = new Map();
      const contentForCard = (session) => {
        if (!cardContentBySessionId.has(session.id)) {
          cardContentBySessionId.set(
            session.id,
            cardContentFor(session, nodeById)
          );
        }
        return cardContentBySessionId.get(session.id);
      };
      const scopedTrees = query
        ? forest.trees
        : activeTree
          ? [activeTree]
          : [];
      const trees = query
        ? scopedTrees
            .map((tree) => filterTreeForQuery(tree, nodeById, query))
            .filter(Boolean)
        : scopedTrees;
      canvasTitle.textContent = query
        ? '搜索结果'
        : activeTree?.title || '航海图';
      canvasMeta.textContent = query
        ? trees.length +
          ' 条航程 · ' +
          forest.trees.reduce(
            (total, tree) =>
              total +
              (
                tree.title.toLocaleLowerCase('zh-CN').includes(query)
                  ? tree.sessions
                  : tree.sessions.filter((session) =>
                      sessionMatches(session, nodeById, query)
                    )
              ).length,
            0
          ) +
          ' 个航点'
        : activeTree
          ? '航程 ' +
          (activeIndex + 1) +
          ' / ' +
          forest.trees.length +
          ' · ' +
          activeTree.sessions.length +
          ' 个航点 · ' +
          activeTree.nodeCount +
          ' 轮'
          : '';
      if (trees.length === 0) {
        graph.append('text')
          .attr('class', 'node-meta')
          .attr('x', width / 2)
          .attr('y', height / 2)
          .attr('text-anchor', 'middle')
          .text(
            query
              ? '当前项目没有匹配的航点'
              : '当前项目还没有航点'
          );
        return;
      }

      const layouts = [];
      let offsetY = mapTopInset;
      let contentLeft = Infinity;
      let contentTop = Infinity;
      let contentRight = -Infinity;
      let contentBottom = -Infinity;
      for (const tree of trees) {
        const root = d3.hierarchy(hierarchyFor(tree));
        d3.tree()
          .nodeSize([nodeVerticalPitch, nodeHorizontalPitch])
          .separation(() => 1)(root);
        const minX = d3.min(root.descendants(), (node) => node.x) || 0;
        const maxX = d3.max(root.descendants(), (node) => node.x) || 0;
        const baseY = offsetY - minX;
        root.each((node) => {
          node.screenX = node.y + mapStartX;
          node.screenY = node.x + baseY;
          contentLeft = Math.min(
            contentLeft,
            node.screenX - nodeCardWidth / 2 - 5
          );
          contentTop = Math.min(contentTop, node.screenY - 24);
          contentRight = Math.max(
            contentRight,
            node.screenX + nodeCardWidth / 2 + 5
          );
          contentBottom = Math.max(
            contentBottom,
            node.screenY + nodeCardTop + nodeCardHeight + 5
          );
        });
        const mainPath = mainPathFor(tree);
        const current = currentSessionFor(tree);
        const routeIndexById = routeIndexesFor(tree);
        layouts.push({
          tree,
          root,
          mainPath,
          routeIndexById,
          currentId: current?.id || ''
        });
        offsetY += maxX - minX + nodeVerticalPitch + nodeCardHeight;
      }
      const contentBounds = {
        left: contentLeft,
        top: contentTop,
        right: contentRight,
        bottom: contentBottom
      };
      const worldWidth = Math.max(
        width / minimumReadableScale,
        contentRight + 140
      );
      const worldHeight = Math.max(
        height / minimumReadableScale,
        contentBottom + 100
      );
      const shoreOverscan = Math.max(worldHeight, height) * 1.6;
      const shoreTop = contentTop - shoreOverscan;
      const shoreBottom = contentBottom + shoreOverscan;
      const shore = coastlineGeometry(shoreTop, shoreBottom);

      graphLayer = graph.append('g');
      const terrain = graphLayer.append('g').attr('aria-hidden', 'true');
      terrain.append('path')
        .attr('class', 'shore-fill')
        .attr('d', shore.fill);
      terrain.append('path')
        .attr('class', 'shore-line')
        .attr('d', shore.line);
      terrain.append('path')
        .attr('class', 'shore-ink')
        .attr('d', shore.line);
      const port = terrain.append('g')
        .attr('class', 'port-sticker')
        .attr(
          'transform',
          'translate(58,' + (contentTop - 8) + ') scale(1.25)'
        );
      port.append('path')
        .attr('class', 'port-outline')
        .attr('d', 'M 2 21 L 4 9 L 7 6 L 7 2 L 12 2 L 12 6 L 15 9 L 17 21 Z');
      port.append('path')
        .attr('class', 'port-tower')
        .attr('d', 'M 3 20 L 5 9 L 14 9 L 16 20 Z');
      port.append('path')
        .attr('class', 'port-roof')
        .attr('d', 'M 4 9 L 9.5 4 L 15 9 Z');
      port.append('circle')
        .attr('class', 'port-light')
        .attr('cx', 9.5)
        .attr('cy', 10.5)
        .attr('r', 1.8);
      terrain.append('path')
        .attr('class', 'ocean-current')
        .attr(
          'd',
          'M 28 ' + (contentTop + 18) +
          ' C ' + (worldWidth * .28) + ' ' + (contentTop - 54) +
          ', ' + (worldWidth * .68) + ' ' + (contentTop + 62) +
          ', ' + (worldWidth - 30) + ' ' + (contentTop - 6)
        );
      terrain.append('path')
        .attr('class', 'ocean-current')
        .attr(
          'd',
          'M 24 ' + (contentBottom + 54) +
          ' C ' + (worldWidth * .34) + ' ' + (contentBottom + 118) +
          ', ' + (worldWidth * .7) + ' ' + (contentBottom + 8) +
          ', ' + (worldWidth - 25) + ' ' + (contentBottom + 72)
        );
      zoomBehavior = d3.zoom()
        .scaleExtent([.4, 3.2])
        .filter((event) => {
          if (event.type === 'mousedown') return false;
          if (event.type === 'touchstart') {
            return (event.touches?.length || 0) >= 2;
          }
          return true;
        })
        .translateExtent([
          [0, -Infinity],
          [Infinity, Infinity]
        ])
        .constrain((transform) => {
          const clampedX = Math.min(0, transform.x);
          return clampedX === transform.x
            ? transform
            : d3.zoomIdentity
                .translate(clampedX, transform.y)
                .scale(transform.k);
        })
        .on('zoom', (event) => {
          graphLayer.attr('transform', event.transform);
          scheduleVisibleCardTabStops();
        });
      graph
        .call(zoomBehavior)
        .on('dblclick.zoom', null)
        .on('wheel.zoom', null)
        .on(
          'wheel.wayfinder',
          (event) => {
            event.preventDefault();
            const pageSize = graphBounds?.height || graph.node().clientHeight;
            if (event.ctrlKey || event.metaKey) {
              const delta = Math.max(
                -12,
                Math.min(
                  12,
                  normalizedWheelDelta(event.deltaY, event.deltaMode, pageSize)
                )
              );
              pendingScale *= Math.pow(2, -delta * .01);
              pendingZoomPoint = [
                event.clientX - (graphBounds?.left || 0),
                event.clientY - (graphBounds?.top || 0)
              ];
              scheduleViewportFrame();
              return;
            }
            const horizontalDelta =
              Math.abs(event.deltaX) > .1
                ? normalizedWheelDelta(
                    event.deltaX,
                    event.deltaMode,
                    pageSize
                  )
                : event.shiftKey
                  ? normalizedWheelDelta(
                      event.deltaY,
                      event.deltaMode,
                      pageSize
                    )
                  : 0;
            const verticalDelta = event.shiftKey
              ? 0
              : normalizedWheelDelta(
                  event.deltaY,
                  event.deltaMode,
                  pageSize
                );
            if (pendingPanX < 0 && horizontalDelta > 0) {
              const currentX = d3.zoomTransform(graph.node()).x;
              if (currentX - pendingPanX >= 0) {
                pendingPanX = currentX;
              }
            }
            pendingPanX += horizontalDelta;
            pendingPanY += verticalDelta;
            scheduleViewportFrame();
          },
          { passive: false }
        );

      const allNodes = layouts.flatMap(({
        tree,
        root,
        mainPath,
        routeIndexById,
        currentId
      }) =>
        root.descendants().map((node) => ({
          tree,
          node,
          mainPath,
          routeIndexById,
          currentId
        }))
      );
      const allLinks = layouts.flatMap(({
        tree,
        root,
        mainPath,
        routeIndexById
      }) =>
        root.links().map((link) => ({
          tree,
          link,
          mainPath,
          routeIndexById
        }))
      );
      const narrowFocusNode = allNodes
        .filter(({ node }) => Boolean(node.data.session))
        .sort((left, right) => left.node.screenY - right.node.screenY)[0]
        ?.node;
      const narrowFocusRight = narrowFocusNode
        ? narrowFocusNode.screenX + nodeCardWidth / 2
        : contentBounds.right;
      const selectedTree = selectedSessionId
        ? trees.find((tree) =>
            tree.sessions.some((session) => session.id === selectedSessionId)
          )
        : undefined;
      const selectedFocus = selectedTree
        ? lineageFocusForTree(selectedTree, selectedSessionId)
        : new Set();
      const nodeClasses = ({
        tree,
        node,
        mainPath,
        routeIndexById,
        currentId
      }, baseClass, sessionClass, rootClass) => {
        if (!node.data.session) {
          return baseClass + ' ' + rootClass;
        }
        const session = node.data.session;
        return (
          baseClass + ' ' + sessionClass + ' ' +
          routeClass(routeIndexById.get(session.id) ?? -1) + ' ' +
          tone(session.verdict) +
          (mainPath.has(session.id) ? ' main' : '') +
          (session.id === currentId ? ' current' : '') +
          (session.id === selectedSessionId ? ' selected' : '') +
          (
            selectedTree?.id === tree.id &&
            !selectedFocus.has(session.id)
              ? ' dimmed'
              : ''
          )
        );
      };
      const branchPath = ({ link }) => {
        const sx = link.source.screenX;
        const sy = link.source.screenY;
        const tx = link.target.screenX;
        const ty = link.target.screenY;
        const span = tx - sx;
        const firstControlX = sx + span * .32;
        const secondControlX = sx + span * .62;
        return 'M ' + sx + ' ' + sy +
          ' C ' + firstControlX + ' ' + sy + ', ' +
          secondControlX + ' ' + ty + ', ' +
          tx + ' ' + ty;
      };
      const linkClass = ({
        tree,
        link,
        mainPath,
        routeIndexById
      }) => {
        const target = link.target.data.session;
        const source = link.source.data.session;
        const isMain =
          target &&
          mainPath.has(target.id) &&
          (!source || mainPath.has(source.id));
        const isDimmed =
          selectedTree?.id === tree.id &&
          target &&
          (
            !selectedFocus.has(target.id) ||
            (source && !selectedFocus.has(source.id))
          );
        return (
          routeClass(routeIndexById.get(target?.id) ?? -1) + ' ' +
          tone(target?.verdict) +
          (isMain ? ' main' : '') +
          (isDimmed ? ' dimmed' : '')
        );
      };
      const routeLayer = graphLayer.append('g').attr('class', 'route-layer');
      routeLayer.selectAll('.forest-path-bed')
        .data(allLinks)
        .join('path')
        .attr('class', (item) =>
          'forest-path-bed ' +
          (linkClass(item).includes('main') ? 'main' : '') +
          (linkClass(item).includes('dimmed') ? ' dimmed' : '')
        )
        .attr('d', branchPath);
      routeLayer.selectAll('.forest-edge')
        .data(allLinks)
        .join('path')
        .attr('class', (item) => 'forest-edge ' + linkClass(item))
        .attr('pathLength', 1)
        .attr('d', branchPath);
      const decorationLayer = graphLayer.append('g')
        .attr('class', 'decoration-layer');
      decorationLayer.selectAll('.channel-decoration')
        .data(allLinks)
        .join('g')
        .attr('aria-hidden', 'true')
        .attr('class', (item) => {
          const target = item.link.target.data.session;
          const source = item.link.source.data.session;
          const dimmed =
            selectedTree?.id === item.tree.id &&
            target &&
            (
              !selectedFocus.has(target.id) ||
              (source && !selectedFocus.has(source.id))
            );
          return (
            'channel-decoration ' +
            routeClass(item.routeIndexById.get(target?.id) ?? -1) +
            (dimmed ? ' dimmed' : '')
          );
        })
        .attr('transform', ({ link }) =>
          'translate(' +
          ((link.source.screenX + link.target.screenX) / 2) +
          ',' +
          ((link.source.screenY + link.target.screenY) / 2) +
          ')'
        )
        .each(function(item) {
          const target = item.link.target.data.session;
          appendChannelDecoration(
            d3.select(this),
            item.routeIndexById.get(target?.id) ?? -1
          );
        });

      const markerLayer = graphLayer.append('g').attr('class', 'marker-layer');
      const nodes = markerLayer.selectAll('.forest-node')
        .data(allNodes)
        .join('g')
        .attr('class', (item) =>
          nodeClasses(item, 'forest-node', 'session-node', 'tree-node')
        )
        .attr('transform', ({ node }) =>
          'translate(' + node.screenX + ',' + node.screenY + ')'
        )
        .attr('role', ({ node }) => node.data.session ? null : 'img')
        .attr('aria-label', ({ tree, node }) =>
          node.data.session
            ? null
            : '共同港口，' + tree.title + ' 从这里出发'
        );
      nodes.each(function({ tree, node, currentId }) {
        const selection = d3.select(this);
        if (!node.data.session) {
          selection.append('path')
            .attr('class', 'trail-start-pole')
            .attr('d', 'M 0 -2 L 0 -39');
          selection.append('path')
            .attr('class', 'trail-start-flag')
            .attr('d', 'M 0 -39 L 20 -32 L 0 -23 Z');
          return;
        }
        const session = node.data.session;
        const isFailure = session.verdict === 'failure';
        const isBlockedEnd =
          isFailure &&
          !tree.sessions.some((candidate) => candidate.parentId === session.id);
        if (session.id === selectedSessionId) {
          selection.append('circle')
            .attr('class', 'journey-selected-ring')
            .attr('r', 18);
        }
        const isCurrent = session.id === currentId;
        if (isCurrent) {
          selection.append('circle')
            .attr('class', 'journey-current-ring')
            .attr('r', 18);
        }
        selection.append('circle')
          .attr('class', 'journey-sticker-shadow')
          .attr('cx', 2.5)
          .attr('cy', 3.5)
          .attr('r', 15);
        selection.append('circle')
          .attr('class', 'journey-sticker-outline')
          .attr('r', 15);
        selection.append('circle')
          .attr('class', 'journey-disc')
          .attr('r', 11);
        if (session.verdict === 'success') {
          selection.append('path')
            .attr('class', 'journey-status')
            .attr('d', 'M -5 0 L -1 4 L 6 -5');
        } else if (session.verdict === 'failure') {
          selection.append('path')
            .attr('class', 'journey-status')
            .attr('d', 'M -5 -5 L 5 5 M 5 -5 L -5 5');
        } else {
          selection.append('circle')
            .attr('class', 'journey-status')
            .attr('r', 2.8);
        }
        if (isCurrent && !isBlockedEnd) {
          const boat = selection.append('g')
            .attr('class', 'sailboat project-ship')
            .attr('transform', 'translate(0,-2) scale(.9)');
          boat.append('title')
            .text(tree.title + ' 当前航点');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M -13 11 Q -6 7, 0 11 T 13 11');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M 0 -11 L 0 6');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M 1 -10 L 11 2 L 1 2 Z');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M -11 5 L 12 5 Q 7 12, 0 12 Q -7 12, -11 5 Z');
          boat.append('path')
            .attr('class', 'sailboat-wake')
            .attr('d', 'M -13 11 Q -6 7, 0 11 T 13 11');
          boat.append('path')
            .attr('class', 'sailboat-mast')
            .attr('d', 'M 0 -11 L 0 6');
          boat.append('path')
            .attr('class', 'sailboat-sail')
            .attr('d', 'M 1 -10 L 11 2 L 1 2 Z');
          boat.append('path')
            .attr('class', 'sailboat-hull')
            .attr('d', 'M -11 5 L 12 5 Q 7 12, 0 12 Q -7 12, -11 5 Z');
          if (
            session.verdict === 'success' ||
            session.verdict === 'failure'
          ) {
            selection.append('circle')
              .attr('class', 'current-status-badge')
              .attr('cx', 12)
              .attr('cy', -10)
              .attr('r', 5);
            selection.append('path')
              .attr('class', 'journey-status')
              .attr('transform', 'translate(12,-10) scale(.56)')
              .attr(
                'd',
                session.verdict === 'success'
                  ? 'M -5 0 L -1 4 L 6 -5'
                  : 'M -5 -5 L 5 5 M 5 -5 L -5 5'
              );
          }
        }
        if (isBlockedEnd) {
          appendReef(selection, false);
        } else if (isFailure) {
          appendReef(selection, true);
        }
        selection.append('title').text(session.title);
      });

      const cardLayer = graphLayer.append('g').attr('class', 'card-layer');
      const cards = cardLayer.selectAll('.forest-card')
        .data(allNodes)
        .join('g')
        .attr('class', (item) =>
          nodeClasses(
            item,
            'forest-card',
            'session-card',
            'tree-card'
          )
        )
        .attr('transform', ({ node }) =>
          'translate(' + node.screenX + ',' + node.screenY + ')'
        )
        .attr('role', ({ node }) => node.data.session ? 'button' : 'img')
        .attr('tabindex', ({ node }) => node.data.session ? 0 : null)
        .attr('aria-label', ({ tree, node }) => {
          const session = node.data.session;
          if (!session) {
            return '共同港口，' + tree.title + ' 从这里出发';
          }
          const content = contentForCard(session);
          return (
            content.title +
            (content.summary ? '，' + content.summary : '') +
            '，' +
            content.meta +
            (
              session.verdict === 'success'
                ? '，正确路线'
                : session.verdict === 'failure'
                  ? '，错误路线，此路不通'
                  : '，尚未评价'
            )
          );
        })
        .attr('aria-pressed', ({ node }) =>
          node.data.session
            ? String(node.data.session.id === selectedSessionId)
            : null
        )
        .attr('data-session-id', ({ node }) =>
          node.data.session?.id || null
        )
        .attr('data-focus-key', ({ node }) =>
          node.data.session ? 'session:' + node.data.session.id : null
        )
        .attr('data-route-index', ({ node, routeIndexById }) =>
          node.data.session
            ? String(routeIndexById.get(node.data.session.id))
            : null
        )
        .on('click', (event, item) => {
          const session = item.node.data.session;
          if (!session) return;
          event.stopPropagation();
          selectSession(session, nodeById);
        })
        .on('keydown', (event, item) => {
          const session = item.node.data.session;
          if (!session || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          selectSession(session, nodeById);
        });
      cards.each(function({ tree, node }) {
        const selection = d3.select(this);
        selection.append('rect')
          .attr('class', 'node-card-shadow')
          .attr('x', -nodeCardWidth / 2 + 3)
          .attr('y', nodeCardTop + 4)
          .attr('width', nodeCardWidth)
          .attr('height', nodeCardHeight)
          .attr('rx', 7);
        selection.append('rect')
          .attr('class', 'node-card-bg')
          .attr('x', -nodeCardWidth / 2)
          .attr('y', nodeCardTop)
          .attr('width', nodeCardWidth)
          .attr('height', nodeCardHeight)
          .attr('rx', 7);
        const session = node.data.session;
        if (!session) {
          selection.append('text')
            .attr('class', 'tree-node-title')
            .attr('x', 0)
            .attr('y', nodeCardTop + 24)
            .text('共同港口');
          selection.append('text')
            .attr('class', 'tree-node-meta')
            .attr('x', 0)
            .attr('y', nodeCardTop + 43)
            .text(tree.title + ' · ' + tree.sessions.length + ' 航点');
          return;
        }
        selection.append('rect')
          .attr('class', 'node-card-accent')
          .attr('x', -nodeCardWidth / 2 + 7)
          .attr('y', nodeCardTop + 12)
          .attr('width', 5)
          .attr('height', nodeCardHeight - 24)
          .attr('rx', 2.5);
        const content = contentForCard(session);
        const lines = cardTextLines(content.title, 27, 2);
        const title = selection.append('text')
          .attr('class', 'node-title');
        lines.forEach((line, index) => {
          title.append('tspan')
            .attr('x', -nodeCardWidth / 2 + 19)
            .attr(
              'y',
              nodeCardTop +
              24 +
              index * 15
            )
            .text(line);
        });
        const summaryLines = cardTextLines(content.summary, 32, 2);
        const summary = selection.append('text')
          .attr('class', 'node-summary');
        summaryLines.forEach((line, index) => {
          summary.append('tspan')
            .attr('x', -nodeCardWidth / 2 + 19)
            .attr('y', nodeCardTop + 59 + index * 13)
            .text(line);
        });
        selection.append('text')
          .attr('class', 'node-card-meta')
          .attr('x', -nodeCardWidth / 2 + 19)
          .attr('y', nodeCardTop + nodeCardHeight - 10)
          .text(content.meta);
        selection.append('title').text(
          [content.title, content.summary, content.meta]
            .filter(Boolean)
            .join('\\n')
        );
      });

      if (query) {
        const applySearchDimming = (selection) =>
          selection.classed('dimmed', ({ tree, node }) => {
          const treeMatches =
            tree.title.toLocaleLowerCase('zh-CN').includes(query);
          if (!node.data.session) {
            return !treeMatches;
          }
          return (
            !treeMatches &&
            !sessionMatches(node.data.session, nodeById, query)
          );
        });
        applySearchDimming(nodes);
        applySearchDimming(cards);
        cards.attr('tabindex', ({ tree, node }) => {
          if (!node.data.session) return -1;
          return (
            tree.title.toLocaleLowerCase('zh-CN').includes(query) ||
            sessionMatches(node.data.session, nodeById, query)
          )
            ? 0
            : -1;
        });
      }
      if (preserveViewport) {
        graph.call(zoomBehavior.transform, previousTransform);
      } else {
        fitGraph(
          viewportWidth,
          height,
          contentBounds,
          minimumReadableScale,
          narrowFocusRight
        );
      }
      viewportSignature = nextViewportSignature;
      fitAllRequested = false;
      if (resumePendingWheel) scheduleViewportFrame();
      scheduleVisibleCardTabStops();
    }

    function filterTreeForQuery(tree, nodeById, query) {
      if (tree.title.toLocaleLowerCase('zh-CN').includes(query)) {
        return tree;
      }
      const byId = new Map(tree.sessions.map((session) => [session.id, session]));
      const included = new Set(
        tree.sessions
          .filter((session) => sessionMatches(session, nodeById, query))
          .map((session) => session.id)
      );
      [...included].forEach((id) => {
        let current = byId.get(id);
        const visited = new Set();
        while (
          current?.parentId &&
          byId.has(current.parentId) &&
          !visited.has(current.id)
        ) {
          visited.add(current.id);
          included.add(current.parentId);
          current = byId.get(current.parentId);
        }
      });
      if (included.size === 0) return null;
      return Object.assign({}, tree, {
        sessions: tree.sessions.filter((session) => included.has(session.id)),
        lineageSessions: tree.sessions
      });
    }

    function hierarchyFor(tree) {
      const byParent = new Map();
      const ids = new Set(tree.sessions.map((session) => session.id));
      tree.sessions.forEach((session) => {
        const parent = session.parentId && ids.has(session.parentId)
          ? session.parentId
          : 'root';
        const children = byParent.get(parent) || [];
        children.push(session);
        byParent.set(parent, children);
      });
      byParent.forEach((items) =>
        items.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      );
      const make = (session, ancestors = new Set()) => {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(session.id);
        return {
          label: session.title,
          session,
          children: (byParent.get(session.id) || [])
            .filter((child) => !nextAncestors.has(child.id))
            .map((child) => make(child, nextAncestors))
        };
      };
      return {
        label: tree.title,
        children: (byParent.get('root') || []).map((session) =>
          make(session)
        )
      };
    }

    function currentSessionFor(tree) {
      const ordered = [...(tree.lineageSessions || tree.sessions)].sort((a, b) =>
        a.completedAt.localeCompare(b.completedAt)
      );
      return [...ordered].reverse().find(
        (session) => session.verdict !== 'failure'
      ) || ordered.at(-1);
    }

    function mainPathFor(tree) {
      const sessions = tree.lineageSessions || tree.sessions;
      const byId = new Map(
        sessions.map((session) => [session.id, session])
      );
      const path = new Set();
      let current = currentSessionFor(tree);
      while (current && !path.has(current.id)) {
        path.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return path;
    }

    function routeIndexesFor(tree) {
      const sessions = [...tree.sessions].sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt)
      );
      const byId = new Map(
        sessions.map((session) => [session.id, session])
      );
      const children = new Map();
      sessions.forEach((session) => {
        if (!session.parentId || !byId.has(session.parentId)) return;
        const items = children.get(session.parentId) || [];
        items.push(session);
        children.set(session.parentId, items);
      });
      const routeKeyFor = (session) => {
        let current = session;
        const visited = new Set();
        while (
          current?.parentId &&
          byId.has(current.parentId) &&
          !visited.has(current.id)
        ) {
          visited.add(current.id);
          if ((children.get(current.parentId) || []).length > 1) {
            return current.id;
          }
          current = byId.get(current.parentId);
        }
        return 'trunk';
      };
      const indexByKey = new Map([['trunk', -1]]);
      const indexBySession = new Map();
      let routeIndex = 0;
      sessions.forEach((session) => {
        const key = routeKeyFor(session);
        if (!indexByKey.has(key)) {
          indexByKey.set(key, routeIndex);
          routeIndex += 1;
        }
        indexBySession.set(session.id, indexByKey.get(key));
      });
      return indexBySession;
    }

    function routeClass(index) {
      return index < 0
        ? 'route-trunk'
        : 'route-' + (index % 6);
    }

    function appendChannelDecoration(selection, index) {
      const style = index < 0 ? -1 : index % 6;
      if (style === -1) {
        [-3, 3].forEach((x) =>
          selection.append('circle').attr('cx', x).attr('r', 1.8)
        );
        return;
      }
      if (style === 0) {
        selection.append('path')
          .attr('d', 'M -8 1 Q -4 -3, 0 1 T 8 1');
        return;
      }
      if (style === 1) {
        selection.append('path')
          .attr('d', 'M 0 -5 L 5 0 L 0 5 L -5 0 Z');
        return;
      }
      if (style === 2) {
        [-6, 0, 6].forEach((x) =>
          selection.append('circle').attr('cx', x).attr('r', 1.7)
        );
        return;
      }
      if (style === 3) {
        selection.append('path')
          .attr('d', 'M -7 -4 L -2 0 L -7 4 M 1 -4 L 6 0 L 1 4');
        return;
      }
      if (style === 4) {
        selection.append('path')
          .attr('d', 'M -7 -2 Q -3 2, 1 -2 T 8 -2 M -7 3 Q -3 7, 1 3 T 8 3');
        return;
      }
      selection.append('path')
        .attr('d', 'M -6 -4 L -1 0 L -6 4 M 1 -4 L 6 0 L 1 4');
    }

    function lineageFocusForTree(tree, selectedId) {
      const byId = new Map(
        tree.sessions.map((session) => [session.id, session])
      );
      const children = new Map();
      tree.sessions.forEach((session) => {
        if (!session.parentId) return;
        const items = children.get(session.parentId) || [];
        items.push(session);
        children.set(session.parentId, items);
      });
      const focus = new Set();
      let current = byId.get(selectedId);
      while (current && !focus.has(current.id)) {
        focus.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      const visit = (id) => {
        (children.get(id) || []).forEach((child) => {
          if (focus.has(child.id)) return;
          focus.add(child.id);
          visit(child.id);
        });
      };
      visit(selectedId);
      return focus;
    }

    function selectSession(session, nodeById) {
      selectedSessionId = session.id;
      lastFocusedSessionId = session.id;
      renderGraph();
      showInspector(session, nodeById, true);
    }

    function showInspector(session, nodeById, focusTitle) {
      inspector.classList.add('open');
      inspector.replaceChildren();
      const close = actionButton(
        'close',
        '关闭详情',
        () => showEmptyInspector(true)
      );
      close.classList.add('inspector-close');
      const kicker = document.createElement('div');
      kicker.className = 'detail-kicker';
      kicker.textContent =
        session.stage +
        (session.branch ? ' · ' + session.branch : '');
      const title = document.createElement('div');
      title.className = 'detail-title';
      title.tabIndex = -1;
      title.textContent = session.title;
      const meta = document.createElement('div');
      meta.className = 'detail-session-meta';
      const sessionNodes = session.nodeIds
        .map((id) => nodeById.get(id))
        .filter(Boolean);
      const importedFolder = sessionNodes.every(
        (node) => node.source?.type === 'folder-import'
      );
      meta.textContent =
        session.nodeIds.length +
        (importedFolder ? ' 个导入条目 · ' : ' 轮对话 · ') +
        dateRange(session.startedAt, session.completedAt);
      inspector.append(close, kicker, title, meta);
      session.nodeIds
        .map((id) => nodeById.get(id))
        .filter(Boolean)
        .forEach((node) => inspector.append(renderTurn(node)));
      if (focusTitle) {
        title.focus();
      }
    }

    function renderTurn(node) {
      const section = document.createElement('section');
      section.className = 'detail-turn ' + tone(node.verdict);
      const head = document.createElement('div');
      head.className = 'detail-turn-head';
      const dot = document.createElement('span');
      dot.className = 'detail-turn-dot';
      const title = document.createElement('div');
      title.className = 'detail-turn-title';
      title.textContent = node.prompt;
      const time = document.createElement('span');
      time.className = 'detail-turn-time';
      time.textContent = shortTime(node.completedAt);
      head.append(dot, title, time);
      section.append(head);
      if (node.kind === 'collected') {
        const source = document.createElement('div');
        source.className = 'detail-source';
        source.textContent =
          '自动记录 · ' +
          (node.sourceHost === 'claude'
            ? 'Claude Code'
            : node.sourceHost === 'codex'
              ? 'Codex'
              : '本机会话');
        section.append(source);
      } else if (node.source?.type === 'folder-import') {
        const source = document.createElement('div');
        source.className = 'detail-source';
        source.textContent = '目录导入 · ' + node.source.relativePath;
        section.append(source);
      }
      if (node.response) {
        const text = document.createElement('p');
        text.className = 'detail-text';
        text.textContent = node.response;
        section.append(text);
      }
      if (node.note) {
        const note = document.createElement('div');
        note.className = 'detail-note';
        note.textContent = node.note;
        section.append(note);
      }
      if (node.files?.length) {
        const files = document.createElement('div');
        files.className = 'detail-files';
        node.files.forEach((file) => {
          const row = document.createElement('div');
          row.className = 'detail-file';
          const name = document.createElement('span');
          name.className = 'detail-file-name';
          name.textContent = file.path;
          name.title = file.path;
          const count = document.createElement('span');
          count.className = 'detail-file-count';
          count.innerHTML =
            '<span class="detail-file-add">+' +
            file.additions +
            '</span> <span class="detail-file-delete">−' +
            file.deletions +
            '</span>';
          row.append(name, count);
          files.append(row);
        });
        section.append(files);
      }
      if (!globalThis.__WAYFINDER_DESKTOP__) {
        const actions = document.createElement('div');
        actions.className = 'detail-actions';
        if (
          node.kind !== 'imported' &&
          node.kind !== 'collected' &&
          node.files?.length &&
          node.snapshotBefore !== node.snapshotAfter
        ) {
          actions.append(actionButton(
            'diff',
            '查看 Diff',
            () => send('diff', { nodeId: node.id }),
            '',
            undefined,
            node.id + ':diff'
          ));
        }
        actions.append(
          actionButton(
            'pass',
            node.verdict === 'success' ? '取消正确标记' : '标记正确',
            () => send('verdict', {
            nodeId: node.id,
            verdict: node.verdict === 'success' ? undefined : 'success'
            }),
            node.verdict === 'success' ? 'active-good' : '',
            node.verdict === 'success',
            node.id + ':pass'
          ),
          actionButton(
            'error',
            node.verdict === 'failure' ? '取消错误标记' : '标记错误',
            () => send('verdict', {
            nodeId: node.id,
            verdict: node.verdict === 'failure' ? undefined : 'failure'
            }),
            node.verdict === 'failure' ? 'active-bad' : '',
            node.verdict === 'failure',
            node.id + ':error'
          ),
          actionButton(
            'edit',
            '记录经验',
            () => send('note', { nodeId: node.id }),
            '',
            undefined,
            node.id + ':edit'
          )
        );
        if (node.kind !== 'imported' && node.kind !== 'collected') {
          actions.append(actionButton(
            'debug-restart',
            '从这里重来',
            () => send('restore', { nodeId: node.id }),
            '',
            undefined,
            node.id + ':restore'
          ));
        }
        section.append(actions);
      }
      return section;
    }

    function showEmptyInspector(restoreFocus = false) {
      selectedSessionId = '';
      inspector.classList.remove('open');
      inspector.innerHTML = '<div class="inspector-empty">选择一个航点<br>查看按时间排列的全部对话</div>';
      graphLayer?.selectAll('.forest-node, .forest-card')
        .classed('selected', false)
        .classed('dimmed', false);
      graphLayer?.selectAll('.journey-selected-ring').remove();
      graphLayer?.selectAll('.forest-path-bed, .forest-edge')
        .classed('dimmed', false);
      graphLayer?.selectAll('.forest-card[data-session-id]')
        .attr('aria-pressed', 'false');
      if (restoreFocus && lastFocusedSessionId) {
        const target = document.querySelector(
          '[data-session-id="' + lastFocusedSessionId + '"]'
        );
        target?.focus();
      } else if (!restoreFocus) {
        lastFocusedSessionId = '';
      }
    }

    function sessionMatches(session, nodeById, query) {
      return [
        session.stage,
        session.branch,
        session.title,
        session.preview,
        ...session.nodeIds.flatMap((id) => {
          const node = nodeById.get(id);
          return node
            ? [
                node.prompt,
                node.response,
                node.note,
                ...(node.files || []).map((file) => file.path)
              ]
            : [];
        })
      ].join(' ').toLocaleLowerCase('zh-CN').includes(query);
    }

    function appendReef(selection, compact) {
      const reef = selection.append('g')
        .attr(
          'class',
          'reef-sticker' + (compact ? ' reef-compact' : '')
        )
        .attr(
          'transform',
          compact ? 'translate(16,-11) scale(.68)' : null
        );
      reef.append('path')
        .attr('class', 'reef-outline')
        .attr('d', 'M -13 9 L -10 -2 L -5 -8 L -1 -1 L 3 -11 L 8 -4 L 12 9 Z');
      reef.append('path')
        .attr('class', 'reef-rock')
        .attr('d', 'M -11 8 L -9 -1 L -4 -7 L 0 8 Z');
      reef.append('path')
        .attr('class', 'reef-rock')
        .attr('d', 'M -1 8 L 3 -10 L 8 -3 L 11 8 Z');
      reef.append('path')
        .attr('class', 'reef-cross')
        .attr('d', 'M -3 -1 L 4 6 M 4 -1 L -3 6');
      reef.append('title').text('礁石：此路不通');
    }

    function actionButton(
      name,
      title,
      handler,
      extraClass,
      pressed,
      focusKey
    ) {
      const button = document.createElement('button');
      button.className = 'icon-button ' + (extraClass || '');
      button.title = title;
      button.setAttribute('aria-label', title);
      if (typeof pressed === 'boolean') {
        button.setAttribute('aria-pressed', String(pressed));
      }
      if (focusKey) {
        button.dataset.focusKey = focusKey;
      }
      const icon = document.createElement('span');
      icon.className = 'codicon codicon-' + name;
      button.append(icon);
      button.addEventListener('click', handler);
      return button;
    }
    function send(type, extra) {
      wayfinderApi.postMessage(Object.assign({ type }, extra || {}));
    }
    function tone(value) {
      if (value === 'success') return 'good';
      if (value === 'failure') return 'bad';
      return '';
    }
    function shortDate(value) {
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          month: 'numeric',
          day: 'numeric'
        }).format(new Date(value));
      } catch {
        return '';
      }
    }
    function shortTime(value) {
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(new Date(value));
      } catch {
        return '';
      }
    }
    function dateRange(start, end) {
      const first = shortDate(start);
      const last = shortDate(end);
      return first === last ? first : first + '–' + last;
    }

    function cardContentFor(session, nodeById) {
      const nodes = session.nodeIds
        .map((id) => nodeById.get(id))
        .filter(Boolean);
      const latest = nodes.at(-1);
      const folderImport = latest?.source?.type === 'folder-import';
      const summary = compactCardSummary(
        latest?.response ||
        session.preview ||
        ''
      );
      if (folderImport) {
        const lineCount = (latest.files || []).reduce(
          (total, file) => total + (file.additions || 0),
          0
        );
        const fileLabel = latest.source.relativePath === '.'
          ? (latest.files?.length || 0) + ' 个 SKILL.md'
          : latest.source.relativePath.split('/').at(-1) || 'SKILL.md';
        return {
          title: session.title,
          summary,
          meta:
            '目录导入 · ' +
            fileLabel +
            (lineCount ? ' · ' + lineCount + ' 行' : '')
        };
      }
      const source = session.sourceHosts?.length
        ? session.sourceHosts
            .map((host) => host === 'codex' ? 'Codex' : host === 'claude'
              ? 'Claude'
              : 'TRAE')
            .join(' + ')
        : '本地记录';
      return {
        title: session.shortTitle || session.title,
        summary: summary === session.title ? '' : summary,
        meta:
          source +
          ' · ' +
          session.nodeIds.length +
          ' 轮 · ' +
          shortDate(session.completedAt)
      };
    }

    function compactCardSummary(value) {
      return String(value || '')
        .slice(0, 240)
        .replace(/[#>*_()]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }

    function cardTextLines(value, maxUnits, maxLines) {
      const characters = Array.from(
        String(value || '').trim().split(' ').filter(Boolean).join(' ')
      );
      const lines = [];
      let cursor = 0;
      while (cursor < characters.length && lines.length < maxLines) {
        let units = 0;
        let end = cursor;
        let lastSpace = -1;
        while (end < characters.length) {
          const character = characters[end];
          const nextUnits = units + (
            /[\u3400-\u9fff\uff00-\uffef]/.test(character) ? 2 : 1
          );
          if (nextUnits > maxUnits) break;
          units = nextUnits;
          if (character === ' ') lastSpace = end;
          end += 1;
        }
        if (
          end < characters.length &&
          lastSpace >= cursor + Math.floor((end - cursor) * .55)
        ) {
          end = lastSpace;
        }
        if (end <= cursor) end = cursor + 1;
        lines.push(characters.slice(cursor, end).join('').trim());
        cursor = end;
        while (characters[cursor] === ' ') cursor += 1;
      }
      if (cursor < characters.length && lines.length) {
        const last = Array.from(lines[lines.length - 1]);
        while (last.length > 1 && visualUnits(last.join('') + '…') > maxUnits) {
          last.pop();
        }
        lines[lines.length - 1] = last.join('').trimEnd() + '…';
      }
      return lines;
    }

    function visualUnits(value) {
      return Array.from(value).reduce(
        (sum, character) =>
          sum + (/[\u3400-\u9fff\uff00-\uffef]/.test(character) ? 2 : 1),
        0
      );
    }

    function coastlineGeometry(top, bottom) {
      const step = 180;
      const shoreX = (y) =>
        92 + Math.sin(y / 205) * 7 + Math.sin(y / 79) * 3;
      let y = top;
      let x = shoreX(y);
      let line = 'M ' + x + ' ' + y;
      let fill = 'M 0 ' + top + ' L ' + x + ' ' + y;
      while (y < bottom) {
        const nextY = Math.min(bottom, y + step);
        const nextX = shoreX(nextY);
        const delta = nextY - y;
        const segment =
          ' C ' + (x + 5) + ' ' + (y + delta * .34) +
          ', ' + (nextX - 5) + ' ' + (y + delta * .66) +
          ', ' + nextX + ' ' + nextY;
        line += segment;
        fill += segment;
        y = nextY;
        x = nextX;
      }
      return {
        line,
        fill: fill + ' L 0 ' + bottom + ' Z'
      };
    }

    function fitGraph(
      width,
      height,
      bounds,
      minimumScale,
      narrowFocusRight
    ) {
      const sideInset = 28;
      const topInset = 86;
      const bottomInset = 28;
      const contentWidth = Math.max(1, bounds.right - bounds.left);
      const contentHeight = Math.max(1, bounds.bottom - bounds.top);
      const availableWidth = Math.max(1, width - sideInset * 2);
      const availableHeight = Math.max(1, height - topInset - bottomInset);
      const scale = Math.max(
        minimumScale,
        Math.min(
          .96,
          availableWidth / contentWidth,
          availableHeight / contentHeight
        )
      );
      const x = sideInset - bounds.left * scale;
      const narrowX = width <= 520
        ? width -
          20 -
          narrowFocusRight * scale
        : x;
      const y = contentHeight * scale > availableHeight
        ? topInset - bounds.top * scale
        : topInset +
          (availableHeight - contentHeight * scale) / 2 -
          bounds.top * scale;
      graph.call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(narrowX, y).scale(scale)
      );
    }

    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'operation') {
        const busy = event.data.status === 'busy';
        document.body.classList.toggle('busy', busy);
        document.body.setAttribute('aria-busy', String(busy));
        return;
      }
      if (event.data.type !== 'render') return;
      const focusKey = document.activeElement?.dataset?.focusKey || '';
      const focusWasTitle =
        document.activeElement?.classList.contains('detail-title');
      state = event.data.state;
      forest = event.data.forest;
      projectName = event.data.projectName;
      if (event.data.focusTreeId) {
        activeTreeId = event.data.focusTreeId;
      }
      if (!forest.trees.some((tree) => tree.id === activeTreeId)) {
        activeTreeId = forest.trees[0]?.id || '';
      }
      document.getElementById('projectMeta').textContent =
        projectName +
        ' · ' +
        forest.trees.length +
        ' 条航程 · ' +
        forest.nodeCount +
        ' 轮';
      renderGraph();
      const selected = forest.trees
        .flatMap((tree) => tree.sessions)
        .find((session) => session.id === selectedSessionId);
      if (selected) {
        showInspector(
          selected,
          new Map(state.nodes.map((node) => [node.id, node])),
          focusWasTitle
        );
      }
      if (focusKey) {
        const target = [...document.querySelectorAll('[data-focus-key]')]
          .find((element) => element.dataset.focusKey === focusKey);
        target?.focus();
      }
    });
    const updateSearch = () => {
      if (!state) return;
      selectedSessionId = '';
      showEmptyInspector();
      renderGraph();
    };
    searchInput.addEventListener('compositionstart', () => {
      composingSearch = true;
    });
    searchInput.addEventListener('compositionend', () => {
      composingSearch = false;
      updateSearch();
    });
    searchInput.addEventListener('input', () => {
      if (!composingSearch) updateSearch();
    });
    const switchProject = (offset) => {
      if (!state || !forest.trees.length) return;
      const activeIndex = forest.trees.findIndex(
        (tree) => tree.id === activeTreeId
      );
      const nextIndex = activeIndex + offset;
      if (nextIndex < 0 || nextIndex >= forest.trees.length) return;
      activeTreeId = forest.trees[nextIndex].id;
      selectedSessionId = '';
      searchInput.value = '';
      showEmptyInspector();
      renderGraph();
      document.getElementById('canvasTitle')?.focus();
    };
    projectPrevious.addEventListener('click', () => switchProject(-1));
    projectNext.addEventListener('click', () => switchProject(1));
    document.getElementById('fit').addEventListener('click', () => {
      if (!state) return;
      fitAllRequested = true;
      renderGraph();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && inspector.classList.contains('open')) {
        showEmptyInspector(true);
      }
      if (event.key === '/' && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
      }
    });
    window.addEventListener('resize', () => {
      if (state) renderGraph();
    });
    send('ready');
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
