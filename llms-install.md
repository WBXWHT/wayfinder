# Install Wayfinder MCP

Install only after the user approves downloading and running the public
Wayfinder Core. Node.js 22.13+ and Git are required.

## Preferred Desktop Path

If the client supports local MCPB installation, download the versioned bundle
from:

https://github.com/WBXWHT/wayfinder/releases/download/v0.3.3/wayfinder-0.3.3.mcpb

Verify its SHA-256 is:

```text
d33fd95ace064cffe86b31d5265e8a17afc51eb482100c66f8488ea82d053adc
```

Install it through the client's local extension UI and let the user select the
project whose existing Wayfinder history should be read.

## Standalone Core Path

Install the versioned GitHub Release tarball:

```bash
npm install -g https://github.com/WBXWHT/wayfinder/releases/download/v0.3.3/wbxwht-wayfinder-0.3.3.tgz
wayfinder --version
```

Expected version: `0.3.3`.

Do not install the unrelated unscoped npm Registry package named `wayfinder`.

Merge, rather than overwrite, this entry in the client's MCP configuration:

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

Use an actual absolute project path. Restart/reload MCP, then call
`wayfinder_show_map` without arguments. A successful call returns text plus
structured content. MCP Apps-capable clients also render `ui://wayfinder/map`.

## Scope And Safety

- This MCP server reads existing Wayfinder history; it does not configure
  capture Hooks.
- It is read-only at the MCP tool interface and does not expose code restore.
- Tool results contain project prompts, replies, notes, and file metadata and
  are shared with the calling AI host.
- Do not connect confidential projects without user approval.
- Do not claim support for a named client until this exact installation has
  been observed in that client.

For capture adapters and the IDE sidebar, follow:
https://github.com/WBXWHT/wayfinder/blob/main/docs/INSTALL.md
