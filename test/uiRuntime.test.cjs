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
    const companionStatePath = path.join(temp, "companion-timeline.json");
    const companionPath = path.join(temp, "companion.html");
    const singleStatePath = path.join(temp, "single-timeline.json");
    const singleCompanionPath = path.join(temp, "single-companion.html");
    const userDataDir = path.join(temp, "chrome");
    const state = fixtureState();
    fs.writeFileSync(statePath, JSON.stringify(state));
    const companionState = fixtureState();
    companionState.nodes[3] = {
      ...companionState.nodes[3],
      kind: "collected",
      sourceHost: "codex",
      files: [
        {
          path: "src/sessionCollector.ts",
          status: "M",
          additions: 12,
          deletions: 3
        }
      ],
      source: {
        type: "rollout",
        host: "codex",
        rolloutPath: "/tmp/rollout.jsonl",
        sessionId: "resume-ai",
        turnIndex: 0,
        collectedAt: "2026-09-10T09:00:00.000Z"
      }
    };
    fs.writeFileSync(companionStatePath, JSON.stringify(companionState));
    const singleState = {
      ...fixtureState(),
      nodes: [fixtureState().nodes[0]],
      pending: {}
    };
    fs.writeFileSync(singleStatePath, JSON.stringify(singleState));

    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const file =
        pathname === "/sidebar.html"
          ? sidebarPath
          : pathname === "/map.html"
            ? mapPath
            : pathname === "/companion.html"
                ? companionPath
                : pathname === "/single-companion.html"
                  ? singleCompanionPath
                : pathname === "/codicon.ttf"
                  ? path.join(temp, "codicon.ttf")
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
      ["scripts/generate-map-preview.cjs", mapPath]
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
    childProcess.execFileSync(
      process.execPath,
      [
        path.join(root, "scripts/generate-companion-preview.cjs"),
        companionStatePath,
        companionPath
      ],
      {
        cwd: root,
        env: { ...process.env, WAYFINDER_PREVIEW_PROJECTS: "2" },
        stdio: "pipe"
      }
    );
    childProcess.execFileSync(
      process.execPath,
      [
        path.join(root, "scripts/generate-companion-preview.cjs"),
        singleStatePath,
        singleCompanionPath
      ],
      {
        cwd: root,
        stdio: "pipe"
      }
    );

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
      await delay(180);
      const map = await evaluateJson(
        cdp,
        `({
          innerWidth,
          scrollWidth: document.body.scrollWidth,
          sessions: document.querySelectorAll('.session-node').length,
          projects: document.querySelectorAll('.tree-node').length,
          reefs: document.querySelectorAll('.reef-sticker').length,
          ships: document.querySelectorAll('.project-ship').length,
          cards: document.querySelectorAll('.session-card').length,
          currentCards: document.querySelectorAll(
            '.session-card.current'
          ).length,
          keyboardCards: document.querySelectorAll(
            '.session-card[tabindex="0"]'
          ).length,
          visibleCards: [...document.querySelectorAll('.session-card')]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return (
                rect.right > 0 &&
                rect.left < innerWidth &&
                rect.bottom > 0 &&
                rect.top < innerHeight
              );
            }).length,
          cardWidth: document.querySelector(
            '.session-card .node-card-bg'
          )?.getAttribute('width'),
          cardHeight: document.querySelector(
            '.session-card .node-card-bg'
          )?.getAttribute('height'),
          foreignObjects: document.querySelectorAll('foreignObject').length,
          cardCollisions: (() => {
            const cards = [...document.querySelectorAll(
              '.session-card .node-card-bg'
            )].map((card) => card.getBoundingClientRect());
            let collisions = 0;
            for (let left = 0; left < cards.length; left += 1) {
              for (let right = left + 1; right < cards.length; right += 1) {
                const a = cards[left];
                const b = cards[right];
                if (
                  a.left < b.right - .5 &&
                  a.right > b.left + .5 &&
                  a.top < b.bottom - .5 &&
                  a.bottom > b.top + .5
                ) {
                  collisions += 1;
                }
              }
            }
            return collisions;
          })(),
          coastCoversCanvas: (() => {
            const coast = document.querySelector(
              '.shore-line'
            )?.getBoundingClientRect();
            const canvas = document.querySelector(
              '.canvas-shell'
            )?.getBoundingClientRect();
            return Boolean(
              coast &&
              canvas &&
              coast.top <= canvas.top &&
              coast.bottom >= canvas.bottom
            );
          })(),
          cardMetadata: document.querySelectorAll(
            '.node-kicker, .node-foot'
          ).length,
          cardSummaries: document.querySelectorAll(
            '.node-summary'
          ).length,
          cardFooters: document.querySelectorAll(
            '.node-card-meta'
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
          ).length,
          allRoutesDirectCubic: [...document.querySelectorAll(
            '.forest-edge'
          )].every((edge) => {
            const path = edge.getAttribute('d') || '';
            return path.includes(' C ') && !path.includes(' L ');
          }),
          maxForkAngle: (() => {
            const groups = new Map();
            [...document.querySelectorAll('.forest-edge')].forEach((edge) => {
              const link = edge.__data__?.link;
              if (!link) return;
              const key = link.source.data.session?.id || 'root';
              const items = groups.get(key) || [];
              items.push(link);
              groups.set(key, items);
            });
            const angles = [];
            groups.forEach((links) => {
              if (links.length < 2) return;
              links.forEach((link) => {
                angles.push(
                  Math.atan2(
                    Math.abs(link.target.screenY - link.source.screenY),
                    link.target.screenX - link.source.screenX
                  ) *
                  180 /
                  Math.PI
                );
              });
            });
            return angles.length ? Math.max(...angles) : 0;
          })()
        })`
      );
      assert.equal(map.scrollWidth, 320);
      assert.equal(map.sessions, 9);
      assert.equal(map.projects, 1);
      assert.equal(map.reefs, 1);
      assert.equal(map.ships, 1);
      assert.equal(map.cards, 9);
      assert.equal(map.currentCards, 1);
      assert.equal(map.keyboardCards, map.cards);
      assert.ok(map.visibleCards >= 1);
      assert.equal(map.cardWidth, "240");
      assert.equal(map.cardHeight, "120");
      assert.equal(map.foreignObjects, 0);
      assert.equal(map.cardCollisions, 0);
      assert.equal(map.coastCoversCanvas, true);
      assert.equal(map.cardMetadata, 0);
      assert.equal(map.cardSummaries, 9);
      assert.equal(map.cardFooters, 9);
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
      assert.equal(map.allRoutesDirectCubic, true);
      assert.ok(map.maxForkAngle >= 20);

      const keyboardReveal = await evaluateJson(
        cdp,
        `(() => {
          const cards = [...document.querySelectorAll('.session-card')];
          const viewport = document.querySelector('#graph').getBoundingClientRect();
          const visible = (rect) =>
            rect.right > viewport.left &&
            rect.left < viewport.right &&
            rect.bottom > viewport.top &&
            rect.top < viewport.bottom;
          const target = cards.find(
            (card) => !visible(card.getBoundingClientRect())
          );
          if (!target) {
            return {
              foundOffscreen: false,
              beforeVisible: true,
              afterVisible: true,
              focused: false
            };
          }
          const before = target?.getBoundingClientRect();
          target.focus();
          const after = target.getBoundingClientRect();
          return {
            foundOffscreen: Boolean(target),
            beforeVisible: before ? visible(before) : true,
            afterVisible: visible(after),
            focused: document.activeElement === target
          };
        })()`
      );
      assert.equal(keyboardReveal.foundOffscreen, true);
      assert.equal(keyboardReveal.beforeVisible, false);
      assert.equal(keyboardReveal.afterVisible, true);
      assert.equal(keyboardReveal.focused, true);

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.querySelector('#search');
          input.value = 'Wayfinder 产品';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        })()`
      });
      await delay(180);
      assert.equal(
        await evaluate(cdp, "document.querySelector('#canvasTitle')?.textContent"),
        "搜索结果"
      );
      assert.equal(
        await evaluate(
          cdp,
          "document.querySelectorAll('.session-card').length > 0"
        ),
        true
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.querySelector('#search');
          input.value = '';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        })()`
      });
      await delay(180);

      const gestures = JSON.parse(await evaluate(
        cdp,
        `(async () => {
          const target = document.querySelector('#graph');
          const rect = target.getBoundingClientRect();
          const nextFrame = () => new Promise((resolve) =>
            requestAnimationFrame(() => resolve())
          );
          const settleFrames = async (count) => {
            for (let index = 0; index < count; index += 1) {
              await nextFrame();
            }
          };
          const wheel = (
            deltaX,
            deltaY,
            ctrlKey = false,
            deltaMode = 0
          ) =>
            target.dispatchEvent(new WheelEvent('wheel', {
              deltaX,
              deltaY,
              deltaMode,
              ctrlKey,
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2
            }));
          const initial = d3.zoomTransform(target);
          let transformWrites = 0;
          const observer = new MutationObserver((records) => {
            transformWrites += records.filter(
              (record) => record.attributeName === 'transform'
            ).length;
          });
          observer.observe(target.firstElementChild, {
            attributes: true,
            attributeFilter: ['transform']
          });
          for (let index = 0; index < 30; index += 1) {
            wheel(-80, 0);
          }
          await settleFrames(2);
          await Promise.resolve();
          const writesForFirstTwoFrames = transformWrites;
          await settleFrames(10);
          const writesForBurst = transformWrites;
          observer.disconnect();
          const atCoast = d3.zoomTransform(target);
          wheel(-160, 0);
          wheel(40, 0);
          await settleFrames(2);
          const reversedAtCoast = d3.zoomTransform(target);
          for (let index = 0; index < 30; index += 1) {
            wheel(-80, 0);
          }
          await settleFrames(2);
          for (let index = 0; index < 30; index += 1) {
            wheel(80, 0);
          }
          await settleFrames(12);
          const explored = d3.zoomTransform(target);
          for (let index = 0; index < 3; index += 1) {
            wheel(0, 80);
          }
          await nextFrame();
          const panned = d3.zoomTransform(target);
          document.querySelector('#fit').click();
          const reset = d3.zoomTransform(target);
          for (let index = 0; index < 30; index += 1) {
            wheel(80, 0);
          }
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'render', state, forest, projectName }
          }));
          await settleFrames(12);
          const afterRenderDuringPan = d3.zoomTransform(target);
          document.querySelector('#fit').click();
          for (let index = 0; index < 30; index += 1) {
            wheel(80, 0);
          }
          const switchedState = {
            ...state,
            projectId: (state.projectId || 'project') + '-other'
          };
          window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'render',
              state: switchedState,
              forest,
              projectName: 'another-project'
            }
          }));
          const afterContextSwitch = d3.zoomTransform(target);
          await settleFrames(12);
          const afterContextSettle = d3.zoomTransform(target);
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'render', state, forest, projectName }
          }));
          document.querySelector('#fit').click();
          for (let index = 0; index < 3; index += 1) {
            wheel(160, 0);
          }
          await settleFrames(3);
          const beforeAwayReversal = d3.zoomTransform(target);
          wheel(160, 0);
          wheel(-40, 0);
          await settleFrames(2);
          const afterAwayReversal = d3.zoomTransform(target);
          document.querySelector('#fit').click();
          const largePacketReset = d3.zoomTransform(target);
          wheel(1458, 0);
          await nextFrame();
          const largePacket = d3.zoomTransform(target);
          document.querySelector('#fit').click();
          const lineModeReset = d3.zoomTransform(target);
          wheel(2, 0, false, 1);
          await nextFrame();
          const lineModePan = d3.zoomTransform(target);
          document.querySelector('#fit').click();
          const pageModeReset = d3.zoomTransform(target);
          wheel(1, 0, false, 2);
          await nextFrame();
          const pageModePan = d3.zoomTransform(target);
          document.querySelector('#fit').click();
          const zoomReset = d3.zoomTransform(target);
          for (let index = 0; index < 3; index += 1) {
            wheel(0, -40, true);
          }
          await nextFrame();
          const pinched = d3.zoomTransform(target);
          for (let index = 0; index < 100; index += 1) {
            wheel(0, -40, true);
          }
          await settleFrames(12);
          const maxZoom = d3.zoomTransform(target);
          for (let index = 0; index < 100; index += 1) {
            wheel(0, 40, true);
          }
          await settleFrames(12);
          const minZoom = d3.zoomTransform(target);
          wheel(0, -40, true);
          await settleFrames(2);
          const reversedZoom = d3.zoomTransform(target);
          return JSON.stringify({
            initial: { x: initial.x, y: initial.y, k: initial.k },
            atCoast: { x: atCoast.x, y: atCoast.y, k: atCoast.k },
            reversedAtCoast: {
              x: reversedAtCoast.x,
              y: reversedAtCoast.y,
              k: reversedAtCoast.k
            },
            explored: { x: explored.x, y: explored.y, k: explored.k },
            panned: { x: panned.x, y: panned.y, k: panned.k },
            reset: { x: reset.x, y: reset.y, k: reset.k },
            afterRenderDuringPan: {
              x: afterRenderDuringPan.x,
              y: afterRenderDuringPan.y,
              k: afterRenderDuringPan.k
            },
            afterContextSwitch: {
              x: afterContextSwitch.x,
              y: afterContextSwitch.y,
              k: afterContextSwitch.k
            },
            afterContextSettle: {
              x: afterContextSettle.x,
              y: afterContextSettle.y,
              k: afterContextSettle.k
            },
            beforeAwayReversal: {
              x: beforeAwayReversal.x,
              y: beforeAwayReversal.y,
              k: beforeAwayReversal.k
            },
            afterAwayReversal: {
              x: afterAwayReversal.x,
              y: afterAwayReversal.y,
              k: afterAwayReversal.k
            },
            largePacketReset: {
              x: largePacketReset.x,
              y: largePacketReset.y,
              k: largePacketReset.k
            },
            largePacket: {
              x: largePacket.x,
              y: largePacket.y,
              k: largePacket.k
            },
            lineModeReset: {
              x: lineModeReset.x,
              y: lineModeReset.y,
              k: lineModeReset.k
            },
            lineModePan: {
              x: lineModePan.x,
              y: lineModePan.y,
              k: lineModePan.k
            },
            pageModeReset: {
              x: pageModeReset.x,
              y: pageModeReset.y,
              k: pageModeReset.k
            },
            pageModePan: {
              x: pageModePan.x,
              y: pageModePan.y,
              k: pageModePan.k
            },
            zoomReset: { x: zoomReset.x, y: zoomReset.y, k: zoomReset.k },
            writesForFirstTwoFrames,
            writesForBurst,
            pinched: { x: pinched.x, y: pinched.y, k: pinched.k },
            maxZoom: { x: maxZoom.x, y: maxZoom.y, k: maxZoom.k },
            minZoom: { x: minZoom.x, y: minZoom.y, k: minZoom.k },
            reversedZoom: {
              x: reversedZoom.x,
              y: reversedZoom.y,
              k: reversedZoom.k
            }
          });
        })()`
      ));
      assert.ok(gestures.atCoast.x <= 0.001);
      assert.ok(gestures.atCoast.x >= -0.001);
      assert.equal(gestures.atCoast.k, gestures.initial.k);
      assert.ok(
        Math.abs(gestures.reversedAtCoast.x + 40) < .001
      );
      assert.ok(gestures.explored.x < gestures.atCoast.x);
      assert.ok(
        Math.abs(
          gestures.explored.x - (gestures.atCoast.x - 2_400)
        ) < .001
      );
      assert.equal(gestures.explored.k, gestures.atCoast.k);
      assert.ok(gestures.panned.y < gestures.explored.y);
      assert.equal(gestures.panned.k, gestures.explored.k);
      assert.ok(gestures.writesForFirstTwoFrames <= 2);
      assert.ok(gestures.writesForBurst < 30);
      assert.ok(
        Math.abs(
          gestures.afterRenderDuringPan.x - (gestures.reset.x - 2_400)
        ) < .001
      );
      assert.deepEqual(
        gestures.afterContextSettle,
        gestures.afterContextSwitch
      );
      assert.ok(
        Math.abs(
          gestures.afterAwayReversal.x -
          (gestures.beforeAwayReversal.x - 120)
        ) < .001
      );
      assert.ok(
        gestures.largePacketReset.x - gestures.largePacket.x >= 159.999
      );
      assert.ok(
        gestures.largePacketReset.x - gestures.largePacket.x <= 160.001
      );
      assert.ok(
        Math.abs(
          gestures.lineModeReset.x - gestures.lineModePan.x - 32
        ) < .001
      );
      assert.ok(
        Math.abs(
          gestures.pageModeReset.x - gestures.pageModePan.x - 160
        ) < .001
      );
      assert.equal(gestures.largePacket.k, gestures.reset.k);
      assert.ok(gestures.pinched.k / gestures.zoomReset.k > 1.25);
      assert.ok(gestures.pinched.k / gestures.zoomReset.k < 1.32);
      assert.equal(gestures.maxZoom.k, 3.2);
      assert.equal(gestures.minZoom.k, 0.4);
      assert.ok(gestures.reversedZoom.k > gestures.minZoom.k);

      const dragTarget = await evaluateJson(
        cdp,
        `(() => {
          const target = document.querySelector('#graph');
          const rect = target.getBoundingClientRect();
          const transform = d3.zoomTransform(target);
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            transform: {
              x: transform.x,
              y: transform.y,
              k: transform.k
            }
          };
        })()`
      );
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: dragTarget.x,
        y: dragTarget.y,
        button: "left",
        clickCount: 1
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: dragTarget.x + 80,
        y: dragTarget.y + 60,
        button: "left",
        buttons: 1
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: dragTarget.x + 80,
        y: dragTarget.y + 60,
        button: "left",
        clickCount: 1
      });
      const afterMouseDrag = await evaluateJson(
        cdp,
        `(() => {
          const transform = d3.zoomTransform(
            document.querySelector('#graph')
          );
          return { x: transform.x, y: transform.y, k: transform.k };
        })()`
      );
      assert.deepEqual(afterMouseDrag, dragTarget.transform);

      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector('.session-card[aria-label*=\"错误路线\"]')" +
          "?.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
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
        await evaluate(
          cdp,
          "document.activeElement?.classList.contains('session-card')"
        ),
        true
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

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });
      await cdp.send("Page.navigate", { url: `${origin}/companion.html` });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 2"
      );
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.forest-node').length > 1"
      );
      const desktopCompanion = await evaluateJson(
        cdp,
        `({
          width: innerWidth,
          scrollWidth: document.body.scrollWidth,
          sidebarWidth: document.querySelector(
            '.project-sidebar'
          )?.getBoundingClientRect().width,
          sidebarLeft: document.querySelector(
            '.project-sidebar'
          )?.getBoundingClientRect().left,
          projectToggleDisplay: getComputedStyle(
            document.querySelector('#toggleProjects')
          ).display,
          projectMeta: document.querySelector('.project-meta')?.textContent,
          projectCount: document.querySelectorAll('.project-item').length,
          mapNodes: document.querySelectorAll('.forest-node').length,
          hasLegacyHookCopy: document.body.textContent.includes(
            'Hook 已配置'
          ),
          hasLegacyHostButtons: Boolean(
            document.querySelector('[data-connect-host]')
          )
        })`
      );
      assert.equal(desktopCompanion.width, 1440);
      assert.equal(desktopCompanion.scrollWidth, 1440);
      assert.equal(desktopCompanion.sidebarWidth, 236);
      assert.equal(desktopCompanion.sidebarLeft, 0);
      assert.equal(desktopCompanion.projectToggleDisplay, "none");
      assert.equal(desktopCompanion.projectMeta, "11 轮 · tmp");
      assert.equal(desktopCompanion.projectCount, 2);
      assert.ok(desktopCompanion.mapNodes > 1);
      assert.equal(desktopCompanion.hasLegacyHookCopy, false);
      assert.equal(desktopCompanion.hasLegacyHostButtons, false);

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const graph = document.querySelector('#graph');
          const rect = graph.getBoundingClientRect();
          for (let index = 0; index < 4; index += 1) {
            graph.dispatchEvent(new WheelEvent('wheel', {
              deltaX: 80,
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2
            }));
          }
        })()`
      });
      await delay(120);
      const beforeUnrelatedRefresh = await evaluateJson(
        cdp,
        `(() => {
          const transform = d3.zoomTransform(
            document.querySelector('#graph')
          );
          return {
            x: transform.x,
            y: transform.y,
            k: transform.k,
            reads: globalThis.__WAYFINDER_PREVIEW_READ_COUNT__
          };
        })()`
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "globalThis.__WAYFINDER_PREVIEW_PROJECTS__[1].nodeCount += 1"
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-meta')[1]?.textContent" +
          ".startsWith('12 轮')"
      );
      const afterUnrelatedRefresh = await evaluateJson(
        cdp,
        `(() => {
          const transform = d3.zoomTransform(
            document.querySelector('#graph')
          );
          return {
            x: transform.x,
            y: transform.y,
            k: transform.k,
            reads: globalThis.__WAYFINDER_PREVIEW_READ_COUNT__,
            project: document.querySelector(
              '#currentProjectLabel'
            )?.textContent
          };
        })()`
      );
      assert.deepEqual(
        {
          x: afterUnrelatedRefresh.x,
          y: afterUnrelatedRefresh.y,
          k: afterUnrelatedRefresh.k
        },
        {
          x: beforeUnrelatedRefresh.x,
          y: beforeUnrelatedRefresh.y,
          k: beforeUnrelatedRefresh.k
        }
      );
      assert.equal(
        afterUnrelatedRefresh.reads,
        beforeUnrelatedRefresh.reads
      );
      assert.equal(afterUnrelatedRefresh.project, "ui-test");

      const readsBeforeDeferredRefresh =
        afterUnrelatedRefresh.reads;
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const active = globalThis.__WAYFINDER_PREVIEW_PROJECTS__[0];
          active.updatedAt = '2026-09-11T02:00:00.000Z';
          globalThis.__WAYFINDER_PREVIEW_STATES__[
            active.id
          ].updatedAt = active.updatedAt;
          globalThis.__WAYFINDER_VIEWPORT_ACTIVE_UNTIL__ =
            Date.now() + 2_200;
        })()`
      });
      await delay(1_700);
      assert.equal(
        await evaluate(cdp, "globalThis.__WAYFINDER_PREVIEW_READ_COUNT__"),
        readsBeforeDeferredRefresh
      );
      await cdp.send("Runtime.evaluate", {
        expression: "globalThis.__WAYFINDER_VIEWPORT_ACTIVE_UNTIL__ = 0"
      });
      await waitForExpression(
        cdp,
        `globalThis.__WAYFINDER_PREVIEW_READ_COUNT__ >
          ${readsBeforeDeferredRefresh}`
      );

      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelectorAll('.project-item')[1]?.click()"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test 2'"
      );
      assert.equal(
        await evaluate(cdp, "state.projectId"),
        await evaluate(
          cdp,
          "globalThis.__WAYFINDER_PREVIEW_PROJECTS__[1].id"
        )
      );
      const readsBeforeTransientMiss = await evaluate(
        cdp,
        "globalThis.__WAYFINDER_PREVIEW_READ_COUNT__"
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "globalThis.__WAYFINDER_PREVIEW_MISSING_PROJECT__ = " +
          "globalThis.__WAYFINDER_PREVIEW_PROJECTS__.pop()"
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 1"
      );
      assert.equal(
        await evaluate(cdp, "document.querySelector('#currentProjectLabel')?.textContent"),
        "ui-test 2"
      );
      assert.equal(
        await evaluate(cdp, "globalThis.__WAYFINDER_PREVIEW_READ_COUNT__"),
        readsBeforeTransientMiss
      );
      await delay(1_700);
      assert.equal(
        await evaluate(cdp, "document.querySelector('#currentProjectLabel')?.textContent"),
        "ui-test 2"
      );
      assert.equal(
        await evaluate(cdp, "globalThis.__WAYFINDER_PREVIEW_READ_COUNT__"),
        readsBeforeTransientMiss
      );
      await waitForExpression(
        cdp,
        "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test'"
      );
      assert.ok(
        await evaluate(cdp, "globalThis.__WAYFINDER_PREVIEW_READ_COUNT__") >
        readsBeforeTransientMiss
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "globalThis.__WAYFINDER_PREVIEW_PROJECTS__.push(" +
          "globalThis.__WAYFINDER_PREVIEW_MISSING_PROJECT__)"
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 2"
      );
      assert.equal(
        await evaluate(cdp, "document.querySelector('#currentProjectLabel')?.textContent"),
        "ui-test"
      );

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 320,
        height: 720,
        deviceScaleFactor: 2,
        mobile: false
      });
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 2"
      );
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.forest-node').length > 1"
      );
      const narrowCompanion = await evaluateJson(
        cdp,
        `({
          width: innerWidth,
          scrollWidth: document.body.scrollWidth,
          projectToggleDisplay: getComputedStyle(
            document.querySelector('#toggleProjects')
          ).display,
          topbarChildrenFit: Array.from(
            document.querySelector('.desktop-topbar').children
          ).every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth;
          }),
          sidebarWidth: document.querySelector(
            '.project-sidebar'
          )?.getBoundingClientRect().width,
          sidebarRight: document.querySelector(
            '.project-sidebar'
          )?.getBoundingClientRect().right,
          sidebarInert: document.querySelector(
            '.project-sidebar'
          )?.hasAttribute('inert'),
          sidebarHidden: document.querySelector(
            '.project-sidebar'
          )?.getAttribute('aria-hidden'),
          toggleExpanded: document.querySelector(
            '#toggleProjects'
          )?.getAttribute('aria-expanded')
        })`
      );
      assert.equal(narrowCompanion.width, 320);
      assert.equal(narrowCompanion.scrollWidth, 320);
      assert.notEqual(narrowCompanion.projectToggleDisplay, "none");
      assert.equal(narrowCompanion.topbarChildrenFit, true);
      assert.equal(narrowCompanion.sidebarWidth, 278);
      assert.ok(narrowCompanion.sidebarRight <= 0);
      assert.equal(narrowCompanion.sidebarInert, true);
      assert.equal(narrowCompanion.sidebarHidden, "true");
      assert.equal(narrowCompanion.toggleExpanded, "false");

      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('#toggleProjects')?.click()"
      });
      await waitForExpression(
        cdp,
        "Math.abs(document.querySelector('.project-sidebar')" +
          "?.getBoundingClientRect().left || 0) < 1"
      );
      await waitForExpression(
        cdp,
        "document.activeElement?.classList.contains('project-item')"
      );
      const openDrawer = await evaluateJson(
        cdp,
        `({
          left: document.querySelector(
            '.project-sidebar'
          )?.getBoundingClientRect().left,
          right: document.querySelector(
            '.project-sidebar'
          )?.getBoundingClientRect().right,
          scrimPointerEvents: getComputedStyle(
            document.querySelector('#sidebarScrim')
          ).pointerEvents,
          sidebarInert: document.querySelector(
            '.project-sidebar'
          )?.hasAttribute('inert'),
          toggleExpanded: document.querySelector(
            '#toggleProjects'
          )?.getAttribute('aria-expanded'),
          activeProject: document.activeElement?.classList.contains(
            'project-item'
          )
        })`
      );
      assert.equal(openDrawer.left, 0);
      assert.ok(openDrawer.right <= 320);
      assert.equal(openDrawer.scrimPointerEvents, "auto");
      assert.equal(openDrawer.sidebarInert, false);
      assert.equal(openDrawer.toggleExpanded, "true");
      assert.equal(openDrawer.activeProject, true);

      await cdp.send("Runtime.evaluate", {
        expression:
          "globalThis.__WAYFINDER_PREVIEW_MISSING_PROJECT__ = " +
          "globalThis.__WAYFINDER_PREVIEW_PROJECTS__.shift()"
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 1"
      );
      assert.equal(
        await evaluate(cdp, "document.activeElement?.id"),
        "closeProjects"
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "globalThis.__WAYFINDER_PREVIEW_PROJECTS__.unshift(" +
          "globalThis.__WAYFINDER_PREVIEW_MISSING_PROJECT__)"
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 2"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.querySelector('.project-item')?.focus();
          globalThis.__WAYFINDER_PREVIEW_SAVED_PROJECTS__ = [
            ...globalThis.__WAYFINDER_PREVIEW_PROJECTS__
          ];
          globalThis.__WAYFINDER_PREVIEW_PROJECTS__.splice(0);
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('.project-empty') !== null"
      );
      assert.equal(
        await evaluate(cdp, "document.activeElement?.id"),
        "closeProjects"
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "globalThis.__WAYFINDER_PREVIEW_PROJECTS__.push(" +
          "...globalThis.__WAYFINDER_PREVIEW_SAVED_PROJECTS__)"
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 2"
      );

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const openData = document.querySelector('#openData');
          openData.focus();
          window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true
          }));
        })()`
      });
      assert.equal(
        await evaluate(cdp, "document.activeElement?.id"),
        "closeProjects"
      );

      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelectorAll('.project-item')[1]?.click()"
      });
      await waitForExpression(
        cdp,
        "!document.body.classList.contains('projects-open')"
      );
      await waitForExpression(
        cdp,
        "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test 2'"
      );
      assert.equal(
        await evaluate(cdp, "document.activeElement?.id"),
        "toggleProjects"
      );

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.querySelector('#search');
          input.value = forest.trees[0]?.sessions[0]?.title || '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#canvasTitle')?.textContent.includes('搜索结果')"
      );
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.session-card').length > 0"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const target = document.querySelector('.session-card');
          const sessionId = target?.dataset.sessionId;
          const session = forest.trees
            .flatMap((tree) => tree.sessions)
            .find((item) => item.id === sessionId);
          const node = state.nodes.find((item) =>
            session?.nodeIds.includes(item.id)
          );
          Object.assign(node, {
            kind: 'collected',
            sourceHost: 'codex',
            files: [{
              path: 'src/sessionCollector.ts',
              status: 'M',
              additions: 12,
              deletions: 3
            }]
          });
          target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#inspector')?.classList.contains('open')"
      );
      assert.equal(
        await evaluate(cdp, "document.querySelector('.detail-source')?.textContent"),
        "自动记录 · Codex"
      );
      assert.match(
        await evaluate(cdp, "document.querySelector('.detail-file')?.textContent"),
        /src\/sessionCollector\.ts.*\+12.*−3/
      );

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });
      await cdp.send("Page.navigate", {
        url: `${origin}/single-companion.html`
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.session-card').length === 1"
      );
      const singleVoyage = await evaluateJson(
        cdp,
        `({
          markers: document.querySelectorAll('.session-node').length,
          cards: document.querySelectorAll('.session-card').length,
          currentCards: document.querySelectorAll(
            '.session-card.current'
          ).length,
          foreignObjects: document.querySelectorAll('foreignObject').length,
          label: document.querySelector(
            '.session-card .node-title'
          )?.textContent,
          coastCoversCanvas: (() => {
            const coast = document.querySelector(
              '.shore-line'
            )?.getBoundingClientRect();
            const canvas = document.querySelector(
              '.canvas-shell'
            )?.getBoundingClientRect();
            return Boolean(
              coast &&
              canvas &&
              coast.top <= canvas.top &&
              coast.bottom >= canvas.bottom
            );
          })()
        })`
      );
      assert.equal(singleVoyage.markers, 1);
      assert.equal(singleVoyage.cards, 1);
      assert.equal(singleVoyage.currentCards, 1);
      assert.equal(singleVoyage.foreignObjects, 0);
      assert.ok(singleVoyage.label.length > 0);
      assert.equal(singleVoyage.coastCoversCanvas, true);

      for (const viewport of [
        { width: 320, height: 568 },
        { width: 812, height: 375 }
      ]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          ...viewport,
          deviceScaleFactor: 1,
          mobile: false
        });
        await cdp.send("Page.navigate", {
          url: `${origin}/website/index.html?viewport=${viewport.width}`
        });
        await waitForExpression(
          cdp,
          "document.querySelectorAll('.download-row .download').length === 2"
        );
        const layout = await evaluateJson(
          cdp,
          `(() => {
            const hero = document.querySelector('.hero').getBoundingClientRect();
            const downloads = [...document.querySelectorAll(
              '.download-row .download'
            )].map((element) => {
              const rect = element.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom };
            });
            return {
              width: innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
              heroBottom: hero.bottom,
              downloads
            };
          })()`
        );
        assert.equal(layout.width, viewport.width);
        assert.equal(layout.scrollWidth, viewport.width);
        assert.ok(
          layout.downloads.every(
            (download) =>
              download.top >= 0 &&
              download.bottom <= layout.heroBottom + .5
          )
        );
      }

      await delay(1_600);
      const canvasBeforeResize = await evaluate(
        cdp,
        `(() => {
          const canvas = document.querySelector('#voyageCanvas');
          const pixels = canvas.getContext('2d').getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          ).data;
          for (let index = 3; index < pixels.length; index += 64) {
            if (pixels[index] > 0) return true;
          }
          return false;
        })()`
      );
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1_000,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false
      });
      await delay(160);
      const canvasAfterResize = await evaluate(
        cdp,
        `(() => {
          const canvas = document.querySelector('#voyageCanvas');
          const pixels = canvas.getContext('2d').getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          ).data;
          for (let index = 3; index < pixels.length; index += 64) {
            if (pixels[index] > 0) return true;
          }
          return false;
        })()`
      );
      assert.equal(canvasBeforeResize, true);
      assert.equal(canvasAfterResize, true);

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
