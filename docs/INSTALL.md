# Install Wayfinder

Version: **0.3.4 early access**.

Wayfinder is distributed only as a macOS desktop application:

https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.4

## Choose Your Mac

- `Wayfinder-Alpha-<version>-macOS-aarch64.dmg`: Apple Silicon.
- `Wayfinder-Alpha-<version>-macOS-x86_64.dmg`: Intel.

Download the matching DMG, move Wayfinder to Applications, and open it.

The current zero-cost Alpha is ad-hoc signed rather than Apple-notarized. On
first launch, open **System Settings → Privacy & Security** and choose
**Open Anyway**.

## Start Recording

Keep Wayfinder running, then continue working normally in Codex or Claude Code.
No extension, plugin, MCP server, terminal command, Node installation, or host
connection screen is required.

Wayfinder watches supported local JSONL session files and updates the matching
project map in the background. Workspace-backed plain chat and coding turns can
both be collected. Codex and Claude Code activity from the same project appears
in one map while retaining its source.

## Local Requirements

- macOS 12 or newer.
- Git, used by the current local snapshot backend.

The app embeds its own runtime. Users do not install Node.js.

## Data And Removal

Wayfinder stores its data under `~/.wayfinder`. Removing the application does
not automatically delete this history.

To erase all Wayfinder data, quit the app and delete `~/.wayfinder`. This
permanently removes recorded history and restore points.

Read [PRIVACY.md](../PRIVACY.md) before deleting or sharing local data.

## Legacy Packages

Earlier VSIX, Claude/Codex plugin, Agent Skill, CLI, Homebrew, Scoop, and MCP
artifacts remain attached to historical releases for reproducibility. They are
not current installation paths and receive no new releases.
