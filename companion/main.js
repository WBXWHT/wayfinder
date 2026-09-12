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
const PROJECT_ACCENTS = [
  "#2f8fa8",
  "#6f72c9",
  "#c97a3d",
  "#2e9468",
  "#c85f73",
  "#8b68b8",
  "#3d7fbf",
  "#8a8235"
];

let invoke;
let projects = [];
let activeProjectId = "";
let loadedProjectId = "";
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
  try {
    await loadProjects();
  } catch (error) {
    showToast(`启动读取失败，正在重试：${String(error)}`);
  }
  setInterval(() => {
    void refreshIfChanged().catch(() => undefined);
  }, 1_500);
  const eventApi = globalThis.__TAURI__.event;
  if (eventApi?.listen) {
    void eventApi.listen(
      "wayfinder://collector-status",
      ({ payload }) => {
        if (payload?.status === "error") {
          showToast("自动采集暂时中断，Wayfinder 将继续重试。");
        } else if (payload?.status === "idle") {
          void refreshIfChanged().catch(() => undefined);
        }
      }
    ).catch((error) => {
      showToast(`无法监听采集状态：${String(error)}`);
    });
  }
}

function handleMapMessage(message) {
  // The final map sends "ready" through the VS Code adapter. Companion data is
  // loaded by start(); host-only commands are hidden in desktop mode.
  if (message?.type === "ready") return;
  if (
    message?.type === "voyageAccent" &&
    /^#[0-9a-f]{6}$/i.test(String(message.color || ""))
  ) {
    [...projectList.querySelectorAll(".project-item")]
      .find((item) =>
        item.dataset.projectId === (loadedProjectId || activeProjectId)
      )
      ?.style.setProperty("--project-accent", message.color);
  }
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
  const drawerOpen =
    narrowProjects.matches &&
    document.body.classList.contains("projects-open");
  projectList.replaceChildren();
  if (projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "project-empty";
    empty.textContent = "开始一次 AI 协作后，项目会自动出现在这里。";
    projectList.append(empty);
    projectSummary.textContent = "尚无项目";
    syncProjectsAccessibility();
    if (
      drawerOpen &&
      !projectSidebar.contains(document.activeElement)
    ) {
      closeProjectsButton.focus();
    }
    return;
  }

  projects.forEach((project) => {
    const currentProjectId = loadedProjectId || activeProjectId;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "project-item";
    item.dataset.projectId = project.id;
    item.setAttribute("aria-current", String(project.id === currentProjectId));
    item.setAttribute(
      "aria-busy",
      String(
        project.id === activeProjectId &&
        activeProjectId !== currentProjectId
      )
    );
    item.title = project.root || project.name;
    item.style.setProperty("--project-accent", projectAccent(project));

    const icon = document.createElement("span");
    icon.className = "project-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
      <svg class="project-folder-route" data-lucide="folder-git-2"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round"
        stroke-linejoin="round">
        <path d="M18 19a5 5 0 0 1-5-5v8"></path>
        <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"></path>
        <circle cx="13" cy="12" r="2"></circle>
        <circle cx="20" cy="19" r="2"></circle>
      </svg>
    `;

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
      if (
        activeProjectId === project.id &&
        loadedProjectId === project.id
      ) {
        closeProjects();
        return;
      }
      activeProjectId = project.id;
      renderProjectList();
      const outcome = await loadActiveProject();
      if (
        outcome === "error" ||
        activeProjectId !== project.id ||
        loadedProjectId !== project.id
      ) {
        return;
      }
      closeProjects();
    });
    projectList.append(item);
  });

  projectSummary.textContent = `${projects.length} 个项目`;
  syncProjectsAccessibility();
  const restoredProject = focusedProjectId
    ? [...projectList.querySelectorAll(".project-item")]
        .find((item) => item.dataset.projectId === focusedProjectId)
    : undefined;
  if (restoredProject) {
    restoredProject.focus();
  } else if (
    drawerOpen &&
    !projectSidebar.contains(document.activeElement)
  ) {
    (
      projectList.querySelector('[aria-current="true"]') ||
      closeProjectsButton
    ).focus();
  }
}

function projectParentLabel(root) {
  const parts = String(root || "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

function projectAccent(project) {
  const value = String(project?.id || project?.root || project?.name || "wayfinder");
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }
  return PROJECT_ACCENTS[hash % PROJECT_ACCENTS.length];
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
    loadedProjectId = "";
    return "loaded";
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
      return "stale";
    }
    showToast(`读取失败：${String(error)}`);
    restoreLoadedProject(requestedProjectId);
    return "error";
  }
  if (
    requestGeneration !== projectLoadGeneration ||
    requestedProjectId !== activeProjectId
  ) {
    return "stale";
  }

  const project = projects.find((item) => item.id === requestedProjectId);
  const selectionChanged = loadedProjectId !== requestedProjectId;
  loadedProjectId = requestedProjectId;
  if (selectionChanged) {
    renderProjectList();
  }
  currentProjectLabel.textContent = project?.name || "航海图";
  sendToMap({
    type: "render",
    projectName: project?.name || "Wayfinder",
    projectAccent: projectAccent(project),
    state,
    forest: buildConversationForest(state)
  });
  lastUpdatedAt = state.updatedAt || "";
  return "loaded";
}

function restoreLoadedProject(failedProjectId) {
  if (activeProjectId !== failedProjectId) {
    return;
  }
  activeProjectId = projects.some((item) => item.id === loadedProjectId)
    ? loadedProjectId
    : "";
  renderProjectList();
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
      if (
        Number(globalThis.__WAYFINDER_VIEWPORT_ACTIVE_UNTIL__ || 0) >
        Date.now()
      ) {
        return;
      }
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
  const last = focusable[focusable.length - 1];
  if (!projectSidebar.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
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
