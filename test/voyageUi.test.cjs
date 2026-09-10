const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
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
});

test("full map scopes layout to one project and removes legacy project list", () => {
  const panel = new ExperienceMapPanel(".", "/tmp/project", {});
  const html = panel.html(webview);

  assert.match(html, /id="projectPrevious"/);
  assert.match(html, /id="projectNext"/);
  assert.match(html, /const scopedTrees = activeTree \? \[activeTree\] : \[\]/);
  assert.match(html, /共同港口，' \+ tree\.title \+ ' 从这里出发/);
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /aria-label="航点详情"/);
  assert.match(html, /showEmptyInspector\(true\)/);
  assert.match(html, /routeIndexesFor\(tree\)/);
  assert.match(html, /\.forest-edge\.route-0/);
  assert.match(
    html,
    /\.forest-edge\.route-0,[\s\S]*?\.forest-edge\.route-3,[\s\S]*?--route-accent: var\(--route-blue\)/
  );
  assert.match(html, /routeClass\(routeIndexById\.get\(session\.id\) \?\? -1\)/);
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
    assert.match(
      html,
      /if \(isBlockedEnd\) \{[\s\S]*?appendReef\(selection, false\);[\s\S]*?\} else if \(isCurrent\) \{/
    );
    assert.match(html, /sailboat project-ship/);
    assert.match(html, /项目船：当前位置/);
    assert.match(html, /错误路线，此路不通/);
    assert.match(html, /礁石：此路不通/);
    assert.match(html, /aria-pressed/);
    assert.match(html, /animation: none !important/);
  }
});

test("sidebar preview resolves D3 from the repository media directory", () => {
  const source = fs.readFileSync(
    require.resolve("../scripts/generate-preview.cjs"),
    "utf8"
  );

  assert.match(source, /\? "\.\.\/media\/d3\.min\.js"/);
});
