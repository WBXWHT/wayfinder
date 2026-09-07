const fs = require("node:fs");
const path = require("node:path");
const { buildConversationForest } = require("../out/conversationForest.js");

const [, , stateFile, outputFile] = process.argv;
if (!stateFile || !outputFile) {
  throw new Error(
    "Usage: node scripts/generate-mcp-preview.cjs <timeline.json> <output.html>"
  );
}

const state = JSON.parse(fs.readFileSync(path.resolve(stateFile), "utf8"));
const appFile = path.resolve(
  __dirname,
  "..",
  "plugins",
  "wayfinder",
  "mcp",
  "wayfinder-app.html"
);
const payload = {
  project: path.basename(state.root),
  state,
  forest: buildConversationForest(state)
};
const bootstrap =
  `<script>globalThis.__WAYFINDER_MCP_PREVIEW__ = ` +
  `${JSON.stringify(payload).replace(/</g, "\\u003c")};</script>\n`;
const html = fs.readFileSync(appFile, "utf8").replace(
  "<script>",
  `${bootstrap}<script>`
);
fs.writeFileSync(path.resolve(outputFile), html);
