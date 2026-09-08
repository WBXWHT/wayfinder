## Wayfinder

**Repository:** https://github.com/WBXWHT/wayfinder

**Release:** https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.3

**Official MCP Registry name:** `io.github.WBXWHT/wayfinder`

**Language / license:** TypeScript, MIT

**Transport:** Local stdio. No hosted HTTP endpoint.

**Suggested categories:** Developer Tools; Memory & Knowledge.

Wayfinder records AI coding sessions as a local voyage map. Its MCP server
provides read-only access to existing prompts, replies, file-change metadata,
notes, and task branches. The `wayfinder_show_map` tool returns structured
history and the `ui://wayfinder/map` MCP App resource. Supporting clients can
pan, zoom, and inspect the map inside the conversation; other clients receive
text and structured data.

Capture adapters for TraeCode, Claude Code, and Codex are separate from the
read-only MCP server. An IDE sidebar and a terminal text-tree viewer are also
available. MCP does not expose the IDE's code-restore actions.

### Installation

Requires Node.js 22.13+. Install the versioned public release tarball:

```bash
npm install -g https://github.com/WBXWHT/wayfinder/releases/download/v0.3.3/wbxwht-wayfinder-0.3.3.tgz
```

Then merge this MCP entry into the client's configuration, replacing the
project directory with the actual project's absolute path:

```json
{
  "mcpServers": {
    "wayfinder": {
      "command": "wayfinder-mcp",
      "env": {
        "WAYFINDER_PROJECT_DIR": "/absolute/path/to/project"
      }
    }
  }
}
```

A `.mcpb` desktop bundle is available on the release page as an alternative.
The tarball is hosted on GitHub; the unrelated unscoped npm package
`wayfinder` is not this project.

### Status And Privacy

This is an early-access release. The packaged CLI/MCP processes and public
installation paths are tested; authenticated acceptance in every AI client
has not been completed.

- Cross-platform public installation checks:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166371656
- Source tests and packaged-Core verification:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166940002
- Privacy:
  https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md

Wayfinder has no telemetry or cloud backend. Calling the MCP tool shares the
selected project's content with the calling AI host, whose privacy policies
apply. It reads locally recorded history; it does not automatically access
Claude Web/Desktop chats or a remote user's machine.

Please consider Wayfinder for the MCP.so directory.
