import { App } from "@modelcontextprotocol/ext-apps";
import { hierarchy, tree as d3Tree } from "d3";
import { WAYFINDER_VERSION } from "../src/version";

const CARD_WIDTH = 128;
const CARD_GAP = 14;
const DEPTH_GAP = 112;

const app = new App(
  { name: "Wayfinder", version: WAYFINDER_VERSION },
  { availableDisplayModes: ["inline", "fullscreen"] }
);

let latestPayload = {};
let activeTree = 0;
let resizeFrame;
let renderedWidth = 0;

app.ontoolresult = (result) => {
  latestPayload = result.structuredContent || {};
  activeTree = 0;
  render();
};

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
  const modes = app.getHostContext()?.availableDisplayModes || [];
  if (modes.includes("fullscreen")) {
    await app.requestDisplayMode({ mode: "fullscreen" });
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
  document.querySelector("#title").textContent =
    tree?.title || latestPayload.project || "Wayfinder 航海图";
  document.querySelector("#treeCount").textContent = trees.length > 1
    ? `${activeTree + 1} / ${trees.length}`
    : "";
  document.querySelector("#previous").hidden = trees.length < 2;
  document.querySelector("#next").hidden = trees.length < 2;
  if (!tree?.sessions?.length) {
    map.innerHTML = '<div class="empty">当前项目还没有航迹</div>';
    return;
  }

  const geometry = geometryFor(tree.sessions, map.clientWidth);
  const routes = routeIndexes(tree.sessions);
  const latest = [...tree.sessions]
    .filter((session) => session.verdict !== "failure")
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .at(-1) || tree.sessions.at(-1);
  const failedNodes = new Set(
    tree.sessions
      .filter((session) => session.verdict === "failure")
      .map((session) => session.id)
  );
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
  const waves = wavePaths(geometry.width, geometry.height);
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
    const reef = failedNodes.has(session.id)
      ? '<path class="reef" d="M-20 11 l7-16 7 9 6-14 8 21z"/>'
      : "";
    const boat = current
      ? '<g class="boat" transform="translate(13 -20)"><path class="sail" d="M0 0 L0 18 L13 15 Z"/><path class="hull" d="M-5 19 H16 L11 25 H0 Z"/></g>'
      : "";
    return `<g class="node${bad ? " bad" : ""}${current ? " current" : ""}" ` +
      `data-id="${escapeHtml(session.id)}" tabindex="0" ` +
      `role="button" aria-label="${escapeHtml(session.shortTitle)}" ` +
      `transform="translate(${point.x} ${point.y})">` +
      `${reef}${boat}<circle r="10"/>` +
      '<rect x="-64" y="16" width="128" height="52" rx="7"/>' +
      `<text text-anchor="middle" style="font-size:${fontSize}px">` +
      `${labels}</text></g>`;
  }).join("");
  const shorePad = Math.max(geometry.width, 1200);
  const shore = `M${-shorePad},27 C${geometry.width * 0.16},18 ` +
    `${geometry.width / 2 - 62},34 ${geometry.width / 2},25 ` +
    `C${geometry.width / 2 + 30},17 ${geometry.width * 0.84},31 ` +
    `${geometry.width + shorePad},24`;
  const rootPoint = geometry.positions.get(geometry.ordered[0].id);
  map.innerHTML =
    `<div class="viewport"><div class="stage" style="width:${geometry.width}px;` +
    `height:${geometry.height}px"><svg viewBox="0 0 ${geometry.width} ` +
    `${geometry.height}" role="img" aria-label="${escapeHtml(tree.title)} 航海图">` +
    `<rect class="ocean" width="${geometry.width}" height="${geometry.height}"/>` +
    `<g class="terrain"><path class="shore-fill" d="${shore} V0 H${-shorePad}Z"/>` +
    `<path class="shore-line" d="${shore}"/><path class="waves far" d="${waves.far}"/>` +
    `<path class="waves near" d="${waves.near}"/></g><g class="routes">${paths}</g>` +
    `<g class="port" transform="translate(${rootPoint.x} 2)"><path class="pole" d="M0 24V1"/>` +
    '<path class="flag" d="M0 1 L13 5 L0 10 Z"/></g>' +
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
        `${source ? ` · ${escapeHtml(source)}` : ""}</small>`;
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

function wavePaths(width, height) {
  let near = "";
  let far = "";
  const seed = (a, b) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  for (let row = 0; row < Math.ceil(height / 62); row += 1) {
    for (let column = 0; column < Math.ceil(width / 78); column += 1) {
      if (seed(row * 131.7 + column, column * 17.3 - row) < 0.48) continue;
      const x = column * 78 + 39 + (seed(row + 11, column * 3 + 1) - 0.5) * 70;
      const y = 48 + row * 62 + (seed(row * 3 + 2, column + 7) - 0.5) * 48;
      if (y > height) continue;
      const length = 18 + seed(row + 5, column * 7 + 3) * 32;
      const amplitude = 2.4 + seed(row * 2 + 1, column + 9) * 3.6;
      const segment = ` M${x.toFixed(1)} ${y.toFixed(1)} c` +
        `${(length * 0.3).toFixed(1)} ${(-amplitude).toFixed(1)},` +
        `${(length * 0.7).toFixed(1)} ${(-amplitude).toFixed(1)},` +
        `${length.toFixed(1)} 0`;
      if (y > height * 0.5) near += segment;
      else far += segment;
    }
  }
  return { near, far };
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
  let x = Math.max(0, (viewport.clientWidth - geometry.width) / 2);
  let y = 0;
  let scale = Math.min(1, viewport.clientWidth / geometry.width);
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
    const next = Math.max(0.4, Math.min(3.2, scale * factor));
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
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === "mouse" && mouseDragging) {
      x += event.clientX - lastMouse.x;
      y += event.clientY - lastMouse.y;
      lastMouse = { x: event.clientX, y: event.clientY };
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
  latestPayload = globalThis.__WAYFINDER_MCP_PREVIEW__;
  render();
} else {
  app.connect();
}
