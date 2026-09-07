import * as fs from "fs";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { buildConversationForest } from "./conversationForest";
import { readProjectState } from "./storage";
import { WAYFINDER_VERSION } from "./version";

const APP_URI = "ui://wayfinder/map";
const APP_MIME_TYPE = "text/html;profile=mcp-app";

export function createWayfinderMcpServer(): McpServer {
  const server = new McpServer({
    name: "wayfinder",
    version: WAYFINDER_VERSION
  });

  server.registerTool(
    "wayfinder_show_map",
    {
      title: "Show Wayfinder",
      description: "Display the current project's interactive voyage map.",
      inputSchema: {
        root: z.string().optional().describe("Absolute project directory")
      },
      _meta: {
        ui: {
          resourceUri: APP_URI,
          visibility: ["model", "app"]
        },
        "ui/resourceUri": APP_URI
      }
    },
    async ({ root }) => {
      const projectRoot = path.resolve(
        root || process.env.WAYFINDER_PROJECT_DIR || process.cwd()
      );
      const state = await readProjectState(projectRoot);
      const payload = state
        ? {
            project: path.basename(projectRoot),
            state,
            forest: buildConversationForest(state)
          }
        : {
            project: path.basename(projectRoot),
            state: undefined,
            forest: { trees: [], nodeCount: 0 }
          };
      return {
        content: [{
          type: "text",
          text: state
            ? `Wayfinder 已载入 ${state.nodes.length} 个节点。`
            : "当前项目还没有 Wayfinder 航迹。"
        }],
        structuredContent: payload
      };
    }
  );

  server.registerResource(
    "Wayfinder Voyage Map",
    APP_URI,
    {
      description: "Interactive Wayfinder voyage map"
    },
    async () => {
      const installed = path.join(
        __dirname,
        "..",
        "mcp",
        "wayfinder-app.html"
      );
      const workspace = path.join(
        __dirname,
        "..",
        "plugins",
        "wayfinder",
        "mcp",
        "wayfinder-app.html"
      );
      const file = fs.existsSync(installed) ? installed : workspace;
      return {
        contents: [{
          uri: APP_URI,
          mimeType: APP_MIME_TYPE,
          text: await fs.promises.readFile(file, "utf8")
        }]
      };
    }
  );

  return server;
}

async function main(): Promise<void> {
  const server = createWayfinderMcpServer();
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
