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
      --project-accent: #2f9fbd;
      --route-trunk: var(--project-accent);
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
      display: flex;
      width: 100%;
      max-width: 100%;
      min-width: 0;
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
      --inspector-width: clamp(286px, 25vw, 336px);
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      background: var(--ocean);
    }
    .layout.inspector-open {
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .canvas-shell { position: relative; min-width: 0; min-height: 0; overflow: hidden; contain: layout paint; background: var(--ocean); }
    .canvas-head {
      position: absolute;
      top: 12px;
      left: 50%;
      z-index: 3;
      display: block;
      min-width: min(390px, calc(100% - 28px));
      transform: translateX(-50%);
    }
    .canvas-title {
      display: block;
      color: var(--ink);
      font-size: 13px;
      font-weight: 750;
      line-height: 17px;
    }
    .canvas-meta { display: block; margin-top: 2px; color: var(--sticker-muted); font-size: 9px; }
    .canvas-page-label {
      min-width: 0;
      padding: 7px 14px;
      border: 2px solid white;
      border-radius: 9px;
      background: var(--paper);
      box-shadow: 2px 3px 0 var(--sticker-shadow);
      text-align: center;
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
    .forest-edge.main,
    .session-node.main,
    .session-card.main {
      --route-accent: var(--voyage-accent, var(--project-accent));
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
    .tree-node,
    .tree-card {
      --route-accent: var(--voyage-accent, var(--project-accent));
    }
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
    .tree-card.collapsed {
      pointer-events: auto;
      cursor: pointer;
    }
    .tree-card.collapsed .node-card-bg {
      fill: color-mix(
        in srgb,
        var(--voyage-accent, var(--project-accent)) 8%,
        var(--paper)
      );
      stroke: color-mix(
        in srgb,
        var(--voyage-accent, var(--project-accent)) 42%,
        white
      );
    }
    .collapsed-route,
    .collapsed-path-bed { opacity: .82; }
    .tree-card.collapsed:focus-visible .node-card-bg {
      stroke: var(--voyage-accent, var(--project-accent));
      stroke-width: 3;
    }
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
    .inspector {
      --inspector-accent: var(--project-accent);
      position: relative;
      z-index: 5;
      display: none;
      width: min(560px, calc(100% - 24px));
      max-height: min(42vh, 360px);
      grid-template-rows: auto minmax(0, 1fr);
      align-self: end;
      justify-self: center;
      overflow: hidden;
      margin: 0 12px 12px;
      border: 2px solid color-mix(
        in srgb,
        var(--inspector-accent) 46%,
        white
      );
      border-radius: 8px;
      color: var(--ink);
      background: color-mix(
        in srgb,
        var(--inspector-accent) 6%,
        var(--paper)
      );
      box-shadow:
        3px 5px 0 color-mix(
          in srgb,
          var(--inspector-accent) 22%,
          transparent
        ),
        0 10px 28px rgba(22, 69, 82, .14);
      transform: none;
    }
    .inspector.open {
      display: grid;
      animation: inspector-sheet-in 170ms cubic-bezier(.2, .8, .2, 1);
    }
    .inspector-head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: grid;
      min-width: 0;
      grid-template-columns: 4px minmax(0, 1fr) 24px;
      gap: 9px;
      align-items: start;
      overflow: hidden;
      padding: 12px 12px 10px;
      border-bottom: 1px solid color-mix(
        in srgb,
        var(--inspector-accent) 24%,
        transparent
      );
      background: color-mix(
        in srgb,
        var(--inspector-accent) 13%,
        var(--paper)
      );
    }
    .inspector-head::before {
      grid-row: 1 / span 3;
      align-self: stretch;
      border-radius: 3px;
      background: var(--inspector-accent);
      content: "";
    }
    .inspector-copy { min-width: 0; overflow: hidden; }
    .inspector-close {
      display: grid;
      width: 24px;
      height: 24px;
      padding: 0;
      place-items: center;
      border: 1px solid color-mix(
        in srgb,
        var(--inspector-accent) 28%,
        white
      );
      border-radius: 50%;
      color: var(--ink);
      background: var(--paper);
      box-shadow: 1px 2px 0 color-mix(
        in srgb,
        var(--inspector-accent) 18%,
        transparent
      );
      cursor: pointer;
      justify-self: end;
    }
    .inspector-close:hover { transform: translateY(-1px) rotate(-3deg); }
    .inspector-turns {
      min-height: 0;
      overflow: auto;
      padding: 4px 12px 12px;
      scrollbar-width: thin;
      scrollbar-color: color-mix(in srgb, var(--inspector-accent) 55%, transparent) transparent;
    }
    .detail-kicker { color: color-mix(in srgb, var(--inspector-accent) 78%, var(--ink)); font-size: 9px; font-weight: 700; }
    .detail-title { margin: 2px 0 0; overflow-wrap: anywhere; outline: 0; font-size: 14px; font-weight: 750; line-height: 1.35; }
    .detail-session-meta { margin-top: 3px; color: var(--sticker-muted); font-size: 9px; }
    .detail-turn { padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, var(--inspector-accent) 16%, transparent); }
    .detail-turn:last-child { border-bottom: 0; }
    .detail-turn-head { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; gap: 7px; align-items: start; }
    .detail-turn-dot { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--inspector-accent); opacity: .72; }
    .detail-turn.good .detail-turn-dot { background: var(--good); opacity: 1; }
    .detail-turn.bad .detail-turn-dot { background: var(--bad); opacity: 1; }
    .detail-turn-title { font-size: 11px; font-weight: 600; line-height: 1.45; }
    .detail-turn-time { color: var(--muted); font-size: 9px; white-space: nowrap; }
    .detail-source { margin: 6px 0 0 14px; color: var(--muted); font-size: 9px; }
    .detail-text { margin: 8px 0 0 14px; overflow-wrap: anywhere; color: var(--ink); font-size: 10px; line-height: 1.6; white-space: pre-wrap; }
    .detail-list { display: grid; gap: 5px; margin: 9px 0 0 14px; padding: 0; list-style: none; color: var(--muted); font-size: 10px; line-height: 1.5; }
    .detail-list li { position: relative; padding-left: 12px; }
    .detail-list li::before { position: absolute; top: 0; left: 0; color: var(--inspector-accent); content: "•"; }
    .detail-note { margin: 9px 0 0 14px; padding: 8px 10px; border-left: 3px solid var(--inspector-accent); border-radius: 0 5px 5px 0; background: color-mix(in srgb, var(--inspector-accent) 9%, transparent); font-size: 10px; line-height: 1.55; white-space: pre-wrap; }
    .detail-files { display: grid; gap: 4px; margin: 8px 0 0 14px; }
    .detail-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; color: var(--muted); font-size: 9px; }
    .detail-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-file-count { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .detail-file-add { color: var(--good); }
    .detail-file-delete { color: var(--bad); }
    .detail-actions { display: flex; justify-content: flex-end; gap: 2px; margin-top: 7px; }
    @keyframes inspector-sheet-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes inspector-dock-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
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
    @media (min-width: 1200px) {
      .layout.inspector-open {
        grid-template-columns: minmax(0, 1fr) var(--inspector-width);
        grid-template-rows: minmax(0, 1fr);
      }
      .inspector {
        grid-column: 2;
        grid-row: 1;
        width: auto;
        max-height: min(72vh, 620px);
        margin: 12px 12px 12px 0;
        align-self: center;
        transform: none;
      }
      .inspector.open {
        animation-name: inspector-dock-in;
      }
    }
    @media (max-width: 860px) {
      .topbar { padding: 0 12px; }
    }
    @media (max-width: 520px) {
      .brand { display: none; }
      .inspector { width: calc(100% - 16px); max-height: 42vh; margin: 0 8px 8px; }
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
    </header>
    <div class="layout">
      <main class="canvas-shell">
        <div class="canvas-head" aria-label="当前项目航海图">
          <div class="canvas-page-label">
            <span id="canvasTitle" class="canvas-title" tabindex="-1"></span>
            <span id="canvasMeta" class="canvas-meta"></span>
          </div>
        </div>
        <svg id="graph" role="application" aria-label="Wayfinder 航海图"></svg>
      </main>
      <aside id="inspector" class="inspector" aria-label="航点详情"></aside>
    </div>
  </div>
  <script nonce="${nonce}" src="${d3}"></script>
  <script nonce="${nonce}">
    const wayfinderApi = acquireVsCodeApi();
    const graph = d3.select('#graph');
    const canvasShell = d3.select('.canvas-shell');
    const layout = document.querySelector('.layout');
    const inspector = document.getElementById('inspector');
    const canvasTitle = document.getElementById('canvasTitle');
    const canvasMeta = document.getElementById('canvasMeta');
    let state;
    let forest;
    let projectName = '';
    let activeTreeId = '';
    let selectedSessionId = '';
    let lastFocusedSessionId = '';
    let graphLayer;
    let zoomBehavior;
    let viewportSignature = '';
    let graphBounds = null;
    let viewportBeforeInspector = null;
    let nativeGestureActive = false;
    let nativeGestureStartScale = 1;
    let nativeGesturePreviousPoint = null;
    const nodeCardWidth = 240;
    const nodeCardHeight = 120;
    const nodeCardTop = 24;
    const startCardWidth = 190;
    const startCardHeight = 58;
    const startCardTop = 12;
    const collapsedCardWidth = 190;
    const collapsedCardHeight = 58;
    const collapsedVoyagePitch = 136;
    const expandedVoyageGap = 112;
    const nodeVerticalPitch = 232;
    const nodeHorizontalPitch = 324;
    const voyageStartX = 92;
    const mapStartX = 184;
    const mapTopInset = 112;
    const minimumReadableScale = .86;
    const projectAccents = [
      '#2f8fa8',
      '#6f72c9',
      '#c97a3d',
      '#2e9468',
      '#c85f73',
      '#8b68b8',
      '#3d7fbf',
      '#8a8235'
    ];

    function projectAccentFor(value) {
      let hash = 0;
      for (const character of String(value || 'wayfinder')) {
        hash = (hash * 31 + character.codePointAt(0)) >>> 0;
      }
      return projectAccents[hash % projectAccents.length];
    }

    function normalizedWheelDelta(value, deltaMode, pageSize) {
      if (!Number.isFinite(value)) return 0;
      const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageSize : 1;
      return Math.max(-160, Math.min(160, value * unit));
    }

    // Match mature infinite-canvas input semantics: content follows the
    // fingers, while modifier-wheel input becomes a bounded zoom step.
    function normalizeWheel(event, pageSize) {
      let deltaX = normalizedWheelDelta(
        event.deltaX,
        event.deltaMode,
        pageSize
      );
      let deltaY = normalizedWheelDelta(
        event.deltaY,
        event.deltaMode,
        pageSize
      );
      let deltaZ = 0;
      if (event.ctrlKey || event.metaKey) {
        deltaZ = -Math.max(-10, Math.min(10, deltaY)) / 100;
        deltaX = 0;
        deltaY = 0;
      } else if (event.shiftKey && Math.abs(deltaX) <= .1) {
        deltaX = deltaY;
        deltaY = 0;
      }
      return { x: -deltaX, y: -deltaY, z: deltaZ };
    }

    function resetNativeGesture() {
      nativeGestureActive = false;
      nativeGestureStartScale = 1;
      nativeGesturePreviousPoint = null;
    }

    const nativeGesturePoint = (event) => {
      const bounds = graphBounds || graph.node().getBoundingClientRect();
      const clientX = Number.isFinite(event.clientX)
        ? event.clientX
        : Number.isFinite(event.pageX)
          ? event.pageX
          : bounds.left + bounds.width / 2;
      const clientY = Number.isFinite(event.clientY)
        ? event.clientY
        : Number.isFinite(event.pageY)
          ? event.pageY
          : bounds.top + bounds.height / 2;
      return [
        clientX - bounds.left,
        clientY - bounds.top
      ];
    };

    graph.node().addEventListener('gesturestart', (event) => {
      if (!zoomBehavior || !graphLayer) return;
      event.preventDefault();
      event.stopPropagation();
      nativeGestureActive = true;
      nativeGestureStartScale = d3.zoomTransform(graph.node()).k;
      nativeGesturePreviousPoint = nativeGesturePoint(event);
    }, { passive: false });

    graph.node().addEventListener('gesturechange', (event) => {
      if (
        !nativeGestureActive ||
        !nativeGesturePreviousPoint ||
        !zoomBehavior
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const point = nativeGesturePoint(event);
      const gestureScale =
        Number.isFinite(event.scale) && event.scale > 0 ? event.scale : 1;
      const nextScale = Math.max(
        .4,
        Math.min(3.2, nativeGestureStartScale * gestureScale)
      );
      const deltaX = point[0] - nativeGesturePreviousPoint[0];
      const deltaY = point[1] - nativeGesturePreviousPoint[1];
      graph.call(zoomBehavior.scaleTo, nextScale, point);
      const scaled = d3.zoomTransform(graph.node());
      graph.call(
        zoomBehavior.translateBy,
        deltaX / scaled.k,
        deltaY / scaled.k
      );
      nativeGesturePreviousPoint = point;
    }, { passive: false });

    graph.node().addEventListener('gestureend', (event) => {
      if (!nativeGestureActive) return;
      event.preventDefault();
      event.stopPropagation();
      resetNativeGesture();
    }, { passive: false });

    function revealCardInViewport(node) {
      resetNativeGesture();
      const current = d3.zoomTransform(graph.node());
      const viewportWidth = graph.node().clientWidth;
      const viewportHeight = graph.node().clientHeight;
      const padding = 24;
      const topPadding = 84;
      const left =
        current.x + (node.screenX - nodeCardWidth / 2) * current.k;
      const right =
        current.x + (node.screenX + nodeCardWidth / 2) * current.k;
      const top =
        current.y + (node.screenY + nodeCardTop) * current.k;
      const bottom =
        current.y +
        (node.screenY + nodeCardTop + nodeCardHeight) * current.k;
      let nextX = current.x;
      let nextY = current.y;
      if (left < padding) nextX += padding - left;
      else if (right > viewportWidth - padding) {
        nextX -= right - (viewportWidth - padding);
      }
      if (top < topPadding) nextY += topPadding - top;
      else if (bottom > viewportHeight - padding) {
        nextY -= bottom - (viewportHeight - padding);
      }
      nextX = Math.min(0, nextX);
      if (
        Math.abs(nextX - current.x) > .001 ||
        Math.abs(nextY - current.y) > .001
      ) {
        graph.call(
          zoomBehavior.transform,
          d3.zoomIdentity.translate(nextX, nextY).scale(current.k)
        );
      }
    }

    function captureViewport() {
      if (!zoomBehavior) return null;
      const current = d3.zoomTransform(graph.node());
      return {
        x: current.x,
        y: current.y,
        scale: current.k
      };
    }

    function restoreViewport(snapshot) {
      if (!snapshot || !zoomBehavior) return;
      graph.call(
        zoomBehavior.transform,
        d3.zoomIdentity
          .translate(snapshot.x, snapshot.y)
          .scale(snapshot.scale)
      );
    }

    function renderGraph() {
      const previousTransform = d3.zoomTransform(graph.node());
      if (!forest.trees.some((tree) => tree.id === activeTreeId)) {
        activeTreeId = forest.trees[0]?.id || '';
      }
      const activeIndex = Math.max(
        0,
        forest.trees.findIndex((tree) => tree.id === activeTreeId)
      );
      const activeTree = forest.trees[activeIndex];
      const activeAccent = projectAccentFor(
        activeTree?.id || state.projectId || projectName
      );
      document.documentElement.style.setProperty(
        '--project-accent',
        activeAccent
      );
      send('voyageAccent', { color: activeAccent });
      const nextViewportSignature =
        (state.projectId || projectName) + '|' + activeTreeId;
      const preserveViewport = viewportSignature === nextViewportSignature;
      if (!preserveViewport) {
        resetNativeGesture();
      }
      graph.selectAll('*').remove();
      const viewportWidth = Math.max(
        1,
        document.getElementById('graph').clientWidth
      );
      const width = Math.max(420, viewportWidth);
      const height = Math.max(340, document.getElementById('graph').clientHeight);
      graphBounds = graph.node().getBoundingClientRect();
      const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
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
      const trees = forest.trees;
      canvasTitle.textContent = projectName || '航海图';
      canvasMeta.textContent = trees.length
        ? trees.length +
          ' 条航程 · ' +
          forest.nodeCount +
          ' 轮'
        : '';
      if (trees.length === 0) {
        graph.append('text')
          .attr('class', 'node-meta')
          .attr('x', width / 2)
          .attr('y', height / 2)
          .attr('text-anchor', 'middle')
          .text(
            '当前项目还没有航点'
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
        const expanded = tree.id === activeTreeId;
        const voyageAccent = projectAccentFor(tree.id);
        const root = d3.hierarchy(
          expanded
            ? hierarchyFor(tree)
            : { label: tree.title, children: [] }
        );
        d3.tree()
          .nodeSize([nodeVerticalPitch, nodeHorizontalPitch])
          .separation(() => 1)(root);
        const minX = d3.min(root.descendants(), (node) => node.x) || 0;
        const maxX = d3.max(root.descendants(), (node) => node.x) || 0;
        const baseY = offsetY - minX;
        let treeLeft = Infinity;
        let treeTop = Infinity;
        let treeRight = -Infinity;
        let treeBottom = -Infinity;
        root.each((node) => {
          const isVoyageStart = !node.data.session;
          node.screenX = isVoyageStart
            ? voyageStartX
            : node.y + mapStartX;
          node.screenY = node.x + baseY;
          const cardWidth = isVoyageStart
            ? expanded
              ? startCardWidth
              : collapsedCardWidth
            : nodeCardWidth;
          const cardTop = isVoyageStart
            ? startCardTop
            : nodeCardTop;
          const cardHeight = isVoyageStart
            ? expanded
              ? startCardHeight
              : collapsedCardHeight
            : nodeCardHeight;
          const left = node.screenX - cardWidth / 2 - 5;
          const top = node.screenY - 42;
          const right = node.screenX + cardWidth / 2 + 5;
          const bottom = node.screenY + cardTop + cardHeight + 5;
          contentLeft = Math.min(contentLeft, left);
          contentTop = Math.min(contentTop, top);
          contentRight = Math.max(contentRight, right);
          contentBottom = Math.max(contentBottom, bottom);
          treeLeft = Math.min(treeLeft, left);
          treeTop = Math.min(treeTop, top);
          treeRight = Math.max(treeRight, right);
          treeBottom = Math.max(treeBottom, bottom);
        });
        const mainPath = mainPathFor(tree);
        const current = currentSessionFor(tree);
        const routeIndexById = routeIndexesFor(tree);
        layouts.push({
          tree,
          root,
          expanded,
          voyageAccent,
          bounds: {
            left: treeLeft,
            top: treeTop,
            right: treeRight,
            bottom: treeBottom
          },
          mainPath,
          routeIndexById,
          currentId: current?.id || ''
        });
        offsetY += expanded
          ? Math.max(
              maxX - minX + nodeCardHeight + expandedVoyageGap,
              collapsedVoyagePitch * 2
            )
          : collapsedVoyagePitch;
      }
      const contentBounds = {
        left: contentLeft,
        top: contentTop,
        right: contentRight,
        bottom: contentBottom
      };
      const activeBounds =
        layouts.find((layout) => layout.expanded)?.bounds ||
        contentBounds;
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
        .extent([
          [0, 86],
          [width, Math.max(87, height - 28)]
        ])
        .filter((event) => {
          if (event.type === 'mousedown') return false;
          if (event.type === 'touchstart') {
            return (event.touches?.length || 0) >= 2;
          }
          return true;
        })
        .translateExtent([
          [0, contentTop],
          [Infinity, contentBottom]
        ])
        .on('zoom', (event) => {
          globalThis.__WAYFINDER_VIEWPORT_ACTIVE_UNTIL__ = Date.now() + 320;
          graphLayer.attr('transform', event.transform);
        });
      graph
        .call(zoomBehavior)
        .on('dblclick.zoom', null)
        .on('wheel.zoom', null);
      const handleViewportWheel = (event) => {
            event.preventDefault();
            event.stopPropagation();
            globalThis.__WAYFINDER_VIEWPORT_ACTIVE_UNTIL__ = Date.now() + 320;
            if (
              event.ctrlKey &&
              nativeGestureActive
            ) {
              return;
            }
            const pageSize = graphBounds?.height || graph.node().clientHeight;
            const delta = normalizeWheel(event, pageSize);
            const before = d3.zoomTransform(graph.node());
            if (delta.z) {
              const point = [
                event.clientX - (graphBounds?.left || 0),
                event.clientY - (graphBounds?.top || 0)
              ];
              graph.call(
                zoomBehavior.scaleBy,
                Math.pow(2, delta.z),
                point
              );
            } else if (delta.x || delta.y) {
              graph.call(
                zoomBehavior.translateBy,
                delta.x / before.k,
                delta.y / before.k
              );
            }
      };
      graph.on(
        'wheel.wayfinder',
        handleViewportWheel,
        { passive: false }
      );
      canvasShell.on(
        'wheel.wayfinder',
        (event) => {
          if (graph.node().contains(event.target)) return;
          if (event.target.closest('button, input')) return;
          handleViewportWheel(event);
        },
        { passive: false }
      );

      const allNodes = layouts.flatMap(({
        tree,
        root,
        expanded,
        voyageAccent,
        mainPath,
        routeIndexById,
        currentId
      }) =>
        root.descendants().map((node) => ({
          tree,
          node,
          expanded,
          voyageAccent,
          mainPath,
          routeIndexById,
          currentId
        }))
      );
      const allLinks = layouts.flatMap(({
        tree,
        root,
        expanded,
        voyageAccent,
        mainPath,
        routeIndexById
      }) =>
        root.links().map((link) => ({
          tree,
          link,
          expanded,
          voyageAccent,
          mainPath,
          routeIndexById
        }))
      );
      const narrowFocusNode = allNodes
        .filter(({ tree, node }) => {
          const session = node.data.session;
          if (!session) return false;
          return tree.id === activeTree?.id;
        })
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
        currentId,
        expanded
      }, baseClass, sessionClass, rootClass) => {
        if (!node.data.session) {
          return (
            baseClass +
            ' ' +
            rootClass +
            (expanded ? ' expanded' : ' collapsed')
          );
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
      const collapsedVoyages = layouts.filter((layout) => !layout.expanded);
      const collapsedRoutePath = ({ root }) =>
        'M ' + voyageStartX + ' ' + root.screenY +
        ' C ' + (voyageStartX + 46) + ' ' + root.screenY +
        ', ' + (voyageStartX + 116) + ' ' + root.screenY +
        ', ' + (voyageStartX + 172) + ' ' + root.screenY;
      routeLayer.selectAll('.collapsed-path-bed')
        .data(collapsedVoyages)
        .join('path')
        .attr('class', 'forest-path-bed main collapsed-path-bed')
        .style('--voyage-accent', ({ voyageAccent }) => voyageAccent)
        .attr('d', collapsedRoutePath);
      routeLayer.selectAll('.collapsed-route')
        .data(collapsedVoyages)
        .join('path')
        .attr('class', 'forest-edge route-trunk main collapsed-route')
        .style('--voyage-accent', ({ voyageAccent }) => voyageAccent)
        .attr('pathLength', 1)
        .attr('d', collapsedRoutePath);
      routeLayer.selectAll('.expanded-path-bed')
        .data(allLinks)
        .join('path')
        .attr('class', (item) =>
          'forest-path-bed expanded-path-bed ' +
          (linkClass(item).includes('main') ? 'main' : '') +
          (linkClass(item).includes('dimmed') ? ' dimmed' : '')
        )
        .style('--voyage-accent', ({ voyageAccent }) => voyageAccent)
        .attr('d', branchPath);
      routeLayer.selectAll('.expanded-edge')
        .data(allLinks)
        .join('path')
        .attr('class', (item) =>
          'forest-edge expanded-edge ' + linkClass(item)
        )
        .style('--voyage-accent', ({ voyageAccent }) => voyageAccent)
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
        .style('--voyage-accent', ({ voyageAccent }) => voyageAccent)
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
        .style('--voyage-accent', ({ voyageAccent }) => voyageAccent)
        .attr('transform', ({ node }) =>
          'translate(' + node.screenX + ',' + node.screenY + ')'
        )
        .attr('role', ({ node }) => node.data.session ? null : 'img')
        .attr('aria-label', ({ tree, node }) =>
          node.data.session
            ? null
            : '航程起点，' + tree.title
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
        .style('--voyage-accent', ({ voyageAccent }) => voyageAccent)
        .attr('transform', ({ node }) =>
          'translate(' + node.screenX + ',' + node.screenY + ')'
        )
        .attr('role', ({ node, expanded }) =>
          node.data.session || !expanded ? 'button' : 'img'
        )
        .attr('tabindex', ({ node, expanded }) =>
          node.data.session || !expanded ? 0 : null
        )
        .attr('aria-label', ({ tree, node, expanded }) => {
          const session = node.data.session;
          if (!session) {
            return expanded
              ? '当前航程起点，' + tree.title
              : '展开航程，' + tree.title + '，' +
                tree.sessions.length + ' 个航点';
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
        .attr('data-tree-id', ({ tree, node }) =>
          node.data.session ? null : tree.id
        )
        .attr('data-route-index', ({ node, routeIndexById }) =>
          node.data.session
            ? String(routeIndexById.get(node.data.session.id))
            : null
        )
        .on('click', (event, item) => {
          const session = item.node.data.session;
          event.stopPropagation();
          if (!session) {
            if (!item.expanded) activateVoyage(item.tree.id);
            return;
          }
          selectSession(session, nodeById);
        })
        .on('focus', (event, item) => {
          if (item.node.data.session) revealCardInViewport(item.node);
        })
        .on('keydown', (event, item) => {
          const session = item.node.data.session;
          if (event.key !== 'Enter' && event.key !== ' ') {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (!session) {
            if (!item.expanded) activateVoyage(item.tree.id);
            return;
          }
          selectSession(session, nodeById);
        });
      cards.each(function({ tree, node, expanded }) {
        const selection = d3.select(this);
        const session = node.data.session;
        if (!session) {
          const cardWidth = expanded
            ? startCardWidth
            : collapsedCardWidth;
          const cardHeight = expanded
            ? startCardHeight
            : collapsedCardHeight;
          selection.append('rect')
            .attr('class', 'node-card-shadow')
            .attr('x', -cardWidth / 2 + 2)
            .attr('y', startCardTop + 3)
            .attr('width', cardWidth)
            .attr('height', cardHeight)
            .attr('rx', 7);
          selection.append('rect')
            .attr('class', 'node-card-bg')
            .attr('x', -cardWidth / 2)
            .attr('y', startCardTop)
            .attr('width', cardWidth)
            .attr('height', cardHeight)
            .attr('rx', 7);
          const titleLines = cardTextLines(
            tree.title,
            22,
            2
          );
          const title = selection.append('text')
            .attr('class', 'tree-node-title')
            .attr('x', 0);
          titleLines.forEach((line, index) => {
            title.append('tspan')
              .attr('x', 0)
              .attr('y', startCardTop + 19 + index * 13)
              .text(line);
          });
          selection.append('text')
            .attr('class', 'tree-node-meta')
            .attr('x', 0)
            .attr('y', startCardTop + cardHeight - 9)
            .text(
              expanded
                ? '当前航程 · ' + tree.sessions.length + ' 个航点'
                : tree.sessions.length + ' 个航点 · 点击展开'
            );
          return;
        }
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

      if (preserveViewport) {
        graph.call(zoomBehavior.transform, previousTransform);
      } else {
        fitGraph(
          viewportWidth,
          height,
          activeBounds,
          minimumReadableScale,
          narrowFocusRight
        );
      }
      viewportSignature = nextViewportSignature;
    }

    function activateVoyage(treeId) {
      if (!treeId || treeId === activeTreeId) return;
      activeTreeId = treeId;
      selectedSessionId = '';
      showEmptyInspector();
      viewportSignature = '';
      renderGraph();
      canvasTitle.focus();
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
      const inspectorWasOpen = inspector.classList.contains('open');
      if (!inspectorWasOpen) {
        viewportBeforeInspector = captureViewport();
      }
      selectedSessionId = session.id;
      lastFocusedSessionId = session.id;
      showInspector(session, nodeById, true);
      if (!inspectorWasOpen) {
        viewportSignature = '';
      }
      renderGraph();
      requestAnimationFrame(revealSelectedSession);
    }

    function revealSelectedSession() {
      const selectedCard = document.querySelector('.session-card.selected');
      const selectedNode = selectedCard?.__data__?.node;
      if (selectedNode) {
        revealCardInViewport(selectedNode);
      }
    }

    function showInspector(session, nodeById, focusTitle) {
      const selectedTree = forest.trees.find((tree) =>
        tree.sessions.some((candidate) => candidate.id === session.id)
      );
      const accent = session.verdict === 'success'
        ? 'var(--good)'
        : session.verdict === 'failure'
          ? 'var(--coral)'
          : projectAccentFor(selectedTree?.id || activeTreeId);
      inspector.style.setProperty('--inspector-accent', accent);
      layout.classList.add('inspector-open');
      inspector.classList.add('open');
      inspector.classList.toggle('good', session.verdict === 'success');
      inspector.classList.toggle('bad', session.verdict === 'failure');
      inspector.replaceChildren();
      const head = document.createElement('header');
      head.className = 'inspector-head';
      const copy = document.createElement('div');
      copy.className = 'inspector-copy';
      const close = actionButton(
        'close',
        '关闭详情',
        () => closeInspector(true)
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
      copy.append(kicker, title, meta);
      head.append(copy, close);
      const turns = document.createElement('div');
      turns.className = 'inspector-turns';
      session.nodeIds
        .map((id) => nodeById.get(id))
        .filter(Boolean)
        .forEach((node) => turns.append(renderTurn(node)));
      inspector.append(head, turns);
      if (focusTitle) {
        title.focus();
      }
    }

    function responseGroups(value) {
      const groups = [];
      let current = { kind: 'body', lines: [] };
      String(value || '').split('\\n').forEach((rawLine) => {
        const line = rawLine.trim();
        const heading = line.replace(/[：:]$/, '');
        const kind =
          heading === '结果'
            ? 'outcome'
            : heading === '行动'
              ? 'actions'
              : heading === '沉淀'
                ? 'learned'
                : '';
        if (kind) {
          if (current.lines.length) groups.push(current);
          current = { kind, lines: [] };
          return;
        }
        if (line) current.lines.push(line);
      });
      if (current.lines.length) groups.push(current);
      return groups;
    }

    function appendResponse(section, value) {
      const groups = responseGroups(value);
      if (groups.length === 0) return;
      groups.forEach((group) => {
        if (group.kind === 'actions') {
          const list = document.createElement('ul');
          list.className = 'detail-list';
          group.lines.forEach((line) => {
            const item = document.createElement('li');
            item.textContent = line.replace(/^[-*]\\s*/, '');
            list.append(item);
          });
          section.append(list);
          return;
        }
        const block = document.createElement(
          group.kind === 'learned' ? 'div' : 'p'
        );
        block.className =
          group.kind === 'learned' ? 'detail-note' : 'detail-text';
        block.textContent = group.lines
          .map((line) => line.replace(/^[-*]\\s*/, ''))
          .join('\\n');
        section.append(block);
      });
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
        appendResponse(section, node.response);
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

    function showEmptyInspector() {
      selectedSessionId = '';
      viewportBeforeInspector = null;
      layout.classList.remove('inspector-open');
      inspector.classList.remove('open');
      inspector.classList.remove('good', 'bad');
      inspector.style.removeProperty('--inspector-accent');
      inspector.replaceChildren();
      graphLayer?.selectAll('.forest-node, .forest-card')
        .classed('selected', false)
        .classed('dimmed', false);
      graphLayer?.selectAll('.journey-selected-ring').remove();
      graphLayer?.selectAll('.forest-path-bed, .forest-edge')
        .classed('dimmed', false);
      graphLayer?.selectAll('.forest-card[data-session-id]')
        .attr('aria-pressed', 'false');
      lastFocusedSessionId = '';
    }

    function closeInspector(restoreFocus = false) {
      const focusSessionId = restoreFocus ? lastFocusedSessionId : '';
      const previousViewport = viewportBeforeInspector;
      showEmptyInspector();
      if (state) {
        viewportSignature = '';
        renderGraph();
      }
      if (focusSessionId) {
        document.querySelector(
          '[data-session-id="' + focusSessionId + '"]'
        )?.focus();
      }
      restoreViewport(previousViewport);
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
      const groups = responseGroups(value);
      const preferred =
        groups.find((group) => group.kind === 'outcome') ||
        groups.find((group) => group.kind === 'body') ||
        groups[0];
      return (preferred?.lines.join(' ') || String(value || ''))
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
      const x = Math.min(0, sideInset - bounds.left * scale);
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
      const previousProjectId = state?.projectId;
      state = event.data.state;
      forest = event.data.forest;
      projectName = event.data.projectName;
      const projectChanged =
        Boolean(previousProjectId) && previousProjectId !== state.projectId;
      if (projectChanged) {
        showEmptyInspector();
      }
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
      const selected = forest.trees
        .flatMap((tree) => tree.sessions)
        .find((session) => session.id === selectedSessionId);
      if (!selected && inspector.classList.contains('open')) {
        showEmptyInspector();
      }
      renderGraph();
      if (selected) {
        showInspector(
          selected,
          new Map(state.nodes.map((node) => [node.id, node])),
          focusWasTitle
        );
        requestAnimationFrame(revealSelectedSession);
      }
      if (focusKey) {
        const target = [...document.querySelectorAll('[data-focus-key]')]
          .find((element) => element.dataset.focusKey === focusKey);
        target?.focus();
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && inspector.classList.contains('open')) {
        closeInspector(true);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (
        !inspector.classList.contains('open') ||
        inspector.contains(event.target) ||
        event.target.closest('.session-card')
      ) {
        return;
      }
      closeInspector();
    });
    window.addEventListener('resize', () => {
      if (!state) return;
      renderGraph();
      if (selectedSessionId) {
        requestAnimationFrame(revealSelectedSession);
      }
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
