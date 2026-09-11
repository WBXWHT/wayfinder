const canvas = document.querySelector("#voyageCanvas");
const context = canvas?.getContext("2d");
const heroVoyage = document.querySelector(".hero-voyage");
const heroCourses = Object.fromEntries(
  ["main", "failure", "success"].map((name) => {
    const path = document.querySelector(`#hero-course-${name}`);
    return [name, path ? {
      path,
      length: path.getTotalLength(),
      trail: document.querySelector(`.hero-route-${name}`)
    } : undefined];
  })
);
const vessel = document.querySelector(".hero-vessel");
const reef = document.querySelector(".hero-reef");
const failedMarker = document.querySelector(".node-failed");
const impact = document.querySelector(".hero-impact");
const arrivalRings = document.querySelectorAll(".arrival-ring");
const celebration = document.querySelector(".hero-celebration");
const celebrationRays = document.querySelectorAll(".celebration-ray");
const celebrationPieces = document.querySelectorAll(".celebration-piece");
const routeNotes = document.querySelectorAll(".route-note");
let width = 0;
let height = 0;
let pointerX = 0;
let pointerY = 0;
let startedAt = performance.now();
let animationFrame;
let scrollFrame;
let hiddenAt;
const motionPreference = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)"
);
let reducedMotion = motionPreference?.matches || false;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const easeOutCubic = (value) => 1 - ((1 - value) ** 3);

// One clock controls both attempts so the boat and outcome markers cannot drift.
function voyageFrame(elapsed) {
  const time = ((elapsed % 16000) + 16000) % 16000;
  const retry = time >= 7500;
  const attemptTime = retry ? time - 7500 : time;
  const mainProgress = Math.min(1, attemptTime / 2000);
  const branchProgress = Math.max(
    0, Math.min(1, (attemptTime - 2000) / (retry ? 3500 : 3000))
  );
  const collision = !retry && time >= 5000 && time < 5600
    ? (time - 5000) / 600 : -1;
  const arrival = retry && time >= 13000 ? time - 13000 : -1;
  return {
    phase: retry
      ? arrival >= 0 ? "arrival" : mainProgress < 1 ? "retry" : "green-sailing"
      : time >= 5000 ? "impact" : "red-sailing",
    course: mainProgress < 1 ? "main" : retry ? "success" : "failure",
    boatProgress: mainProgress < 1 ? mainProgress : branchProgress,
    mainProgress,
    redProgress: retry ? 1 : branchProgress,
    greenProgress: retry ? branchProgress : 0,
    reefVisible: !retry,
    boatOpacity: retry
      ? Math.min(1, attemptTime / 240)
      : Math.min(1, Math.max(0, (6500 - time) / 500)),
    collision,
    arrival
  };
}

function renderCelebration(arrival) {
  const active = !reducedMotion && arrival >= 0 && arrival <= 1800;
  if (celebration) celebration.style.opacity = active ? 1 : 0;
  celebrationRays.forEach((ray, index) => {
    const progress = clamp01((arrival - index * 22) / 680);
    const visible = active && progress > 0 && progress < 1;
    const angle = Number(ray.dataset.angle) * Math.PI / 180;
    const travel = easeOutCubic(progress);
    const inner = 30 + travel * 12;
    const outer = inner + 12 + (1 - progress) * 10;
    ray.setAttribute("x1", Math.cos(angle) * inner);
    ray.setAttribute("y1", Math.sin(angle) * inner);
    ray.setAttribute("x2", Math.cos(angle) * outer);
    ray.setAttribute("y2", Math.sin(angle) * outer);
    ray.style.opacity = visible ? Math.sin(progress * Math.PI) * .92 : 0;
  });
  celebrationPieces.forEach((piece, index) => {
    const delay = Number(piece.dataset.delay);
    const progress = clamp01((arrival - delay) / 1150);
    const visible = active && progress > 0 && progress < 1;
    const angle = Number(piece.dataset.angle) * Math.PI / 180;
    const distance = Number(piece.dataset.distance) * easeOutCubic(progress);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance + progress * progress * 24;
    const scale = Math.min(1, progress * 5);
    const opacity = progress < .68 ? 1 : (1 - progress) / .32;
    piece.setAttribute(
      "transform",
      `translate(${x},${y}) rotate(${index * 23 + progress * 150}) scale(${scale})`
    );
    piece.style.opacity = visible ? Math.max(0, opacity) : 0;
  });
}

function renderHeroVoyage(elapsed) {
  if (!heroVoyage || !vessel || !heroCourses.main) return;
  const frame = voyageFrame(reducedMotion ? 14500 : elapsed);
  heroVoyage.dataset.scene = frame.phase;
  vessel.dataset.course = frame.course;
  const course = heroCourses[frame.course];
  const point = course.path.getPointAtLength(course.length * frame.boatProgress);
  const bump = frame.collision < 0
    ? 0 : Math.sin(frame.collision * Math.PI * 5) * (1 - frame.collision);
  const bowOffset = frame.course === "failure"
    ? Math.max(0, (frame.boatProgress - .88) / .12) * 24 : 0;
  vessel.setAttribute("transform",
    `translate(${point.x + bump * 10 - bowOffset},${point.y - Math.abs(bump) * 12})`
  );
  vessel.style.opacity = frame.boatOpacity;
  reef.style.opacity = frame.reefVisible ? 1 : 0;
  failedMarker.style.opacity = frame.reefVisible ? 0 : 1;
  impact.style.opacity = frame.collision < 0 ? 0 : 1 - frame.collision;
  for (const [name, progress] of [
    ["main", frame.mainProgress],
    ["failure", frame.redProgress],
    ["success", frame.greenProgress]
  ]) {
    heroCourses[name].trail.style.strokeDashoffset = 1 - progress;
  }
  arrivalRings.forEach((ring, index) => {
    const progress = (frame.arrival - index * 320) / 1500;
    const visible = !reducedMotion && progress >= 0 && progress <= 1;
    ring.style.opacity = visible ? (1 - progress) * .8 : 0;
    ring.setAttribute("r", 24 + Math.max(0, Math.min(1, progress)) * 44);
  });
  renderCelebration(frame.arrival);
  const activeNote = frame.arrival >= 0 ? 3
    : frame.mainProgress < 1 ? 0 : frame.reefVisible ? 1 : 2;
  routeNotes.forEach((note, index) => {
    note.classList.toggle("is-current", index === activeNote);
  });
}

for (const [name, selector, progress] of [
  ["main", ".mark-main", .55],
  ["success", ".mark-success", .55],
  ["failure", ".mark-failure", .5]
]) {
  const course = heroCourses[name];
  const mark = document.querySelector(selector);
  if (!course || !mark) continue;
  const point = course.path.getPointAtLength(course.length * progress);
  mark.setAttribute("transform", `translate(${point.x},${point.y})`);
}

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
  renderHeroVoyage(time - startedAt);
  if (!context) return;
  context.clearRect(0, 0, width, height);
  drawMapSurface(time);
  heroVoyage?.style.setProperty("--route-shift-x", `${pointerX * 8}px`);
  heroVoyage?.style.setProperty("--route-shift-y", `${pointerY * 8}px`);
  animationFrame = reducedMotion ? undefined : requestAnimationFrame(draw);
}

function drawMapSurface(time) {
  const coastBase = width <= 900 ? width * .86 : width * .5;
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
      link.href = "https://github.com/StayCurious-Xuan/wayfinder/releases";
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
      const workflowProgress = Math.min(1, progress * 2);
      section.style.setProperty(
        "--workflow-progress",
        workflowProgress.toFixed(3)
      );
      const activeIndex = Math.min(2, Math.floor(workflowProgress * 3));
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
    hiddenAt = performance.now();
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    return;
  }
  if (hiddenAt !== undefined) {
    startedAt += performance.now() - hiddenAt;
    hiddenAt = undefined;
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
renderHeroVoyage(0);
updateScrollState();
void loadDownloads();
if (reducedMotion) draw(startedAt + 1_250);
else animationFrame = requestAnimationFrame(draw);
