const canvas = document.querySelector("#voyageCanvas");
const context = canvas.getContext("2d");
let width = 0;
let height = 0;
let pointerX = 0;
let pointerY = 0;
let startedAt = performance.now();
let animationFrame;
const motionPreference = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)"
);
let reducedMotion = motionPreference?.matches || false;

const routes = [
  {
    color: "#1d8fb4",
    points: [[.58, .2], [.64, .36], [.7, .48], [.76, .67]],
    nodes: [[.58, .2], [.64, .36], [.7, .48], [.76, .67]]
  },
  {
    color: "#258e7d",
    points: [[.64, .36], [.74, .32], [.83, .4], [.88, .56]],
    nodes: [[.83, .4], [.88, .56]]
  },
  {
    color: "#d85f57",
    failed: true,
    points: [[.7, .48], [.77, .46], [.82, .52], [.85, .62]],
    nodes: [[.85, .62]]
  }
];

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  width = Math.round(rect.width);
  height = Math.round(rect.height);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function draw(time) {
  context.clearRect(0, 0, width, height);
  drawGrid();
  const progress = Math.min(1, (time - startedAt) / 1_400);
  context.save();
  context.translate(pointerX * 8, pointerY * 8);
  for (const route of routes) drawRoute(route, progress, time);
  context.restore();
  animationFrame = reducedMotion ? undefined : requestAnimationFrame(draw);
}

function drawGrid() {
  context.strokeStyle = "#e7e9ed";
  context.lineWidth = 1;
  for (let x = width * .52; x < width; x += 32) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += 32) {
    context.beginPath();
    context.moveTo(width * .52, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawRoute(route, progress, time) {
  const points = route.points.map(([x, y]) => [
    x * width,
    y * height
  ]);
  context.beginPath();
  context.moveTo(...points[0]);
  for (let index = 1; index < points.length; index += 1) {
    const [previousX, previousY] = points[index - 1];
    const [x, y] = points[index];
    const middleY = previousY + (y - previousY) * .5;
    context.bezierCurveTo(previousX, middleY, x, middleY, x, y);
  }
  context.strokeStyle = "#dde1e6";
  context.lineWidth = 8;
  context.lineCap = "round";
  context.setLineDash([]);
  context.stroke();
  context.strokeStyle = route.color;
  context.lineWidth = 3;
  context.setLineDash(route.failed ? [7, 8] : []);
  context.lineDashOffset = route.failed && !reducedMotion ? -time / 90 : 0;
  context.globalAlpha = .25 + progress * .75;
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;

  route.nodes.forEach(([x, y], index) => {
    const delay = index / Math.max(1, route.nodes.length) * .4;
    const nodeProgress = Math.max(0, Math.min(1, (progress - delay) / .6));
    if (!nodeProgress) return;
    const px = x * width;
    const py = y * height;
    context.beginPath();
    context.arc(px, py, 8 * nodeProgress, 0, Math.PI * 2);
    context.fillStyle = "#f6f7f9";
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = route.color;
    context.stroke();
    context.beginPath();
    context.arc(px, py, 3 * nodeProgress, 0, Math.PI * 2);
    context.fillStyle = route.color;
    context.fill();
  });
}

async function loadDownloads() {
  try {
    const response = await fetch("./releases.json", { cache: "no-store" });
    const release = await response.json();
    const published = release.published === true;
    document.querySelectorAll("[data-version]").forEach((element) => {
      element.textContent = published
        ? `macOS ${release.version} · Early Access`
        : `macOS ${release.version} · 即将开放`;
    });
    document.querySelectorAll("[data-download]").forEach((link) => {
      const url = published
        ? release.downloads?.[link.dataset.download]
        : undefined;
      if (url) link.href = url;
      else link.href = release.releasePage;
    });
    const architecture = await detectArchitecture();
    if (published && architecture === "x64") {
      const arm64 = document.querySelector(
        ".download-row [data-download='arm64']"
      );
      const x64 = document.querySelector(
        ".download-row [data-download='x64']"
      );
      arm64?.classList.replace("primary", "secondary");
      x64?.classList.replace("secondary", "primary");
    }
    document.querySelectorAll("[data-default-download]").forEach((link) => {
      link.href = published && architecture
        ? release.downloads?.[architecture] || release.releasePage
        : release.releasePage;
    });
  } catch {
    document.querySelectorAll("[data-download]").forEach((link) => {
      link.href = "https://github.com/WBXWHT/wayfinder/releases";
    });
  }
}

async function detectArchitecture() {
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const value = await navigator.userAgentData.getHighEntropyValues([
        "architecture"
      ]);
      return value.architecture === "x86" ? "x64" : "arm64";
    }
  } catch {
    // Fall through to the architecture-neutral release page.
  }
  return undefined;
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("visible");
  });
}, { threshold: .16 });
document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

window.addEventListener("resize", () => {
  resize();
  if (reducedMotion) draw(startedAt + 1_400);
});
window.addEventListener("pointermove", (event) => {
  if (reducedMotion) return;
  pointerX = (event.clientX / Math.max(1, width) - .5) * .5;
  pointerY = (event.clientY / Math.max(1, height) - .5) * .5;
});
motionPreference?.addEventListener?.("change", (event) => {
  reducedMotion = event.matches;
  if (reducedMotion) {
    if (animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    }
    draw(startedAt + 1_400);
    return;
  }
  startedAt = performance.now();
  if (animationFrame === undefined) {
    animationFrame = requestAnimationFrame(draw);
  }
});

resize();
void loadDownloads();
if (reducedMotion) draw(startedAt + 1_400);
else animationFrame = requestAnimationFrame(draw);
