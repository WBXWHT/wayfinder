## Server name

WBXWHT/wayfinder

## Project URL

https://github.com/WBXWHT/wayfinder

## Best category

Developer Productivity & Utilities

## What can an agent do with this server?

Wayfinder lets an agent read existing, locally recorded AI coding history as
task trees and branches. Its read-only `wayfinder_show_map` tool returns
prompts, replies, notes, file-change metadata, verdicts, and structured
lineage. MCP Apps-capable clients can render the bundled interactive voyage
map; other clients receive text and structured data. Capture adapters and IDE
restore operations are separate from this MCP read interface.

## Install or connection instructions

Requires Node.js 22.13+ and existing Wayfinder history for the selected project.

Preferred desktop installation:

1. Download `wayfinder-0.3.1.mcpb` from
   https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.1
2. Install it through the client's local MCP bundle installer.
3. Select the project directory when prompted.

Standalone Core:

```bash
npm install -g https://github.com/WBXWHT/wayfinder/releases/download/v0.3.1/wbxwht-wayfinder-0.3.1.tgz
```

Then merge:

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

The tarball is hosted on GitHub. The unrelated unscoped npm package named
`wayfinder` is not this project.

## Transport

stdio

## Auth requirements

no auth

## Known supported clients

Protocol-level stdio MCP clients. Interactive HTML requires MCP Apps support;
otherwise the tool returns text and structured data. Authenticated acceptance
in every named client remains pending and is not claimed.

## License

MIT

## Before submitting

- [x] I searched the repository for this project URL and name.

## Verification

- Official MCP Registry: `io.github.WBXWHT/wayfinder`, active version `0.3.1`
- Packaged-Core Hook/CLI/MCP process verification:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166940002
- Cross-platform public downloads:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166371656
- Privacy and local-data behavior:
  https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md

This is an early-access release. The MCP interface is read-only and does not
restore files or automatically capture a desktop/web client's conversations.
