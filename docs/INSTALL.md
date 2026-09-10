# Install Wayfinder

Version: **0.3.3 early access**.

- Companion Alpha:
  https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.3
- Core, Plugin, VSIX, and MCP assets:
  https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.3

## Choose One Capture Installation

| You use | Install | Then open |
| --- | --- | --- |
| TraeCode | VSIX, then connect the TraeCode adapter | Wayfinder sidebar |
| Claude/Codex in VS Code | VSIX plus either project Hooks or the host Plugin | Wayfinder sidebar |
| Claude Code on macOS | Wayfinder Companion | Companion voyage map |
| Codex on macOS | Wayfinder Companion | Companion voyage map |
| Claude Code / Codex without Companion | Host Plugin, or Core plus project Hooks | `wayfinder map` |
| Claude Desktop / another MCP Apps host | Local `.mcpb` or a stdio MCP server configuration | `wayfinder_show_map` |

The MCP bundle reads existing history. It does not capture Claude Web/Desktop
chat history. Claude Web cannot directly start this local stdio server. Remote
hosting/tunneling is not included.

## macOS Companion

Download the DMG matching your Mac from the GitHub Release:

- `Wayfinder-Alpha-<version>-macOS-aarch64.dmg` for Apple Silicon.
- `Wayfinder-Alpha-<version>-macOS-x86_64.dmg` for Intel.

Move Wayfinder to Applications and open it. No host connection screen is
required. Continue working in Codex or Claude Code; the Companion watches their
local JSONL session files and updates the matching project map in the
background.

The zero-cost Alpha is ad-hoc signed rather than Apple-notarized. On first
launch, open **System Settings → Privacy & Security** and choose
**Open Anyway**. This step disappears from future Developer ID releases.

Workspace-backed conversations are captured automatically, including plain
chat and coding turns. Codex and Claude turns from the same project feed one
voyage map and retain their source labels. File-change summaries are shown only
when recorded edit operations provide real change data.

The release DMGs embed the Wayfinder runtime, so users do not install Node.js
or download another component on first run. Git remains required by the current
snapshot backend.

## Local Plugin Archives

`wayfinder-plugin-0.3.3.zip` contains `wayfinder/` with Claude and Codex manifests,
bundled Hooks, MCP, and a Skill. Keep the whole directory together. This plugin
channel requires Node.js; use the macOS Companion for the no-Node installation.

For local Claude Code development:

```bash
claude --plugin-dir /absolute/path/to/wayfinder
```

For distribution, add `WBXWHT/wayfinder` as the marketplace and install
`wayfinder@wayfinder` in Claude Code. Codex uses its `/plugins` picker after
`codex plugin marketplace add WBXWHT/wayfinder`.

## Standalone Core

Install the release tarball using npm, or extract `wayfinder-core-0.3.3.tar.gz`.
The Core includes its dependencies; Node.js 22.13+ and Git must be installed.

```bash
node /absolute/path/to/wayfinder/bin/wayfinder-cli.cjs --version
node /absolute/path/to/wayfinder/bin/wayfinder-cli.cjs install codex --root /absolute/project
node /absolute/path/to/wayfinder/bin/wayfinder-cli.cjs doctor --root /absolute/project
node /absolute/path/to/wayfinder/bin/wayfinder-cli.cjs map --root /absolute/project
```

Do not move or delete the Core directory while project Hooks point to it.
Reconnect after moving/upgrading it. Running `install` repeatedly is idempotent.

## MCP Server Configuration

For clients that use `mcpServers` JSON, merge an entry like this into the
client's existing settings, using the actual Core and project directories:

```json
{
  "mcpServers": {
    "wayfinder": {
      "command": "node",
      "args": ["/absolute/path/to/wayfinder/bin/wayfinder-mcp.cjs"],
      "env": {
        "WAYFINDER_PROJECT_DIR": "/absolute/project"
      }
    }
  }
}
```

This is a template, not a command to overwrite existing settings.
Restart/reload MCP in the client, then call `wayfinder_show_map`. Supporting
hosts render the `ui://wayfinder/map` resource; other hosts receive text and
structured data. The tool accepts an optional `root` to override the default.

## Checksums

Release `SHA256SUMS` lists all asset hashes. After downloading the assets and
checksum file into the same directory:

```bash
shasum -a 256 -c SHA256SUMS
```

Only check entries for assets you downloaded. A missing file is an error, not
a checksum match. On Windows, `Get-FileHash -Algorithm SHA256 <file>` prints
the corresponding checksum.

## Removing It

Remove project Hooks before uninstalling the Core:

```bash
wayfinder uninstall codex --root /absolute/project
```

Use the host's Plugin manager for a Plugin installation. Uninstall the VSIX
from the IDE's Extensions view. All these actions leave `~/.wayfinder` history
intact. Read [the privacy note](../PRIVACY.md) before deleting history.
