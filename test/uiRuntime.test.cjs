/* global WebSocket */
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const console = require("node:console");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout } = require("node:timers");
const { URL } = require("node:url");

const root = path.resolve(__dirname, "..");
const chrome = findChrome();

test(
  "generated voyage previews run in Chromium at 220px and 320px",
  {
    skip: !chrome || process.env.WAYFINDER_SKIP_UI_TEST === "1",
    timeout: 45_000
  },
  async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-ui-"));
    const statePath = path.join(temp, "timeline.json");
    const sidebarPath = path.join(temp, "sidebar.html");
    const mapPath = path.join(temp, "map.html");
    const mcpPath = path.join(temp, "mcp.html");
    const userDataDir = path.join(temp, "chrome");
    const state = fixtureState();
    fs.writeFileSync(statePath, JSON.stringify(state));

    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const file =
        pathname === "/sidebar.html"
          ? sidebarPath
          : pathname === "/map.html"
            ? mapPath
            : pathname === "/mcp.html"
              ? mcpPath
            : path.join(root, pathname.replace(/^\/+/, ""));
      if (!file.startsWith(root) && !file.startsWith(temp)) {
        response.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      try {
        response.writeHead(200, {
          "content-type": contentType(file)
        });
        fs.createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
      } catch {
        response.writeHead(404).end();
      }
    });
    await listen(server);
    server.unref();
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;

    for (const [script, output] of [
      ["scripts/generate-preview.cjs", sidebarPath],
      ["scripts/generate-map-preview.cjs", mapPath],
      ["scripts/generate-mcp-preview.cjs", mcpPath]
    ]) {
      childProcess.execFileSync(
        process.execPath,
        [path.join(root, script), statePath, output],
        {
          cwd: root,
          env: {
            ...process.env,
            WAYFINDER_PREVIEW_ORIGIN: origin,
            WAYFINDER_PREVIEW_TREE: "示例应用"
          },
          stdio: "pipe"
        }
      );
    }

    const debugPort = await freePort();
    const browser = childProcess.spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        `${origin}/sidebar.html`
      ],
      { stdio: "ignore", detached: process.platform !== "win32" }
    );
    browser.unref();

    try {
      const target = await waitForTarget(debugPort, "/sidebar.html");
      const cdp = await connectCdp(target.webSocketDebuggerUrl);
      const exceptions = [];
      cdp.on("Runtime.exceptionThrown", (params) => {
        exceptions.push(
          params.exceptionDetails.exception?.description ||
            params.exceptionDetails.text
        );
      });
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 320,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false
      });
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.lineage-node-button').length === 9"
      );

      const sidebar = await evaluateJson(
        cdp,
        `({
          width: innerWidth,
          scrollWidth: document.body.scrollWidth,
          title: document.querySelector('.voyage-title')?.textContent,
          summaryHeight: document.querySelector(
            '.summary'
          )?.getBoundingClientRect().height,
          summaryTitleHeight: document.querySelector(
            '.summary-title'
          )?.getBoundingClientRect().height,
          summaryMetaHeight: document.querySelector(
            '.summary-meta'
          )?.getBoundingClientRect().height,
          disabledPagerTitle: document.querySelector(
            '.pager-button:disabled'
          )?.getAttribute('title'),
          projects: document.querySelectorAll('.lineage-section').length,
          reefs: document.querySelectorAll('.reef-sticker').length,
          canvasBottomGap: innerHeight - document.querySelector(
            '.lineage-canvas'
          ).getBoundingClientRect().bottom,
          stageDesignWidth: document.querySelector(
            '.lineage-stage'
          )?.offsetWidth,
          stageScale: Number(
            /scale\\(([^)]+)\\)/.exec(
              document.querySelector('.lineage-stage')?.style.transform || ''
            )?.[1]
          ),
          renderedCardWidth: document.querySelector(
            '.lineage-node-button'
          )?.getBoundingClientRect().width,
          maxLabelHeight: Math.max(
            ...[...document.querySelectorAll('.lineage-node-button')]
              .map((element) => element.getBoundingClientRect().height)
          ),
          labelMetadata: document.querySelectorAll(
            '.lineage-node-meta'
          ).length,
          routes: [...document.querySelectorAll('.lineage-node-button')]
            .map((element) => ({
              index: element.dataset.routeIndex,
              right: element.classList.contains('label-right'),
              routeClass: [...element.classList]
                .find((name) => name.startsWith('route-')),
              x: Number(element.dataset.routeX),
              y: Number(element.dataset.nodeY)
            })),
          routeColors: [0, 1, 2, 3, 4, 5].map((index) =>
            getComputedStyle(document.querySelector(
              '.lineage-edge.route-' + index + ':not(.good):not(.bad)'
            )).stroke
          ),
          routePatterns: [0, 1, 2, 3, 4, 5].map((index) =>
            document.querySelector(
              '.channel-decoration.route-' + index
            )?.innerHTML
          ),
          routeIdentity: ['.lineage-edge.route-2',
            '.lineage-node.route-2',
            '.lineage-node-button.route-2'
          ].map((selector) =>
            getComputedStyle(document.querySelector(selector))
              .getPropertyValue('--route-accent').trim()
          ),
          stageClasses: document.querySelectorAll(
            '[class*="stage-"]'
          ).length,
          successFill: getComputedStyle(
            document.querySelector('.lineage-node.good .journey-disc')
          ).fill,
          failureFill: getComputedStyle(
            document.querySelector('.lineage-node.bad .journey-disc')
          ).fill,
          linksSmooth: [...document.querySelectorAll('.lineage-link')]
            .every((element) => {
              const path = element.getAttribute('d');
              return path.includes(' C ') && !path.includes(' L ');
            }),
          channelWidth: getComputedStyle(
            document.querySelector('.lineage-edge.route-0')
          ).strokeWidth,
          decorations: document.querySelectorAll(
            '.channel-decoration'
          ).length,
          labelsInside: [...document.querySelectorAll('.lineage-node-button')]
            .every((element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= innerWidth;
            }),
          minSiblingCardGap: (() => {
            const cards = [...document.querySelectorAll(
              '.lineage-node-button'
            )].map((element) => ({
              y: Number(element.dataset.nodeY),
              rect: element.getBoundingClientRect()
            }));
            const scale = cards[0]?.rect.width / 128 || 1;
            const gaps = [];
            const rows = new Map();
            cards.forEach((card) => {
              const row = rows.get(card.y) || [];
              row.push(card.rect);
              rows.set(card.y, row);
            });
            rows.forEach((row) => {
              row.sort((a, b) => a.left - b.left);
              for (let index = 1; index < row.length; index += 1) {
                gaps.push((row[index].left - row[index - 1].right) / scale);
              }
            });
            return gaps.length > 0 ? Math.min(...gaps) : null;
          })()
        })`
      );
      // The sidebar now shares the wide map's d3.tree engine, rotated 90°:
      // depth grows downward into rows and sibling branches fan into parallel
      // columns (AI and API run side by side from the fork). The canvas may be
      // wider than 320px and scroll horizontally. Assert the tree invariants.
      assert.equal(sidebar.width, 320);
      assert.equal(sidebar.title, "示例应用");
      assert.equal(sidebar.projects, 1);
      assert.equal(sidebar.reefs, 1);
      assert.ok(sidebar.summaryHeight <= 43);
      assert.ok(sidebar.summaryTitleHeight <= 16);
      assert.ok(sidebar.summaryMetaHeight <= 16);
      assert.equal(sidebar.disabledPagerTitle, null);
      assert.ok(sidebar.canvasBottomGap >= 20 && sidebar.canvasBottomGap <= 28);
      assert.ok(sidebar.stageDesignWidth <= 925);
      assert.ok(sidebar.stageScale >= 0.793 && sidebar.stageScale <= 0.794);
      // Preserve the readable scale measured in the final pre-rename build:
      // 128px design cards rendered at roughly 101px (scale 0.7935).
      assert.ok(
        sidebar.renderedCardWidth >= 100 &&
          sidebar.renderedCardWidth <= 102
      );
      assert.ok(sidebar.maxLabelHeight > 10 && sidebar.maxLabelHeight <= 34);
      assert.equal(sidebar.labelMetadata, 0);
      assert.equal(sidebar.stageClasses, 0);
      assert.equal(sidebar.channelWidth, "16px");
      assert.equal(sidebar.decorations, 8);
      assert.equal(sidebar.linksSmooth, true);
      // Trunk (root waypoint) is the topmost node; every branch grows into a
      // deeper row below it, so the tree reads top-to-bottom.
      const trunk = sidebar.routes[0];
      assert.equal(trunk.routeClass, "route-trunk");
      assert.ok(
        sidebar.routes.slice(1).every((route) => route.y > trunk.y)
      );
      // Sibling branches occupy distinct parallel columns instead of one lane.
      const columns = new Set(sidebar.routes.map((route) => route.x));
      assert.ok(columns.size >= 4);
      // Card width (128px) participates in d3's sibling spacing, so parallel
      // columns preserve a 14px design-space gap without moving card centers
      // away from their route nodes. Runtime values are normalized for fit scale.
      assert.ok(sidebar.minSiblingCardGap >= 13.9);
      // The AI branch and the API branch share the fork's depth row but sit in
      // clearly separated columns — proof they run in parallel, not stacked.
      const aiFork = sidebar.routes.find((r) => r.routeClass === "route-0");
      const apiFork = sidebar.routes.find((r) => r.routeClass === "route-1");
      assert.ok(aiFork && apiFork);
      assert.ok(Math.abs(aiFork.x - apiFork.x) >= 80);
      assert.equal(new Set(sidebar.routeColors).size, 3);
      assert.equal(sidebar.routeColors[0], sidebar.routeColors[3]);
      assert.equal(sidebar.routeColors[1], sidebar.routeColors[4]);
      assert.equal(sidebar.routeColors[2], sidebar.routeColors[5]);
      assert.notEqual(sidebar.routePatterns[0], sidebar.routePatterns[3]);
      assert.notEqual(sidebar.routePatterns[1], sidebar.routePatterns[4]);
      assert.notEqual(sidebar.routePatterns[2], sidebar.routePatterns[5]);
      assert.equal(new Set(sidebar.routeIdentity).size, 1);
      assert.match(sidebar.successFill, /47,\s*158,\s*98/);
      assert.match(sidebar.failureFill, /238,\s*116,\s*105/);

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 220,
        height: 800,
        deviceScaleFactor: 2,
        mobile: false
      });
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.lineage-node-button').length === 9"
      );
      await waitForExpression(
        cdp,
        "document.querySelector('.lineage-stage')" +
          "?.style.transform.includes('scale(')"
      );
      const narrowSidebar = await evaluateJson(
        cdp,
        `({
          width: innerWidth,
          scrollWidth: document.body.scrollWidth,
          summaryHeight: document.querySelector(
            '.summary'
          )?.getBoundingClientRect().height,
          titleHeight: document.querySelector(
            '.summary-title'
          )?.getBoundingClientRect().height,
          metaHeight: document.querySelector(
            '.summary-meta'
          )?.getBoundingClientRect().height,
          disabledPagerTitle: document.querySelector(
            '.pager-button:disabled'
          )?.getAttribute('title'),
          canvasBottomGap: innerHeight - document.querySelector(
            '.lineage-canvas'
          ).getBoundingClientRect().bottom,
          stageDesignWidth: document.querySelector(
            '.lineage-stage'
          )?.offsetWidth,
          stageScale: Number(
            /scale\\(([^)]+)\\)/.exec(
              document.querySelector('.lineage-stage')?.style.transform || ''
            )?.[1]
          ),
          renderedCardWidth: document.querySelector(
            '.lineage-node-button'
          )?.getBoundingClientRect().width,
          labelsInside: [...document.querySelectorAll(
            '.lineage-node-button'
          )].every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth;
          }),
          visibleCardCount: (() => {
            const canvas = document.querySelector(
              '.lineage-canvas'
            ).getBoundingClientRect();
            return [...document.querySelectorAll(
              '.lineage-node-button'
            )].filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.right > canvas.left && rect.left < canvas.right;
            }).length;
          })()
        })`
      );
      assert.equal(narrowSidebar.width, 220);
      assert.equal(narrowSidebar.scrollWidth, 220);
      assert.ok(narrowSidebar.summaryHeight <= 43);
      assert.ok(narrowSidebar.titleHeight <= 16);
      assert.ok(narrowSidebar.metaHeight <= 16);
      assert.equal(narrowSidebar.disabledPagerTitle, null);
      assert.equal(narrowSidebar.labelsInside, false);
      assert.ok(narrowSidebar.visibleCardCount >= 1);
      assert.ok(
        narrowSidebar.canvasBottomGap >= 20 &&
          narrowSidebar.canvasBottomGap <= 28
      );
      assert.ok(narrowSidebar.stageDesignWidth <= 925);
      assert.ok(
        narrowSidebar.stageScale >= 0.793 &&
          narrowSidebar.stageScale <= 0.794
      );
      assert.ok(
        narrowSidebar.renderedCardWidth >= 100 &&
          narrowSidebar.renderedCardWidth <= 102
      );

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 320,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false
      });
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.lineage-node-button').length === 9"
      );

      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector(" +
          "'.lineage-node-button[aria-label*=\"错误路线\"]')?.click()"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('.lineage-detail-sheet') !== null"
      );
      await waitForExpression(
        cdp,
        "document.activeElement?.classList.contains('sheet-title')"
      );
      await waitForExpression(
        cdp,
        "document.querySelector('.lineage-detail-sheet')" +
          "?.getBoundingClientRect().bottom <= innerHeight"
      );
      const sheet = await evaluateJson(
        cdp,
        `({
          count: document.querySelectorAll('.lineage-detail-sheet').length,
          inlineDetails: document.querySelectorAll(
            '.lineage-section > .session'
          ).length,
          bodyClass: document.body.classList.contains('sheet-open'),
          active: document.activeElement?.className,
          viewport: innerHeight,
          bottom: Math.round(
            document.querySelector('.lineage-detail-sheet')
              ?.getBoundingClientRect().bottom || 0
          )
        })`
      );
      assert.equal(sheet.count, 1);
      assert.equal(sheet.inlineDetails, 0);
      assert.equal(sheet.bodyClass, true);
      assert.equal(sheet.active, "sheet-title");
      assert.ok(
        sheet.bottom <= sheet.viewport &&
        sheet.bottom >= sheet.viewport - 12,
        JSON.stringify(sheet)
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "document.dispatchEvent(new KeyboardEvent('keydown'," +
          "{ key: 'Escape', bubbles: true }))"
      });
      await delay(120);
      assert.equal(
        await evaluate(
          cdp,
          "document.querySelectorAll('.lineage-detail-sheet').length"
        ),
        0
      );
      assert.match(
        await evaluate(cdp, "document.activeElement?.getAttribute('aria-label')"),
        /错误路线/
      );

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.querySelector('.search input');
          input.value = '简';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
          input.value = '项目方案';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        })()`
      });
      await delay(250);
      assert.equal(
        await evaluate(cdp, "document.querySelector('.search input')?.value"),
        "项目方案"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.querySelector('.search input');
          input.value = 'API';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
          window.dispatchEvent(new MessageEvent('message', {
            data: Object.assign({}, latestPayload, {
              validationCommand: 'NEW'
            })
          }));
        })()`
      });
      await delay(250);
      // The validation-command footer was removed as dead product surface;
      // configuring validation now lives only in the title-bar menu.
      assert.equal(
        await evaluate(cdp, "document.querySelectorAll('.footer').length"),
        0
      );

      const originalTitle = sidebar.title;
      await cdp.send("Runtime.evaluate", {
        expression:
          "[...document.querySelectorAll('.pager-button')]" +
          ".find((button) => !button.disabled)?.click()"
      });
      await delay(120);
      assert.notEqual(
        await evaluate(cdp, "document.querySelector('.voyage-title')?.textContent"),
        originalTitle
      );
      assert.equal(await evaluate(cdp, "scrollY"), 0);

      await cdp.send("Page.navigate", { url: `${origin}/map.html` });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.session-node').length === 9"
      );
      const map = await evaluateJson(
        cdp,
        `({
          innerWidth,
          scrollWidth: document.body.scrollWidth,
          sessions: document.querySelectorAll('.session-node').length,
          projects: document.querySelectorAll('.tree-node').length,
          reefs: document.querySelectorAll('.reef-sticker').length,
          ships: document.querySelectorAll('.project-ship').length,
          cardWidth: document.querySelector(
            '.session-node foreignObject'
          )?.getAttribute('width'),
          cardHeight: document.querySelector(
            '.session-node foreignObject'
          )?.getAttribute('height'),
          cardMetadata: document.querySelectorAll(
            '.node-kicker, .node-foot'
          ).length,
          routeChannels: document.querySelectorAll(
            '.forest-edge.route-0, .forest-edge.route-1, ' +
            '.forest-edge.route-2, .forest-edge.route-3, ' +
            '.forest-edge.route-4, .forest-edge.route-5'
          ).length,
          routeColors: [0, 1, 2, 3, 4, 5].map((index) =>
            getComputedStyle(document.querySelector(
              '.forest-edge.route-' + index + ':not(.good):not(.bad)'
            )).stroke
          ),
          routePatterns: [0, 1, 2, 3, 4, 5].map((index) =>
            document.querySelector(
              '.channel-decoration.route-' + index
            )?.innerHTML
          ),
          routeIdentity: ['.forest-edge.route-2',
            '.session-node.route-2'
          ].map((selector) =>
            getComputedStyle(document.querySelector(selector))
              .getPropertyValue('--route-accent').trim()
          ),
          stageClasses: document.querySelectorAll(
            '[class*="stage-"]'
          ).length,
          successFill: getComputedStyle(
            document.querySelector('.session-node.good .journey-disc')
          ).fill,
          failureFill: getComputedStyle(
            document.querySelector('.session-node.bad .journey-disc')
          ).fill,
          channelWidth: getComputedStyle(
            document.querySelector('.forest-edge.route-0')
          ).strokeWidth,
          shoreFill: getComputedStyle(
            document.querySelector('.shore-fill')
          ).fill,
          decorations: document.querySelectorAll(
            '.channel-decoration'
          ).length
        })`
      );
      assert.equal(map.scrollWidth, 320);
      assert.equal(map.sessions, 9);
      assert.equal(map.projects, 1);
      assert.equal(map.reefs, 1);
      assert.equal(map.ships, 1);
      assert.equal(map.cardWidth, "148");
      assert.equal(map.cardHeight, "46");
      assert.equal(map.cardMetadata, 0);
      assert.equal(map.routeChannels, 8);
      assert.equal(new Set(map.routeColors).size, 3);
      assert.equal(map.routeColors[0], map.routeColors[3]);
      assert.equal(map.routeColors[1], map.routeColors[4]);
      assert.equal(map.routeColors[2], map.routeColors[5]);
      assert.notEqual(map.routePatterns[0], map.routePatterns[3]);
      assert.notEqual(map.routePatterns[1], map.routePatterns[4]);
      assert.notEqual(map.routePatterns[2], map.routePatterns[5]);
      assert.equal(new Set(map.routeIdentity).size, 1);
      assert.equal(map.stageClasses, 0);
      assert.match(map.successFill, /47,\s*158,\s*98/);
      assert.match(map.failureFill, /238,\s*116,\s*105/);
      assert.equal(map.channelWidth, "19px");
      assert.match(map.shoreFill, /244.*210.*138/);
      assert.equal(map.decorations, 9);

      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector('.node-hit[aria-label*=\"错误路线\"]')?.click()"
      });
      await delay(120);
      assert.equal(
        await evaluate(cdp, "document.activeElement?.className"),
        "detail-title"
      );
      const toggles = await evaluateJson(
        cdp,
        `[...document.querySelectorAll('.detail-actions [aria-pressed]')]
          .map((button) => ({
            label: button.getAttribute('aria-label'),
            pressed: button.getAttribute('aria-pressed')
          }))`
      );
      assert.deepEqual(toggles, [
        { label: "标记正确", pressed: "false" },
        { label: "取消错误标记", pressed: "true" }
      ]);
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const button = [...document.querySelectorAll(
            '.detail-actions [aria-pressed]'
          )].find((item) => item.getAttribute('aria-pressed') === 'true');
          button.focus();
          window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'render',
              state,
              forest,
              projectName
            }
          }));
        })()`
      });
      await delay(120);
      assert.equal(
        await evaluate(cdp, "document.activeElement?.getAttribute('aria-label')"),
        "取消错误标记"
      );

      await cdp.send("Runtime.evaluate", {
        expression:
          "document.dispatchEvent(new KeyboardEvent('keydown'," +
          "{ key: 'Escape', bubbles: true }))"
      });
      await delay(120);
      assert.equal(
        await evaluate(cdp, "document.activeElement?.className"),
        "node-hit"
      );

      await cdp.send("Emulation.setEmulatedMedia", {
        media: "screen",
        features: [{ name: "prefers-reduced-motion", value: "reduce" }]
      });
      assert.equal(
        await evaluate(
          cdp,
          "getComputedStyle(document.querySelector('.sailboat')).animationName"
        ),
        "none"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'operation', status: 'busy' }
        }))`
      });
      assert.equal(
        await evaluate(cdp, "document.body.getAttribute('aria-busy')"),
        "true"
      );

      await cdp.send("Page.navigate", { url: `${origin}/mcp.html` });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.node').length === 9"
      );
      const mcp = await evaluateJson(
        cdp,
        `({
          innerWidth,
          scrollWidth: document.body.scrollWidth,
          nodes: document.querySelectorAll('.node').length,
          routes: document.querySelectorAll('.route').length,
          smoothRoutes: [...document.querySelectorAll('.route')]
            .every((element) => element.getAttribute('d').includes(' C')),
          grids: document.querySelectorAll('#wayfinder-grid').length,
          roots: document.querySelectorAll('.root-core').length,
          currentRings: document.querySelectorAll('.current-ring').length,
          errorMarks: document.querySelectorAll('.error-mark').length,
          cardWidth: document.querySelector('.node rect')?.getAttribute('width'),
          cardHeight: document.querySelector('.node rect')?.getAttribute('height'),
          renderedCardWidth: document.querySelector(
            '.node rect'
          )?.getBoundingClientRect().width,
          minSiblingCardGap: (() => {
            const cards = [...document.querySelectorAll('.node')].map((node) => ({
              top: Math.round(node.getBoundingClientRect().top),
              rect: node.querySelector('rect').getBoundingClientRect()
            }));
            const scale = cards[0]?.rect.width / 128 || 1;
            const rows = new Map();
            cards.forEach((card) => {
              const row = rows.get(card.top) || [];
              row.push(card.rect);
              rows.set(card.top, row);
            });
            const gaps = [];
            rows.forEach((row) => {
              row.sort((a, b) => a.left - b.left);
              for (let index = 1; index < row.length; index += 1) {
                gaps.push((row[index].left - row[index - 1].right) / scale);
              }
            });
            return gaps.length ? Math.min(...gaps) : null;
          })()
        })`
      );
      assert.equal(mcp.innerWidth, 320);
      assert.equal(mcp.scrollWidth, 320);
      assert.equal(mcp.nodes, 9);
      assert.equal(mcp.routes, 9);
      assert.equal(mcp.smoothRoutes, true);
      assert.equal(mcp.grids, 1);
      assert.equal(mcp.roots, 1);
      assert.equal(mcp.currentRings, 1);
      assert.equal(mcp.errorMarks, 1);
      assert.equal(mcp.cardWidth, "128");
      assert.equal(mcp.cardHeight, "48");
      assert.ok(mcp.renderedCardWidth >= 95);
      assert.ok(mcp.minSiblingCardGap >= 13.9);

      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector('.node.bad')?.dispatchEvent(" +
          "new MouseEvent('click', { bubbles: true }))"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#detail')?.hidden === false"
      );
      assert.match(
        await evaluate(cdp, "document.querySelector('#detail p')?.textContent"),
        /AI 助手/
      );
      const beforeZoom = await evaluate(
        cdp,
        "document.querySelector('.stage')?.style.transform"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('.viewport')?.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -8,
            ctrlKey: true,
            clientX: 160,
            clientY: 220,
            bubbles: true,
            cancelable: true
          })
        )`
      });
      assert.notEqual(
        await evaluate(cdp, "document.querySelector('.stage')?.style.transform"),
        beforeZoom
      );
      const beforeTouchPan = await evaluate(
        cdp,
        "document.querySelector('.stage')?.style.transform"
      );
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 160, y: 600 }]
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 160, y: 420 }]
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: []
      });
      assert.notEqual(
        await evaluate(cdp, "document.querySelector('.stage')?.style.transform"),
        beforeTouchPan
      );

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const session = (id, title) => ({
            id,
            parentId: undefined,
            shortTitle: title,
            preview: title,
            stage: '实现',
            verdict: undefined,
            nodeIds: [id],
            startedAt: '2026-09-10T00:00:00.000Z',
            completedAt: '2026-09-10T00:00:01.000Z'
          });
          const payload = {
            project: 'selection-test',
            state: { root: '/tmp/selection-test', nodes: [] },
            forest: {
              trees: [
                { id: 'tree-a', title: 'A', sessions: [session('a', 'A')] },
                { id: 'tree-b', title: 'B', sessions: [session('b', 'B')] }
              ]
            }
          };
          globalThis.__WAYFINDER_SET_PAYLOAD__(payload);
          document.querySelector('#next').click();
          globalThis.__WAYFINDER_SET_PAYLOAD__({
            ...payload,
            forest: {
              trees: payload.forest.trees.map((tree) => ({ ...tree }))
            }
          });
        })()`
      });
      assert.equal(
        await evaluate(cdp, "document.querySelector('#treeCount')?.textContent"),
        "2 / 2"
      );
      assert.deepEqual(exceptions, []);
      cdp.close();
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      const exited = new Promise((resolve) => browser.once("exit", resolve));
      const killBrowser = (signal) => {
        try {
          if (process.platform === "win32") browser.kill(signal);
          else process.kill(-browser.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      killBrowser("SIGTERM");
      await Promise.race([exited, delay(2_000)]);
      if (browser.exitCode === null && browser.signalCode === null) {
        killBrowser("SIGKILL");
        await Promise.race([exited, delay(2_000)]);
      }
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await Promise.race([
        new Promise((resolve) => server.close(resolve)),
        delay(2_000)
      ]);
      fs.rmSync(temp, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
    }
  }
);

function fixtureState() {
  const nodes = [
    fixtureNode("life-root", "2026-09-01T09:00:00.000Z", "项目方向探索"),
    fixtureNode("life-product", "2026-09-02T09:00:00.000Z", "Wayfinder 产品"),
    fixtureNode("resume-root", "2026-09-03T09:00:00.000Z", "需求与设计"),
    fixtureNode("resume-ai", "2026-09-04T09:00:00.000Z", "AI 助手"),
    fixtureNode("resume-api", "2026-09-05T09:00:00.000Z", "API 动态分成"),
    fixtureNode("resume-third", "2026-09-06T09:00:00.000Z", "第三路线"),
    fixtureNode(
      "resume-ai-child",
      "2026-09-07T09:00:00.000Z",
      "AI 助手 · Tips"
    ),
    fixtureNode(
      "resume-ai-sibling",
      "2026-09-07T10:00:00.000Z",
      "AI 助手 · Tags"
    ),
    fixtureNode("resume-fourth", "2026-09-08T09:00:00.000Z", "第四路线"),
    fixtureNode("resume-fifth", "2026-09-09T09:00:00.000Z", "第五路线"),
    fixtureNode("resume-sixth", "2026-09-10T09:00:00.000Z", "第六路线")
  ];
  nodes[2].verdict = "success";
  nodes[3].verdict = "failure";
  nodes[5].source.forest = {
    tree: "示例应用",
    stage: "第三路线",
    stageOrder: 1,
    parentStage: "需求结构"
  };
  nodes[8].source.forest = {
    tree: "示例应用",
    stage: "第四路线",
    stageOrder: 1,
    parentStage: "需求结构"
  };
  nodes[9].source.forest = {
    tree: "示例应用",
    stage: "第五路线",
    stageOrder: 1,
    parentStage: "需求结构"
  };
  nodes[10].source.forest = {
    tree: "示例应用",
    stage: "第六路线",
    stageOrder: 1,
    parentStage: "需求结构"
  };
  return {
    version: 1,
    projectId: "ui-test",
    root: "/tmp/ui-test",
    activeBranchId: "main",
    branches: [
      {
        id: "main",
        name: "main",
        createdAt: nodes[0].completedAt
      }
    ],
    nodes,
    pending: {},
    updatedAt: nodes.at(-1).completedAt
  };
}

function fixtureNode(id, completedAt, chapter) {
  return {
    id,
    kind: "imported",
    sessionId: id,
    branchId: "history",
    prompt: `${chapter} ${id}`,
    response: "",
    startedAt: completedAt,
    completedAt,
    snapshotBefore: "same",
    snapshotAfter: "same",
    files: [],
    actions: [],
    validation: { status: "skipped" },
    source: {
      type: "trae-memory",
      importedAt: completedAt,
      chapter
    }
  };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function contentType(file) {
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".ttf")) return "font/ttf";
  return "text/html; charset=utf-8";
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function freePort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForTarget(port, suffix) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const targets = await getTargets(port);
      const target = targets.find(
        (item) => item.type === "page" && item.url.endsWith(suffix)
      );
      if (target) return target;
    } catch {
      // Chrome may not have opened its debugging endpoint yet.
    }
    await delay(100);
  }
  throw new Error("Chromium debugging target did not start");
}

async function waitForExpression(cdp, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function getTargets(port) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json`, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          return new Promise((resolveCommand, rejectCommand) => {
            const id = nextId;
            nextId += 1;
            pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, listener) {
          const items = listeners.get(method) || [];
          items.push(listener);
          listeners.set(method, items);
        },
        close() {
          socket.close();
        }
      });
    });
    socket.addEventListener("error", reject);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const task = pending.get(message.id);
        if (!task) return;
        pending.delete(message.id);
        if (message.error) {
          task.reject(new Error(message.error.message));
        } else {
          task.resolve(message.result);
        }
        return;
      }
      for (const listener of listeners.get(message.method) || []) {
        listener(message.params);
      }
    });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function evaluateJson(cdp, expression) {
  return evaluate(cdp, `JSON.stringify(${expression})`).then(JSON.parse);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
