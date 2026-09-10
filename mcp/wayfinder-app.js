import { hierarchy, tree as d3Tree } from "d3";
import { WAYFINDER_VERSION } from "../src/version";

const CARD_WIDTH = 128;
const CARD_GAP = 14;
const DEPTH_GAP = 112;
const MIN_SCALE = 0.75;

let app;
let latestPayload = {};
let activeTree = 0;
let activeProjectKey = "";
let resizeFrame;
let renderedWidth = 0;

function setPayload(payload) {
  const previousTreeId = latestPayload.forest?.trees?.[activeTree]?.id;
  const nextProjectKey = projectKey(payload);
  const nextTrees = payload?.forest?.trees || [];
  latestPayload = payload || {};
  activeTree = nextProjectKey === activeProjectKey && previousTreeId
    ? Math.max(0, nextTrees.findIndex((tree) => tree.id === previousTreeId))
    : 0;
  activeProjectKey = nextProjectKey;
  render();
}

globalThis.__WAYFINDER_SET_PAYLOAD__ = setPayload;

document.querySelector("#previous").addEventListener("click", () => {
  const count = latestPayload.forest?.trees?.length || 0;
  if (!count) return;
  activeTree = (activeTree - 1 + count) % count;
  render();
});

document.querySelector("#next").addEventListener("click", () => {
  const count = latestPayload.forest?.trees?.length || 0;
  if (!count) return;
  activeTree = (activeTree + 1) % count;
  render();
});

document.querySelector("#expand").addEventListener("click", async () => {
  const modes = app?.getHostContext()?.availableDisplayModes || [];
  if (modes.includes("fullscreen")) {
    await app?.requestDisplayMode({ mode: "fullscreen" });
  }
});

new ResizeObserver((entries) => {
  const width = Math.round(entries[0]?.contentRect?.width || 0);
  if (!width || width === renderedWidth) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(render);
}).observe(document.querySelector("#map"));

function render() {
  const map = document.querySelector("#map");
  renderedWidth = Math.round(map.clientWidth);
  const trees = latestPayload.forest?.trees || [];
  const tree = trees[activeTree];
  const assessment = (latestPayload.assessments || []).find(
    (item) => item.topicId === tree?.id
  );
  document.querySelector("#title").textContent =
    tree?.title || latestPayload.project || "Wayfinder 航海图";
  document.querySelector("#treeCount").textContent = trees.length > 1
    ? `${activeTree + 1} / ${trees.length}`
    : "";
  document.querySelector("#previous").hidden = trees.length < 2;
  document.querySelector("#next").hidden = trees.length < 2;
  if (!tree?.sessions?.length) {
    map.innerHTML = globalThis.__WAYFINDER_DESKTOP__
      ? '<div class="empty"><strong>还没有新的航迹</strong>' +
        '<span>连接 Codex 或 Claude Code 后，下一次会话会自动出现在这里。</span></div>'
      : '<div class="empty">当前项目还没有航迹</div>';
    return;
  }

  const geometry = geometryFor(tree.sessions, map.clientWidth);
  const routes = routeIndexes(tree.sessions);
  const latest = [...tree.sessions]
    .filter((session) => session.verdict !== "failure")
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .at(-1) || tree.sessions.at(-1);
  const paths = geometry.ordered.map((session) => {
    const target = geometry.positions.get(session.id);
    const parent = session.parentId
      ? geometry.positions.get(session.parentId)
      : { x: target.x, y: 27 };
    const middle = parent.y + (target.y - parent.y) * 0.5;
    const d = `M${parent.x},${parent.y} C${parent.x},${middle} ` +
      `${target.x},${middle} ${target.x},${target.y}`;
    const route = routes.get(session.id) || 0;
    const tone = session.verdict === "failure" ? " bad" : "";
    return `<path class="route-bed${tone}" d="${d}"/>` +
      `<path class="route route-${route}${tone}" d="${d}"/>`;
  }).join("");
  const nodes = geometry.ordered.map((session) => {
    const point = geometry.positions.get(session.id);
    const bad = session.verdict === "failure";
    const current = session.id === latest?.id;
    const lines = wrapTitle(session.shortTitle);
    const lineHeight = Math.min(14, 42 / lines.length);
    const fontSize = Math.max(7, Math.min(10.5, lineHeight - 1.5));
    const textY = 44 - (lines.length - 1) * lineHeight / 2;
    const labels = lines.map((line, index) =>
      `<tspan x="0" y="${textY + index * lineHeight}">` +
      `${escapeHtml(line)}</tspan>`
    ).join("");
    const errorMark = bad
      ? '<g transform="translate(16 -15)"><circle class="error-mark" r="8"/>' +
        '<path class="error-cross" d="M-3-3L3 3M3-3L-3 3"/></g>'
      : "";
    const currentRing = current
      ? '<circle class="current-ring" r="13"/>'
      : "";
    return `<g class="node${bad ? " bad" : ""}${current ? " current" : ""}" ` +
      `data-id="${escapeHtml(session.id)}" tabindex="0" ` +
      `role="button" aria-label="${escapeHtml(session.shortTitle)}" ` +
      `transform="translate(${point.x} ${point.y})">` +
      `${currentRing}<circle r="7"/>${errorMark}` +
      '<rect x="-64" y="16" width="128" height="48" rx="5"/>' +
      `<text text-anchor="middle" style="font-size:${fontSize}px">` +
      `${labels}</text></g>`;
  }).join("");
  const rootPoint = geometry.positions.get(geometry.ordered[0].id);
  map.innerHTML =
    `<div class="viewport"><div class="stage" style="width:${geometry.width}px;` +
    `height:${geometry.height}px"><svg viewBox="0 0 ${geometry.width} ` +
    `${geometry.height}" role="img" aria-label="${escapeHtml(tree.title)} 航海图">` +
    '<defs><pattern id="wayfinder-grid" width="24" height="24" ' +
    'patternUnits="userSpaceOnUse"><path class="grid-line" d="M24 0H0V24"/></pattern></defs>' +
    `<rect class="workspace" width="${geometry.width}" height="${geometry.height}"/>` +
    `<rect width="${geometry.width}" height="${geometry.height}" fill="url(#wayfinder-grid)"/>` +
    `<g class="routes">${paths}</g>` +
    `<g class="root" transform="translate(${rootPoint.x} 27)">` +
    '<circle class="root-ring" r="8"/><circle class="root-core" r="3"/></g>' +
    `<g class="nodes">${nodes}</g></svg></div></div><aside id="detail" hidden></aside>`;

  const viewport = map.querySelector(".viewport");
  const detail = map.querySelector("#detail");
  map.querySelectorAll(".node").forEach((node) => {
    const show = () => {
      const session = tree.sessions.find((item) => item.id === node.dataset.id);
      const source = sessionSources(session, latestPayload.state);
      detail.hidden = false;
      detail.innerHTML =
        `<div class="detail-head"><strong>${escapeHtml(session.shortTitle)}</strong>` +
        '<button class="close" title="关闭详情" aria-label="关闭详情">×</button></div>' +
        `<p>${escapeHtml(session.preview)}</p><small>${escapeHtml(session.stage)}` +
        `${source ? ` · ${escapeHtml(source)}` : ""}</small>` +
        `${assessment ? `<span class="assessment ${assessment.status}">` +
          `${escapeHtml(assessmentText(assessment.status))}</span>` : ""}`;
      detail.querySelector(".close").addEventListener("click", () => {
        detail.hidden = true;
      });
    };
    node.addEventListener("click", show);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show();
      }
    });
  });
  enableViewport(viewport, map.querySelector(".stage"), geometry);
}

function assessmentText(status) {
  return status === "conflicting"
    ? "证据冲突"
    : status === "superseded"
      ? "后续已替代"
      : "失败候选";
}

function geometryFor(sessions, availableWidth) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map();
  for (const session of sessions) {
    const parent = session.parentId && byId.has(session.parentId)
      ? session.parentId
      : "root";
    const list = children.get(parent) || [];
    list.push(session);
    children.set(parent, list);
  }
  children.forEach((items) =>
    items.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  );
  const make = (session, ancestors = new Set()) => {
    const next = new Set(ancestors);
    next.add(session.id);
    return {
      session,
      children: (children.get(session.id) || [])
        .filter((child) => !next.has(child.id))
        .map((child) => make(child, next))
    };
  };
  const root = hierarchy({
    session: null,
    children: (children.get("root") || []).map((session) => make(session))
  });
  d3Tree().nodeSize([CARD_WIDTH + CARD_GAP, DEPTH_GAP])(root);
  const real = root.descendants().filter((node) => node.data.session);
  const minX = Math.min(...real.map((node) => node.x));
  const maxX = Math.max(...real.map((node) => node.x));
  const minY = Math.min(...real.map((node) => node.y));
  const marginX = CARD_WIDTH / 2 + 12;
  const width = Math.max(
    360,
    Math.ceil(maxX - minX + marginX * 2),
    Math.ceil(availableWidth || 0)
  );
  const offsetX = (width - (maxX - minX)) / 2 - minX;
  const positions = new Map();
  for (const node of real) {
    positions.set(node.data.session.id, {
      x: node.x + offsetX,
      y: 82 + node.y - minY
    });
  }
  const ordered = real.map((node) => node.data.session);
  const lastY = Math.max(...[...positions.values()].map((point) => point.y));
  return {
    ordered,
    positions,
    width,
    height: Math.max(460, lastY + 100)
  };
}

function routeIndexes(sessions) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map();
  sessions.forEach((session) => {
    if (!session.parentId || !byId.has(session.parentId)) return;
    const list = children.get(session.parentId) || [];
    list.push(session);
    children.set(session.parentId, list);
  });
  const keys = new Map();
  const branchKeys = [];
  const keyFor = (session) => {
    let current = session;
    const seen = new Set();
    while (current?.parentId && byId.has(current.parentId) &&
      !seen.has(current.id)) {
      seen.add(current.id);
      if ((children.get(current.parentId) || []).length > 1) {
        return current.id;
      }
      current = byId.get(current.parentId);
    }
    return "trunk";
  };
  [...sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .forEach((session) => {
      const key = keyFor(session);
      if (key !== "trunk" && !branchKeys.includes(key)) branchKeys.push(key);
      keys.set(session.id, key);
    });
  return new Map(
    sessions.map((session) => {
      const key = keys.get(session.id);
      return [session.id, key === "trunk" ? 0 : branchKeys.indexOf(key) + 1];
    })
  );
}

function wrapTitle(value) {
  const text = String(value || "未命名航点").trim();
  if (text.length <= 10) return [text];
  const words = text.includes(" ") ? text.split(/\s+/) : [...text];
  const lines = [];
  let line = "";
  for (const word of words) {
    const joiner = text.includes(" ") && line ? " " : "";
    if ((line + joiner + word).length > 11 && line) {
      lines.push(line);
      line = word;
    } else {
      line += joiner + word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function sessionSources(session, state) {
  const nodes = new Map((state?.nodes || []).map((node) => [node.id, node]));
  const hosts = [...new Set(
    session.nodeIds.map((id) => nodes.get(id)?.sourceHost).filter(Boolean)
  )];
  return hosts.map((host) =>
    host === "trae" ? "TraeCode" : host === "claude" ? "Claude" : "Codex"
  ).join("、");
}

function enableViewport(viewport, stage, geometry) {
  const pointers = new Map();
  let scale = Math.min(
    1,
    Math.max(MIN_SCALE, viewport.clientWidth / geometry.width)
  );
  let x = (viewport.clientWidth - geometry.width * scale) / 2;
  let y = 0;
  let mouseDragging = false;
  let lastMouse;
  let touchSnapshot;
  const apply = () => {
    y = Math.min(0, y);
    stage.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  };
  const zoomAt = (factor, clientX, clientY) => {
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const next = Math.max(MIN_SCALE, Math.min(3.2, scale * factor));
    x = px - (px - x) * next / scale;
    y = py - (py - y) * next / scale;
    scale = next;
    apply();
  };
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const delta = Math.max(-12, Math.min(12, event.deltaY));
      zoomAt(Math.pow(2, -delta * 0.01), event.clientX, event.clientY);
    } else {
      x -= event.deltaX;
      y -= event.deltaY;
      apply();
    }
  }, { passive: false });
  viewport.addEventListener("pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") {
      mouseDragging = true;
      lastMouse = { x: event.clientX, y: event.clientY };
    } else if (pointers.size === 2) {
      touchSnapshot = touchState(pointers);
    }
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === "mouse" && mouseDragging) {
      x += event.clientX - lastMouse.x;
      y += event.clientY - lastMouse.y;
      lastMouse = { x: event.clientX, y: event.clientY };
      apply();
      return;
    }
    if (event.pointerType !== "mouse" && pointers.size === 1) {
      x += event.clientX - previous.x;
      y += event.clientY - previous.y;
      apply();
      return;
    }
    if (pointers.size === 2) {
      const next = touchState(pointers);
      if (touchSnapshot) {
        x += next.center.x - touchSnapshot.center.x;
        y += next.center.y - touchSnapshot.center.y;
        zoomAt(
          next.distance / Math.max(1, touchSnapshot.distance),
          next.center.x,
          next.center.y
        );
      }
      touchSnapshot = next;
    }
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    mouseDragging = false;
    if (pointers.size < 2) touchSnapshot = undefined;
  };
  viewport.addEventListener("pointerup", release);
  viewport.addEventListener("pointercancel", release);
  apply();
}

function projectKey(payload) {
  return payload?.state?.root || payload?.project || "";
}

function touchState(pointers) {
  const [a, b] = [...pointers.values()];
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(a.x - b.x, a.y - b.y)
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

if (globalThis.__WAYFINDER_MCP_PREVIEW__) {
  setPayload(globalThis.__WAYFINDER_MCP_PREVIEW__);
} else if (!globalThis.__WAYFINDER_DESKTOP__) {
  void connectMcp();
}

async function connectMcp() {
  const { App } = await import("@modelcontextprotocol/ext-apps");
  app = new App(
    { name: "Wayfinder", version: WAYFINDER_VERSION },
    { availableDisplayModes: ["inline", "fullscreen"] }
  );
  app.ontoolresult = (result) => {
    setPayload(result.structuredContent || {});
  };
  await app.connect();
}
