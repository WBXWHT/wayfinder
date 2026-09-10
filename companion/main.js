import { buildConversationForest } from "../src/conversationForest";
import { buildLocalTopicAssessments } from "../src/localExperience";

const projectPicker = document.querySelector("#projectPicker");
const connectionStatus = document.querySelector("#connectionStatus");
const refreshButton = document.querySelector("#refresh");
const settingsDialog = document.querySelector("#settingsDialog");
let invoke;
let projects = [];
let activeProjectId = "";
let lastUpdatedAt = "";
let hostStates = [];
let hostStatusRefresh;
let hostStatusGeneration = 0;
let projectLoadGeneration = 0;
const hostOperations = new Set();

async function start() {
  globalThis.__WAYFINDER_DESKTOP__ = true;
  await import("../mcp/wayfinder-app.js");
  invoke = globalThis.__TAURI__.core.invoke;
  try {
    await updateHostStatus();
  } catch {
    connectionStatus.textContent = "连接状态暂不可用";
  }
  await loadProjects();
  setInterval(() => {
    void refreshIfChanged().catch(() => undefined);
  }, 1_500);
  setInterval(() => {
    void updateHostStatus().catch(() => undefined);
  }, 5_000);
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
  projectPicker.innerHTML = projects.length
    ? projects.map((project) =>
        `<option value="${escapeHtml(project.id)}">` +
        `${escapeHtml(project.name)} · ${project.nodeCount} 航点</option>`
      ).join("")
    : '<option value="">尚无航迹</option>';
  projectPicker.value = activeProjectId;
  projectPicker.disabled = projects.length === 0;
  await loadActiveProject();
}

async function loadActiveProject() {
  const requestedProjectId = activeProjectId;
  const requestGeneration = ++projectLoadGeneration;
  if (!requestedProjectId) {
    globalThis.__WAYFINDER_SET_PAYLOAD__({
      project: "Wayfinder",
      state: undefined,
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
    globalThis.__WAYFINDER_SET_PAYLOAD__({
      project: "读取失败",
      state: undefined,
      forest: { trees: [], sessionCount: 0, nodeCount: 0 }
    });
    connectionStatus.textContent = `数据读取失败：${String(error)}`;
    return;
  }
  if (
    requestGeneration !== projectLoadGeneration ||
    requestedProjectId !== activeProjectId
  ) {
    return;
  }
  const project = projects.find((item) => item.id === requestedProjectId);
  const forest = buildConversationForest(state);
  globalThis.__WAYFINDER_SET_PAYLOAD__({
    project: project?.name || "Wayfinder",
    state,
    forest,
    assessments: buildLocalTopicAssessments(state, forest)
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

projectPicker.addEventListener("change", async () => {
  activeProjectId = projectPicker.value;
  await loadActiveProject();
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  try {
    await loadProjects(activeProjectId);
  } finally {
    refreshButton.disabled = false;
  }
});

document.querySelector("#settings").addEventListener("click", () => {
  document.querySelector("#archiveProject").disabled = !activeProjectId;
  settingsDialog.showModal();
});
document.querySelector("#closeSettings").addEventListener("click", () => {
  settingsDialog.close();
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
    `归档“${project?.name || "当前项目"}”？项目会移出列表，原始数据仍保留在 archive 目录。`
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
  } catch (error) {
    if (
      String(error).includes("PENDING_TURNS:") &&
      globalThis.confirm(
        "仍有未完成的 AI 回合。确认 Codex 与 Claude Code 已停止后强制归档？"
      )
    ) {
      try {
        await invoke("archive_project", {
          projectId: activeProjectId,
          force: true
        });
        activeProjectId = "";
        settingsDialog.close();
        await loadProjects();
        return;
      } catch (forceError) {
        connectionStatus.textContent = `归档失败：${String(forceError)}`;
        return;
      }
    }
    connectionStatus.textContent = `归档失败：${String(error)}`;
  }
});

document.querySelectorAll("[data-connect-host]").forEach((button) => {
  button.addEventListener("click", async () => {
    const host = button.dataset.connectHost;
    const state = hostStates.find((item) => item.host === host);
    const disconnecting = Boolean(
      state?.configured &&
      (state?.runtimeMatches || state?.enabled === false)
    );
    hostOperations.add(host);
    hostStatusGeneration += 1;
    button.disabled = true;
    connectionStatus.textContent =
      `正在${disconnecting ? "断开" : "配置"} ${hostName(host)}…`;
    try {
      const result = await invoke(
        disconnecting ? "disconnect_host" : "connect_host",
        { host }
      );
      connectionStatus.textContent = result;
      hostOperations.delete(host);
      await updateHostStatus({ force: true });
    } catch (error) {
      connectionStatus.textContent = `操作失败：${String(error)}`;
    } finally {
      hostOperations.delete(host);
      button.disabled = hostOperations.has(host);
    }
  });
});

async function updateHostStatus({ force = false } = {}) {
  if (hostStatusRefresh && !force) return hostStatusRefresh;
  const generation = ++hostStatusGeneration;
  const request = (async () => {
    const result = await invoke("host_status");
    if (generation !== hostStatusGeneration) return;
    hostStates = result.hosts || [];
    document.querySelectorAll("[data-connect-host]").forEach((button) => {
      const state = hostStates.find(
        (item) => item.host === button.dataset.connectHost
      );
      const label = button.querySelector(".host-label");
      const dot = button.querySelector(".host-dot");
      button.dataset.connected = state?.healthy ? "true" : "false";
      button.dataset.configured =
        state?.configured && state?.runtimeMatches ? "true" : "false";
      button.title = state?.healthy
        ? `断开 ${hostName(button.dataset.connectHost)}`
        : state?.configured && state?.enabled === false
          ? `断开 ${hostName(button.dataset.connectHost)} 的已禁用配置`
          : state?.configured && state?.runtimeMatches
            ? `${hostName(button.dataset.connectHost)} 已配置；首次使用需在宿主批准`
          : state?.configured
            ? `${hostName(button.dataset.connectHost)} 配置需要修复`
            : `配置 ${hostName(button.dataset.connectHost)}`;
      button.disabled = hostOperations.has(button.dataset.connectHost);
      if (label) label.textContent = hostName(button.dataset.connectHost);
      if (dot) dot.setAttribute(
        "aria-label",
        state?.healthy
          ? "Hook 正常"
          : state?.configured && state?.runtimeMatches
            ? "Hook 已配置"
            : state?.configured
              ? "Hook 需要修复"
            : "尚未配置"
      );
    });
    const healthy = hostStates.filter((state) => state.healthy);
    const disabled = hostStates.filter(
      (state) => state.configured && state.enabled === false
    );
    const awaitingApproval = hostStates.filter(
      (state) =>
        state.configured &&
        state.enabled &&
        state.runtimeMatches &&
        !state.healthy
    );
    const needsRepair = hostStates.filter(
      (state) =>
        state.configured &&
        (!state.enabled || !state.runtimeMatches)
    );
    connectionStatus.textContent = !result.git?.available
      ? "未检测到 Git，配置后也无法记录"
      : disabled.length > 0
        ? `${disabled.map((state) => hostName(state.host)).join("、")} Hooks 已禁用，请在宿主设置中启用`
      : needsRepair.length > 0
        ? `${needsRepair.map((state) => hostName(state.host)).join("、")} 配置需要修复`
        : healthy.length > 0
          ? `Hook 正常：${healthy.map((state) => hostName(state.host)).join("、")}`
          : awaitingApproval.length > 0
            ? `Hook 已配置：${awaitingApproval
                .map((state) => hostName(state.host))
                .join("、")}；首次使用需在宿主批准`
          : "仅在本地记录";
  })();
  hostStatusRefresh = request;
  try {
    return await request;
  } finally {
    if (hostStatusRefresh === request) {
      hostStatusRefresh = undefined;
    }
  }
}

function hostName(host) {
  return host === "claude" ? "Claude Code" : "Codex";
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

void start().catch((error) => {
  connectionStatus.textContent = `启动失败：${String(error)}`;
});
