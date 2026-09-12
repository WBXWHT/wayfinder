const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

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
const { TimelineViewProvider } = require("../out/timelineView.js");

const webview = {
  cspSource: "https://preview.invalid",
  asWebviewUri(value) {
    return String(value);
  }
};

test("sidebar renders one active project with accessible voyage paging", () => {
  const provider = new TimelineViewProvider(".", "/tmp/project", {});
  const html = provider.html(webview);

  assert.match(html, /renderVoyagePager\(forest\.trees, activeIndex, activeTree/);
  assert.match(html, /trees: \[activeTree\]/);
  assert.match(html, /aria-label', '切换项目航海图'/);
  assert.match(html, /placeholder = '搜索当前项目'/);
  assert.match(html, /activeTreeId = trees\[nextIndex\]\.id/);
  assert.match(html, /setTimeout\(\(\) => \{[\s\S]*?updateSearch\(\);[\s\S]*?\}, 120\)/);
  assert.match(html, /position: sticky;[\s\S]*?top: 92px/);
  assert.match(html, /'lineage-detail-sheet '/);
  assert.match(html, /renderSessionSheet\(\s*selectedSession,\s*nodeById,\s*payload,\s*sheetRouteClass\s*\)/);
  assert.match(html, /lineageGeometryFor\(tree\.sessions\)/);
  assert.match(html, /d3\.hierarchy\(lineageHierarchyFor\(sessions\)\)/);
  assert.match(html, /const lineageCardWidth = 128/);
  assert.match(html, /const lineageCardGap = 14/);
  assert.match(
    html,
    /const lineageSiblingGap = lineageCardWidth \+ lineageCardGap/
  );
  assert.match(
    html,
    /d3\.tree\(\)[\s\S]*?\.nodeSize\(\[lineageSiblingGap, 96\]\)[\s\S]*?\.separation\(\(\) => 1\)\(root\)/
  );
  assert.match(html, /const smoothVerticalPath = \(/);
  assert.match(html, /sourceY \+ \(targetY - sourceY\) \* \.5/);
  // Pan + pinch-zoom: a single d3.zoom drives the stage element, and a
  // ResizeObserver keeps the whole tree fitted to the panel width.
  assert.match(html, /d3\.zoom\(\)/);
  assert.match(html, /scaleExtent/);
  assert.match(html, /translateExtent\(\[\[-Infinity, 0\], \[Infinity, Infinity\]\]\)/);
  assert.match(html, /new ResizeObserver/);
  assert.match(html, /renderCleanups\.splice\(0\)\.forEach/);
  assert.match(html, /resizeObserver\?\.disconnect\(\)/);
  assert.match(html, /window\.removeEventListener\('resize', fitStage\)/);
  assert.match(html, /lineageViewports\.set\(tree\.id \+ '\\u0000' \+ query/);
  assert.match(
    html,
    /const saved = lineageViewports\.get\(tree\.id \+ '\\u0000' \+ query\)/
  );
  assert.match(html, /const minimumReadableScale = 0\.7935/);
  assert.match(html, /Math\.max\(minimumReadableScale, fitScale\)/);
  assert.match(html, /Math\.max\(scaledHeight, viewportRoom, 240\)/);
  assert.match(html, /'wheel\.zoom', null/);
  assert.match(html, /zoom\.translateBy/);
  assert.match(html, /zoom\.scaleBy/);
  assert.match(
    html,
    /if \(!previous\.disabled\) previous\.title = previousLabel/
  );
  assert.match(html, /if \(!next\.disabled\) next\.title = nextLabel/);
  // A seeded (reproducible) natural ocean, not the old equal-spaced sine rows.
  assert.match(html, /const waveSeed = /);
  // Waves scatter across the whole ocean (a jittered grid spanning the full
  // shore width), not just the path column, so every part of the sea has waves.
  assert.match(html, /shoreLeft \+ c \* cellW/);
  assert.match(html, /waveCols = Math\.max/);
  assert.doesNotMatch(html, /\[0\.16, 0\.34, 0\.52, 0\.7, 0\.88\]/);
  assert.doesNotMatch(html, /channel-stem/);
  assert.doesNotMatch(html, /' L ' \+ targetX \+ ' ' \+ targetY/);
  assert.doesNotMatch(html, /Math\.sin\(index \* 1\.3\)/);
  assert.match(html, /\.lineage-edge\.route-0/);
  assert.match(
    html,
    /\.lineage-edge\.route-0,[\s\S]*?\.lineage-edge\.route-3,[\s\S]*?--route-accent: var\(--route-blue\)/
  );
  assert.match(html, /routeClass\(routeLayoutById\.get\(session\.id\)\.index\)/);
  assert.doesNotMatch(html, /stageTone|stage-(sun|leaf|sky|bloom)/);
  assert.doesNotMatch(html, /lineage-node-meta/);
  assert.doesNotMatch(html, /section\.append\(detail\)/);
  assert.match(html, /-webkit-line-clamp: 2/);
  assert.match(html, /sheet\.setAttribute\('role', 'dialog'\)/);
  assert.match(html, /sheet\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(html, /tools\.setAttribute\('inert', ''\)/);
  assert.match(html, /event\.key === 'Tab' && selectedSessionId/);
});

test("full map keeps one project canvas with expandable voyages", () => {
  const panel = new ExperienceMapPanel(".", "/tmp/project", {});
  const html = panel.html(webview);

  assert.doesNotMatch(html, /id="projectPrevious"/);
  assert.doesNotMatch(html, /id="projectNext"/);
  assert.doesNotMatch(html, /id="search"/);
  assert.doesNotMatch(html, /id="fit"/);
  assert.match(html, /const trees = forest\.trees/);
  assert.match(html, /function activateVoyage/);
  assert.match(html, /collapsedVoyagePitch/);
  assert.match(html, /tree-card\.collapsed/);
  assert.match(html, /点击展开/);
  assert.doesNotMatch(html, /共同港口/);
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /aria-label="航点详情"/);
  assert.match(html, /closeInspector\(true\)/);
  assert.match(html, /\.canvas-page-label \{[\s\S]*?text-align: center/);
  assert.match(html, /\.inspector-head/);
  assert.match(html, /\.inspector-turns/);
  assert.match(html, /\.layout\.inspector-open/);
  assert.match(
    html,
    /--inspector-width: clamp\(136px, 32vw, 336px\)/
  );
  assert.match(
    html,
    /\.layout\.inspector-open \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) var\(--inspector-width\)/
  );
  assert.doesNotMatch(html, /@media \(min-width: 720px\)/);
  assert.match(
    html,
    /\.inspector \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-width: thin;/
  );
  assert.match(
    html,
    /\.inspector-head \{[\s\S]*?position: relative;/
  );
  assert.match(
    html,
    /\.inspector-turns \{[\s\S]*?overflow: visible;/
  );
  assert.match(html, /--inspector-accent/);
  assert.match(html, /function captureViewport/);
  assert.match(html, /restoreViewport\(previousViewport\)/);
  assert.match(html, /requestAnimationFrame\(revealSelectedSession\)/);
  assert.match(html, /document\.addEventListener\('pointerdown'/);
  assert.match(html, /function appendResponse/);
  assert.match(html, /file\.lineCountsKnown === false/);
  assert.match(html, /count\.textContent = '行数未知'/);
  assert.match(html, /\.detail-actions \{[^}]*flex-wrap: wrap/);
  assert.match(html, /\.forest-card:focus \.node-card-bg/);
  assert.doesNotMatch(html, /forest-card:focus-visible/);
  assert.match(html, /@supports not \(color: color-mix/);
  assert.doesNotMatch(html, /\.at\(-1\)/);
  assert.match(html, /--project-accent/);
  assert.match(html, /routeIndexesFor\(tree\)/);
  assert.match(html, /\.forest-edge\.route-0/);
  assert.match(
    html,
    /\.forest-edge\.route-0,[\s\S]*?\.forest-edge\.route-3,[\s\S]*?--route-accent: var\(--route-blue\)/
  );
  assert.match(
    html,
    /\.forest-edge\.main,[\s\S]*?--route-accent: var\(--voyage-accent/
  );
  assert.match(html, /routeClass\(routeIndexById\.get\(session\.id\) \?\? -1\)/);
  assert.match(html, /const nodeCardWidth = 240/);
  assert.match(html, /const nodeCardHeight = 120/);
  assert.match(html, /const collapsedVoyagePitch = 136/);
  assert.match(html, /const expandedVoyageGap = 112/);
  assert.match(html, /const nodeVerticalPitch = 232/);
  assert.match(html, /const nodeHorizontalPitch = 324/);
  assert.match(html, /const voyageStartX = 92/);
  assert.match(html, /const minimumReadableScale = \.86/);
  assert.match(html, /\.scaleExtent\(\[\.4, 3\.2\]\)/);
  assert.match(html, /\.extent\(\[\s*\[0, insets\.top\]/);
  assert.match(html, /function viewportInsets\(height\)/);
  assert.match(html, /height < 420[\s\S]*top: 64, bottom: 12/);
  assert.match(html, /height < 420 \? Math\.min\(minimumScale, \.56\)/);
  assert.match(html, /suppressFocusReveal/);
  assert.match(
    html,
    /\.translateExtent\(\[\s*\[0, contentTop\],\s*\[Infinity, contentBottom\]\s*\]\)/
  );
  assert.match(html, /event\.type === 'mousedown'/);
  assert.match(html, /event\.touches\?\.length \|\| 0/);
  assert.match(html, /'wheel\.zoom', null/);
  assert.match(html, /'wheel\.wayfinder'/);
  assert.match(html, /function normalizedWheelDelta/);
  assert.match(html, /function normalizeWheel/);
  assert.match(html, /zoomBehavior\.translateBy/);
  assert.match(html, /zoomBehavior\.scaleTo/);
  assert.doesNotMatch(html, /function scheduleViewportFrame/);
  assert.match(html, /function revealCardInViewport/);
  assert.match(html, /\.on\('focus'/);
  assert.match(html, /Math\.max\(-160, Math\.min\(160, value \* unit\)\)/);
  assert.match(html, /zoomBehavior\.transform/);
  assert.match(html, /Math\.pow\(2, delta\.z\)/);
  assert.match(html, /const firstControlX = sx \+ span \* \.32/);
  assert.match(html, /const secondControlX = sx \+ span \* \.62/);
  assert.match(html, /coastlineGeometry\(shoreTop, shoreBottom\)/);
  assert.match(html, /const narrowX = width <= 520/);
  assert.match(html, /attr\('class', 'card-layer'\)/);
  assert.match(html, /attr\('class', 'marker-layer'\)/);
  assert.match(html, /attr\('class', 'node-card-bg'\)/);
  assert.match(html, /attr\('class', 'node-summary'\)/);
  assert.match(html, /attr\('class', 'node-card-meta'\)/);
  assert.doesNotMatch(html, /foreignObject/);
  assert.doesNotMatch(html, /stageTone|stage-(sun|leaf|sky|bloom)/);
  assert.doesNotMatch(html, /node-kicker|node-foot/);
  assert.doesNotMatch(html, /<nav class="trees">/);
  assert.doesNotMatch(html, /renderForestOverview/);
});

test("failed routes expose red, reef, and blocked-route semantics", () => {
  const sidebar = new TimelineViewProvider(".", "/tmp/project", {}).html(
    webview
  );
  const map = new ExperienceMapPanel(".", "/tmp/project", {}).html(webview);

  for (const html of [sidebar, map]) {
    assert.match(html, /\.lineage-edge\.bad|\.forest-edge\.bad/);
    assert.match(html, /appendReef\(selection, true\)/);
    assert.match(html, /appendReef\(selection, false\)/);
    assert.match(html, /sailboat project-ship/);
    assert.match(html, /错误路线，此路不通/);
    assert.match(html, /礁石：此路不通/);
    assert.match(html, /aria-pressed/);
    assert.match(html, /animation: none !important/);
  }
  assert.match(map, /if \(isCurrent && !isBlockedEnd\) \{/);
  assert.match(
    map,
    /if \(isBlockedEnd\) \{[\s\S]*?appendReef\(selection, false\)/
  );
  assert.match(map, /当前航点/);
});

test("sidebar preview resolves D3 from the repository media directory", () => {
  const source = fs.readFileSync(
    require.resolve("../scripts/generate-preview.cjs"),
    "utf8"
  );

  assert.match(source, /\? "\.\.\/media\/d3\.min\.js"/);
});

test("sidebar preview escapes persisted UI state inside inline scripts", (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-preview-"));
  const statePath = path.join(sandbox, "timeline.json");
  const outputPath = path.join(sandbox, "preview.html");
  const marker =
    "</script><script>globalThis.previewInjected=true</script>\u2028\u2029";
  const now = "2026-09-12T00:00:00.000Z";
  fs.writeFileSync(statePath, JSON.stringify({
    version: 1,
    projectId: "preview-project",
    root: sandbox,
    activeBranchId: "main",
    branches: [{ id: "main", name: "main", createdAt: now }],
    nodes: [{
      id: marker,
      kind: "collected",
      sessionId: "codex:preview",
      sourceHost: "codex",
      branchId: "main",
      prompt: "Preview",
      startedAt: now,
      completedAt: now,
      snapshotBefore: "same",
      snapshotAfter: "same",
      files: [],
      actions: [],
      validation: { status: "skipped" }
    }],
    pending: {},
    updatedAt: now
  }));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  childProcess.execFileSync(
    process.execPath,
    [require.resolve("../scripts/generate-preview.cjs"), statePath, outputPath],
    {
      env: {
        ...process.env,
        WAYFINDER_PREVIEW_EXPAND_SESSION: "1"
      },
      stdio: "pipe"
    }
  );
  const html = fs.readFileSync(outputPath, "utf8");
  assert.doesNotMatch(html, /<script>globalThis\.previewInjected=true/);
  assert.match(html, /\\u003c\/script>/);
  assert.equal(html.includes("\u2028"), false);
  assert.equal(html.includes("\u2029"), false);
});
