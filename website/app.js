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
    points: [[.56, .17], [.64, .34], [.69, .5], [.77, .78]],
    nodes: [[.56, .17], [.64, .34], [.69, .5], [.77, .78]]
  },
  {
    color: "#258e7d",
    points: [[.64, .34], [.76, .31], [.84, .39], [.9, .62]],
    nodes: [[.84, .39], [.9, .62]]
  },
  {
    color: "#d85f57",
    failed: true,
    points: [[.69, .5], [.76, .47], [.81, .56], [.86, .73]],
    nodes: [[.86, .73]]
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
  drawMapSurface();
  const progress = Math.min(1, (time - startedAt) / 1_400);
  context.save();
  context.translate(pointerX * 8, pointerY * 8);
  for (const route of routes) drawRoute(route, progress, time);
  context.restore();
  animationFrame =
    reducedMotion || progress >= 1
      ? undefined
      : requestAnimationFrame(draw);
}

function drawMapSurface() {
  const coastBase = width <= 820 ? width * .86 : width * .5;
  const coastX = (y) =>
    coastBase + Math.sin(y / 142) * 10 + Math.sin(y / 57) * 4;
  context.fillStyle = "#eaf7fb";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#d5ebf1";
  context.lineWidth = 1;
  for (let x = coastBase; x < width; x += 34) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += 34) {
    context.beginPath();
    context.moveTo(coastBase, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(coastX(0), 0);
  for (let y = 0; y <= height + 20; y += 24) {
    context.lineTo(coastX(y), y);
  }
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = "#f7f8fa";
  context.fill();

  context.beginPath();
  context.moveTo(coastX(0) - 32, 0);
  context.lineTo(coastX(0), 0);
  for (let y = 0; y <= height + 20; y += 24) {
    context.lineTo(coastX(y), y);
  }
  for (let y = height + 20; y >= 0; y -= 24) {
    context.lineTo(coastX(y) - 32, y);
  }
  context.closePath();
  context.fillStyle = "#f2d795";
  context.fill();

  context.beginPath();
  context.moveTo(coastX(0), 0);
  for (let y = 0; y <= height + 20; y += 24) {
    context.lineTo(coastX(y), y);
  }
  context.strokeStyle = "#ffffff";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = "#b7863d";
  context.lineWidth = 1.5;
  context.stroke();

  context.beginPath();
  context.moveTo(coastBase + 30, height * .18);
  context.bezierCurveTo(
    width * .7,
    height * .1,
    width * .82,
    height * .24,
    width - 24,
    height * .16
  );
  context.strokeStyle = "#a9dce9";
  context.lineWidth = 1.2;
  context.setLineDash([4, 10]);
  context.stroke();
  context.setLineDash([]);
}

function drawRoute(route, progress, time) {
  const compact = width <= 820;
  const mapPoint = ([x, y]) => [
    (compact ? .5 + x * .52 : x) * width,
    y * height * (compact ? .58 : 1)
  ];
  const points = route.points.map(mapPoint);
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
  context.lineDashOffset = route.failed ? -Math.min(time - startedAt, 1_400) / 90 : 0;
  context.globalAlpha = .25 + progress * .75;
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;

  route.nodes.forEach((point, index) => {
    const delay = index / Math.max(1, route.nodes.length) * .4;
    const nodeProgress = Math.max(0, Math.min(1, (progress - delay) / .6));
    if (!nodeProgress) return;
    const [px, py] = mapPoint(point);
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
    document.querySelectorAll("[data-version='macos']").forEach((element) => {
      element.textContent = published
        ? `macOS ${release.version} · Early Access`
        : `macOS ${release.version} · 即将开放`;
    });
    document.querySelectorAll("[data-version='windows']").forEach((element) => {
      element.textContent = published
        ? `Windows ${release.version} · Early Access`
        : `Windows ${release.version} · 即将开放`;
    });
    document.querySelectorAll("[data-download]").forEach((link) => {
      const url = published
        ? release.downloads?.[link.dataset.download]
        : undefined;
      link.href = url || release.releasePage;
      link.hidden = link.dataset.download === "windowsX64" && !url;
    });
    const target = await detectDownloadTarget();
    if (published && target) {
      document.querySelectorAll(".download-row [data-download]").forEach(
        (link) => link.classList.replace("primary", "secondary")
      );
      document.querySelector(
        `.download-row [data-download='${target}']`
      )?.classList.replace("secondary", "primary");
    }
    document.querySelectorAll("[data-default-download]").forEach((link) => {
      link.href = published && target
        ? release.downloads?.[target] || release.releasePage
        : release.releasePage;
      link.textContent = target === "windowsX64"
        ? "下载 Windows 版"
        : target
          ? "下载 macOS 版"
          : "选择桌面版本";
    });
  } catch {
    document.querySelectorAll("[data-download]").forEach((link) => {
      link.href = "https://github.com/WBXWHT/wayfinder/releases";
    });
  }
}

async function detectDownloadTarget() {
  const platform = [
    navigator.userAgentData?.platform,
    navigator.userAgent
  ].filter(Boolean).join(" ");
  if (/Windows|Win32|Win64/i.test(platform)) {
    return "windowsX64";
  }
  if (!/Mac/i.test(platform)) {
    return undefined;
  }
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const value = await navigator.userAgentData.getHighEntropyValues([
        "architecture"
      ]);
      return value.architecture === "x86" ? "x64" : "arm64";
    }
  } catch {
    // Safari does not expose architecture, so prefer current Apple Silicon.
  }
  return "arm64";
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
  if (animationFrame === undefined) {
    animationFrame = requestAnimationFrame(draw);
  }
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
