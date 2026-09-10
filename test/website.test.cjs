const assert = require("node:assert/strict");
const console = require("node:console");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { setImmediate } = require("node:timers");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("download website exposes architecture-specific release links", () => {
  const html = fs.readFileSync(path.join(root, "website", "index.html"), "utf8");
  const releases = JSON.parse(fs.readFileSync(
    path.join(root, "website", "releases.json"),
    "utf8"
  ));

  assert.match(html, /<h1>Wayfinder<\/h1>/);
  assert.match(html, /data-download="arm64"/);
  assert.match(html, /data-download="x64"/);
  assert.match(html, /data-default-download/);
  assert.equal(releases.published, false);
  assert.match(releases.downloads.arm64, /Alpha.*macOS-aarch64\.dmg$/);
  assert.match(releases.downloads.x64, /Alpha.*macOS-x86_64\.dmg$/);
});

test("website scripts parse and visual CSS avoids decorative gradients", () => {
  const script = fs.readFileSync(path.join(root, "website", "app.js"), "utf8");
  const styles = fs.readFileSync(
    path.join(root, "website", "styles.css"),
    "utf8"
  );

  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient/i);
  assert.match(styles, /\.hero\s*\{/);
  assert.match(styles, /#voyageCanvas/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /data-default-download/);
  assert.match(script, /release\.downloads\?\.\[architecture\]/);
});

test("Cloudflare deployment cannot silently claim the occupied project name", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "deploy-website.yml"),
    "utf8"
  );
  assert.match(workflow, /CLOUDFLARE_PROJECT_NAME/);
  assert.match(workflow, /test "\$PROJECT_NAME" != "wayfinder"/);
  assert.match(workflow, /Verify public release downloads/);
  assert.match(workflow, /--head/);
  assert.match(workflow, /--retry-all-errors/);
});

test("Intel detection updates the generic CTA and reduced motion stops animation", async () => {
  const runtime = await runWebsiteScript("x86");

  assert.match(runtime.defaultLink.href, /macOS-x86_64\.dmg$/);
  assert.ok(runtime.x64Link.classes.has("primary"));
  assert.ok(runtime.arm64Link.classes.has("secondary"));
  assert.equal(runtime.animationFrames, 0);
});

test("unpublished downloads fall back to the release page", async () => {
  const runtime = await runWebsiteScript("arm64", false);

  assert.equal(
    runtime.arm64Link.href,
    "https://github.com/WBXWHT/wayfinder/releases"
  );
  assert.equal(runtime.defaultLink.href, runtime.arm64Link.href);
});

test("runtime reduced-motion changes cancel the active canvas frame", async () => {
  const runtime = await runWebsiteScript("arm64", true, false);
  assert.equal(runtime.animationFrames, 1);

  runtime.setReducedMotion(true);

  assert.equal(runtime.cancelledFrames, 1);
});

async function runWebsiteScript(
  architecture,
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
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => drawingContext,
    getBoundingClientRect: () => ({ width: 390, height: 700 })
  };
  const link = (download, classes) => ({
    dataset: { download },
    href: "",
    classes: new Set(classes),
    classList: {
      replace(from, to) {
        const changed = this.owner.classes.delete(from);
        if (changed) this.owner.classes.add(to);
      },
      owner: undefined
    }
  });
  const arm64Link = link("arm64", ["download", "primary"]);
  const x64Link = link("x64", ["download", "secondary"]);
  const defaultLink = link("arm64", ["download", "primary", "compact"]);
  for (const item of [arm64Link, x64Link, defaultLink]) {
    item.classList.owner = item;
  }
  let animationFrames = 0;
  let cancelledFrames = 0;
  let motionListener;
  const context = {
    console,
    devicePixelRatio: 1,
    fetch: async () => ({
      json: async () => ({
        version: "0.3.3",
        published,
        releasePage: "https://github.com/WBXWHT/wayfinder/releases",
        downloads: {
          arm64: "https://example.test/macOS-aarch64.dmg",
          x64: "https://example.test/macOS-x86_64.dmg"
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
    navigator: {
      userAgentData: {
        getHighEntropyValues: async () => ({ architecture })
      }
    },
    performance: { now: () => 1_000 },
    requestAnimationFrame: () => {
      animationFrames += 1;
      return animationFrames;
    },
    cancelAnimationFrame: () => {
      cancelledFrames += 1;
    },
    document: {
      querySelector(selector) {
        if (selector === "#voyageCanvas") return canvas;
        if (selector.includes("arm64")) return arm64Link;
        if (selector.includes("x64")) return x64Link;
        return undefined;
      },
      querySelectorAll(selector) {
        if (selector === "[data-download]") {
          return [arm64Link, x64Link, defaultLink];
        }
        if (selector === "[data-default-download]") return [defaultLink];
        return [];
      }
    },
    window: {
      addEventListener() {}
    }
  };
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return {
    arm64Link,
    x64Link,
    defaultLink,
    animationFrames,
    get cancelledFrames() {
      return cancelledFrames;
    },
    setReducedMotion(value) {
      motionListener?.({ matches: value });
    }
  };
}
