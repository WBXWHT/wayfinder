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
const skipUiTest = process.env.WAYFINDER_SKIP_UI_TEST === "1";

if (!chrome && process.env.CI && !skipUiTest) {
  throw new Error(
    "Chromium is required for the UI regression suite in CI. " +
      "Set CHROME_PATH to an executable browser."
  );
}

test(
  "generated voyage previews run in Chromium at 220px and 320px",
  {
    skip: !chrome || skipUiTest,
    timeout: 75_000
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
                  : pathname === "/wayfinder-icon.png"
                    ? path.join(temp, "wayfinder-icon.png")
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
        "--disable-dev-shm-usage",
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

      const sidebarViewportBeforeSheet = await evaluate(
        cdp,
        `(() => {
          const canvas = document.querySelector('.lineage-canvas');
          const initial =
            document.querySelector('.lineage-stage')?.style.transform || '';
          const rect = canvas.getBoundingClientRect();
          canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 56,
            deltaY: 24,
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          }));
          return {
            initial,
            after:
              document.querySelector('.lineage-stage')?.style.transform || ''
          };
        })()`
      );
      assert.notEqual(
        sidebarViewportBeforeSheet.after,
        sidebarViewportBeforeSheet.initial
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
          role: document.querySelector('.lineage-detail-sheet')
            ?.getAttribute('role'),
          modal: document.querySelector('.lineage-detail-sheet')
            ?.getAttribute('aria-modal'),
          backgroundInert: document.querySelector('.lineage-section')
            ?.closest('[inert]') !== null,
          viewportPreserved:
            document.querySelector('.lineage-stage')?.style.transform ===
            ${JSON.stringify(sidebarViewportBeforeSheet.after)},
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
      assert.equal(sheet.role, "dialog");
      assert.equal(sheet.modal, "true");
      assert.equal(sheet.backgroundInert, true);
      assert.equal(sheet.viewportPreserved, true);
      assert.ok(
        sheet.bottom <= sheet.viewport &&
        sheet.bottom >= sheet.viewport - 12,
        JSON.stringify(sheet)
      );
      const trappedFocus = await evaluateJson(
        cdp,
        `(() => {
            const sheet = document.querySelector('.lineage-detail-sheet');
            const focusable = [...sheet.querySelectorAll(
              'button, [tabindex]:not([tabindex="-1"])'
            )].filter((element) =>
              !element.disabled && element.getClientRects().length > 0
            );
            focusable.at(-1).focus();
            const before = document.activeElement?.className;
            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Tab',
              bubbles: true
            }));
            return {
              before,
              after: document.activeElement?.className,
              first: focusable[0]?.className,
              last: focusable.at(-1)?.className,
              trapped: document.activeElement === focusable[0]
            };
          })()`
      );
      assert.equal(trappedFocus.trapped, true, JSON.stringify(trappedFocus));

      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('.turn-main')?.click()"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('.turn.selected .actions [data-focus-key]')"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const action = document.querySelector(
            '.turn.selected .actions [data-focus-key]'
          );
          action?.focus();
          window.dispatchEvent(new MessageEvent('message', {
            data: latestPayload
          }));
        })()`
      });
      await delay(120);
      assert.equal(
        await evaluate(
          cdp,
          "document.activeElement?.closest('.actions') !== null"
        ),
        true
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
          input.focus();
          const active = latestPayload.forest.trees.find(
            (tree) => tree.id === activeTreeId
          );
          input.value =
            latestPayload.state.nodes.find(
              (node) => active?.sessions[0]?.nodeIds.includes(node.id)
            )?.prompt ||
            '';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
          window.dispatchEvent(new MessageEvent('message', {
            data: Object.assign({}, latestPayload, {
              validationCommand: 'NEW'
            })
          }));
        })()`
      });
      await delay(250);
      const filteredViewport = await evaluateJson(
        cdp,
        `({
          transform:
            document.querySelector('.lineage-stage')?.style.transform || '',
          cards: document.querySelectorAll('.lineage-node-button').length,
          query,
          input: document.querySelector('.search input')?.value || '',
          activeTreeId,
          titles: latestPayload.forest.trees
            .find((tree) => tree.id === activeTreeId)
            ?.sessions.map((session) => session.shortTitle || session.title)
        })`
      );
      assert.ok(
        filteredViewport.cards > 0,
        JSON.stringify(filteredViewport)
      );
      assert.notEqual(
        filteredViewport.transform,
        sidebarViewportBeforeSheet.after
      );
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
          collapsedVoyages: document.querySelectorAll(
            '.tree-card.collapsed'
          ).length,
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
      assert.equal(map.projects, 2);
      assert.equal(map.collapsedVoyages, 1);
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
          const graph = document.querySelector('#graph');
          for (let index = 0; index < 30; index += 1) {
            graph.dispatchEvent(new WheelEvent('wheel', {
              deltaX: 80,
              deltaY: 0,
              bubbles: true,
              cancelable: true,
              clientX: viewport.left + viewport.width / 2,
              clientY: viewport.top + viewport.height / 2
            }));
          }
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
      await delay(120);
      const settledKeyboardReveal = await evaluateJson(
        cdp,
        `(() => {
          const viewport = document.querySelector('#graph').getBoundingClientRect();
          const target = document.activeElement;
          const rect = target?.getBoundingClientRect();
          return {
            focused: target?.classList.contains('session-card') || false,
            visible: Boolean(
              rect &&
              rect.right > viewport.left &&
              rect.left < viewport.right &&
              rect.bottom > viewport.top &&
              rect.top < viewport.bottom
            )
          };
        })()`
      );
      assert.equal(settledKeyboardReveal.focused, true);
      assert.equal(settledKeyboardReveal.visible, true);

      assert.equal(
        await evaluate(cdp, "document.querySelector('#search') === null"),
        true
      );
      assert.equal(
        await evaluate(cdp, "document.querySelector('#fit') === null"),
        true
      );
      const voyageOverview = await evaluateJson(
        cdp,
        `(() => {
          const originalForest = forest;
          const sourceTree = forest.trees[0];
          const secondTree = {
            ...sourceTree,
            id: sourceTree.id + '-second',
            title: 'Second voyage'
          };
          const thirdTree = {
            ...sourceTree,
            id: sourceTree.id + '-third',
            title: 'Third voyage'
          };
          const combinedForest = {
            ...forest,
            trees: [sourceTree, secondTree, thirdTree]
          };
          window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'render',
              state,
              forest: combinedForest,
              projectName
            }
          }));
          const before = {
            treeCards: document.querySelectorAll('.tree-card').length,
            collapsed: document.querySelectorAll(
              '.tree-card.collapsed'
            ).length,
            pagers: document.querySelectorAll(
              '#projectPrevious, #projectNext'
            ).length,
            title: document.querySelector('#canvasTitle')?.textContent,
            voyageStarts: [...document.querySelectorAll('.tree-card')]
              .map((card) => card.__data__.node.screenY)
              .sort((a, b) => a - b)
          };
          document.querySelector('.tree-card.collapsed')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
          );
          const after = {
            activeTreeId,
            collapsed: document.querySelectorAll(
              '.tree-card.collapsed'
            ).length,
            sessionCards: document.querySelectorAll(
              '.session-card'
            ).length
          };
          window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'render',
              state,
              forest: originalForest,
              projectName
            }
          }));
          return { before, after, secondTreeId: secondTree.id };
        })()`
      );
      assert.equal(voyageOverview.before.treeCards, 3);
      assert.equal(voyageOverview.before.collapsed, 2);
      assert.equal(voyageOverview.before.pagers, 0);
      assert.equal(voyageOverview.before.title, "ui-test");
      assert.ok(
        voyageOverview.before.voyageStarts.every(
          (value, index, values) =>
            index === 0 || value - values[index - 1] >= 136
        )
      );
      assert.equal(voyageOverview.after.activeTreeId, voyageOverview.secondTreeId);
      assert.equal(voyageOverview.after.collapsed, 2);
      assert.equal(voyageOverview.after.sessionCards, 9);

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
          const resetView = () => {
            viewportSignature = '';
            renderGraph();
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
          const overlayReset = d3.zoomTransform(target);
          document.querySelector('.canvas-page-label').dispatchEvent(
            new WheelEvent('wheel', {
              deltaX: 80,
              deltaY: 0,
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + 30
            })
          );
          const overlayPan = d3.zoomTransform(target);
          resetView();
          const initial = d3.zoomTransform(target);
          for (let index = 0; index < 30; index += 1) {
            wheel(-80, 0);
          }
          await settleFrames(2);
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
          resetView();
          const reset = d3.zoomTransform(target);
          for (let index = 0; index < 30; index += 1) {
            wheel(80, 0);
          }
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'render', state, forest, projectName }
          }));
          await settleFrames(12);
          const afterRenderDuringPan = d3.zoomTransform(target);
          resetView();
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
          resetView();
          for (let index = 0; index < 3; index += 1) {
            wheel(160, 0);
          }
          await settleFrames(3);
          const beforeAwayReversal = d3.zoomTransform(target);
          wheel(160, 0);
          wheel(-40, 0);
          await settleFrames(2);
          const afterAwayReversal = d3.zoomTransform(target);
          resetView();
          for (let index = 0; index < 4; index += 1) {
            wheel(120, 0);
          }
          const reversibleStart = d3.zoomTransform(target);
          for (let index = 0; index < 60; index += 1) {
            wheel(8, 0);
            await nextFrame();
          }
          const reversibleAway = d3.zoomTransform(target);
          for (let index = 0; index < 60; index += 1) {
            wheel(-8, 0);
            await nextFrame();
          }
          const reversibleReturn = d3.zoomTransform(target);
          const visibleCardCount = () => {
            const viewport = target.getBoundingClientRect();
            return [...document.querySelectorAll('.session-card')]
              .filter((element) => {
                const bounds = element.getBoundingClientRect();
                return (
                  bounds.right > viewport.left &&
                  bounds.left < viewport.right &&
                  bounds.bottom > viewport.top &&
                  bounds.top < viewport.bottom
                );
              }).length;
          };
          resetView();
          for (let index = 0; index < 100; index += 1) {
            wheel(0, 160);
          }
          const verticalBottom = {
            transform: d3.zoomTransform(target),
            visibleCards: visibleCardCount()
          };
          for (let index = 0; index < 200; index += 1) {
            wheel(0, -160);
          }
          const verticalTop = {
            transform: d3.zoomTransform(target),
            visibleCards: visibleCardCount()
          };
          resetView();
          const largePacketReset = d3.zoomTransform(target);
          wheel(1458, 0);
          await nextFrame();
          const largePacket = d3.zoomTransform(target);
          resetView();
          const lineModeReset = d3.zoomTransform(target);
          wheel(2, 0, false, 1);
          await nextFrame();
          const lineModePan = d3.zoomTransform(target);
          resetView();
          const pageModeReset = d3.zoomTransform(target);
          wheel(1, 0, false, 2);
          await nextFrame();
          const pageModePan = d3.zoomTransform(target);
          resetView();
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
            overlayReset: {
              x: overlayReset.x,
              y: overlayReset.y,
              k: overlayReset.k
            },
            overlayPan: {
              x: overlayPan.x,
              y: overlayPan.y,
              k: overlayPan.k
            },
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
            reversibleStart: {
              x: reversibleStart.x,
              y: reversibleStart.y,
              k: reversibleStart.k
            },
            reversibleAway: {
              x: reversibleAway.x,
              y: reversibleAway.y,
              k: reversibleAway.k
            },
            reversibleReturn: {
              x: reversibleReturn.x,
              y: reversibleReturn.y,
              k: reversibleReturn.k
            },
            verticalBottom: {
              x: verticalBottom.transform.x,
              y: verticalBottom.transform.y,
              k: verticalBottom.transform.k,
              visibleCards: verticalBottom.visibleCards
            },
            verticalTop: {
              x: verticalTop.transform.x,
              y: verticalTop.transform.y,
              k: verticalTop.transform.k,
              visibleCards: verticalTop.visibleCards
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
      assert.ok(gestures.overlayPan.x < gestures.overlayReset.x);
      assert.equal(gestures.overlayPan.k, gestures.overlayReset.k);
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
      assert.ok(gestures.reversibleAway.x < gestures.reversibleStart.x);
      assert.ok(
        Math.abs(
          gestures.reversibleReturn.x - gestures.reversibleStart.x
        ) < .001
      );
      assert.equal(
        gestures.reversibleReturn.y,
        gestures.reversibleStart.y
      );
      assert.equal(
        gestures.reversibleReturn.k,
        gestures.reversibleStart.k
      );
      assert.ok(gestures.verticalBottom.visibleCards >= 1);
      assert.ok(gestures.verticalTop.visibleCards >= 1);
      assert.ok(Number.isFinite(gestures.verticalBottom.y));
      assert.ok(Number.isFinite(gestures.verticalTop.y));
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
      assert.ok(gestures.pinched.k / gestures.zoomReset.k > 1.22);
      assert.ok(gestures.pinched.k / gestures.zoomReset.k < 1.24);
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

      const nativeGesture = JSON.parse(await evaluate(
        cdp,
        `(async () => {
          const target = document.querySelector('#graph');
          const rect = target.getBoundingClientRect();
          const nextFrame = () => new Promise((resolve) =>
            requestAnimationFrame(() => resolve())
          );
          viewportSignature = '';
          renderGraph();
          await nextFrame();
          await nextFrame();
          const reset = d3.zoomTransform(target);
          const dispatch = (type, scale, clientX, clientY) => {
            const event = new Event(type, {
              bubbles: true,
              cancelable: true
            });
            Object.defineProperties(event, {
              scale: { value: scale },
              clientX: { value: clientX },
              clientY: { value: clientY },
              pageX: { value: clientX },
              pageY: { value: clientY }
            });
            target.dispatchEvent(event);
          };
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          dispatch('gesturestart', 1, centerX, centerY);
          dispatch(
            'gesturechange',
            .75,
            centerX + 40,
            centerY + 20
          );
          const changed = d3.zoomTransform(target);
          target.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 0,
            deltaY: -40,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY
          }));
          await nextFrame();
          const duringNativeWheel = d3.zoomTransform(target);
          dispatch('gestureend', .75, centerX + 40, centerY + 20);
          target.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 0,
            deltaY: -40,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY
          }));
          await nextFrame();
          const afterFallbackWheel = d3.zoomTransform(target);
          return JSON.stringify({
            reset: { x: reset.x, y: reset.y, k: reset.k },
            changed: {
              x: changed.x,
              y: changed.y,
              k: changed.k
            },
            duringNativeWheel: {
              x: duringNativeWheel.x,
              y: duringNativeWheel.y,
              k: duringNativeWheel.k
            },
            afterFallbackWheel: {
              x: afterFallbackWheel.x,
              y: afterFallbackWheel.y,
              k: afterFallbackWheel.k
            }
          });
        })()`
      ));
      assert.ok(
        Math.abs(nativeGesture.changed.k - nativeGesture.reset.k * .75) <
        .0001
      );
      assert.ok(nativeGesture.changed.x > nativeGesture.reset.x);
      assert.ok(nativeGesture.changed.y > nativeGesture.reset.y);
      assert.equal(
        nativeGesture.duringNativeWheel.k,
        nativeGesture.changed.k
      );
      assert.ok(
        nativeGesture.afterFallbackWheel.k >
        nativeGesture.changed.k
      );

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
          projectAccent: getComputedStyle(
            document.querySelector('.project-item[aria-current="true"]')
          ).getPropertyValue('--project-accent').trim(),
          mapAccent: getComputedStyle(
            document.documentElement
          ).getPropertyValue('--project-accent').trim(),
          projectIconName: document.querySelector(
            '.project-item[aria-current="true"] .project-folder-route'
          )?.dataset.lucide,
          titleAlign: getComputedStyle(
            document.querySelector('.canvas-page-label')
          ).textAlign,
          hasSearch: Boolean(document.querySelector('#search')),
          hasReset: Boolean(document.querySelector('#fit')),
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
      assert.equal(desktopCompanion.projectAccent, desktopCompanion.mapAccent);
      assert.equal(desktopCompanion.projectIconName, "folder-git-2");
      assert.equal(desktopCompanion.titleAlign, "center");
      assert.equal(desktopCompanion.hasSearch, false);
      assert.equal(desktopCompanion.hasReset, false);
      assert.equal(desktopCompanion.hasLegacyHookCopy, false);
      assert.equal(desktopCompanion.hasLegacyHostButtons, false);
      assert.equal(
        await evaluate(
          cdp,
          "typeof globalThis.__WAYFINDER_PREVIEW_EVENT_HANDLERS__" +
            "['wayfinder://collector-status']"
        ),
        "function"
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "globalThis.__WAYFINDER_PREVIEW_EVENT_HANDLERS__" +
          "['wayfinder://collector-status']({ payload: { status: 'error' } })"
      });
      assert.match(
        await evaluate(cdp, "document.querySelector('#toast')?.textContent"),
        /自动采集暂时中断/
      );

      const activeBeforeFailedSwitch = await evaluate(
        cdp,
        "document.querySelector('.project-item[aria-current=\"true\"]')" +
          "?.dataset.projectId"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const target = document.querySelectorAll('.project-item')[1];
          globalThis.__WAYFINDER_PREVIEW_READ_FAILURE__ =
            target?.dataset.projectId || '';
          target?.click();
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#toast')?.classList.contains('visible')"
      );
      assert.equal(
        await evaluate(
          cdp,
          "document.querySelector('.project-item[aria-current=\"true\"]')" +
            "?.dataset.projectId"
        ),
        activeBeforeFailedSwitch
      );
      await cdp.send("Runtime.evaluate", {
        expression: "globalThis.__WAYFINDER_PREVIEW_READ_FAILURE__ = ''"
      });

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const target = document.querySelectorAll('.project-item')[1];
          const id = target.dataset.projectId;
          globalThis.__WAYFINDER_PREVIEW_READ_DELAYS__[id] = [900, 0];
          target.click();
          void loadActiveProject();
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test 2'"
      );
      await delay(1_000);
      assert.equal(
        await evaluate(
          cdp,
          "document.body.classList.contains('projects-open')"
        ),
        false
      );
      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('#toggleProjects')?.click()"
      });
      await waitForExpression(
        cdp,
        "document.body.classList.contains('projects-open')"
      );
      const activeBeforeRacedFailure = await evaluate(
        cdp,
        "document.querySelector('.project-item[aria-current=\"true\"]')" +
          "?.dataset.projectId"
      );

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const original = globalThis.__WAYFINDER_PREVIEW_PROJECTS__[0];
          const raceId = original.id + '-race';
          globalThis.__WAYFINDER_PREVIEW_PROJECTS__.push({
            ...original,
            id: raceId,
            name: 'ui-test 3',
            updatedAt: original.updatedAt + '-race'
          });
          globalThis.__WAYFINDER_PREVIEW_STATES__[raceId] = {
            ...globalThis.__WAYFINDER_PREVIEW_STATES__[original.id],
            projectId: raceId
          };
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 3"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const items = document.querySelectorAll('.project-item');
          const slowId = items[1].dataset.projectId;
          const failedId = items[2].dataset.projectId;
          const toast = document.querySelector('#toast');
          toast.classList.remove('visible');
          toast.textContent = '';
          globalThis.__WAYFINDER_PREVIEW_READ_DELAYS__[slowId] = [900];
          globalThis.__WAYFINDER_PREVIEW_READ_DELAYS__[failedId] = [1900, 0];
          globalThis.__WAYFINDER_PREVIEW_READ_FAILURE__ = failedId;
          items[1].click();
          document.querySelectorAll('.project-item')[2].click();
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#toast')?.textContent.includes('读取失败') && " +
          "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test 2'"
      );
      assert.equal(
        await evaluate(
          cdp,
          "document.querySelector('.project-item[aria-current=\"true\"]')" +
            "?.dataset.projectId"
        ),
        activeBeforeRacedFailure
      );
      await delay(1_000);
      assert.equal(
        await evaluate(cdp, "document.querySelector('#currentProjectLabel')?.textContent"),
        "ui-test 2"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          globalThis.__WAYFINDER_PREVIEW_READ_FAILURE__ = '';
          globalThis.__WAYFINDER_PREVIEW_PROJECTS__.pop();
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 2"
      );

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const target = document.querySelectorAll('.project-item')[1];
          const id = target.dataset.projectId;
          globalThis.__WAYFINDER_PREVIEW_PROJECTS__[1].updatedAt += '-new';
          globalThis.__WAYFINDER_PREVIEW_READ_DELAYS__[id] = [2200, 0];
          target.click();
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test 2'"
      );
      await delay(2_400);
      assert.equal(
        await evaluate(
          cdp,
          "document.querySelector('.project-item[aria-current=\"true\"]')" +
            "?.textContent.includes('ui-test 2')"
        ),
        true
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelectorAll('.project-item')[0]?.click()"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test'"
      );

      const desktopViewportBeforeInspector = await evaluateJson(
        cdp,
        `(() => {
          const transform = d3.zoomTransform(document.querySelector('#graph'));
          return { x: transform.x, y: transform.y, k: transform.k };
        })()`
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const viewport = document.querySelector('#graph').getBoundingClientRect();
          const target = [...document.querySelectorAll('.session-card')]
            .filter((card) => {
              const rect = card.getBoundingClientRect();
              return (
                rect.right > viewport.left &&
                rect.left < viewport.right &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            })
            .sort(
              (left, right) =>
                right.getBoundingClientRect().bottom -
                left.getBoundingClientRect().bottom
            )[0];
          target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#inspector')?.classList.contains('open')"
      );
      const desktopInspector = await evaluateJson(
        cdp,
        `(() => {
          const panel = document.querySelector('#inspector');
          const graph = document.querySelector('#graph');
          const selected = document.querySelector('.session-card.selected');
          const panelRect = panel?.getBoundingClientRect();
          const graphRect = graph?.getBoundingClientRect();
          const selectedRect = selected?.getBoundingClientRect();
          const selectedStyle = selected
            ? getComputedStyle(selected)
            : undefined;
          const expectedAccent = selected?.classList.contains('good')
            ? 'var(--good)'
            : selected?.classList.contains('bad')
              ? 'var(--coral)'
              : selectedStyle?.getPropertyValue('--voyage-accent').trim();
          return {
            docked: document.querySelector('.layout')
              ?.classList.contains('inspector-open'),
            width: panelRect?.width,
            overlap: graphRect && panelRect
              ? graphRect.right - panelRect.left
              : Infinity,
            selectedVisible: Boolean(
              graphRect &&
              selectedRect &&
              selectedRect.left >= graphRect.left &&
              selectedRect.right <= graphRect.right &&
              selectedRect.top >= graphRect.top &&
              selectedRect.bottom <= graphRect.bottom
            ),
            titleSize: Number.parseFloat(
              getComputedStyle(
                document.querySelector('.detail-title')
              ).fontSize
            ),
            accent: panel?.style.getPropertyValue('--inspector-accent'),
            expectedAccent
          };
        })()`
      );
      assert.equal(desktopInspector.docked, true);
      assert.ok(desktopInspector.width <= 336);
      assert.ok(desktopInspector.overlap <= 0.5);
      assert.equal(desktopInspector.selectedVisible, true);
      assert.ok(desktopInspector.titleSize <= 14);
      assert.equal(desktopInspector.accent, desktopInspector.expectedAccent);
      const scrollingInspector = await evaluateJson(
        cdp,
        `(() => {
          const panel = document.querySelector('#inspector');
          const head = document.querySelector('.inspector-head');
          const turns = document.querySelector('.inspector-turns');
          panel.style.maxHeight = '140px';
          turns.style.minHeight = '360px';
          const headTopBefore = head.getBoundingClientRect().top;
          panel.scrollTop = 60;
          const headTopAfter = head.getBoundingClientRect().top;
          return {
            panelOverflowY: getComputedStyle(panel).overflowY,
            turnsOverflowY: getComputedStyle(turns).overflowY,
            headPosition: getComputedStyle(head).position,
            scrollTop: panel.scrollTop,
            headMoved: headTopAfter < headTopBefore - 1
          };
        })()`
      );
      assert.equal(scrollingInspector.panelOverflowY, "auto");
      assert.equal(scrollingInspector.turnsOverflowY, "visible");
      assert.equal(scrollingInspector.headPosition, "relative");
      assert.ok(scrollingInspector.scrollTop > 0);
      assert.equal(scrollingInspector.headMoved, true);
      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('.inspector-close')?.click()"
      });
      await waitForExpression(
        cdp,
        "!document.querySelector('.layout')?.classList.contains('inspector-open')"
      );
      const desktopViewportAfterInspector = await evaluateJson(
        cdp,
        `(() => {
          const transform = d3.zoomTransform(document.querySelector('#graph'));
          return { x: transform.x, y: transform.y, k: transform.k };
        })()`
      );
      for (const key of ["x", "y", "k"]) {
        assert.ok(
          Math.abs(
            desktopViewportAfterInspector[key] -
            desktopViewportBeforeInspector[key]
          ) < .001,
          JSON.stringify({
            key,
            before: desktopViewportBeforeInspector,
            after: desktopViewportAfterInspector
          })
        );
      }

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1080,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false
      });
      await delay(120);
      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('.session-card')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true })
        )`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#inspector')?.classList.contains('open')"
      );
      const mediumInspector = await evaluateJson(
        cdp,
        `(() => {
          const layout = document.querySelector('.layout');
          const graph = document.querySelector('#graph').getBoundingClientRect();
          const panel = document.querySelector('#inspector').getBoundingClientRect();
          return {
            columns: getComputedStyle(layout).gridTemplateColumns
              .split(' ').length,
            graphWidth: graph.width,
            horizontalOverlap: graph.right - panel.left,
            panelRight: panel.right
          };
        })()`
      );
      assert.equal(mediumInspector.columns, 2);
      assert.ok(
        mediumInspector.graphWidth >= 500,
        JSON.stringify(mediumInspector)
      );
      assert.ok(mediumInspector.horizontalOverlap <= 0.5);
      assert.ok(mediumInspector.panelRight <= 1080);
      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('.inspector-close')?.click()"
      });
      await waitForExpression(
        cdp,
        "!document.querySelector('.layout')?.classList.contains('inspector-open')"
      );
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });
      await delay(120);

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
        expression: `(() => {
          const items = document.querySelectorAll('.project-item');
          const firstId = items[0].dataset.projectId;
          const secondId = items[1].dataset.projectId;
          globalThis.__WAYFINDER_PREVIEW_READ_DELAYS__[secondId] = [900];
          globalThis.__WAYFINDER_PREVIEW_READ_DELAYS__[firstId] = [1900, 0];
          globalThis.__WAYFINDER_PREVIEW_READ_FAILURE__ = firstId;
          items[1].click();
          document.querySelectorAll('.project-item')[0].click();
        })()`
      });
      await delay(1_100);
      assert.equal(
        await evaluate(
          cdp,
          "document.body.classList.contains('projects-open')"
        ),
        true
      );
      await waitForExpression(
        cdp,
        "document.querySelector('#toast')?.textContent.includes('读取失败')"
      );
      await cdp.send("Runtime.evaluate", {
        expression: "globalThis.__WAYFINDER_PREVIEW_READ_FAILURE__ = ''"
      });

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

      assert.equal(
        await evaluate(cdp, "document.querySelector('#search') === null"),
        true
      );
      assert.equal(
        await evaluate(cdp, "document.querySelector('#fit') === null"),
        true
      );
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.session-card').length > 0"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const viewport = document.querySelector('#graph').getBoundingClientRect();
          const target = [...document.querySelectorAll('.session-card')]
            .filter((card) => {
              const rect = card.getBoundingClientRect();
              return (
                rect.right > viewport.left &&
                rect.left < viewport.right &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            })
            .sort(
              (left, right) =>
                right.getBoundingClientRect().bottom -
                left.getBoundingClientRect().bottom
            )[0];
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
            response:
              '结果\\n完成目标\\n行动\\n- 第一步\\n沉淀\\n- 关键经验',
            files: [{
              path: 'src/sessionCollector.ts',
              status: 'M',
              additions: 12,
              deletions: 3
            }, {
              path: 'src/removed.ts',
              status: 'D',
              additions: 0,
              deletions: 0,
              lineCountsKnown: false
            }]
          });
          target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#inspector')?.classList.contains('open')"
      );
      await waitForExpression(
        cdp,
        `(() => {
          const graph = document.querySelector('#graph')
            ?.getBoundingClientRect();
          const panel = document.querySelector('#inspector')
            ?.getBoundingClientRect();
          const selected = document.querySelector('.session-card.selected')
            ?.getBoundingClientRect();
          return Boolean(
            graph &&
            panel &&
            selected &&
            graph.right <= panel.left + .5
          );
        })()`
      );
      await waitForExpression(
        cdp,
        `(() => {
          const graph = document.querySelector('#graph')
            ?.getBoundingClientRect();
          const selected = document.querySelector('.session-card.selected')
            ?.getBoundingClientRect();
          return Boolean(
            graph &&
            selected &&
            selected.left >= graph.left &&
            selected.right <= graph.right &&
            selected.top >= graph.top &&
            selected.bottom <= graph.bottom
          );
        })()`
      );
      const inspectorLayout = await evaluateJson(
        cdp,
        `(() => {
          const close = document.querySelector('.inspector-close')
            ?.getBoundingClientRect();
          const title = document.querySelector('.detail-title');
          const layout = document.querySelector('.layout');
          const graph = document.querySelector('#graph')
            ?.getBoundingClientRect();
          const panel = document.querySelector('#inspector')
            ?.getBoundingClientRect();
          const selected = document.querySelector('.session-card.selected')
            ?.getBoundingClientRect();
          return {
            columns: getComputedStyle(layout).gridTemplateColumns
              .split(' ').length,
            closeLeft: close?.left,
            closeRight: close?.right,
            panelLeft: panel?.left,
            panelRight: panel?.right,
            panelWidth: panel?.width,
            graphLeft: graph?.left,
            graphRight: graph?.right,
            graphTop: graph?.top,
            graphBottom: graph?.bottom,
            selectedLeft: selected?.left,
            selectedRight: selected?.right,
            selectedTop: selected?.top,
            selectedBottom: selected?.bottom,
            horizontalOverlap: graph && panel
              ? graph.right - panel.left
              : Infinity,
            selectedVisible: Boolean(
              graph &&
              selected &&
              selected.left >= graph.left &&
              selected.right <= graph.right &&
              selected.top >= graph.top &&
              selected.bottom <= graph.bottom
            ),
            titleFits: title
              ? title.scrollWidth <= title.clientWidth
              : false
          };
        })()`
      );
      assert.equal(inspectorLayout.columns, 2);
      assert.ok(inspectorLayout.closeLeft >= 0);
      assert.ok(inspectorLayout.closeRight <= 320);
      assert.ok(inspectorLayout.panelLeft >= 0);
      assert.ok(inspectorLayout.panelRight <= 320);
      assert.ok(inspectorLayout.panelWidth >= 130);
      assert.ok(inspectorLayout.horizontalOverlap <= 0.5);
      assert.equal(
        inspectorLayout.selectedVisible,
        true,
        JSON.stringify(inspectorLayout)
      );
      assert.equal(inspectorLayout.titleFits, true);
      assert.equal(
        await evaluate(cdp, "document.querySelector('.detail-source')?.textContent"),
        "自动记录 · Codex"
      );
      assert.match(
        await evaluate(
          cdp,
          "document.querySelectorAll('.detail-file')[0]?.textContent"
        ),
        /src\/sessionCollector\.ts.*\+12.*−3/
      );
      assert.match(
        await evaluate(
          cdp,
          "document.querySelectorAll('.detail-file')[1]?.textContent"
        ),
        /src\/removed\.ts.*行数未知/
      );
      assert.equal(
        await evaluate(cdp, "document.querySelectorAll('.inspector-head').length"),
        1
      );
      assert.equal(
        await evaluate(cdp, "document.querySelectorAll('.inspector-turns').length"),
        1
      );
      assert.equal(
        await evaluate(
          cdp,
          "document.querySelector('.inspector-turns')?.textContent.includes('结果')"
        ),
        false
      );
      assert.equal(
        await evaluate(cdp, "document.querySelectorAll('.detail-list li').length"),
        1
      );
      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('.canvas-shell').dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true })
        )`
      });
      await waitForExpression(
        cdp,
        "!document.querySelector('#inspector')?.classList.contains('open')"
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector('.session-card')" +
          "?.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#inspector')?.classList.contains('open')"
      );
      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('.inspector-close')?.click()"
      });
      await waitForExpression(
        cdp,
        "!document.querySelector('#inspector')?.classList.contains('open')"
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector('.session-card')" +
          "?.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#inspector')?.classList.contains('open')"
      );
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.querySelector('#toggleProjects')?.click();
          document.querySelectorAll('.project-item')[0]?.click();
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#currentProjectLabel')?.textContent === 'ui-test'"
      );
      await waitForExpression(
        cdp,
        "!document.querySelector('#inspector')?.classList.contains('open')"
      );

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 812,
        height: 375,
        deviceScaleFactor: 1,
        mobile: false
      });
      await cdp.send("Page.navigate", { url: `${origin}/companion.html` });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.session-card').length > 0"
      );
      const shortViewport = await evaluateJson(
        cdp,
        `(() => {
          const graph = document.querySelector('#graph').getBoundingClientRect();
          const cards = [...document.querySelectorAll('.session-card')]
            .map((card) => card.getBoundingClientRect());
          const horizontallyVisible = cards.filter((card) =>
            card.right > graph.left && card.left < graph.right
          );
          const transform = d3.zoomTransform(document.querySelector('#graph'));
          const verticallyComplete = horizontallyVisible.filter((card) =>
            card.top >= graph.top && card.bottom <= graph.bottom
          );
          return {
            shortFitValid:
              horizontallyVisible.length > 0 &&
              (
                horizontallyVisible.every((card) =>
                  card.top >= graph.top && card.bottom <= graph.bottom
                ) ||
                (
                  transform.k <= .561 &&
                  verticallyComplete.length > 0
                )
              ),
            graph: {
              left: graph.left,
              top: graph.top,
              right: graph.right,
              bottom: graph.bottom
            },
            horizontallyVisible: horizontallyVisible.map((card) => ({
              left: card.left,
              top: card.top,
              right: card.right,
              bottom: card.bottom
            })),
            transform: { x: transform.x, y: transform.y, k: transform.k }
          };
        })()`
      );
      assert.equal(
        shortViewport.shortFitValid,
        true,
        JSON.stringify(shortViewport)
      );
      await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector('.session-card')" +
          "?.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#inspector')?.classList.contains('open')"
      );
      await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('.inspector-close')?.click()"
      });
      await waitForExpression(
        cdp,
        "!document.querySelector('#inspector')?.classList.contains('open')"
      );
      await delay(200);
      const shortAfterClose = await evaluateJson(
        cdp,
        `(() => {
          const transform = d3.zoomTransform(document.querySelector('#graph'));
          return { x: transform.x, y: transform.y, k: transform.k };
        })()`
      );
      assert.deepEqual(shortAfterClose, shortViewport.transform);

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

      await cdp.send("Page.navigate", {
        url: `${origin}/companion.html?listFailures=1`
      });
      await waitForExpression(
        cdp,
        "document.querySelector('#toast')?.classList.contains('visible')"
      );
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.project-item').length === 2",
        5_000
      );

      await cdp.send("Emulation.setEmulatedMedia", {
        media: "screen",
        features: [
          { name: "prefers-reduced-motion", value: "no-preference" }
        ]
      });
      for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
        { width: 812, height: 375 },
        { width: 1440, height: 900 }
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
          `location.search === '?viewport=${viewport.width}' &&
            document.querySelectorAll(
              '.hero-downloads [data-download]'
            ).length === 3 &&
            getComputedStyle(
              document.querySelector('.hero-downloads')
            ).display === 'grid' &&
            document.querySelector('.hero-voyage')?.dataset.scene`
        );
        const layout = await evaluateJson(
          cdp,
          `(() => {
            const hero = document.querySelector('.hero').getBoundingClientRect();
            const downloads = [...document.querySelectorAll(
              '.hero-downloads [data-download]'
            )].map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left
              };
            });
            return {
              width: innerWidth,
              height: innerHeight,
              scrollWidth: document.documentElement.scrollWidth,
              heroBottom: hero.bottom,
              heroHeight: getComputedStyle(
                document.querySelector('.hero')
              ).height,
              heroTitleFontSize: Number.parseFloat(getComputedStyle(
                document.querySelector('#hero-title')
              ).fontSize),
              heroStatusDisplay: getComputedStyle(
                document.querySelector('.hero-status')
              ).display,
              evidenceColumns: getComputedStyle(
                document.querySelector('.evidence-lines > div')
              ).gridTemplateColumns,
              downloadColumns: getComputedStyle(
                document.querySelector('.hero-downloads')
              ).gridTemplateColumns,
              scrollSnapType: getComputedStyle(
                document.documentElement
              ).scrollSnapType,
              finalTitleFits: (() => {
                const title = document.querySelector('#download-title');
                return title.scrollWidth <= title.clientWidth;
              })(),
              finalMeta: (() => {
                const section = document.querySelector('.final-cta')
                  .getBoundingClientRect();
                const meta = document.querySelector('.final-meta')
                  .getBoundingClientRect();
                return {
                  inside: meta.top >= section.top &&
                    meta.bottom <= section.bottom,
                  color: getComputedStyle(
                    document.querySelector('.final-meta')
                  ).color,
                  linkColor: getComputedStyle(
                    document.querySelector('.final-meta a')
                  ).color,
                  outsideFooter: Boolean(
                    document.querySelector('body > footer')
                  )
                };
              })(),
              heroVoyage: (() => {
                const element = document.querySelector('.hero-voyage');
                const rect = element.getBoundingClientRect();
                return {
                  width: rect.width,
                  height: rect.height,
                  scene: element.dataset.scene,
                  endpointsInside: [...element.querySelectorAll(
                    '.node-experience, .node-failed, .hero-reef'
                  )].every((marker) => {
                    const bounds = marker.getBoundingClientRect();
                    return bounds.left >= 0 && bounds.right <= innerWidth &&
                      bounds.top >= 0 && bounds.bottom <= innerHeight;
                  }),
                  channelBases: element.querySelectorAll(
                    '.hero-route-base'
                  ).length,
                  notes: element.querySelectorAll('.route-note').length,
                  vessels: element.querySelectorAll('.hero-vessel').length
                };
              })(),
              legacyWaypoints: document.querySelectorAll(
                '.hero-waypoint, [data-waypoint]'
              ).length,
              productImageSource: document.querySelector(
                '.product-visual img'
              ).getAttribute('src'),
              productImageWidth: document.querySelector(
                '.product-visual img'
              ).getBoundingClientRect().width,
              productImageInteractive: Boolean(
                document.querySelector('.product-visual img').closest('a')
              ),
              downloads,
              storyHeights: [...document.querySelectorAll(
                '.story-section'
              )].map((section) => section.getBoundingClientRect().height)
            };
          })()`
        );
        assert.equal(layout.width, viewport.width);
        assert.equal(layout.scrollWidth, viewport.width);
        assert.equal(layout.scrollSnapType, "none");
        assert.equal(layout.finalTitleFits, true);
        assert.equal(layout.finalMeta.inside, true);
        assert.equal(layout.finalMeta.color, "rgb(255, 255, 255)");
        assert.equal(layout.finalMeta.linkColor, "rgb(255, 255, 255)");
        assert.equal(layout.finalMeta.outsideFooter, false);
        assert.ok(layout.heroVoyage.scene);
        assert.equal(layout.heroVoyage.endpointsInside, true);
        assert.equal(layout.heroVoyage.channelBases, 3);
        assert.equal(layout.heroVoyage.notes, 4);
        assert.equal(layout.heroVoyage.vessels, 1);
        assert.equal(layout.legacyWaypoints, 0);
        assert.equal(
          layout.productImageSource,
          "./login-voyage-focus-4k.png?v=map-0.3.14"
        );
        assert.equal(layout.productImageInteractive, false);
        assert.ok(layout.heroVoyage.width > 0);
        assert.ok(layout.heroVoyage.height > 0);
        assert.ok(
          layout.heroBottom >= layout.height - .5,
          JSON.stringify({ viewport, layout })
        );
        assert.ok(
          layout.downloads.every(
            (download) =>
              download.top >= 0 &&
              download.bottom <= layout.heroBottom + .5 &&
              download.left >= 0 &&
              download.right <= layout.width + .5
          )
        );
        if (viewport.width <= 540) {
          assert.ok(layout.heroTitleFontSize <= 42);
          assert.equal(layout.heroStatusDisplay, "none");
          assert.match(layout.evidenceColumns, /^56px /);
        }
        if (viewport.width >= 1000) {
          assert.ok(
            Math.abs(layout.heroBottom - layout.height) <= .5,
            JSON.stringify({ viewport, layout })
          );
          assert.ok(
            Math.max(...layout.storyHeights) -
              Math.min(...layout.storyHeights) <= .5
          );
          assert.ok(
            layout.heroVoyage.width >= layout.width * .5,
            JSON.stringify({ viewport, layout })
          );
          assert.ok(
            layout.productImageWidth >= layout.width * .65,
            JSON.stringify({ viewport, layout })
          );
        }
      }

      const noteAnchors = await evaluateJson(cdp, `(() => {
        const svg = document.querySelector('.hero-route-map');
        const toScreen = (element, point) => {
          const result = new DOMPoint(point.x, point.y).matrixTransform(
            element.getScreenCTM()
          );
          return { x: result.x, y: result.y };
        };
        return [...document.querySelectorAll('.route-note')].map((note) => {
          const node = document.querySelector(
            '.node-' + note.dataset.node + ' circle'
          );
          const leader = note.querySelector('.route-note-leader');
          const point = leader.getPointAtLength(0);
          const start = toScreen(leader, point);
          const center = toScreen(svg, {
            x: Number(note.dataset.anchorX),
            y: Number(note.dataset.anchorY)
          });
          const radius = node.getBoundingClientRect().width / 2;
          return {
            title: note.querySelector('.route-note-title').textContent,
            edgeGap: Math.abs(
              Math.hypot(start.x - center.x, start.y - center.y) - radius
            )
          };
        });
      })()`);
      assert.deepEqual(
        noteAnchors.map((note) => note.title),
        ["确认目标", "保留分叉", "查看记录", "沉淀经验"]
      );
      assert.ok(
        noteAnchors.every((note) => note.edgeGap <= 0.1),
        JSON.stringify(noteAnchors)
      );

      const voyageScenes = await evaluateJson(cdp, `(() => {
        const samples = [0, 3500, 5000, 5200, 7500, 11250, 13000, 13500, 16000];
        return samples.map(time => {
          renderHeroVoyage(time);
          const matrix = document.querySelector('.hero-vessel')
            .transform.baseVal.consolidate().matrix;
          return {
            time,
            scene: document.querySelector('.hero-voyage').dataset.scene,
            course: document.querySelector('.hero-vessel').dataset.course,
            boat: { x: matrix.e, y: matrix.f },
            reefOpacity: Number(getComputedStyle(document.querySelector('.hero-reef')).opacity),
            crossOpacity: Number(getComputedStyle(document.querySelector('.node-failed')).opacity),
            checkOpacity: Number(getComputedStyle(document.querySelector('.node-experience')).opacity),
            checkColor: getComputedStyle(document.querySelector('.node-experience circle')).stroke,
            impactOpacity: Number(getComputedStyle(document.querySelector('.hero-impact')).opacity),
            ringRadius: Number(document.querySelector('.arrival-ring').getAttribute('r')),
            ringOpacity: Number(getComputedStyle(document.querySelector('.arrival-ring')).opacity),
            celebrationOpacity: Number(getComputedStyle(
              document.querySelector('.hero-celebration')
            ).opacity),
            visibleRays: [...document.querySelectorAll('.celebration-ray')]
              .filter((element) => Number(element.style.opacity) > 0).length,
            visiblePieces: [...document.querySelectorAll('.celebration-piece')]
              .filter((element) => Number(element.style.opacity) > 0).length
          };
        });
      })()`);
      assert.equal(voyageScenes[1].course, "failure");
      assert.equal(voyageScenes[1].reefOpacity, 1);
      assert.equal(voyageScenes[1].crossOpacity, 0);
      assert.deepEqual(voyageScenes[2].boat, { x: 496, y: 735 });
      assert.ok(voyageScenes[3].impactOpacity > 0);
      assert.equal(voyageScenes[4].reefOpacity, 0);
      assert.equal(voyageScenes[4].crossOpacity, 1);
      assert.equal(voyageScenes[5].course, "success");
      assert.deepEqual(voyageScenes[6].boat, { x: 650, y: 760 });
      assert.deepEqual(voyageScenes[7].boat, { x: 650, y: 760 });
      assert.ok(voyageScenes[7].ringRadius > 24);
      assert.ok(voyageScenes[7].ringOpacity > 0);
      assert.equal(voyageScenes[7].celebrationOpacity, 1);
      assert.equal(voyageScenes[7].visibleRays, 9);
      assert.equal(voyageScenes[7].visiblePieces, 10);
      assert.deepEqual(voyageScenes[8].boat, voyageScenes[0].boat);
      assert.equal(voyageScenes[8].reefOpacity, 1);
      assert.ok(voyageScenes.every((scene) =>
        scene.checkOpacity === 1 && scene.checkColor === "rgb(35, 143, 123)"
      ));

      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.documentElement.style.scrollBehavior = 'auto';
          const workflow = document.querySelector('.workflow');
          workflow.scrollIntoView({ block: 'center', behavior: 'instant' });
        })()`
      });
      await waitForExpression(
        cdp,
        "document.querySelectorAll('.workflow .flow-list li.is-active').length === 3"
      );
      const centeredWorkflow = await evaluateJson(
        cdp,
        `(() => {
          const workflow = document.querySelector('.workflow');
          const rect = workflow.getBoundingClientRect();
          return {
            centerDelta: Math.abs(
              rect.top + rect.height / 2 - innerHeight / 2
            ),
            activeSteps: document.querySelectorAll(
              '.workflow .flow-list li.is-active'
            ).length,
            progress: Number(
              getComputedStyle(workflow).getPropertyValue(
                '--workflow-progress'
              )
            )
          };
        })()`
      );
      assert.ok(
        centeredWorkflow.centerDelta <= 16,
        JSON.stringify(centeredWorkflow)
      );
      assert.equal(centeredWorkflow.activeSteps, 3);
      assert.equal(centeredWorkflow.progress, 1);

      await delay(1_600);
      const animatedSignature = async () =>
        evaluate(
          cdp,
          `(() => {
            const canvas = document.querySelector('#voyageCanvas');
            const pixels = canvas.getContext('2d').getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            ).data;
            let signature = 0;
            for (let index = 0; index < pixels.length; index += 256) {
              signature = (signature + pixels[index] + pixels[index + 1]) %
                1_000_000_007;
            }
            return signature;
          })()`
        );
      const firstMotionFrame = await animatedSignature();
      await delay(260);
      const secondMotionFrame = await animatedSignature();
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
      assert.notEqual(firstMotionFrame, secondMotionFrame);
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
  for (let attempt = 0; attempt < 450; attempt += 1) {
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
