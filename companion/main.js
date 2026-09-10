import { buildConversationForest } from "../src/conversationForest";

const projectList = document.querySelector("#projectList");
const projectSummary = document.querySelector("#projectSummary");
const currentProjectLabel = document.querySelector("#currentProjectLabel");
const refreshButton = document.querySelector("#refresh");
const settingsDialog = document.querySelector("#settingsDialog");
const toast = document.querySelector("#toast");

let invoke;
let projects = [];
let activeProjectId = "";
let lastUpdatedAt = "";
let projectLoadGeneration = 0;
let toastTimer;

async function start() {
  invoke = globalThis.__TAURI__.core.invoke;
  globalThis.__WAYFINDER_DESKTOP_HANDLE_MESSAGE__ = handleMapMessage;
  const queued = globalThis.__WAYFINDER_DESKTOP_MESSAGE_QUEUE__ || [];
  globalThis.__WAYFINDER_DESKTOP_MESSAGE_QUEUE__ = [];
  queued.forEach(handleMapMessage);

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
  projects = await invoke("list_projects");
  const nextId =
    activeProjectId && projects.some((item) => item.id === activeProjectId)
      ? activeProjectId
      : preferredId && projects.some((item) => item.id === preferredId)
        ? preferredId
        : projects[0]?.id || "";
  activeProjectId = nextId;
  renderProjectList();
  await loadActiveProject();
}

function renderProjectList() {
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
    icon.className = "codicon codicon-folder";
    icon.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "project-copy";
    const name = document.createElement("span");
    name.className = "project-name";
    name.textContent = project.name;
    const meta = document.createElement("span");
    meta.className = "project-meta";
    const parent = projectParentLabel(project.root);
    meta.textContent = parent
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
}

function projectParentLabel(root) {
  const parts = String(root || "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
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
  const latest = await invoke("list_projects");
  const active = latest.find((item) => item.id === activeProjectId);
  const projectSetChanged =
    latest.length !== projects.length ||
    latest.some((item, index) =>
      item.id !== projects[index]?.id ||
      item.name !== projects[index]?.name ||
      item.nodeCount !== projects[index]?.nodeCount
    );
  if (projectSetChanged) {
    await loadProjects(activeProjectId);
    return;
  }
  projects = latest;
  if (active?.updatedAt && active.updatedAt !== lastUpdatedAt) {
    await loadActiveProject();
  }
}

refreshButton.addEventListener("click", async () => {
  const icon = refreshButton.querySelector(".codicon");
  refreshButton.disabled = true;
  icon?.classList.add("is-spinning");
  try {
    await loadProjects(activeProjectId);
  } catch (error) {
    showToast(`刷新失败：${String(error)}`);
  } finally {
    refreshButton.disabled = false;
    icon?.classList.remove("is-spinning");
  }
});

document.querySelector("#toggleProjects").addEventListener("click", () => {
  document.body.classList.toggle("projects-open");
});
document.querySelector("#closeProjects").addEventListener("click", closeProjects);
document.querySelector("#sidebarScrim").addEventListener("click", closeProjects);

function closeProjects() {
  document.body.classList.remove("projects-open");
}

document.querySelector("#settings").addEventListener("click", () => {
  document.querySelector("#archiveProject").disabled = !activeProjectId;
  settingsDialog.showModal();
});
document.querySelector("#closeSettings").addEventListener("click", () => {
  settingsDialog.close();
});
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
document.querySelector("#openData").addEventListener("click", async () => {
  await invoke("open_data_folder");
});
document.querySelector("#checkUpdates").addEventListener("click", async () => {
  await invoke("open_release_page");
});
document.querySelector("#archiveProject").addEventListener("click", async () => {
  if (!activeProjectId) return;
  const project = projects.find((item) => item.id === activeProjectId);
  const confirmed = globalThis.confirm(
    `归档“${project?.name || "当前项目"}”？原始数据仍会保存在本机。`
  );
  if (!confirmed) return;

  try {
    await invoke("archive_project", {
      projectId: activeProjectId,
      force: false
    });
    activeProjectId = "";
    settingsDialog.close();
    await loadProjects();
    showToast("项目已归档");
  } catch (error) {
    if (
      String(error).includes("PENDING_TURNS:") &&
      globalThis.confirm("当前项目仍在记录。确认停止相关 AI 会话后强制归档？")
    ) {
      try {
        await invoke("archive_project", {
          projectId: activeProjectId,
          force: true
        });
        activeProjectId = "";
        settingsDialog.close();
        await loadProjects();
        showToast("项目已归档");
        return;
      } catch (forceError) {
        showToast(`归档失败：${String(forceError)}`);
        return;
      }
    }
    showToast(`归档失败：${String(error)}`);
  }
});

globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProjects();
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
