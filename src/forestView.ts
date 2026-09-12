import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildConversationForest } from "./conversationForest";
import { hostHooksInstalled } from "./hostInstaller";
import { AgentHost, ProjectState } from "./models";
import {
  projectDataDir,
  readProjectConfig,
  readProjectState
} from "./storage";

export interface TimelineHandlers {
  installHooks(): Promise<void>;
  openMap(treeId?: string): Promise<void>;
  refresh(): Promise<void>;
  setVerdict(nodeId: string, verdict?: "success" | "failure"): Promise<void>;
  setNote(nodeId: string): Promise<void>;
  openDiff(nodeId: string): Promise<void>;
  restore(nodeId: string): Promise<void>;
  configureValidation(): Promise<void>;
}

export class TimelineViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private refreshGeneration = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly root: string,
    private readonly handlers: TimelineHandlers
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.refreshGeneration += 1;
      }
    });
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.joinPath(this.extensionUri, "media"),
        vscode.Uri.joinPath(this.extensionUri, "node_modules")
      ]
    };
    let operationInFlight = false;
    view.webview.onDidReceiveMessage(async (message: any) => {
      const isOperation = !["ready", "refresh"].includes(message?.type);
      if (isOperation && operationInFlight) {
        return;
      }
      if (isOperation) {
        operationInFlight = true;
        await view.webview.postMessage({ type: "operation", status: "busy" });
      }
      let failed = false;
      try {
        switch (message?.type) {
          case "ready":
          case "refresh":
            await this.handlers.refresh();
            break;
          case "install":
            await this.handlers.installHooks();
            break;
          case "openMap":
            await this.handlers.openMap(message.treeId);
            break;
          case "verdict":
            await this.handlers.setVerdict(message.nodeId, message.verdict);
            break;
          case "note":
            await this.handlers.setNote(message.nodeId);
            break;
          case "diff":
            await this.handlers.openDiff(message.nodeId);
            break;
          case "restore":
            await this.handlers.restore(message.nodeId);
            break;
          case "configure":
            await this.handlers.configureValidation();
            break;
          default:
            break;
        }
      } catch (error) {
        failed = true;
        const detail = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Wayfinder 操作失败：${detail}`);
        await view.webview.postMessage({
          type: "operation",
          status: "error",
          message: "操作失败，请查看通知"
        });
      } finally {
        if (isOperation) {
          operationInFlight = false;
          if (!failed) {
            await view.webview.postMessage({
              type: "operation",
              status: "idle"
            });
          }
        }
      }
    });
    view.webview.html = this.html(view.webview);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const view = this.view;
    if (!view) {
      return;
    }
    const generation = ++this.refreshGeneration;
    const [state, connections, config, hookError] = await Promise.all([
      readProjectState(this.root),
      Promise.all(
        (["trae", "claude", "codex"] as AgentHost[]).map(async (host) => ({
          host,
          connected: await hostHooksInstalled(this.root, host)
        }))
      ),
      readProjectConfig(this.root),
      readLastHookError(this.root)
    ]);
    if (
      this.view !== view ||
      generation !== this.refreshGeneration
    ) {
      return;
    }
    const connectedHosts = connections
      .filter((connection) => connection.connected)
      .map((connection) => connection.host);
    const resolved = state || emptyState(this.root);
    await view.webview.postMessage({
      type: "render",
      state: resolved,
      forest: buildConversationForest(resolved),
      connected: connectedHosts.length > 0,
      connectedHosts,
      validationCommand: config.validationCommand || "",
      hookError
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
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
    const d3 = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "d3.min.js")
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");
    const lineageCardWidth = 128;
    const lineageCardGap = 14;

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
      --warn: var(--vscode-editorWarning-foreground, #b77a13);
      --muted: var(--vscode-descriptionForeground, #777);
      --line: var(--vscode-panel-border, rgba(128,128,128,.24));
      --surface: var(--vscode-sideBar-background, #fff);
      --surface-2: var(--vscode-editorWidget-background, #f5f5f7);
      --hover: var(--vscode-list-hoverBackground, rgba(128,128,128,.09));
      --selected: var(--vscode-list-activeSelectionBackground, rgba(0,122,255,.12));
      --ocean: #eaf7fb;
      --ocean-line: #95d6e5;
      --route: #2f9fbd;
      --route-dark: #176f89;
      --route-trunk: #2f9fbd;
      --route-blue: #4d9ff8;
      --route-violet: #8c72db;
      --route-gold: #d79b32;
      --wake: #ffffff;
      --sand: #f4d38b;
      --shore: #c79243;
      --sun: #f3bd4f;
      --coral: #ee7469;
      --paper: #fffdf7;
      --ink: #254852;
      --sticker-muted: #647980;
      --sticker-shadow: rgba(25, 92, 108, .24);
      --port-roof: #c79243;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--vscode-foreground, #1d1d1f);
      background: var(--surface);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      letter-spacing: 0;
    }
    body.sheet-open { overflow: hidden; }
    button, input { color: inherit; font: inherit; }
    button { letter-spacing: 0; }
    .shell { min-width: 0; padding: 0 12px 20px; }
    .summary {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      min-height: 42px;
      align-items: center;
      justify-content: space-between;
      margin: 0 -12px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }
    .summary-left {
      display: flex;
      min-width: 0;
      flex: 1 1 auto;
      align-items: center;
      gap: 8px;
    }
    .recording-dot {
      width: 7px;
      height: 7px;
      flex: 0 0 7px;
      border-radius: 50%;
      background: var(--muted);
    }
    .recording-dot.on {
      background: var(--good);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--good) 14%, transparent);
    }
    .summary-title {
      min-width: 0;
      overflow: hidden;
      font-size: 11px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .summary-meta {
      flex: 0 0 auto;
      margin-left: 8px;
      color: var(--muted);
      font-size: 10px;
      white-space: nowrap;
    }
    .notice {
      min-height: 18px;
      padding: 3px 0;
      color: var(--muted);
      font-size: 10px;
    }
    .notice:empty { display: none; }
    .tools {
      position: sticky;
      top: 42px;
      z-index: 4;
      margin: 0 -12px;
      padding: 9px 12px 10px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }
    .search {
      display: flex;
      height: 31px;
      align-items: center;
      gap: 7px;
      padding: 0 9px;
      border: 1px solid var(--vscode-input-border, var(--line));
      border-radius: 6px;
      color: var(--muted);
      background: var(--vscode-input-background, var(--surface-2));
    }
    .search:focus-within { border-color: var(--accent); color: inherit; }
    .search input {
      width: 100%;
      min-width: 0;
      padding: 0;
      border: 0;
      outline: 0;
      color: var(--vscode-input-foreground, inherit);
      background: transparent;
      font-size: 11px;
    }
    .voyage-pager {
      position: sticky;
      top: 92px;
      z-index: 3;
      display: grid;
      min-height: 64px;
      grid-template-columns: 30px minmax(0, 1fr) 30px;
      gap: 8px;
      align-items: center;
      margin: 0 -12px;
      padding: 9px 12px 10px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }
    .pager-button {
      display: grid;
      width: 28px;
      height: 28px;
      padding: 0;
      place-items: center;
      border: 2px solid white;
      border-radius: 50%;
      color: var(--ink);
      background: var(--paper);
      box-shadow: 1px 2px 0 var(--sticker-shadow);
      cursor: pointer;
      transition: transform 130ms ease, box-shadow 130ms ease;
    }
    .pager-button:not(:disabled):hover {
      transform: translateY(-1px) rotate(-2deg);
      box-shadow: 2px 3px 0 var(--sticker-shadow);
    }
    .pager-button:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--accent));
      outline-offset: 2px;
    }
    .pager-button:disabled {
      opacity: .28;
      box-shadow: none;
      cursor: default;
    }
    .voyage-copy { min-width: 0; text-align: center; }
    .voyage-kicker {
      display: block;
      color: var(--muted);
      font-size: 8px;
      font-weight: 700;
      letter-spacing: .04em;
    }
    .voyage-title {
      display: block;
      margin-top: 2px;
      overflow-wrap: anywhere;
      font-size: 13px;
      font-weight: 750;
      line-height: 17px;
    }
    .voyage-meta {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 9px;
    }
    .session {
      position: relative;
      margin: 6px 0 0 var(--depth);
    }
    .session::before {
      position: absolute;
      top: 0;
      bottom: -7px;
      left: -8px;
      width: 1px;
      background: color-mix(in srgb, var(--muted) 34%, transparent);
      content: "";
    }
    .session::after {
      position: absolute;
      top: 21px;
      left: -8px;
      width: 8px;
      height: 1px;
      background: color-mix(in srgb, var(--muted) 34%, transparent);
      content: "";
    }
    .session-main {
      display: grid;
      width: 100%;
      min-height: 54px;
      grid-template-columns: 4px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: stretch;
      padding: 7px 8px;
      border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
      border-radius: 6px;
      color: var(--vscode-foreground, #1d1d1f);
      text-align: left;
      background: color-mix(in srgb, var(--surface-2) 70%, transparent);
      cursor: pointer;
      transition: border-color 130ms ease, background 130ms ease;
    }
    .session-main:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); background: var(--hover); }
    .session.open .session-main { border-color: color-mix(in srgb, var(--accent) 65%, var(--line)); background: var(--selected); }
    .session-status { width: 3px; border-radius: 2px; background: var(--muted); opacity: .7; }
    .session.good .session-status { background: var(--good); opacity: 1; }
    .session.bad .session-status { background: var(--bad); opacity: 1; }
    .session-copy { min-width: 0; }
    .session-kicker { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9px; font-weight: 600; }
    .session-branch { color: var(--accent); }
    .session-title {
      margin-top: 3px;
      color: var(--vscode-foreground, #1d1d1f);
      font-size: 11px;
      font-weight: 600;
      line-height: 15px;
    }
    .session-foot { display: flex; align-items: center; gap: 5px; margin-top: 4px; color: var(--muted); font-size: 9px; }
    .turn-dots { display: flex; min-width: 0; align-items: center; gap: 3px; }
    .turn-dot { width: 5px; height: 5px; flex: 0 0 5px; border-radius: 50%; background: var(--muted); opacity: .55; }
    .turn-dot.good { background: var(--good); opacity: 1; }
    .turn-dot.bad { background: var(--bad); opacity: 1; }
    .session-count { align-self: center; color: var(--muted); font-size: 10px; white-space: nowrap; }
    .turn-list {
      display: none;
      margin: 2px 0 0 9px;
      padding: 3px 0 2px 9px;
      border-left: 1px solid var(--line);
    }
    .session.open .turn-list { display: block; }
    .turn { border-bottom: 1px solid color-mix(in srgb, var(--line) 62%, transparent); }
    .turn-main {
      display: grid;
      width: 100%;
      min-height: 42px;
      grid-template-columns: 7px minmax(0, 1fr);
      gap: 7px;
      align-items: center;
      padding: 6px 4px;
      border: 0;
      text-align: left;
      background: transparent;
      cursor: pointer;
    }
    .turn-main:hover { background: var(--hover); }
    .turn.selected .turn-main { background: var(--selected); }
    .turn-marker { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); opacity: .65; }
    .turn.good .turn-marker { background: var(--good); opacity: 1; }
    .turn.bad .turn-marker { background: var(--bad); opacity: 1; }
    .turn-copy { min-width: 0; }
    .turn-title { display: block; color: var(--vscode-foreground, #1d1d1f); font-size: 10px; font-weight: 550; line-height: 14px; white-space: normal; }
    .turn-meta { display: flex; gap: 5px; margin-top: 2px; color: var(--muted); font-size: 9px; }
    .turn-detail { display: none; padding: 7px 5px 10px 20px; }
    .turn.selected .turn-detail { display: block; animation: reveal 140ms ease-out; }
    .detail-label { margin: 7px 0 3px; color: var(--muted); font-size: 9px; font-weight: 650; }
    .detail-text { margin: 0; overflow-wrap: anywhere; font-size: 10px; line-height: 1.55; white-space: pre-wrap; }
    .detail-source { margin: 0 0 7px; overflow-wrap: anywhere; color: var(--muted); font-size: 9px; }
    .detail-files { display: grid; gap: 4px; margin-top: 8px; }
    .detail-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; color: var(--muted); font-size: 9px; }
    .detail-file-name { min-width: 0; overflow-wrap: anywhere; }
    .detail-file-count { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .detail-file-add { color: var(--good); }
    .detail-file-delete { color: var(--bad); }
    .note { margin-top: 8px; padding-left: 8px; overflow-wrap: anywhere; border-left: 2px solid var(--accent); font-size: 10px; line-height: 1.5; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px; margin-top: 7px; }
    .icon-button {
      display: inline-grid;
      width: 26px;
      height: 26px;
      padding: 0;
      place-items: center;
      border: 0;
      border-radius: 5px;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
    }
    .icon-button:hover { color: inherit; background: var(--hover); }
    .icon-button.active-good { color: var(--good); }
    .icon-button.active-bad { color: var(--bad); }
    .pending { padding: 10px 4px; color: var(--muted); font-size: 10px; }
    .empty { display: grid; min-height: 230px; place-content: center; padding: 30px 16px; text-align: center; }
    .empty .codicon { margin: 0 auto 12px; color: var(--muted); font-size: 24px; }
    .empty strong { font-size: 12px; }
    .empty p { max-width: 230px; margin: 6px auto 14px; color: var(--muted); font-size: 10px; line-height: 1.5; }
    .primary { min-height: 28px; padding: 4px 12px; border: 0; border-radius: 5px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    .empty { padding: 34px 12px; color: var(--muted); text-align: center; font-size: 10px; }
    .lineage-section {
      padding: 12px 0 16px;
      border-bottom: 1px solid var(--line);
    }
    .lineage-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0 2px 9px;
    }
    .lineage-heading-main {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 7px;
    }
    .lineage-glyph {
      display: grid;
      width: 17px;
      height: 17px;
      flex: 0 0 17px;
      place-items: center;
      border-radius: 50%;
      background: color-mix(in srgb, var(--sun) 28%, var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sun) 58%, transparent);
    }
    .lineage-glyph .codicon { color: var(--route-dark); font-size: 11px; }
    .lineage-title {
      font-size: 12px;
      font-weight: 700;
      line-height: 16px;
    }
    .lineage-meta {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 9px;
    }
    .lineage-canvas {
      position: relative;
      width: 100%;
      overflow: hidden;
      border-radius: 8px;
      border: 2px solid white;
      background: var(--ocean);
      box-shadow: 2px 3px 0 var(--sticker-shadow);
      cursor: grab;
      touch-action: none;
    }
    .lineage-canvas:active { cursor: grabbing; }
    .lineage-stage {
      position: relative;
      transform-origin: top left;
    }
    .lineage-canvas svg {
      display: block;
      overflow: visible;
    }
    .lineage-label-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .lineage-path-bed,
    .lineage-edge {
      fill: none;
      stroke-linecap: round;
    }
    .lineage-path-bed {
      stroke: color-mix(in srgb, var(--wake) 88%, var(--ocean));
      stroke-width: 22;
      filter: drop-shadow(1px 2px 0 var(--sticker-shadow));
    }
    .lineage-path-bed.main {
      stroke-width: 23;
    }
    .lineage-path-bed.dimmed { opacity: .16; }
    .lineage-edge {
      stroke: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 42%,
        var(--ocean)
      );
      stroke-width: 16;
      opacity: 1;
      animation: channel-reveal 260ms ease-out both;
    }
    .lineage-edge.main {
      stroke-width: 17;
    }
    .lineage-edge.route-trunk,
    .lineage-node.route-trunk,
    .lineage-node-button.route-trunk,
    .lineage-detail-sheet.route-trunk {
      --route-accent: var(--route-trunk);
    }
    .lineage-edge.route-0,
    .lineage-edge.route-3,
    .lineage-node.route-0,
    .lineage-node.route-3,
    .lineage-node-button.route-0,
    .lineage-node-button.route-3,
    .lineage-detail-sheet.route-0,
    .lineage-detail-sheet.route-3 {
      --route-accent: var(--route-blue);
    }
    .lineage-edge.route-1,
    .lineage-edge.route-4,
    .lineage-node.route-1,
    .lineage-node.route-4,
    .lineage-node-button.route-1,
    .lineage-node-button.route-4,
    .lineage-detail-sheet.route-1,
    .lineage-detail-sheet.route-4 {
      --route-accent: var(--route-violet);
    }
    .lineage-edge.route-2,
    .lineage-edge.route-5,
    .lineage-node.route-2,
    .lineage-node.route-5,
    .lineage-node-button.route-2,
    .lineage-node-button.route-5,
    .lineage-detail-sheet.route-2,
    .lineage-detail-sheet.route-5 {
      --route-accent: var(--route-gold);
    }
    .lineage-edge.good {
      stroke: color-mix(in srgb, var(--good) 58%, var(--ocean));
      stroke-width: 17;
    }
    .lineage-edge.bad {
      stroke: color-mix(in srgb, var(--coral) 62%, var(--ocean));
      stroke-width: 16;
      stroke-dasharray: none;
    }
    .channel-decoration {
      pointer-events: none;
      filter: drop-shadow(1px 1px 0 var(--sticker-shadow));
    }
    .channel-decoration.dimmed { opacity: .16; }
    .channel-decoration path {
      fill: none;
      stroke: white;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .channel-decoration circle {
      fill: white;
      stroke: color-mix(in srgb, var(--route-dark) 60%, transparent);
      stroke-width: .8;
    }
    .lineage-node {
      opacity: 1;
      transition: opacity 150ms ease;
      animation: node-pop 240ms cubic-bezier(.2,.8,.2,1) both;
    }
    .lineage-node.dimmed { opacity: .2; }
    .lineage-node-button.dimmed { opacity: .2; }
    .journey-disc {
      fill: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 22%,
        var(--surface)
      );
      stroke: var(--route-accent, var(--route));
      stroke-width: 2.2;
    }
    .journey-sticker-shadow { fill: var(--sticker-shadow); }
    .journey-sticker-outline { fill: white; }
    .lineage-node.good .journey-disc {
      fill: var(--good);
      stroke: color-mix(in srgb, var(--good) 72%, black);
    }
    .lineage-node.bad .journey-disc {
      fill: var(--coral);
      stroke: color-mix(in srgb, var(--coral) 72%, black);
    }
    .journey-status {
      fill: color-mix(in srgb, var(--muted) 68%, var(--surface));
    }
    .lineage-node.good .journey-status,
    .lineage-node.bad .journey-status {
      fill: none;
      stroke: white;
      stroke-width: 1.8;
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
      stroke-width: 5;
    }
    .ocean-current {
      fill: none;
      stroke: color-mix(in srgb, var(--ocean-line) 58%, transparent);
      stroke-width: 1;
      stroke-dasharray: 3 8;
      stroke-linecap: round;
    }
    .ocean-wave {
      fill: none;
      stroke: color-mix(in srgb, var(--ocean-line) 78%, var(--route-dark));
      stroke-width: 2;
      stroke-linecap: round;
    }
    .shore-fill { fill: var(--sand); opacity: .92; }
    .shore-line { fill: none; stroke: white; stroke-width: 5; filter: drop-shadow(1px 2px 0 var(--sticker-shadow)); }
    .shore-ink { fill: none; stroke: var(--shore); stroke-width: 1.4; }
    .trail-start-pole {
      fill: none;
      stroke: var(--shore);
      stroke-width: 1.8;
      stroke-linecap: round;
    }
    .trail-start-flag {
      fill: var(--sun);
      stroke: color-mix(in srgb, var(--sun) 65%, var(--shore));
      stroke-width: 1.2;
      stroke-linejoin: round;
      filter: drop-shadow(0 2px 1px color-mix(in srgb, var(--shore) 20%, transparent));
    }
    .sailboat {
      filter: drop-shadow(2px 3px 0 var(--sticker-shadow));
      animation: boat-bob 1.9s ease-in-out infinite;
    }
    .sailboat-mast { stroke: var(--route-dark); stroke-width: 1.4; stroke-linecap: round; }
    .sailboat-sail { fill: color-mix(in srgb, var(--sun) 82%, white); stroke: var(--shore); stroke-width: 1; stroke-linejoin: round; }
    .sailboat-hull { fill: var(--route-accent, var(--route)); stroke: var(--route-dark); stroke-width: 1.1; stroke-linejoin: round; }
    .lineage-node.good .sailboat-hull { fill: var(--good); }
    .lineage-node.bad .sailboat-hull { fill: var(--coral); }
    .sailboat-wake { fill: none; stroke: color-mix(in srgb, white 72%, var(--ocean-line)); stroke-width: 1.4; stroke-linecap: round; }
    .sailboat-sticker-outline { fill: none; stroke: white; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
    .port-flag { filter: drop-shadow(1px 2px 0 var(--sticker-shadow)); }
    .reef-sticker { filter: drop-shadow(2px 3px 0 var(--sticker-shadow)); }
    .reef-outline { fill: white; stroke: white; stroke-width: 5; stroke-linejoin: round; }
    .reef-rock { fill: var(--coral); stroke: var(--ink); stroke-width: 1.2; stroke-linejoin: round; }
    .reef-cross { fill: none; stroke: white; stroke-width: 1.8; stroke-linecap: round; }
    .current-status-badge { stroke: white; stroke-width: 1; }
    .lineage-node.good .current-status-badge { fill: var(--good); }
    .lineage-node.bad .current-status-badge { fill: var(--coral); }
    .lineage-node-button {
      position: absolute;
      z-index: 1;
      display: grid;
      width: ${lineageCardWidth}px;
      min-height: 34px;
      padding: 5px 7px;
      align-content: center;
      justify-items: center;
      border: 2px solid white;
      border-radius: 7px;
      color: var(--ink);
      text-align: center;
      background: color-mix(in srgb, var(--paper) 94%, transparent);
      box-shadow: 1px 2px 0 var(--sticker-shadow);
      cursor: pointer;
      pointer-events: auto;
      transform: translate(-50%, 4px);
      transition: color 130ms ease, background 130ms ease, transform 130ms ease, box-shadow 130ms ease;
    }
    .lineage-node-button::before {
      position: absolute;
      top: -5px;
      left: 50%;
      width: 16px;
      height: 4px;
      transform: translateX(-50%);
      border: 1px solid white;
      border-radius: 2px;
      background: color-mix(
        in srgb,
        var(--node-accent, var(--route-accent, var(--route))) 78%,
        white
      );
      box-shadow: 1px 1px 0 var(--sticker-shadow);
      content: "";
    }
    .lineage-node-button.good { --node-accent: var(--good); }
    .lineage-node-button.bad { --node-accent: var(--coral); }
    .lineage-node-button:hover {
      background: var(--paper);
      transform: translate(-50%, 3px);
      box-shadow: 2px 3px 0 var(--sticker-shadow);
    }
    .lineage-node-button.selected {
      color: var(--ink);
      background: color-mix(
        in srgb,
        var(--route-accent, var(--route)) 12%,
        var(--paper)
      );
    }
    .lineage-node-button:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--accent));
      outline-offset: 1px;
    }
    .lineage-node-title {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      font-size: 10.5px;
      font-weight: 700;
      line-height: 13px;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .lineage-detail-sheet {
      position: fixed;
      right: 10px;
      bottom: 10px;
      left: 10px;
      z-index: 12;
      display: grid;
      max-height: min(62vh, 560px);
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      border: 2px solid white;
      border-radius: 14px;
      color: var(--ink);
      background: var(--paper);
      box-shadow: 3px 5px 0 var(--sticker-shadow),
        0 -6px 26px rgba(22, 69, 82, .16);
      animation: sheet-in 170ms cubic-bezier(.2, .8, .2, 1);
    }
    .lineage-detail-sheet::before {
      position: absolute;
      top: 7px;
      left: 50%;
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: color-mix(in srgb, var(--route-accent, var(--route)) 45%, white);
      content: "";
      transform: translateX(-50%);
    }
    .sheet-head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: grid;
      min-width: 0;
      grid-template-columns: 5px minmax(0, 1fr) 28px;
      gap: 10px;
      align-items: start;
      padding: 16px 12px 11px;
      background: color-mix(in srgb, var(--route-accent, var(--route)) 7%, var(--paper));
      border-bottom: 1px solid color-mix(in srgb, var(--route-accent, var(--route)) 22%, transparent);
    }
    .sheet-head::before {
      grid-row: 1 / span 3;
      align-self: stretch;
      border-radius: 3px;
      background: var(--route-accent, var(--route));
      content: "";
    }
    .lineage-detail-sheet.good { --route-accent: var(--good); }
    .lineage-detail-sheet.bad { --route-accent: var(--coral); }
    .sheet-copy { min-width: 0; }
    .sheet-kicker {
      color: color-mix(in srgb, var(--route-accent, var(--route)) 78%, var(--ink));
      font-size: 9px;
      font-weight: 700;
      letter-spacing: .03em;
    }
    .sheet-title {
      display: block;
      margin-top: 3px;
      overflow-wrap: anywhere;
      outline: 0;
      font-size: 13px;
      font-weight: 750;
      line-height: 17px;
    }
    .sheet-meta {
      margin-top: 4px;
      color: var(--sticker-muted);
      font-size: 9px;
    }
    .sheet-close {
      display: grid;
      width: 26px;
      height: 26px;
      padding: 0;
      place-items: center;
      border: 2px solid white;
      border-radius: 50%;
      color: var(--ink);
      background: var(--paper);
      box-shadow: 1px 2px 0 var(--sticker-shadow);
      cursor: pointer;
    }
    .sheet-close:hover { transform: translateY(-1px) rotate(-3deg); }
    .sheet-close:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--accent));
      outline-offset: 2px;
    }
    .sheet-turns {
      min-height: 0;
      /* Show about three turns; the rest scroll with a visible rail. */
      max-height: 216px;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 8px 12px 14px;
      scrollbar-width: thin;
      scrollbar-color: color-mix(in srgb, var(--route-accent, var(--route)) 55%, transparent) transparent;
    }
    .sheet-turns::-webkit-scrollbar {
      width: 8px;
    }
    .sheet-turns::-webkit-scrollbar-thumb {
      border: 2px solid var(--paper);
      border-radius: 8px;
      background: color-mix(in srgb, var(--route-accent, var(--route)) 55%, transparent);
    }
    .sheet-turns::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--route-accent, var(--route)) 75%, transparent);
    }
    .sheet-turns::-webkit-scrollbar-track {
      background: transparent;
    }
    .sheet-turns .turn {
      border-bottom: 1px solid color-mix(in srgb, var(--sticker-shadow) 30%, transparent);
    }
    .sheet-turns .turn:last-child { border-bottom: 0; }
    @keyframes sheet-in {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes node-pop {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes channel-reveal {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes bud-breathe {
      0%, 100% { opacity: .8; r: 14px; }
      50% { opacity: .2; r: 18px; }
    }
    @keyframes boat-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-1.5px); }
    }
    body.busy button { pointer-events: none; opacity: .55; }
    @keyframes reveal {
      from { opacity: 0; transform: translateY(-3px); }
      to { opacity: 1; transform: translateY(0); }
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
  <main class="shell">
    <header class="summary">
      <div class="summary-left">
        <span id="recording" class="recording-dot"></span>
        <span id="summaryTitle" class="summary-title">Wayfinder</span>
      </div>
      <span id="summaryMeta" class="summary-meta"></span>
    </header>
    <div id="notice" class="notice" role="status" aria-live="polite"></div>
    <section id="content"></section>
  </main>
  <script nonce="${nonce}" src="${d3}"></script>
  <script nonce="${nonce}">
    const wayfinderApi = acquireVsCodeApi();
    const content = document.getElementById('content');
    const recording = document.getElementById('recording');
    const summaryTitle = document.getElementById('summaryTitle');
    const summaryMeta = document.getElementById('summaryMeta');
    const notice = document.getElementById('notice');
    const saved = typeof wayfinderApi.getState === 'function'
      ? wayfinderApi.getState() || {}
      : {};
    const expandedSessions = new Set(saved.expandedSessions || []);
    let selectedId = saved.selectedId || '';
    let selectedSessionId = saved.selectedSessionId || '';
    let activeTreeId = saved.activeTreeId || '';
    let query = '';
    let composingSearch = false;
    let searchTimer;
    let latestPayload;
    const lineageViewports = new Map();
    let renderCleanups = [];

    const icon = (name) => {
      const value = document.createElement('span');
      value.className = 'codicon codicon-' + name;
      value.setAttribute('aria-hidden', 'true');
      return value;
    };
    const hostName = (host) => host === 'trae'
      ? 'TraeCode'
      : host === 'claude'
        ? 'Claude Code'
        : host === 'codex'
          ? 'Codex'
          : host;
    const send = (type, extra) =>
      wayfinderApi.postMessage(Object.assign({ type }, extra || {}));

    function remember() {
      if (typeof wayfinderApi.setState !== 'function') return;
      wayfinderApi.setState({
        expandedSessions: [...expandedSessions],
        selectedId,
        selectedSessionId,
        activeTreeId
      });
    }

    function render(payload) {
      renderCleanups.splice(0).forEach((cleanup) => cleanup());
      const activeElement = document.activeElement;
      const searchWasFocused = activeElement?.matches('.search input');
      const focusKey = activeElement?.dataset?.focusKey || '';
      if (searchWasFocused) {
        query = activeElement.value.trim().toLocaleLowerCase('zh-CN');
      }
      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = undefined;
      }
      latestPayload = payload;
      const state = payload.state;
      const forest = payload.forest;
      document.body.classList.remove('sheet-open');
      notice.textContent = payload.hookError
        ? '最近一轮记录失败，请查看 Wayfinder 通知'
        : '';
      recording.classList.toggle('on', payload.connected);
      recording.title = payload.connectedHosts?.length
        ? '已连接：' + payload.connectedHosts.map(hostName).join('、')
        : '尚未连接采集器';
      summaryTitle.textContent = payload.connected
        ? '正在记录'
        : forest.nodeCount > 0
          ? '航海记录'
          : '尚未连接';
      content.replaceChildren();
      summaryMeta.textContent = '';

      if (!payload.connected && forest.nodeCount === 0) {
        content.appendChild(emptyState('plug', '连接当前项目', '安装对应 AI 工具的 Wayfinder 采集器后，新对话会进入航海图。', '连接 AI 工具', () => send('install')));
        return;
      }
      if (forest.nodeCount === 0 && Object.keys(state.pending || {}).length === 0) {
        content.appendChild(emptyState('history', '等待下一轮对话', '完成一次 AI 对话后，这里会生成第一棵任务树。'));
        return;
      }
      const tools = document.createElement('div');
      tools.className = 'tools';
      const search = document.createElement('label');
      search.className = 'search';
      search.append(icon('search'));
      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = '搜索当前项目';
      input.setAttribute('aria-label', '搜索当前项目');
      input.value = query;
      search.append(input);
      tools.append(search);

      const nodeById = Object.fromEntries(state.nodes.map((node) => [node.id, node]));
      if (!forest.trees.some((tree) => tree.id === activeTreeId)) {
        activeTreeId = forest.trees[0]?.id || '';
      }
      const activeIndex = Math.max(
        0,
        forest.trees.findIndex((tree) => tree.id === activeTreeId)
      );
      const activeTree = forest.trees[activeIndex];
      const activeNodeIds = new Set(
        activeTree
          ? activeTree.sessions.flatMap((session) => session.nodeIds)
          : []
      );
      const good = state.nodes.filter(
        (node) => activeNodeIds.has(node.id) && node.verdict === 'success'
      ).length;
      const bad = state.nodes.filter(
        (node) => activeNodeIds.has(node.id) && node.verdict === 'failure'
      ).length;
      const neutral = Math.max(0, activeNodeIds.size - good - bad);
      summaryMeta.textContent =
        good + ' 正确 · ' + bad + ' 错误 · ' + neutral + ' 未评';
      const forestRoot = document.createElement('div');
      if (activeTree) {
        forestRoot.append(
          renderVoyagePager(forest.trees, activeIndex, activeTree, payload)
        );
      }
      const visibleTrees = activeTree
        ? filterForest(
            Object.assign({}, forest, { trees: [activeTree] }),
            nodeById,
            query
          )
        : [];
      if (visibleTrees.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'filter-empty';
        empty.textContent = query
          ? '当前项目没有匹配的航点'
          : '当前项目还没有航点';
        forestRoot.append(empty);
      } else {
        visibleTrees.forEach((tree) =>
          forestRoot.append(renderLineage(tree, nodeById, payload))
        );
      }
      if (Object.keys(state.pending || {}).length > 0) {
        const pending = document.createElement('div');
        pending.className = 'pending';
        pending.textContent = '当前对话正在记录';
        forestRoot.append(pending);
      }
      content.append(tools, forestRoot);
      const selectedSession = activeTree?.sessions.find(
        (session) => session.id === selectedSessionId
      );
      if (selectedSession) {
        document.body.classList.add('sheet-open');
        tools.setAttribute('aria-hidden', 'true');
        tools.setAttribute('inert', '');
        forestRoot.setAttribute('aria-hidden', 'true');
        forestRoot.setAttribute('inert', '');
        const sheetOrdered = sessionsForLayout(activeTree.sessions);
        const sheetById = new Map(
          sheetOrdered.map((item) => [item.id, item])
        );
        const sheetRoutes = routeLayoutsFor(sheetOrdered, sheetById);
        const sheetRouteClass = routeClass(
          sheetRoutes.get(selectedSession.id)?.index ?? -1
        );
        const sheet = renderSessionSheet(
          selectedSession,
          nodeById,
          payload,
          sheetRouteClass
        );
        content.append(sheet);
      }
      const updateSearch = () => {
        query = input.value.trim().toLocaleLowerCase('zh-CN');
        selectedSessionId = '';
        selectedId = '';
        remember();
        render(latestPayload || payload);
      };
      input.addEventListener('compositionstart', () => {
        composingSearch = true;
      });
      input.addEventListener('compositionend', () => {
        composingSearch = false;
        if (searchTimer) {
          clearTimeout(searchTimer);
          searchTimer = undefined;
        }
        updateSearch();
      });
      input.addEventListener('input', () => {
        if (composingSearch) return;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          searchTimer = undefined;
          updateSearch();
        }, 120);
      });
      requestAnimationFrame(() => {
        if (selectedSessionId) {
          if (focusKey) {
            const target = [
              ...document.querySelectorAll(
                '.lineage-detail-sheet [data-focus-key]'
              )
            ].find((element) => element.dataset.focusKey === focusKey);
            if (target) {
              target.focus();
              return;
            }
          }
          document.querySelector('.sheet-title')?.focus();
          return;
        }
        if (focusKey) {
          const target = [...document.querySelectorAll('[data-focus-key]')]
            .find((element) => element.dataset.focusKey === focusKey);
          target?.focus();
          return;
        }
        if (searchWasFocused) {
          const next = document.querySelector('.search input');
          next?.focus();
          if (next) {
            next.selectionStart = next.selectionEnd = next.value.length;
          }
        }
      });
    }

    function renderVoyagePager(trees, activeIndex, tree, payload) {
      const pager = document.createElement('nav');
      pager.className = 'voyage-pager';
      pager.setAttribute('aria-label', '切换项目航海图');

      const move = (nextIndex) => {
        if (nextIndex < 0 || nextIndex >= trees.length) return;
        if (searchTimer) {
          clearTimeout(searchTimer);
          searchTimer = undefined;
        }
        activeTreeId = trees[nextIndex].id;
        selectedSessionId = '';
        selectedId = '';
        query = '';
        remember();
        render(payload);
        window.scrollTo(0, 0);
        requestAnimationFrame(() => {
          document.querySelector('.voyage-title')?.focus();
        });
      };
      const previous = document.createElement('button');
      previous.className = 'pager-button';
      previous.type = 'button';
      previous.disabled = activeIndex === 0;
      const previousLabel = previous.disabled
        ? '已经是第一个项目'
        : '上一个项目：' + trees[activeIndex - 1].title;
      previous.setAttribute('aria-label', previousLabel);
      if (!previous.disabled) previous.title = previousLabel;
      previous.dataset.focusKey = 'project-previous';
      previous.append(icon('chevron-left'));
      previous.addEventListener('click', () => move(activeIndex - 1));

      const copy = document.createElement('div');
      copy.className = 'voyage-copy';
      const kicker = document.createElement('span');
      kicker.className = 'voyage-kicker';
      kicker.textContent = '航程 ' + (activeIndex + 1) + ' / ' + trees.length;
      const title = document.createElement('strong');
      title.className = 'voyage-title';
      title.tabIndex = -1;
      title.textContent = tree.title;
      const meta = document.createElement('span');
      meta.className = 'voyage-meta';
      meta.textContent =
        tree.sessions.length + ' 个航点 · ' + tree.nodeCount + ' 轮';
      copy.append(kicker, title, meta);

      const next = document.createElement('button');
      next.className = 'pager-button';
      next.type = 'button';
      next.disabled = activeIndex === trees.length - 1;
      const nextLabel = next.disabled
        ? '已经是最后一个项目'
        : '下一个项目：' + trees[activeIndex + 1].title;
      next.setAttribute('aria-label', nextLabel);
      if (!next.disabled) next.title = nextLabel;
      next.dataset.focusKey = 'project-next';
      next.append(icon('chevron-right'));
      next.addEventListener('click', () => move(activeIndex + 1));
      pager.append(previous, copy, next);
      return pager;
    }

    function filterForest(forest, nodeById, term) {
      if (!term) return forest.trees;
      return forest.trees.map((tree) => {
        const treeMatch = tree.title.toLocaleLowerCase('zh-CN').includes(term);
        if (treeMatch) return tree;
        const byId = new Map(
          tree.sessions.map((session) => [session.id, session])
        );
        const included = new Set();
        tree.sessions.forEach((session) => {
          const text = [
            session.stage,
            session.branch,
            session.title,
            session.preview,
            ...session.nodeIds.flatMap((id) => {
              const node = nodeById[id];
              return node ? [node.prompt, node.response, node.note] : [];
            })
          ].join(' ').toLocaleLowerCase('zh-CN');
          if (!text.includes(term)) return;
          let current = session;
          const visited = new Set();
          while (current && !visited.has(current.id)) {
            visited.add(current.id);
            included.add(current.id);
            current = current.parentId ? byId.get(current.parentId) : undefined;
          }
        });
        const sessions = tree.sessions.filter((session) =>
          included.has(session.id)
        );
        return sessions.length > 0
          ? Object.assign({}, tree, {
              sessions,
              lineageSessions: tree.sessions
            })
          : null;
      }).filter(Boolean);
    }

    function renderLineage(tree, nodeById, payload) {
      const section = document.createElement('section');
      section.className = 'lineage-section';
      const chart = document.createElement('div');
      chart.className = 'lineage-canvas';
      const geometry = lineageGeometryFor(tree.sessions);
      const svgNode = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
      );
      const graphHeight = geometry.graphHeight;
      svgNode.setAttribute(
        'viewBox',
        '0 0 ' + geometry.graphWidth + ' ' + graphHeight
      );
      svgNode.style.width = geometry.graphWidth + 'px';
      svgNode.style.height = graphHeight + 'px';
      svgNode.setAttribute('aria-hidden', 'true');
      svgNode.setAttribute('focusable', 'false');
      const labelLayer = document.createElement('div');
      labelLayer.className = 'lineage-label-layer';
      labelLayer.setAttribute('role', 'group');
      labelLayer.setAttribute('aria-label', tree.title + ' 航点');
      const stage = document.createElement('div');
      stage.className = 'lineage-stage';
      stage.style.width = geometry.graphWidth + 'px';
      stage.style.height = graphHeight + 'px';
      stage.append(svgNode, labelLayer);
      chart.append(stage);
      drawLineage(
        d3.select(svgNode),
        labelLayer,
        tree,
        geometry,
        payload
      );
      section.append(chart);
      // Pan + pinch-zoom via a single d3.zoom on the canvas. Because both the
      // SVG and the HTML card layer live inside one stage element, applying
      // the transform to that single element moves them together — no risk of
      // the two layers drifting apart. Trackpad pinch works out of the box
      // (Chromium reports it as wheel + ctrlKey, which d3-zoom treats as zoom).
      const applyStage = (transform) => {
        stage.style.transform =
          'translate(' + transform.x + 'px,' + transform.y + 'px) scale(' +
          transform.k + ')';
        lineageViewports.set(tree.id + '\\u0000' + query, {
          x: transform.x,
          y: transform.y,
          k: transform.k
        });
      };
      const zoom = d3.zoom()
        .scaleExtent([0.4, 3.2])
        // Coast is pinned to the top of the world at y=0, so the top boundary
        // is 0: the user can pan up only until the coast reaches the viewport
        // top, never revealing blank sea above it. Everything else stays
        // infinite — horizontal panning and downward panning are unlimited.
        .translateExtent([[-Infinity, 0], [Infinity, Infinity]])
        .on('zoom', (event) => applyStage(event.transform));
      const canvasSelection = d3.select(chart);
      let retryFrame;
      let retryTimer;
      let resizeObserver;
      const fitStage = () => {
        if (!chart.isConnected) return;
        const available = chart.clientWidth;
        if (!available) {
          // Layout not ready yet (width 0) — retry next frame so the initial
          // fit transform reliably applies.
          retryFrame = requestAnimationFrame(fitStage);
          return;
        }
        const viewportRoom = Math.floor(
          window.innerHeight - chart.getBoundingClientRect().top - 24
        );
        const saved = lineageViewports.get(tree.id + '\\u0000' + query);
        if (saved) {
          chart.style.height =
            Math.max(
              Math.ceil(graphHeight * saved.k),
              viewportRoom,
              240
            ) + 'px';
          const restored = d3.zoomIdentity
            .translate(saved.x, saved.y)
            .scale(saved.k);
          canvasSelection.call(zoom.transform, restored);
          applyStage(restored);
          return;
        }
        // Match the last pre-rename sidebar baseline: cards rendered at about
        // 101.6px (128px * 0.7935). On narrower panels, preserve that readable
        // scale and let the existing two-finger pan expose outer branches.
        // Users can still pinch out to the 0.4 overview scale.
        const minimumReadableScale = 0.7935;
        const fitScale = available / geometry.graphWidth;
        const baseScale = Math.min(
          1,
          Math.max(minimumReadableScale, fitScale)
        );
        const scaledHeight = Math.ceil(graphHeight * baseScale);
        chart.style.height =
          Math.max(scaledHeight, viewportRoom, 240) + 'px';
        // Center the fitted tree, pin to top, and make that the zoom's initial
        // transform so pinch/pan build on the fitted view.
        const offsetX = (available - geometry.graphWidth * baseScale) / 2;
        const initial = d3.zoomIdentity.translate(offsetX, 0).scale(baseScale);
        canvasSelection.call(zoom.transform, initial);
        // Apply directly too, so the fitted view paints even if the zoom
        // event hasn't flushed yet on first layout.
        applyStage(initial);
      };
      canvasSelection
        .call(zoom)
        .on('dblclick.zoom', null)
        .on('wheel.zoom', null);
      // Custom trackpad gestures: two-finger swipe pans, pinch (wheel+ctrlKey)
      // zooms. d3's default treats every wheel as zoom, so we take over wheel
      // and route it. Pinch sensitivity is boosted so it zooms readily.
      chart.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) {
            // Pinch → zoom toward the cursor. 0.01 factor = responsive but not
            // jumpy; clamp per-event delta so a hard pinch doesn't overshoot.
            const delta = Math.max(-12, Math.min(12, event.deltaY));
            const rect = chart.getBoundingClientRect();
            canvasSelection.call(
              zoom.scaleBy,
              Math.pow(2, -delta * 0.01),
              [event.clientX - rect.left, event.clientY - rect.top]
            );
          } else {
            // Two-finger swipe → pan.
            canvasSelection.call(
              zoom.translateBy,
              -event.deltaX / d3.zoomTransform(chart).k,
              -event.deltaY / d3.zoomTransform(chart).k
            );
          }
        },
        { passive: false }
      );
      // A ResizeObserver fires exactly when the canvas gains or changes width,
      // so the "fit the whole tree" transform always applies at the right
      // moment regardless of first-paint timing (rAF/timers were racing it).
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => fitStage());
        resizeObserver.observe(chart);
      } else {
        retryFrame = requestAnimationFrame(fitStage);
        retryTimer = setTimeout(fitStage, 120);
      }
      fitStage();
      window.addEventListener('resize', fitStage);
      renderCleanups.push(() => {
        resizeObserver?.disconnect();
        window.removeEventListener('resize', fitStage);
        if (retryFrame !== undefined) cancelAnimationFrame(retryFrame);
        if (retryTimer !== undefined) clearTimeout(retryTimer);
      });
      return section;
    }

    function drawLineage(svg, labelLayer, tree, geometry, payload) {
      const {
        ordered,
        byId,
        routeLayoutById,
        xById,
        yById,
        sideById,
        graphWidth,
        graphHeight
      } = geometry;
      const lineageSessions = [...(tree.lineageSessions || tree.sessions)]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const lineageById = new Map(
        lineageSessions.map((session) => [session.id, session])
      );
      const current = [...lineageSessions]
        .filter((session) => session.verdict !== 'failure')
        .sort((a, b) =>
          a.completedAt.localeCompare(b.completedAt)
        ).slice(-1)[0] || [...lineageSessions].sort((a, b) =>
          a.completedAt.localeCompare(b.completedAt)
        ).slice(-1)[0];
      const mainPath = new Set();
      let cursor = current;
      while (cursor && !mainPath.has(cursor.id)) {
        mainPath.add(cursor.id);
        cursor = cursor.parentId
          ? lineageById.get(cursor.parentId)
          : undefined;
      }
      const hasVisibleSelection = byId.has(selectedSessionId);
      const focus = hasVisibleSelection
        ? lineageFocus(selectedSessionId, ordered, byId)
        : new Set();
      const labelRightFor = (session) => sideById.get(session.id);
      const midX = graphWidth / 2;
      // Extend the shore far past both edges so the coast never shows an end,
      // even when the user zooms/pans out (item: coast reads as infinite).
      const shorePad = Math.max(graphWidth, 1200);
      const shoreLeft = -shorePad;
      const shoreRight = graphWidth + shorePad;
      const terrain = svg.append('g').attr('aria-hidden', 'true');
      terrain.append('path')
        .attr('class', 'shore-fill')
        .attr(
          'd',
          'M ' + shoreLeft + ' 0 H ' + shoreRight + ' V 24 C ' +
          (graphWidth * .84) + ' 31, ' + (midX + 30) + ' 17, ' +
          midX + ' 25 C ' + (midX - 62) + ' 34, ' +
          (graphWidth * .16) + ' 18, ' + shoreLeft + ' 27 Z'
        );
      const shoreEdge =
        'M ' + shoreLeft + ' 27 C ' + (graphWidth * .16) + ' 18, ' +
        (midX - 62) + ' 34, ' + midX + ' 25 C ' +
        (midX + 30) + ' 17, ' + (graphWidth * .84) + ' 31, ' +
        shoreRight + ' 24';
      terrain.append('path')
        .attr('class', 'shore-line')
        .attr('d', shoreEdge);
      terrain.append('path')
        .attr('class', 'shore-ink')
        .attr('d', shoreEdge);
      // Departure point: just a small planted flag on the shore (no building).
      // The departure flag is drawn later (after the route channels) so it
      // sits on top of the white path edge instead of being covered by it.
      // Natural flat-illustration sea: instead of regular rows, short uneven
      // wave crests are scattered across the WHOLE ocean on a jittered grid, so
      // they fill every part of the water (the full shore span, not just the
      // path column) yet never line up into rows. Seeded gaps thin them out
      // into an irregular, un-dense scatter; randomness is seeded so the sea
      // never jitters between renders, and crests fade toward the far water.
      const waveSeed = (a, b) => {
        const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
        return s - Math.floor(s);
      };
      const lerp = (from, to, t) => from + (to - from) * t;
      const oceanTop = 38;
      // Waves must cover the WHOLE visible sea, including the open water below a
      // short voyage's content. graphHeight is only the tree's bounding box, so
      // extend the field down past it (SVG is overflow:visible; the canvas clips
      // the excess). A viewport-based floor guarantees coverage after the fit
      // scale, without coupling to fitStage's later-computed baseScale.
      const oceanBottom = Math.max(
        graphHeight,
        (window.innerHeight || 900) * 1.6
      );
      const cellW = 78;
      const cellH = 62;
      const waveCols = Math.max(1, Math.ceil((shoreRight - shoreLeft) / cellW));
      const waveRows = Math.max(1, Math.ceil((oceanBottom - oceanTop) / cellH));
      let waveNear = '';
      let waveFar = '';
      for (let r = 0; r < waveRows; r += 1) {
        for (let c = 0; c < waveCols; c += 1) {
          // Seeded skips carve irregular gaps so the sea reads scattered, not
          // dense or gridded. ~48% of cells stay empty for open, airy water.
          if (waveSeed(r * 131.7 + c, c * 17.3 - r) < 0.48) {
            continue;
          }
          // Jitter each crest up to a bit past its cell so neighbours overlap
          // and no row/column alignment survives.
          const jx = (waveSeed(r + 11, c * 3 + 1) - 0.5) * cellW * 1.1;
          const jy = (waveSeed(r * 3 + 2, c + 7) - 0.5) * cellH * 1.1;
          const x = shoreLeft + c * cellW + cellW * 0.5 + jx;
          const y = oceanTop + r * cellH + cellH * 0.5 + jy;
          if (y < oceanTop || y > oceanBottom) {
            continue;
          }
          const w = lerp(18, 50, waveSeed(r + 5, c * 7 + 3));
          const amp = lerp(2.4, 6, waveSeed(r * 2 + 1, c + 9));
          const tilt = (waveSeed(r + 3, c * 5 + 2) - 0.5) * 3;
          const seg =
            ' M ' + x.toFixed(1) + ' ' + y.toFixed(1) +
            ' c ' + (w * 0.3).toFixed(1) + ' ' + (-amp).toFixed(1) + ', ' +
            (w * 0.7).toFixed(1) + ' ' + (-amp).toFixed(1) + ', ' +
            w.toFixed(1) + ' ' + tilt.toFixed(1);
          // Far (upper) water gets a fainter bucket for a soft depth fade.
          const depthT = (y - oceanTop) / Math.max(1, oceanBottom - oceanTop);
          if (depthT > 0.5) {
            waveNear += seg;
          } else {
            waveFar += seg;
          }
        }
      }
      terrain.append('path')
        .attr('class', 'ocean-wave')
        .attr('d', waveNear.trim())
        .attr('stroke-opacity', '0.6');
      terrain.append('path')
        .attr('class', 'ocean-wave')
        .attr('d', waveFar.trim())
        .attr('stroke-opacity', '0.42');
      terrain.append('path')
        .attr('class', 'ocean-current')
        .attr(
          'd',
          'M 18 ' + (graphHeight * .24) +
          ' C ' + (graphWidth * .24) + ' ' + (graphHeight * .14) +
          ', ' + (graphWidth * .76) + ' ' +
          (graphHeight * .16) + ', ' + (graphWidth - 18) + ' ' +
          (graphHeight * .29)
        );
      terrain.append('path')
        .attr('class', 'ocean-current')
        .attr(
          'd',
          'M 26 ' + (graphHeight * .73) +
          ' C ' + (graphWidth * .28) + ' ' + (graphHeight * .61) +
          ', ' + (graphWidth * .76) + ' ' +
          (graphHeight * .86) + ', ' + (graphWidth - 14) + ' ' +
          (graphHeight * .68)
        );
      const layer = svg.append('g');
      const links = ordered
        .filter((session) => session.parentId && byId.has(session.parentId))
        .map((session) => ({
          source: byId.get(session.parentId),
          target: session
        }));
      const parentIds = new Set(
        lineageSessions.map((session) => session.parentId).filter(Boolean)
      );
      const smoothVerticalPath = (
        sourceX,
        sourceY,
        targetX,
        targetY
      ) => {
        // Mirror of the wide map's branchPath: a symmetric S whose control
        // points sit at the vertical midpoint, so a fork leaves its parent
        // heading straight down and eases sideways into the child column.
        const middle = sourceY + (targetY - sourceY) * .5;
        return (
          'M ' + sourceX + ' ' + sourceY +
          ' C ' + sourceX + ' ' + middle + ', ' +
          targetX + ' ' + middle + ', ' +
          targetX + ' ' + targetY
        );
      };
      const branchPath = (link) => {
        const sourceX = xById.get(link.source.id);
        const targetX = xById.get(link.target.id);
        const sourceY = yById.get(link.source.id);
        const targetY = yById.get(link.target.id);
        return smoothVerticalPath(
          sourceX,
          sourceY,
          targetX,
          targetY
        );
      };
      const linkClass = (link) =>
        routeClass(routeLayoutById.get(link.target.id).index) +
        ' ' +
        tone(link.target.verdict) +
        (
          mainPath.has(link.source.id) && mainPath.has(link.target.id)
            ? ' main'
            : ''
        ) +
        (
          hasVisibleSelection &&
          (!focus.has(link.source.id) || !focus.has(link.target.id))
            ? ' dimmed'
            : ''
        );
      layer.selectAll('.lineage-link-bed')
        .data(links)
        .join('path')
        .attr('class', (link) =>
          'lineage-path-bed lineage-link-bed ' +
          (
            mainPath.has(link.source.id) && mainPath.has(link.target.id)
              ? 'main'
              : ''
          ) +
          (
            hasVisibleSelection &&
            (!focus.has(link.source.id) || !focus.has(link.target.id))
              ? ' dimmed'
              : ''
          )
        )
        .attr('d', branchPath);
      layer.selectAll('.lineage-link')
        .data(links)
        .join('path')
        .attr('class', (link) =>
          'lineage-edge lineage-link ' + linkClass(link)
        )
        .attr('pathLength', 1)
        .attr('d', branchPath);
      layer.selectAll('.channel-decoration')
        .data(links)
        .join('g')
        .attr('aria-hidden', 'true')
        .attr('class', (link) => {
          const route = routeLayoutById.get(link.target.id);
          const dimmed =
            hasVisibleSelection &&
            (!focus.has(link.source.id) || !focus.has(link.target.id));
          return (
            'channel-decoration ' +
            routeClass(route.index) +
            (dimmed ? ' dimmed' : '')
          );
        })
        .attr('transform', (link) =>
          'translate(' +
          (
            (xById.get(link.source.id) + xById.get(link.target.id)) /
            2
          ) +
          ',' +
          (
            (
              yById.get(link.source.id) +
              yById.get(link.target.id)
            ) /
            2
          ) +
          ')'
        )
        .each(function(link) {
          appendChannelDecoration(
            d3.select(this),
            routeLayoutById.get(link.target.id).index
          );
        });

      const rootSession = ordered.find(
        (session) => !session.parentId || !byId.has(session.parentId)
      );
      if (rootSession) {
        const rootX = xById.get(rootSession.id);
        const rootY = yById.get(rootSession.id);
        const rootPath =
          'M ' + rootX + ' 25 L ' + rootX + ' ' + rootY;
        layer.insert('path', ':first-child')
          .attr('class', 'lineage-path-bed main')
          .attr('d', rootPath);
        layer.insert('path', ':first-child')
          .attr('class', 'lineage-edge main route-trunk')
          .attr('pathLength', 1)
          .attr('d', rootPath);
        // Draw the single departure flag on top of the trunk channel so its
        // pole/flag are not covered by the white path edge.
        const port = layer.append('g')
          .attr('class', 'port-flag')
          .attr('transform', 'translate(' + rootX + ',2)');
        port.append('path')
          .attr('class', 'trail-start-pole')
          .attr('d', 'M 0 24 L 0 1');
        port.append('path')
          .attr('class', 'trail-start-flag')
          .attr('d', 'M 0 1 L 13 5 L 0 10 Z');
      }

      const nodes = layer.selectAll('.lineage-node')
        .data(ordered)
        .join('g')
        .attr('class', (session) => {
          const labelSide = labelRightFor(session) ? 'right' : 'left';
          return (
            'lineage-node lineage-label-' + labelSide + ' ' +
            routeClass(routeLayoutById.get(session.id).index) + ' ' +
            tone(session.verdict) +
            (mainPath.has(session.id) ? ' main' : '') +
            (session.id === current?.id ? ' current' : '') +
            (session.id === selectedSessionId ? ' selected' : '') +
            (
              hasVisibleSelection && !focus.has(session.id)
                ? ' dimmed'
                : ''
            )
          );
        })
        .attr('transform', (session) =>
          'translate(' +
          xById.get(session.id) +
          ',' +
          yById.get(session.id) +
          ')'
        )
        .style('animation-delay', (_session, index) => index * 22 + 'ms');
      nodes.each(function(session) {
        const selection = d3.select(this);
        const labelRight = labelRightFor(session);
        if (session.id === selectedSessionId) {
          selection.append('circle')
            .attr('class', 'journey-selected-ring')
            .attr('r', 15);
        }
        const isCurrent = session.id === current?.id;
        const isFailure = session.verdict === 'failure';
        const isBlockedEnd = isFailure && !parentIds.has(session.id);
        if (isCurrent) {
          selection.append('circle')
            .attr('class', 'journey-current-ring')
            .attr('r', 14);
        }
        if (isBlockedEnd) {
          appendReef(selection, false);
        } else if (isCurrent) {
          const boat = selection.append('g')
            .attr('class', 'sailboat project-ship');
          boat.append('title')
            .text(tree.title + ' 项目船：当前位置');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M -11 9 Q -5 6, 0 9 T 11 9');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M 0 -9 L 0 5');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M 1 -8 L 9 2 L 1 2 Z');
          boat.append('path')
            .attr('class', 'sailboat-sticker-outline')
            .attr('d', 'M -9 4 L 10 4 Q 6 10, 0 10 Q -6 10, -9 4 Z');
          boat.append('path')
            .attr('class', 'sailboat-wake')
            .attr('d', 'M -11 9 Q -5 6, 0 9 T 11 9');
          boat.append('path')
            .attr('class', 'sailboat-mast')
            .attr('d', 'M 0 -9 L 0 5');
          boat.append('path')
            .attr('class', 'sailboat-sail')
            .attr('d', 'M 1 -8 L 9 2 L 1 2 Z');
          boat.append('path')
            .attr('class', 'sailboat-hull')
            .attr('d', 'M -9 4 L 10 4 Q 6 10, 0 10 Q -6 10, -9 4 Z');
          // A path still being sailed carries no verdict badge — only a
          // failed turn gets the coral cross. "Correct" needs no mark: the
          // voyage simply continues.
          if (session.verdict === 'failure') {
            selection.append('circle')
              .attr('class', 'current-status-badge')
              .attr('cx', 10)
              .attr('cy', -8)
              .attr('r', 4.5);
            selection.append('path')
              .attr('class', 'journey-status')
              .attr('transform', 'translate(10,-8) scale(.52)')
              .attr('d', 'M -4 -4 L 4 4 M 4 -4 L -4 4');
          }
        } else {
          selection.append('circle')
            .attr('class', 'journey-sticker-shadow')
            .attr('cx', 2)
            .attr('cy', 3)
            .attr('r', 12.5);
          selection.append('circle')
            .attr('class', 'journey-sticker-outline')
            .attr('r', 12.5);
          selection.append('circle')
            .attr('class', 'journey-disc')
            .attr('r', 9);
          // Two-state semantics: a failed turn shows the coral cross; every
          // other waypoint (in-progress / not-yet-judged) is a neutral dot.
          // Success is intentionally unmarked — the path is still being walked.
          if (session.verdict === 'failure') {
            selection.append('path')
              .attr('class', 'journey-status')
              .attr('d', 'M -4 -4 L 4 4 M 4 -4 L -4 4');
          } else {
            selection.append('circle')
              .attr('class', 'journey-status')
              .attr('r', 2.4);
          }
          if (isFailure) {
            appendReef(selection, true);
          }
        }
        const selectSession = () => {
          const opening = selectedSessionId !== session.id;
          selectedSessionId = opening ? session.id : '';
          selectedId = '';
          remember();
          render(latestPayload || payload);
          if (opening) {
            document.querySelector('.sheet-title')?.focus();
          } else {
            document.querySelector(
              '[data-session-id="' + session.id + '"]'
            )?.focus();
          }
        };
        const body = document.createElement('button');
        body.className =
          'lineage-node-button ' +
          routeClass(routeLayoutById.get(session.id).index) +
          ' ' +
          tone(session.verdict) +
          (session.id === selectedSessionId ? ' selected' : '') +
          (
            hasVisibleSelection && !focus.has(session.id)
              ? ' dimmed'
              : ''
          );
        // Card sits centered on its own column and just below the disc — the
        // wide map's card-under-node pattern, rotated into the vertical column.
        body.style.left =
          (xById.get(session.id) / graphWidth * 100) + '%';
        body.style.top =
          ((yById.get(session.id) + 16) / graphHeight * 100) + '%';
        body.dataset.sessionId = session.id;
        body.dataset.focusKey = 'session:' + session.id;
        body.dataset.routeIndex =
          String(routeLayoutById.get(session.id).index);
        body.dataset.routeX = String(Math.round(xById.get(session.id)));
        body.dataset.nodeY = String(Math.round(yById.get(session.id)));
        body.setAttribute(
          'aria-label',
          (session.shortTitle || session.title) +
          (
            session.verdict === 'success'
              ? '，正确路线'
              : session.verdict === 'failure'
                ? '，错误路线，此路不通'
                : '，尚未评价'
          )
        );
        body.setAttribute(
          'aria-pressed',
          String(session.id === selectedSessionId)
        );
        body.addEventListener('click', selectSession);
        const title = document.createElement('span');
        title.className = 'lineage-node-title';
        title.textContent = session.shortTitle || session.title;
        body.append(title);
        labelLayer.append(body);
        selection.append('title').text(session.title);
      });
      svg.attr('viewBox', '0 0 ' + graphWidth + ' ' + graphHeight);
    }

    function appendReef(selection, compact) {
      const reef = selection.append('g')
        .attr(
          'class',
          'reef-sticker' + (compact ? ' reef-compact' : '')
        )
        .attr(
          'transform',
          compact ? 'translate(13,-9) scale(.62)' : null
        );
      reef.append('path')
        .attr('class', 'reef-outline')
        .attr('d', 'M -12 8 L -9 -2 L -5 -7 L -1 -1 L 2 -10 L 7 -4 L 11 8 Z');
      reef.append('path')
        .attr('class', 'reef-rock')
        .attr('d', 'M -10 7 L -8 -1 L -4 -6 L 0 7 Z');
      reef.append('path')
        .attr('class', 'reef-rock')
        .attr('d', 'M -1 7 L 2 -9 L 7 -3 L 10 7 Z');
      reef.append('path')
        .attr('class', 'reef-cross')
        .attr('d', 'M -3 -1 L 4 6 M 4 -1 L -3 6');
      reef.append('title').text('礁石：此路不通');
    }

    function sessionsForLayout(sessions) {
      const byId = new Map(
        sessions.map((session) => [session.id, session])
      );
      const children = new Map();
      sessions.forEach((session) => {
        const parentId =
          session.parentId && byId.has(session.parentId)
            ? session.parentId
            : 'root';
        const items = children.get(parentId) || [];
        items.push(session);
        children.set(parentId, items);
      });
      children.forEach((items) =>
        items.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      );
      const ordered = [];
      const visited = new Set();
      const visit = (session) => {
        if (visited.has(session.id)) return;
        visited.add(session.id);
        ordered.push(session);
        (children.get(session.id) || []).forEach(visit);
      };
      (children.get('root') || []).forEach(visit);
      sessions.forEach(visit);
      return ordered;
    }

    function lineageHierarchyFor(sessions) {
      const byParent = new Map();
      const ids = new Set(sessions.map((session) => session.id));
      sessions.forEach((session) => {
        const parent =
          session.parentId && ids.has(session.parentId)
            ? session.parentId
            : 'root';
        const items = byParent.get(parent) || [];
        items.push(session);
        byParent.set(parent, items);
      });
      byParent.forEach((items) =>
        items.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      );
      const make = (session, ancestors = new Set()) => {
        const next = new Set(ancestors);
        next.add(session.id);
        return {
          session,
          children: (byParent.get(session.id) || [])
            .filter((child) => !next.has(child.id))
            .map((child) => make(child, next))
        };
      };
      return {
        session: null,
        children: (byParent.get('root') || []).map((session) =>
          make(session)
        )
      };
    }

    function lineageGeometryFor(sessions) {
      const ordered = sessionsForLayout(sessions);
      const byId = new Map(
        ordered.map((session) => [session.id, session])
      );
      const routeLayoutById = routeLayoutsFor(ordered, byId);
      // This is the wide map's d3.tree engine turned on its side: in the map
      // depth grows rightward and siblings stack vertically; here we swap the
      // axes so depth grows downward (rows) and sibling branches fan out into
      // parallel columns. AI and API therefore run side by side from the fork
      // instead of being flattened into one snaking column.
      const root = d3.hierarchy(lineageHierarchyFor(sessions));
      // nodeSize([sibling gap, depth gap]) — sibling gap becomes horizontal
      // column spacing, depth gap becomes vertical row spacing after the swap.
      // Treat the real card box as the horizontal node size: the full branch
      // subtree (route, disc, card, and descendants) moves as one aligned
      // column, while adjacent cards retain a calm, explicit gap.
      const lineageCardWidth = ${lineageCardWidth};
      const lineageCardGap = ${lineageCardGap};
      const lineageSiblingGap = lineageCardWidth + lineageCardGap;
      d3.tree()
        .nodeSize([lineageSiblingGap, 96])
        // D3 defaults to double spacing between cousin subtrees. Cards are
        // equal-width boxes, so one card-plus-gap is sufficient at every
        // depth and avoids shrinking a sparse tree into a thumbnail.
        .separation(() => 1)(root);
      const real = root
        .descendants()
        .filter((node) => node.data.session);
      // Pack each depth into the minimum number of aligned card columns.
      // D3's tidy-tree centering can leave unused half-columns between
      // unrelated subtrees; preserving that empty space makes every label
      // smaller in a narrow sidebar. The original left-to-right D3 order is
      // retained, so links do not cross, while node, route, card, and
      // descendants continue to move together.
      const nodesByDepth = d3.group(real, (node) => node.depth);
      nodesByDepth.forEach((nodesAtDepth) => {
        nodesAtDepth
          .sort((a, b) => a.x - b.x)
          .forEach((node, index) => {
            node.x =
              (index - (nodesAtDepth.length - 1) / 2) * lineageSiblingGap;
          });
      });
      const minX = Math.min(...real.map((node) => node.x));
      const maxX = Math.max(...real.map((node) => node.x));
      const minY = Math.min(...real.map((node) => node.y));
      // Keep half a card plus a little breathing room on both outer edges so
      // the widest columns and their sticker shadows remain fully visible.
      const marginX = Math.ceil(lineageCardWidth / 2 + 8);
      const laneLeft = marginX - minX;
      const xById = new Map();
      const yById = new Map();
      const sideById = new Map();
      real.forEach((node) => {
        const id = node.data.session.id;
        const x = node.x + laneLeft;
        const y = 56 + (node.y - minY);
        xById.set(id, x);
        yById.set(id, y);
        // Leaf/terminal columns put their card on the outward side; interior
        // nodes keep the card on whichever side has room.
        sideById.set(id, node.children && node.children.length > 0
          ? node.x >= (minX + maxX) / 2
          : node.x > minX);
      });
      const graphWidth = Math.max(
        340,
        Math.round(maxX - minX + marginX * 2)
      );
      const lastY = real.length > 0
        ? Math.max(...real.map((node) => yById.get(node.data.session.id)))
        : 56;
      return {
        ordered,
        byId,
        routeLayoutById,
        xById,
        yById,
        sideById,
        graphWidth,
        graphHeight: Math.max(118, lastY + 56)
      };
    }

    function routeLayoutsFor(sessions, byId) {
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
      const routeKeyBySession = new Map(
        sessions.map((session) => [session.id, routeKeyFor(session)])
      );
      const routeInfoByKey = new Map();
      let routeIndex = 0;
      [...sessions]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .forEach((session) => {
          const key = routeKeyBySession.get(session.id);
          if (key === 'trunk' || routeInfoByKey.has(key)) return;
          const root = byId.get(key) || session;
          const parentKey = root.parentId
            ? routeKeyBySession.get(root.parentId) || 'trunk'
            : 'trunk';
          routeInfoByKey.set(key, {
            key,
            index: routeIndex,
            parentKey
          });
          routeIndex += 1;
        });
      const childKeysByParent = new Map();
      routeInfoByKey.forEach((info) => {
        const keys = childKeysByParent.get(info.parentKey) || [];
        keys.push(info.key);
        childKeysByParent.set(info.parentKey, keys);
      });
      childKeysByParent.forEach((keys) =>
        keys.sort((a, b) =>
          routeInfoByKey.get(a).index - routeInfoByKey.get(b).index
        )
      );
      const leftLanes = [140, 110, 125];
      const rightLanes = [200, 230, 215];
      const byKey = new Map([
        [
          'trunk',
          {
            index: -1,
            right: false,
            x: 170,
            familyKey: 'trunk'
          }
        ]
      ]);
      const topLevelKeys = childKeysByParent.get('trunk') || [];
      const layoutForKey = (key) => {
        if (byKey.has(key)) return byKey.get(key);
        const info = routeInfoByKey.get(key);
        if (!info) return byKey.get('trunk');
        const parent = layoutForKey(info.parentKey);
        let right;
        let x;
        let familyKey;
        if (info.parentKey === 'trunk') {
          const position = topLevelKeys.indexOf(key);
          right = position % 2 === 1;
          const lanes = right ? rightLanes : leftLanes;
          x = lanes[Math.floor(position / 2) % lanes.length];
          familyKey = key;
        } else {
          right = parent.right;
          const lanes = right ? rightLanes : leftLanes;
          const siblings = childKeysByParent.get(info.parentKey) || [];
          const position = siblings.indexOf(key);
          const available = [
            parent.x,
            ...lanes.filter((lane) => lane !== parent.x)
          ];
          x = available[position % available.length];
          familyKey = parent.familyKey;
        }
        const layout = {
          index: info.index,
          right,
          x,
          familyKey
        };
        byKey.set(key, layout);
        return layout;
      };
      routeInfoByKey.forEach((_info, key) => layoutForKey(key));
      const bySession = new Map();
      sessions.forEach((session) => {
        const key = routeKeyBySession.get(session.id);
        bySession.set(session.id, byKey.get(key));
      });
      return bySession;
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
          selection.append('circle').attr('cx', x).attr('r', 1.7)
        );
        return;
      }
      if (style === 0) {
        selection.append('path')
          .attr('d', 'M -7 1 Q -4 -2, -1 1 T 5 1');
        return;
      }
      if (style === 1) {
        selection.append('path')
          .attr('d', 'M 0 -4 L 4 0 L 0 4 L -4 0 Z');
        return;
      }
      if (style === 2) {
        [-5, 0, 5].forEach((x) =>
          selection.append('circle').attr('cx', x).attr('r', 1.5)
        );
        return;
      }
      if (style === 3) {
        selection.append('path')
          .attr('d', 'M -6 -3 L -2 0 L -6 3 M 1 -3 L 5 0 L 1 3');
        return;
      }
      if (style === 4) {
        selection.append('path')
          .attr('d', 'M -6 -2 Q -3 1, 0 -2 T 6 -2 M -6 2 Q -3 5, 0 2 T 6 2');
        return;
      }
      selection.append('path')
        .attr('d', 'M -5 -3 L -1 0 L -5 3 M 1 -3 L 5 0 L 1 3');
    }

    function lineageFocus(selectedId, sessions, byId) {
      const focus = new Set();
      let current = byId.get(selectedId);
      while (current && !focus.has(current.id)) {
        focus.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      const children = new Map();
      sessions.forEach((session) => {
        if (!session.parentId) return;
        const items = children.get(session.parentId) || [];
        items.push(session);
        children.set(session.parentId, items);
      });
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

    function renderSessionSheet(session, nodeById, payload, routeClassName) {
      const nodes = session.nodeIds.map((id) => nodeById[id]).filter(Boolean);
      const sheet = document.createElement('aside');
      sheet.className =
        'lineage-detail-sheet ' +
        (routeClassName || 'route-trunk') +
        ' ' +
        tone(session.verdict);
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.setAttribute('aria-label', '航点详情');
      const head = document.createElement('header');
      head.className = 'sheet-head';
      const copy = document.createElement('div');
      copy.className = 'sheet-copy';
      const kicker = document.createElement('div');
      kicker.className = 'sheet-kicker';
      kicker.textContent = session.stage;
      if (session.branch) {
        kicker.textContent += ' · ' + session.branch;
      }
      const title = document.createElement('strong');
      title.className = 'sheet-title';
      title.tabIndex = -1;
      title.textContent = session.shortTitle || session.title;
      const meta = document.createElement('div');
      meta.className = 'sheet-meta';
      meta.textContent =
        session.nodeIds.length + ' 轮 · ' + sessionTime(session);
      copy.append(kicker, title, meta);
      const close = document.createElement('button');
      close.className = 'sheet-close';
      close.type = 'button';
      close.title = '关闭详情';
      close.setAttribute('aria-label', '关闭详情');
      close.append(icon('close'));
      close.addEventListener('click', () => {
        closeSessionSheet(payload, true);
      });
      const turns = document.createElement('div');
      turns.className = 'sheet-turns';
      nodes.forEach((node) =>
        turns.append(renderTurn(node, payload))
      );
      head.append(copy, close);
      sheet.append(head, turns);
      return sheet;
    }

    function closeSessionSheet(payload, restoreFocus) {
      const sessionId = selectedSessionId;
      selectedSessionId = '';
      selectedId = '';
      remember();
      render(latestPayload || payload);
      if (restoreFocus && sessionId) {
        document.querySelector(
          '[data-session-id="' + sessionId + '"]'
        )?.focus();
      }
    }

    function renderTurn(node, payload) {
      const row = document.createElement('div');
      row.className =
        'turn ' +
        tone(node.verdict || 'neutral') +
        (selectedId === node.id ? ' selected' : '');
      const main = document.createElement('button');
      main.className = 'turn-main';
      main.dataset.focusKey = 'turn:' + node.id;
      const marker = document.createElement('span');
      marker.className = 'turn-marker';
      const copy = document.createElement('span');
      copy.className = 'turn-copy';
      const title = document.createElement('span');
      title.className = 'turn-title';
      title.textContent = node.prompt || '未命名对话';
      const meta = document.createElement('span');
      meta.className = 'turn-meta';
      const time = document.createElement('span');
      time.textContent = shortTime(node.completedAt);
      const evidence = document.createElement('span');
      evidence.textContent = node.note
        ? '有经验'
        : node.kind === 'imported'
          ? '历史'
          : node.kind === 'collected'
            ? '自动记录'
          : validationLabel(node);
      if (node.kind === 'collected') {
        evidence.title =
          '自动记录自 ' +
          (node.sourceHost === 'claude'
            ? 'Claude Code'
            : node.sourceHost === 'codex'
              ? 'Codex'
              : '本机会话');
      }
      meta.append(time, evidence);
      copy.append(title, meta);
      main.append(marker, copy);
      main.addEventListener('click', () => {
        selectedId = selectedId === node.id ? '' : node.id;
        remember();
        render(payload);
      });
      const detail = document.createElement('div');
      detail.className = 'turn-detail';
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
        detail.append(source);
      }
      if (node.response) {
        const assistant = node.sourceHost === 'claude'
          ? 'Claude 回复'
          : node.sourceHost === 'codex'
            ? 'Codex 回复'
            : node.sourceHost === 'trae'
              ? 'TraeCode 回复'
              : 'AI 回复';
        detail.append(detailBlock(node.kind === 'imported' ? '历史摘要' : assistant, node.response));
      }
      if (node.note) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = node.note;
        detail.append(note);
      }
      if (node.kind === 'collected' && node.files?.length) {
        const files = document.createElement('div');
        files.className = 'detail-files';
        node.files.forEach((file) => {
          const row = document.createElement('div');
          row.className = 'detail-file';
          const name = document.createElement('span');
          name.className = 'detail-file-name';
          name.textContent = file.previousPath
            ? file.previousPath + ' → ' + file.path
            : file.path;
          name.title = name.textContent;
          const count = document.createElement('span');
          count.className = 'detail-file-count';
          if (file.lineCountsKnown === false) {
            count.textContent = '行数未知';
          } else {
            const added = document.createElement('span');
            added.className = 'detail-file-add';
            added.textContent = '+' + file.additions;
            const deleted = document.createElement('span');
            deleted.className = 'detail-file-delete';
            deleted.textContent = '−' + file.deletions;
            count.append(added, ' ', deleted);
          }
          row.append(name, count);
          files.append(row);
        });
        detail.append(files);
      }
      const actions = document.createElement('div');
      actions.className = 'actions';
      if (
        node.kind !== 'imported' &&
        node.kind !== 'collected' &&
        node.files?.length &&
        node.snapshotBefore !== node.snapshotAfter
      ) {
        actions.append(actionButton(
          'diff',
          '查看本轮 Diff',
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
      detail.append(actions);
      row.append(main, detail);
      return row;
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
      button.append(icon(name));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handler();
      });
      return button;
    }

    function detailBlock(labelText, value) {
      const fragment = document.createDocumentFragment();
      const label = document.createElement('div');
      label.className = 'detail-label';
      label.textContent = labelText;
      const text = document.createElement('p');
      text.className = 'detail-text';
      text.textContent = value;
      fragment.append(label, text);
      return fragment;
    }

    function tone(value) {
      if (value === 'success') return 'good';
      if (value === 'failure') return 'bad';
      return '';
    }
    function validationLabel(node) {
      if (node.validation?.status === 'passed') return '验证通过';
      if (node.validation?.status === 'failed') return '验证失败';
      if (node.validation?.status === 'running') return '验证中';
      return '未验证';
    }
    function shortTime(value) {
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(new Date(value));
      } catch {
        return '';
      }
    }
    function sessionTime(session) {
      const first = shortTime(session.startedAt);
      const last = shortTime(session.completedAt);
      if (first === last) return first;
      return shortDate(session.startedAt) === shortDate(session.completedAt)
        ? first + '–' + last.split(' ').slice(-1)[0]
        : first + '–' + last;
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
    function emptyState(iconName, titleText, bodyText, actionText, action) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.append(icon(iconName));
      const title = document.createElement('strong');
      title.textContent = titleText;
      const body = document.createElement('p');
      body.textContent = bodyText;
      empty.append(title, body);
      if (actionText && action) {
        const button = document.createElement('button');
        button.className = 'primary';
        button.textContent = actionText;
        button.addEventListener('click', action);
        empty.append(button);
      }
      return empty;
    }

    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'render') {
        render(event.data);
        return;
      }
      if (event.data.type === 'operation') {
        const busy = event.data.status === 'busy';
        document.body.classList.toggle('busy', busy);
        notice.textContent = busy
          ? '正在处理'
          : event.data.status === 'error'
            ? event.data.message
            : '';
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && selectedSessionId) {
        const sheet = document.querySelector('.lineage-detail-sheet');
        const focusable = sheet
          ? [...sheet.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')]
              .filter((element) =>
                !element.disabled && element.getClientRects().length > 0
              )
          : [];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last) {
          if (!sheet.contains(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          } else if (
            event.shiftKey &&
            (
              document.activeElement === first ||
              !focusable.includes(document.activeElement)
            )
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (
        event.key === 'Escape' &&
        selectedSessionId &&
        latestPayload
      ) {
        event.preventDefault();
        closeSessionSheet(latestPayload, true);
      }
    });
    send('ready');
  </script>
</body>
</html>`;
  }
}

function emptyState(root: string): ProjectState {
  return {
    version: 1,
    projectId: "",
    root,
    activeBranchId: "main",
    branches: [
      {
        id: "main",
        name: "main",
        createdAt: new Date().toISOString()
      }
    ],
    nodes: [],
    pending: {},
    updatedAt: new Date().toISOString()
  };
}

async function readLastHookError(root: string): Promise<string | undefined> {
  try {
    const dir = projectDataDir(root);
    const [errors, successes] = await Promise.all([
      fs.promises.readFile(path.join(dir, "hook-errors.log"), "utf8"),
      fs.promises
        .readFile(path.join(dir, "hook-success.log"), "utf8")
        .catch(() => "")
    ]);
    const errorLines = errors.trim().split(/\r?\n/);
    const latestError = errorLines[errorLines.length - 1];
    if (!latestError) {
      return undefined;
    }
    const errorAt = Date.parse(latestError.split(/\s/, 1)[0]);
    const successAt = Math.max(
      0,
      ...successes
        .split(/\r?\n/)
        .map((value) => Number.parseInt(value, 10))
        .filter(Number.isFinite)
    );
    return Number.isFinite(errorAt) && successAt >= errorAt
      ? undefined
      : latestError;
  } catch {
    return undefined;
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
