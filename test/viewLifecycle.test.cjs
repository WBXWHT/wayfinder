const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const pendingReads = [];
const originalLoad = Module._load;
let activePanel;

Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        joinPath: (...parts) => parts.join("/")
      },
      ViewColumn: { One: 1 },
      window: {
        createWebviewPanel() {
          let disposeListener;
          activePanel = {
            posted: [],
            reveal() {},
            webview: {
              cspSource: "https://preview.invalid",
              html: "",
              asWebviewUri(value) {
                return String(value);
              },
              async postMessage(message) {
                activePanel.posted.push(message);
                return true;
              },
              onDidReceiveMessage() {}
            },
            onDidDispose(listener) {
              disposeListener = listener;
            },
            dispose() {
              disposeListener?.();
            }
          };
          return activePanel;
        },
        async showErrorMessage() {}
      }
    };
  }
  if (
    request === "./storage" &&
    String(parent?.filename || "").endsWith("/forestMapPanel.js")
  ) {
    return {
      readProjectState() {
        return new Promise((resolve) => pendingReads.push(resolve));
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  ExperienceMapPanel
} = require("../out/experienceMapPanel.js");

test("a disposed map panel ignores an in-flight refresh", async () => {
  const map = new ExperienceMapPanel(".", "/tmp/project", {});
  map.show();
  const panel = activePanel;
  const refreshing = map.refresh();
  assert.equal(pendingReads.length, 1);

  map.dispose();
  pendingReads.shift()(projectState("disposed"));
  await refreshing;

  assert.deepEqual(panel.posted, []);
});

test("an older map refresh cannot overwrite a newer result", async () => {
  const map = new ExperienceMapPanel(".", "/tmp/project", {});
  map.show();
  const panel = activePanel;
  const older = map.refresh();
  const newer = map.refresh();
  assert.equal(pendingReads.length, 2);

  pendingReads[1](projectState("newer"));
  await newer;
  pendingReads[0](projectState("older"));
  await older;
  pendingReads.splice(0);

  const renders = panel.posted.filter((message) => message.type === "render");
  assert.equal(renders.length, 1);
  assert.equal(renders[0].state.projectId, "newer");
});

function projectState(projectId) {
  const now = "2026-09-12T00:00:00.000Z";
  return {
    version: 1,
    projectId,
    root: "/tmp/project",
    activeBranchId: "main",
    branches: [{ id: "main", name: "main", createdAt: now }],
    nodes: [],
    pending: {},
    updatedAt: now
  };
}
