const assert = require("node:assert/strict");
const console = require("node:console");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { clearTimeout, setImmediate, setTimeout } = require("node:timers");
const vm = require("node:vm");

const {
  DEFAULT_ATTEMPTS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  verifyProductionDeployment
} = require("../scripts/verify-website-deployment.cjs");

const root = path.resolve(__dirname, "..");

test("download website exposes architecture-specific release links", () => {
  const html = fs.readFileSync(path.join(root, "website", "index.html"), "utf8");
  const releases = JSON.parse(fs.readFileSync(
    path.join(root, "website", "releases.json"),
    "utf8"
  ));
  const productImage = fs.readFileSync(
    path.join(root, "website", "wayfinder-app-map.png")
  );
  const productFocusImage = fs.readFileSync(
    path.join(root, "website", "login-voyage-focus-4k.png")
  );

  assert.match(html, /<h1[^>]*>Wayfinder<\/h1>/);
  assert.doesNotMatch(html, /scroll-cue|继续浏览/);
  assert.match(html, /data-download="arm64"/);
  assert.match(html, /data-download="x64"/);
  assert.match(html, /data-download="windowsX64"/);
  assert.equal((html.match(/data-download="/g) || []).length, 6);
  assert.doesNotMatch(html, /data-default-download|data-version=/);
  assert.doesNotMatch(html, />[^<]*0\.3\.7[^<]*</);
  assert.match(html, /class="hero-voyage"/);
  assert.match(html, /class="hero-vessel"/);
  assert.equal((html.match(/class="hero-route-base /g) || []).length, 3);
  assert.match(html, /class="vessel-sticker"/);
  assert.match(html, /translate\(0,-8\) scale\(2\.25\)/);
  assert.match(html, /id="hero-course-failure"/);
  assert.match(html, /class="hero-reef"/);
  assert.match(html, /class="hero-arrival"/);
  assert.doesNotMatch(html, /<animateMotion/);
  assert.doesNotMatch(html, /hero-waypoint|data-waypoint/);
  assert.match(html, /src="\.\/wayfinder-icon\.svg"/);
  assert.match(html, /href="\.\/styles\.css\?v=0\.3\.13-anchored"/);
  assert.match(html, /src="\.\/app\.js\?v=0\.3\.13-anchored"/);
  assert.match(html, /src="\.\/login-voyage-focus-4k\.png\?v=map-0\.3\.13"/);
  assert.match(html, /<figure class="product-visual">/);
  assert.doesNotMatch(html, /class="product-image-link"/);
  assert.doesNotMatch(html, /href="\.\/login-voyage-focus-4k\.png/);
  assert.match(html, />\s*示例航程 · 登录回跳稳定性\s*</);
  assert.doesNotMatch(html, /4K 示例航程/);
  assert.equal(productImage.readUInt32BE(16), 2_560);
  assert.equal(productImage.readUInt32BE(20), 1_440);
  assert.equal(productFocusImage.readUInt32BE(16), 3_840);
  assert.equal(productFocusImage.readUInt32BE(20), 2_160);
  assert.match(
    html,
    /data-download="arm64"[\s\S]*?href="https:\/\/github\.com\/StayCurious-Xuan\/wayfinder\/releases"/
  );
  assert.doesNotMatch(html, /无需 Node、插件或 MCP/);
  assert.doesNotMatch(html, /首次打开需在系统设置中允许/);
  assert.match(html, /按实际可用情况保留/);
  assert.doesNotMatch(html, /每个结论，都能回到原始证据/);
  assert.doesNotMatch(html, /每个结论都连着对应会话、文件与测试证据/);
  assert.equal(typeof releases.published, "boolean");
  assert.ok(["alpha", "stable"].includes(releases.channel));
  const tag = releases.channel === "alpha"
    ? `alpha-v${releases.version}`
    : `companion-v${releases.version}`;
  const assetPrefix = releases.channel === "alpha"
    ? `Wayfinder-Alpha-${releases.version}`
    : `Wayfinder-${releases.version}`;
  assert.equal(
    releases.downloads.arm64,
    `https://github.com/StayCurious-Xuan/wayfinder/releases/download/${tag}/` +
      `${assetPrefix}-macOS-aarch64.dmg`
  );
  assert.equal(
    releases.downloads.x64,
    `https://github.com/StayCurious-Xuan/wayfinder/releases/download/${tag}/` +
      `${assetPrefix}-macOS-x86_64.dmg`
  );
  assert.equal(
    releases.downloads.windowsX64,
    `https://github.com/StayCurious-Xuan/wayfinder/releases/download/${tag}/` +
      `${assetPrefix}-Windows-x86_64.exe`
  );
});

test("website scripts parse and visual CSS avoids decorative gradients", () => {
  const script = fs.readFileSync(path.join(root, "website", "app.js"), "utf8");
  const styles = fs.readFileSync(
    path.join(root, "website", "styles.css"),
    "utf8"
  );

  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient/i);
  assert.match(styles, /a:focus-visible/);
  assert.match(styles, /\.hero\s*\{/);
  assert.match(styles, /#voyageCanvas/);
  assert.doesNotMatch(styles, /\.scroll-cue|@keyframes scroll-cue/);
  assert.doesNotMatch(styles, /scroll-snap-/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /const workflowProgress = Math\.min\(1, progress \* 2\)/);
  assert.match(script, /const heroVoyage/);
  assert.doesNotMatch(script, /drawRouteSignals|updateActiveWaypoint/);
  assert.doesNotMatch(styles, /@keyframes route-(main|success|failure)-draw/);
  assert.match(script, /function voyageFrame\(elapsed\)/);
  assert.match(script, /getPointAtLength/);
  assert.match(styles, /animation: final-route-move 2\.667s linear infinite/);
  assert.match(script, /width <= 900 \? width \* \.86 : width \* \.5/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(
    styles,
    /@media \(min-width: 560px\) and \(max-width: 900px\) and \(max-height: 600px\)/
  );
  assert.match(styles, /\.hero-route-rail\s*\{[\s\S]*?stroke-width: 31/);
  assert.match(styles, /\.hero-route\s*\{[\s\S]*?stroke-width: 21/);
  assert.match(styles, /\.hero-vessel-bob\s*\{/);
  assert.doesNotMatch(styles, /hero-waypoint|waypoint-enter/);
  assert.doesNotMatch(styles, /\.product-image-link/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.route-sample\s*\{[\s\S]*?transition: none/
  );
  assert.match(script, /"windowsX64"/);
});

test("Cloudflare deployment cannot silently claim the occupied project name", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "deploy-website.yml"),
    "utf8"
  );
  assert.match(workflow, /CLOUDFLARE_PROJECT_NAME/);
  assert.match(workflow, /test "\$PROJECT_NAME" = "wayfinder-ai"/);
  assert.match(workflow, /Verify public release downloads/);
  assert.match(workflow, /alpha: \{/);
  assert.match(workflow, /stable: \{/);
  assert.match(workflow, /tag: `alpha-v\$\{release\.version\}`/);
  assert.match(workflow, /tag: `companion-v\$\{release\.version\}`/);
  assert.match(
    workflow,
    /`\$\{channel\.assetPrefix\}-Windows-x86_64\.exe`/
  );
  assert.match(workflow, /group: deploy-wayfinder-website-production/);
  assert.doesNotMatch(workflow, /^\s+paths:/m);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Verify Wayfinder/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /Require successful CI for the deployed commit/);
  assert.match(workflow, /listWorkflowRuns/);
  assert.match(workflow, /head_sha: process\.env\.DEPLOY_SHA/);
  assert.match(workflow, /Require the latest main commit/);
  assert.match(workflow, /Prevent a public version rollback/);
  assert.match(workflow, /compare\(candidate\.version, live\.version\) < 0/);
  assert.match(workflow, /url\.pathname !== expectedPath/);
  assert.match(workflow, /Published release is missing SHA256SUMS/);
  assert.match(workflow, /asset\?\.digest/);
  assert.match(workflow, /SHA256SUMS does not match \$\{assetName\}/);
  assert.match(workflow, /--head/);
  assert.match(workflow, /--connect-timeout 10/);
  assert.match(workflow, /--max-time 20/);
  assert.match(workflow, /--retry-max-time 45/);
  assert.match(workflow, /--retry-all-errors/);
  assert.match(workflow, /timeout-minutes: 10/);
  assert.equal((workflow.match(/AbortSignal\.timeout\(10_000\)/g) || []).length, 3);
  assert.match(workflow, /--branch=main/);
  assert.match(workflow, /--commit-hash=\$\{\{/);
  assert.match(workflow, /Write the deployed commit marker/);
  assert.match(workflow, /> website\/deployment\.json/);
  assert.match(workflow, /Recheck the latest main commit before deployment/);
  assert.equal(
    (workflow.match(/latest="\$\(git ls-remote origin refs\/heads\/main/g) || [])
      .length,
    2
  );
  assert.match(workflow, /Verify the production website/);
  assert.match(workflow, /verify-website-deployment\.cjs/);
});

test("production verification fits within the deployment job budget", () => {
  const maximumDuration =
    DEFAULT_ATTEMPTS * DEFAULT_TIMEOUT_MS +
    (DEFAULT_ATTEMPTS - 1) * DEFAULT_INTERVAL_MS;
  assert.ok(maximumDuration <= 180_000);
});

test("production verification retries until release and commit both match", async () => {
  const expectedRelease = {
    version: "9.8.7",
    channel: "alpha",
    published: true,
    downloads: {}
  };
  let releaseRequests = 0;
  let markerRequests = 0;
  let sleeps = 0;

  await verifyProductionDeployment({
    baseUrl: "https://example.invalid",
    expectedRelease,
    expectedSha: "expected-sha",
    attempts: 2,
    intervalMs: 1,
    timeoutMs: 50,
    sleep: async (milliseconds) => {
      assert.equal(milliseconds, 1);
      sleeps += 1;
    },
    fetchImpl: async (url, options) => {
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "follow");
      assert.ok(options.signal instanceof globalThis.AbortSignal);

      if (url.pathname.endsWith("/releases.json")) {
        releaseRequests += 1;
        return {
          ok: true,
          status: 200,
          json: async () => expectedRelease
        };
      }

      markerRequests += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          commit: markerRequests === 1 ? "stale-sha" : "expected-sha"
        })
      };
    }
  });

  assert.equal(releaseRequests, 2);
  assert.equal(markerRequests, 2);
  assert.equal(sleeps, 1);
});

test("production verification rejects a permanently stale commit", async () => {
  await assert.rejects(
    verifyProductionDeployment({
      baseUrl: "https://example.invalid",
      expectedRelease: { version: "9.8.7" },
      expectedSha: "expected-sha",
      attempts: 2,
      intervalMs: 0,
      timeoutMs: 50,
      sleep: async () => {},
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => url.pathname.endsWith("/deployment.json")
          ? { commit: "stale-sha" }
          : { version: "9.8.7" }
      })
    }),
    /Production deployment did not become current/
  );
});

test("production verification aborts a stalled request", async () => {
  const stalledFetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      const keepAlive = setTimeout(() => {}, 100);
      options.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(keepAlive);
          reject(options.signal.reason);
        },
        { once: true }
      );
    });

  await assert.rejects(
    verifyProductionDeployment({
      baseUrl: "https://example.invalid",
      expectedRelease: { version: "9.8.7" },
      expectedSha: "expected-sha",
      attempts: 1,
      timeoutMs: 5,
      fetchImpl: stalledFetch
    }),
    /Production deployment did not become current/
  );
});

test("public website ships restrictive security headers", () => {
  const headers = fs.readFileSync(
    path.join(root, "website", "_headers"),
    "utf8"
  );

  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /default-src 'self'/);
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
});

test("public Windows installer smoke test installs and launches the release", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "smoke-public-windows.yml"),
    "utf8"
  );

  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /website\/releases\.json/);
  assert.match(workflow, /Invoke-WebRequest -Uri \$url -OutFile \$installer/);
  assert.match(workflow, /SHA256SUMS/);
  assert.match(workflow, /Get-FileHash \$installer -Algorithm SHA256/);
  assert.match(workflow, /ArgumentList @\("\/S", "\/D=\$installDir"\)/);
  assert.match(workflow, /default: alpha-v0\.3\.13/);
  assert.match(workflow, /collector sidecar was not found/);
  assert.match(workflow, /\$machine -ne 0x8664/);
  assert.match(workflow, /& \$sidecar\.FullName --version/);
  assert.match(workflow, /& \$sidecar\.FullName collect/);
  assert.match(workflow, /Start-Process -FilePath \$app\.FullName -PassThru/);
  assert.match(workflow, /if \(\$process\.HasExited\)/);
});

test("published downloads expose every desktop installer equally", async () => {
  const runtime = await runWebsiteScript();

  assert.match(runtime.arm64Link.href, /macOS-aarch64\.dmg$/);
  assert.match(runtime.x64Link.href, /macOS-x86_64\.dmg$/);
  assert.match(runtime.windowsLink.href, /Windows-x86_64\.exe$/);
  assert.equal(runtime.animationFrames, 0);
});

test("unpublished downloads fall back to the release page", async () => {
  const runtime = await runWebsiteScript(false);

  assert.equal(
    runtime.arm64Link.href,
    "https://github.com/StayCurious-Xuan/wayfinder/releases"
  );
  assert.equal(runtime.x64Link.href, runtime.arm64Link.href);
  assert.equal(runtime.windowsLink.href, runtime.arm64Link.href);
});

test("runtime reduced-motion changes cancel the active canvas frame", async () => {
  const runtime = await runWebsiteScript(true, false);
  assert.equal(runtime.animationFrames, 1);

  runtime.setReducedMotion(true);

  assert.equal(runtime.cancelledFrames, 1);
});

test("canvas redraws when resized after its entrance animation", async () => {
  const runtime = await runWebsiteScript(true, false);

  runtime.finishAnimation();
  const clearsBeforeResize = runtime.clears;
  runtime.resize();
  runtime.finishAnimation();

  assert.ok(runtime.clears > clearsBeforeResize);
});

test("hero replays reef collision, recorded failure, and successful arrival", async () => {
  const runtime = await runWebsiteScript();
  const red = runtime.frameAt(3500);
  assert.equal(red.course, "failure");
  assert.equal(red.reefVisible, true);
  assert.equal(red.boatProgress, .5);
  assert.equal(red.greenProgress, 0);

  const hit = runtime.frameAt(5000);
  assert.equal(hit.phase, "impact");
  assert.equal(hit.collision, 0);
  assert.equal(hit.boatProgress, 1);
  assert.equal(runtime.frameAt(6500).boatOpacity, 0);

  const retry = runtime.frameAt(7500);
  assert.equal(retry.phase, "retry");
  assert.equal(retry.course, "main");
  assert.equal(retry.reefVisible, false);
  assert.equal(retry.redProgress, 1);
  const green = runtime.frameAt(11250);
  assert.equal(green.course, "success");
  assert.equal(green.boatProgress, .5);
  assert.equal(green.reefVisible, false);

  const arrived = runtime.frameAt(13500);
  assert.equal(arrived.phase, "arrival");
  assert.equal(arrived.arrival, 500);
  assert.equal(arrived.greenProgress, 1);
  assert.deepEqual(runtime.frameAt(16000), runtime.frameAt(0));
  assert.deepEqual(runtime.frameAt(48000 + 3500), red);
});

test("website capture preserves all five waypoints and their branch ancestry", () => {
  const state = JSON.parse(fs.readFileSync(
    path.join(root, "scripts/fixtures/website-voyage.json"), "utf8"
  ));
  const parents = state.nodes.map((node) => node.source.forest.parentStage);
  const stages = new Set(state.nodes.map((node) => node.source.forest.stage));
  assert.equal(state.nodes.length, 5);
  assert.equal(parents.filter((parent) => !parent).length, 1);
  assert.ok(parents.filter(Boolean).every((parent) => stages.has(parent)));
  assert.equal(state.nodes.filter((node) => node.verdict === "failure").length, 1);
  const capture = fs.readFileSync(
    path.join(root, "scripts/capture-website-map.cjs"), "utf8"
  );
  assert.match(capture, /generate-companion-preview\.cjs/);
  assert.match(capture, /Page\.captureScreenshot/);
  assert.match(capture, /resampled: false/);
});

async function runWebsiteScript(
  published = true,
  initiallyReduced = true
) {
  const script = fs.readFileSync(path.join(root, "website", "app.js"), "utf8");
  const drawingContext = new Proxy({}, {
    get(target, key) {
      if (!(key in target)) target[key] = () => undefined;
      return target[key];
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    }
  });
  let clears = 0;
  drawingContext.clearRect = () => {
    clears += 1;
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => drawingContext,
    getBoundingClientRect: () => ({ width: 390, height: 700 })
  };
  const link = (download, classes) => ({
    dataset: { download },
    href: "",
    hidden: false,
    textContent: "",
    classes: new Set(classes),
    classList: {
      replace(from, to) {
        const changed = this.owner.classes.delete(from);
        if (changed) this.owner.classes.add(to);
      },
      owner: undefined
    }
  });
  const arm64Link = link("arm64", ["download-option"]);
  const x64Link = link("x64", ["download-option"]);
  const windowsLink = link("windowsX64", ["download-option"]);
  for (const item of [arm64Link, x64Link, windowsLink]) {
    item.classList.owner = item;
  }
  let animationFrames = 0;
  let cancelledFrames = 0;
  let motionListener;
  let resizeListener;
  let frameCallback;
  const context = {
    console,
    devicePixelRatio: 1,
    fetch: async () => ({
      json: async () => ({
        version: "0.3.3",
        published,
        releasePage: "https://github.com/StayCurious-Xuan/wayfinder/releases",
        downloads: {
          arm64: "https://example.test/macOS-aarch64.dmg",
          x64: "https://example.test/macOS-x86_64.dmg",
          windowsX64: "https://example.test/Windows-x86_64.exe"
        }
      })
    }),
    IntersectionObserver: class {
      observe() {}
    },
    matchMedia: () => ({
      matches: initiallyReduced,
      addEventListener(event, listener) {
        if (event === "change") motionListener = listener;
      }
    }),
    navigator: {},
    performance: { now: () => 1_000 },
    requestAnimationFrame: (callback) => {
      animationFrames += 1;
      frameCallback = callback;
      return animationFrames;
    },
    cancelAnimationFrame: () => {
      cancelledFrames += 1;
    },
    document: {
      querySelector(selector) {
        if (selector === "#voyageCanvas") return canvas;
        return undefined;
      },
      querySelectorAll(selector) {
        if (selector === "[data-download]") {
          return [arm64Link, x64Link, windowsLink];
        }
        return [];
      }
    },
    window: {
      addEventListener(event, listener) {
        if (event === "resize") resizeListener = listener;
      }
    }
  };
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return {
    arm64Link,
    x64Link,
    windowsLink,
    animationFrames,
    frameAt(elapsed) {
      return JSON.parse(JSON.stringify(context.voyageFrame(elapsed)));
    },
    get clears() {
      return clears;
    },
    get cancelledFrames() {
      return cancelledFrames;
    },
    finishAnimation() {
      frameCallback?.(2_400);
    },
    resize() {
      resizeListener?.();
    },
    setReducedMotion(value) {
      motionListener?.({ matches: value });
    }
  };
}
