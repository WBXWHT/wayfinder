const canvas = document.querySelector("#voyageCanvas");
const context = canvas?.getContext("2d");
const heroVoyage = document.querySelector(".hero-voyage");
let width = 0;
let height = 0;
let pointerX = 0;
let pointerY = 0;
let startedAt = performance.now();
let animationFrame;
let scrollFrame;
const motionPreference = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)"
);
let reducedMotion = motionPreference?.matches || false;

function resize() {
  if (!canvas || !context) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  width = Math.round(rect.width);
  height = Math.round(rect.height);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function draw(time) {
  if (!context) return;
  context.clearRect(0, 0, width, height);
  drawMapSurface(time);
  heroVoyage?.style.setProperty("--route-shift-x", `${pointerX * 8}px`);
  heroVoyage?.style.setProperty("--route-shift-y", `${pointerY * 8}px`);
  animationFrame = reducedMotion ? undefined : requestAnimationFrame(draw);
}

function drawMapSurface(time) {
  const coastBase = width <= 820 ? width * .86 : width * .5;
  const coastX = (y) =>
    coastBase + Math.sin(y / 142) * 10 + Math.sin(y / 57) * 4;
  context.fillStyle = "#e8f6fa";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#d3eaf0";
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
  context.fillStyle = "#f5f7f9";
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
  context.fillStyle = "#efd38f";
  context.fill();

  context.beginPath();
  context.moveTo(coastX(0), 0);
  for (let y = 0; y <= height + 20; y += 24) {
    context.lineTo(coastX(y), y);
  }
  context.strokeStyle = "#ffffff";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = "#af7d34";
  context.lineWidth = 1.5;
  context.stroke();

  context.beginPath();
  context.moveTo(coastBase + 28, height * .19);
  context.bezierCurveTo(
    width * .7,
    height * .11,
    width * .82,
    height * .25,
    width - 24,
    height * .17
  );
  context.strokeStyle = "#acdce7";
  context.lineWidth = 1.2;
  context.setLineDash([4, 10]);
  context.lineDashOffset = -(time - startedAt) / 120;
  context.stroke();
  context.setLineDash([]);
}

async function loadDownloads() {
  try {
    const response = await fetch("./releases.json", { cache: "no-store" });
    const release = await response.json();
    const published = release.published === true;
    document.querySelectorAll("[data-download]").forEach((link) => {
      const url = published
        ? release.downloads?.[link.dataset.download]
        : undefined;
      link.href = url || release.releasePage;
      link.hidden = link.dataset.download === "windowsX64" && !url;
    });
  } catch {
    document.querySelectorAll("[data-download]").forEach((link) => {
      link.href = "https://github.com/WBXWHT/wayfinder/releases";
    });
  }
}

function updateScrollState() {
  scrollFrame = undefined;
  const root = document.documentElement;
  const scrollTop = globalThis.scrollY || root?.scrollTop || 0;
  const scrollHeight = Math.max(
    1,
    (root?.scrollHeight || 1) - (globalThis.innerHeight || 0)
  );
  root?.style?.setProperty(
    "--page-progress",
    `${Math.min(100, scrollTop / scrollHeight * 100)}%`
  );

  const viewportHeight = Math.max(1, globalThis.innerHeight || 1);
  document.querySelectorAll(".story-section").forEach((section) => {
    const rect = section.getBoundingClientRect();
    const progress = Math.max(
      0,
      Math.min(1, (viewportHeight - rect.top) / (viewportHeight + rect.height))
    );
    section.style.setProperty("--section-progress", progress.toFixed(3));
    if (section.classList.contains("workflow")) {
      const activeIndex = Math.min(2, Math.floor(progress * 3.25));
      section.querySelectorAll(".flow-list li").forEach((item, index) => {
        item.classList.toggle("is-active", index <= activeIndex);
      });
    }
  });

  document.querySelectorAll("[data-parallax]").forEach((element) => {
    const rect = element.getBoundingClientRect();
    const centerOffset =
      (rect.top + rect.height / 2 - viewportHeight / 2) / viewportHeight;
    element.style.setProperty(
      "--media-shift",
      `${Math.max(-14, Math.min(14, centerOffset * -18))}px`
    );
  });
}

function scheduleScrollUpdate() {
  if (scrollFrame !== undefined) return;
  scrollFrame = requestAnimationFrame(updateScrollState);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("visible");
  });
}, { threshold: .16 });
document.querySelectorAll(".reveal").forEach((element) => {
  observer.observe(element);
});

document.querySelectorAll("[data-parallax]").forEach((element) => {
  element.addEventListener?.("pointermove", (event) => {
    if (reducedMotion) return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width) - .5;
    const y = (event.clientY - rect.top) / Math.max(1, rect.height) - .5;
    element.style.setProperty("--tilt-x", `${x * 2.5}deg`);
    element.style.setProperty("--tilt-y", `${y * -2.5}deg`);
  });
  element.addEventListener?.("pointerleave", () => {
    element.style.setProperty("--tilt-x", "0deg");
    element.style.setProperty("--tilt-y", "0deg");
  });
});

window.addEventListener?.("resize", () => {
  resize();
  updateScrollState();
  if (reducedMotion) draw(startedAt + 1_250);
});
window.addEventListener?.("scroll", scheduleScrollUpdate, { passive: true });
window.addEventListener?.("pointermove", (event) => {
  if (reducedMotion || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  pointerX = (event.clientX - rect.left) / Math.max(1, rect.width) - .5;
  pointerY = (event.clientY - rect.top) / Math.max(1, rect.height) - .5;
});
document.addEventListener?.("visibilitychange", () => {
  if (document.hidden) {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    return;
  }
  if (!reducedMotion && animationFrame === undefined) {
    animationFrame = requestAnimationFrame(draw);
  }
});
motionPreference?.addEventListener?.("change", (event) => {
  reducedMotion = event.matches;
  if (reducedMotion) {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    draw(startedAt + 1_250);
    return;
  }
  startedAt = performance.now();
  if (animationFrame === undefined) {
    animationFrame = requestAnimationFrame(draw);
  }
});

resize();
updateScrollState();
void loadDownloads();
if (reducedMotion) draw(startedAt + 1_250);
else animationFrame = requestAnimationFrame(draw);
