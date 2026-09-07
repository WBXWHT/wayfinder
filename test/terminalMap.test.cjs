const assert = require("node:assert/strict");
const test = require("node:test");
const { renderTerminalMap } = require("../out/terminalMap.js");

test("terminal map keeps branches and host sources inside the terminal", () => {
  const sessions = [
    session("root", undefined, "定义产品", "neutral", ["n1"]),
    session("claude", "root", "实现会话地图", "success", ["n2"]),
    session("codex", "root", "验证终端入口", "failure", ["n3"])
  ];
  const state = {
    nodes: [
      { id: "n1", sourceHost: "trae" },
      { id: "n2", sourceHost: "claude" },
      { id: "n3", sourceHost: "codex" }
    ]
  };
  const forest = {
    nodeCount: 3,
    sessionCount: 3,
    trees: [{
      title: "Wayfinder",
      sessions,
      nodeCount: 3
    }]
  };

  const output = renderTerminalMap("/tmp/demo-project", state, forest);

  assert.match(output, /Wayfinder - demo-project/);
  assert.match(output, /\\- \[open\] 定义产品 \[TraeCode\]/);
  assert.match(output, /\+- \[ok\] 实现会话地图 \[Claude\]/);
  assert.match(output, /\\- \[blocked\] 验证终端入口 \[Codex\]/);
  assert.doesNotMatch(output, /https?:\/\//);
});

function session(id, parentId, shortTitle, verdict, nodeIds) {
  return {
    id,
    parentId,
    shortTitle,
    verdict,
    nodeIds,
    startedAt: `2026-09-08T00:0${nodeIds[0].slice(1)}:00.000Z`
  };
}
