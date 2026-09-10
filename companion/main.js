import { buildConversationForest } from "../src/conversationForest";

const projectList = document.querySelector("#projectList");
const projectSummary = document.querySelector("#projectSummary");
const currentProjectLabel = document.querySelector("#currentProjectLabel");
const projectSidebar = document.querySelector("#projectSidebar");
const projectToggle = document.querySelector("#toggleProjects");
const closeProjectsButton = document.querySelector("#closeProjects");
const openDataButton = document.querySelector("#openData");
const toast = document.querySelector("#toast");
const narrowProjects = globalThis.matchMedia("(max-width: 760px)");

let invoke;
let projects = [];
let activeProjectId = "";
let lastUpdatedAt = "";
let projectLoadGeneration = 0;
let activeProjectMisses = 0;
let refreshInFlight = false;
let toastTimer;
const ACTIVE_PROJECT_MISS_LIMIT = 3;

async function start() {
  invoke = globalThis.__TAURI__.core.invoke;
  globalThis.__WAYFINDER_DESKTOP_HANDLE_MESSAGE__ = handleMapMessage;
  const queued = globalThis.__WAYFINDER_DESKTOP_MESSAGE_QUEUE__ || [];
  globalThis.__WAYFINDER_DESKTOP_MESSAGE_QUEUE__ = [];
  queued.forEach(handleMapMessage);

  syncProjectsAccessibility();
  await loadProjects();
  setInterval(() => {
    void refreshIfChanged().catch(() => undefined);
  }, 1_500);
}

function handleMapMessage(message) {
  // The final map sends "ready" through the VS Code adapter. Companion data is
  // loaded by start(); host-only commands are hidden in desktop mode.
  if (message?.type === "ready") return;
}

function sendToMap(data) {
  globalThis.dispatchEvent(new MessageEvent("message", { data }));
}

async function loadProjects(preferredId) {
  projects = visibleProjects(await invoke("list_projects"));
  const nextId =
    activeProjectId && projects.some((item) => item.id === activeProjectId)
      ? activeProjectId
      : preferredId && projects.some((item) => item.id === preferredId)
        ? preferredId
        : projects[0]?.id || "";
  activeProjectId = nextId;
  activeProjectMisses = 0;
  renderProjectList();
  await loadActiveProject();
}

function renderProjectList() {
  const focusedProjectId =
    document.activeElement?.closest(".project-item")?.dataset.projectId || "";
  projectList.replaceChildren();
  if (projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "project-empty";
    empty.textContent = "开始一次 AI 协作后，项目会自动出现在这里。";
    projectList.append(empty);
    projectSummary.textContent = "尚无项目";
    return;
  }

  projects.forEach((project) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "project-item";
    item.dataset.projectId = project.id;
    item.setAttribute("aria-current", String(project.id === activeProjectId));
    item.title = project.root || project.name;

    const icon = document.createElement("span");
    icon.className = "project-icon";
    icon.setAttribute("aria-hidden", "true");
    const iconGlyph = document.createElement("span");
    iconGlyph.className = "codicon codicon-map";
    icon.append(iconGlyph);

    const copy = document.createElement("span");
    copy.className = "project-copy";
    const name = document.createElement("span");
    name.className = "project-name";
    name.textContent = project.name;
    const meta = document.createElement("span");
    meta.className = "project-meta";
    const parent = projectParentLabel(project.root);
    meta.textContent = project.pendingCount > 0
      ? `正在记录 · ${project.nodeCount} 轮${parent ? ` · ${parent}` : ""}`
      : parent
        ? `${project.nodeCount} 轮 · ${parent}`
        : `${project.nodeCount} 轮记录`;
    copy.append(name, meta);
    item.append(icon, copy);

    item.addEventListener("click", async () => {
      if (activeProjectId === project.id) {
        closeProjects();
        return;
      }
      activeProjectId = project.id;
      renderProjectList();
      await loadActiveProject();
      closeProjects();
    });
    projectList.append(item);
  });

  projectSummary.textContent = `${projects.length} 个项目`;
  syncProjectsAccessibility();
  if (
    focusedProjectId &&
    (
      !narrowProjects.matches ||
      document.body.classList.contains("projects-open")
    )
  ) {
    projectList
      .querySelector(`[data-project-id="${focusedProjectId}"]`)
      ?.focus();
  }
}

function projectParentLabel(root) {
  const parts = String(root || "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

function visibleProjects(items) {
  return items.filter((project) => {
    if (project.nodeCount <= 0 && project.pendingCount <= 0) return false;
    return !/^\/private\/var\/folders\/.+\/T\/tmp[._-]/.test(
      String(project.root || "")
    );
  });
}

async function loadActiveProject() {
  const requestedProjectId = activeProjectId;
  const requestGeneration = ++projectLoadGeneration;
  if (!requestedProjectId) {
    currentProjectLabel.textContent = "航海图";
    sendToMap({
      type: "render",
      projectName: "Wayfinder",
      state: { nodes: [] },
      forest: { trees: [], sessionCount: 0, nodeCount: 0 }
    });
    lastUpdatedAt = "";
    return;
  }

  let state;
  try {
    state = await invoke("read_project_state", {
      projectId: requestedProjectId
    });
  } catch (error) {
    if (
      requestGeneration !== projectLoadGeneration ||
      requestedProjectId !== activeProjectId
    ) {
      return;
    }
    showToast(`读取失败：${String(error)}`);
    return;
  }
  if (
    requestGeneration !== projectLoadGeneration ||
    requestedProjectId !== activeProjectId
  ) {
    return;
  }

  const project = projects.find((item) => item.id === requestedProjectId);
  currentProjectLabel.textContent = project?.name || "航海图";
  sendToMap({
    type: "render",
    projectName: project?.name || "Wayfinder",
    state,
    forest: buildConversationForest(state)
  });
  lastUpdatedAt = state.updatedAt || "";
}

async function refreshIfChanged() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const latest = visibleProjects(await invoke("list_projects"));
    const active = latest.find((item) => item.id === activeProjectId);
    const projectSetChanged =
      latest.length !== projects.length ||
      latest.some((item, index) =>
        item.id !== projects[index]?.id ||
        item.name !== projects[index]?.name ||
        item.nodeCount !== projects[index]?.nodeCount ||
        item.pendingCount !== projects[index]?.pendingCount
      );
    projects = latest;

    if (!activeProjectId) {
      activeProjectId = projects[0]?.id || "";
      activeProjectMisses = 0;
      renderProjectList();
      await loadActiveProject();
      return;
    }

    if (!active) {
      activeProjectMisses += 1;
      if (projectSetChanged) renderProjectList();
      if (activeProjectMisses < ACTIVE_PROJECT_MISS_LIMIT) return;
      activeProjectId = projects[0]?.id || "";
      activeProjectMisses = 0;
      renderProjectList();
      await loadActiveProject();
      return;
    }

    activeProjectMisses = 0;
    if (projectSetChanged) renderProjectList();
    if (active.updatedAt && active.updatedAt !== lastUpdatedAt) {
      await loadActiveProject();
    }
  } finally {
    refreshInFlight = false;
  }
}

projectToggle.addEventListener("click", () => {
  if (document.body.classList.contains("projects-open")) {
    closeProjects();
    return;
  }
  document.body.classList.add("projects-open");
  syncProjectsAccessibility();
  requestAnimationFrame(() => {
    (
      projectList.querySelector('[aria-current="true"]') ||
      closeProjectsButton
    )?.focus();
  });
});
closeProjectsButton.addEventListener("click", closeProjects);
document.querySelector("#sidebarScrim").addEventListener("click", closeProjects);

function closeProjects() {
  const restoreFocus =
    narrowProjects.matches &&
    document.body.classList.contains("projects-open");
  document.body.classList.remove("projects-open");
  syncProjectsAccessibility();
  if (restoreFocus) projectToggle.focus();
}

function syncProjectsAccessibility() {
  const open =
    !narrowProjects.matches ||
    document.body.classList.contains("projects-open");
  projectToggle.setAttribute("aria-expanded", String(open));
  projectSidebar.toggleAttribute("inert", !open);
  projectSidebar.setAttribute("aria-hidden", String(!open));
  [
    closeProjectsButton,
    ...projectList.querySelectorAll("button"),
    openDataButton
  ].forEach((element) => {
    if (open) element.removeAttribute("tabindex");
    else element.tabIndex = -1;
  });
}

openDataButton.addEventListener("click", async () => {
  try {
    await invoke("open_data_folder");
  } catch (error) {
    showToast(`无法打开数据目录：${String(error)}`);
  }
});

globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeProjects();
    return;
  }
  if (
    event.key !== "Tab" ||
    !narrowProjects.matches ||
    !document.body.classList.contains("projects-open")
  ) {
    return;
  }
  const focusable = [
    closeProjectsButton,
    ...projectList.querySelectorAll("button"),
    openDataButton
  ].filter((element) => !element.disabled);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
narrowProjects.addEventListener?.("change", () => {
  if (!narrowProjects.matches) {
    document.body.classList.remove("projects-open");
  }
  syncProjectsAccessibility();
});

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3_000);
}

void start().catch((error) => {
  showToast(`启动失败：${String(error)}`);
});
