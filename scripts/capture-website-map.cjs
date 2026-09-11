/* global WebSocket */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const output = path.resolve(
  process.argv[2] || path.join(root, "website/login-voyage-focus-4k.png")
);
const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].find((candidate) => candidate && fs.existsSync(candidate));

async function main() {
  if (!chrome) throw new Error("Chrome is required to render the product map.");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-map-capture-"));
  const preview = path.join(temp, "preview.html");
  execFileSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), "-p", root
  ], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [
    path.join(root, "scripts/generate-companion-preview.cjs"),
    path.join(__dirname, "fixtures/website-voyage.json"), preview
  ], { cwd: root, stdio: "inherit" });

  const browser = spawn(chrome, [
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--remote-debugging-port=0",
    `--user-data-dir=${path.join(temp, "chrome")}`, "about:blank"
  ], { stdio: "ignore" });
  let cdp;
  try {
    const activePort = path.join(temp, "chrome/DevToolsActivePort");
    await waitUntil(() => fs.existsSync(activePort));
    const port = Number(fs.readFileSync(activePort, "utf8").split("\n")[0]);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    cdp = await connect(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
    });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }]
    });
    await cdp.send("Page.navigate", { url: pathToFileURL(preview).href });
    await waitUntil(async () => evaluate(cdp,
      "document.querySelectorAll('.session-card').length === 5"
    ));
    await evaluate(cdp, "document.fonts.ready.then(() => true)");
    // Only the surrounding app chrome is excluded; map styles stay unchanged.
    await evaluate(cdp, `document.querySelector('.canvas-page-label').style.visibility = 'hidden'`);
    const crop = await evaluate(cdp, `(() => {
      const graph = document.querySelector('#graph').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.session-card, .session-node')]
        .map(element => element.getBoundingClientRect());
      const left = Math.max(graph.left, Math.min(...cards.map(r => r.left)) - 80);
      const right = Math.min(graph.right, Math.max(...cards.map(r => r.right)) + 28);
      const top = Math.min(...cards.map(r => r.top));
      const bottom = Math.max(...cards.map(r => r.bottom));
      const width = Math.ceil((right - left) / 16) * 16;
      const height = width * 9 / 16;
      const x = Math.max(graph.left, Math.min(left, graph.right - width));
      const y = Math.max(graph.top, Math.min((top + bottom - height) / 2, graph.bottom - height));
      if (height < bottom - top || width > graph.width) {
        throw new Error('The complete voyage does not fit the capture.');
      }
      return { x, y, width, height, scale: 1 };
    })()`);
    const deviceScaleFactor = 3840 / crop.width;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1920, height: 1080, deviceScaleFactor, mobile: false
    });
    await delay(250);
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png", clip: crop, captureBeyondViewport: true
    });
    const png = Buffer.from(data, "base64");
    if (png.readUInt32BE(16) !== 3840 || png.readUInt32BE(20) !== 2160) {
      throw new Error("Capture must be native 3840 x 2160 pixels.");
    }
    fs.writeFileSync(output, png);
    process.stdout.write(JSON.stringify({
      output, version: require("../package.json").version,
      crop, deviceScaleFactor, nodes: 5, resampled: false
    }, null, 2) + "\n");
  } finally {
    if (cdp) {
      await cdp.send("Browser.close").catch(() => {});
      cdp.close();
    }
    if (browser.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => browser.once("exit", resolve)),
        delay(2000).then(() => browser.kill("SIGTERM"))
      ]);
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for the product renderer.");
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener("error", reject);
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((resolveCommand, rejectCommand) => {
          const id = ++nextId;
          pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    });
  });
}

module.exports = { connect, evaluate, waitUntil };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
  });
}
