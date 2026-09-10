# Wayfinder

Most work with AI is scattered across one chat after another. Wayfinder records
the prompts, attempts, changes, evidence, decisions, and wrong turns locally,
then turns them into a branching voyage map you can revisit and reuse.

The macOS Companion captures workspace-backed Codex and Claude Code
conversations from their local session files, including plain chat as well as
coding work. The same experience model can organize writing, research, design,
and other work advanced through conversation.

**Early access, v0.3.3.** MIT licensed. No account, telemetry, or separate model
API key is required by Wayfinder.

[Website](https://wayfinder-ai.pages.dev) |
[Downloads](https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.3) |
[Install Guide](https://github.com/WBXWHT/wayfinder/blob/main/docs/INSTALL.md) |
[Privacy](https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md) |
[Publication Status](https://github.com/WBXWHT/wayfinder/blob/main/docs/PUBLISHING.md) |
[Report a Bug](https://github.com/WBXWHT/wayfinder/issues)

## Where It Lives

| Host | Primary Wayfinder surface |
| --- | --- |
| TraeCode / VS Code-compatible IDE | Activity-bar sidebar, with an optional wide in-IDE map |
| Claude Code / Codex inside a compatible IDE | The same Wayfinder sidebar |
| Claude Code / Codex on macOS | Wayfinder Companion, reading the same local voyage data |
| MCP Apps-capable clients | An interactive map inside the conversation |
| Claude Code / Codex terminal workflows | A text tree inside the terminal |

An external browser is never opened automatically. MCP Apps require a host
that supports them; installing a Claude Code plugin does not install anything
into Claude Web or Claude Desktop.

## Install

The Core and ordinary Claude/Codex Plugins need Git and Node.js 22.13+. The
macOS Companion DMG embeds the Node runtime, so Companion users only need Git.
See the [Install Guide](docs/INSTALL.md#macos-companion).

### macOS Companion

Download the macOS Alpha DMG for your Mac architecture from
[GitHub Releases](https://github.com/WBXWHT/wayfinder/releases). The current
zero-cost Alpha uses an ad-hoc signature, so macOS requires **Open Anyway** on
first launch. Open Wayfinder, then work normally in Claude Code or Codex. The
Companion watches their local session files in the background; both hosts write
into the same project map and remain visible as provenance rather than
splitting the voyage.

The Companion and complete voyage history stay local under `~/.wayfinder`.
It does not require Node.js or a separate Hook setup. See
[Companion architecture and release notes](docs/COMPANION.md).

### IDE Sidebar

Download [wayfinder-0.3.3.vsix](https://github.com/WBXWHT/wayfinder/releases/download/v0.3.3/wayfinder-0.3.3.vsix).
Choose **Extensions: Install from VSIX**, open the Wayfinder activity-bar icon,
then use **Connect AI Tool / 连接 AI 工具** to configure a project adapter.

The VSIX is self-distributed. A download link is not a claim of approval by the
VS Code, Open VSX, or TRAE marketplaces.

### Claude Code Plugin

In Claude Code:

```text
/plugin marketplace add WBXWHT/wayfinder
/plugin install wayfinder@wayfinder
```

### Codex Plugin

```bash
codex plugin marketplace add WBXWHT/wayfinder
```

Restart Codex if needed, open `/plugins`, select the Wayfinder marketplace,
and install Wayfinder. These are **self-hosted marketplaces**, not listings
in Anthropic's or OpenAI's curated directories.

### Agent Skill

```bash
npx skills add WBXWHT/wayfinder --skill wayfinder
```

The skill includes the Core CLI and requests approval before changing project
Hooks. It does not silently install the IDE extension or register an MCP
server. Capture adapters are for TraeCode, Claude Code, and Codex only;
other skill-compatible agents may inspect an existing map.

### Homebrew

```bash
brew install WBXWHT/tap/wayfinder
```

### Scoop

```powershell
scoop bucket add wayfinder https://github.com/WBXWHT/scoop-wayfinder
scoop install wayfinder
```

### npm-Compatible Tarball

```bash
npm install -g https://github.com/WBXWHT/wayfinder/releases/download/v0.3.3/wbxwht-wayfinder-0.3.3.tgz
wayfinder --version
```

This installs a public GitHub Release artifact using npm. It is **not**
an npm Registry listing; `npm install -g @wbxwht/wayfinder` is not yet available.

### Local MCP Bundle

Download [wayfinder-0.3.3.mcpb](https://github.com/WBXWHT/wayfinder/releases/download/v0.3.3/wayfinder-0.3.3.mcpb)
and install it through a desktop client's local MCP extension installer. Select
the project directory containing existing Wayfinder history. This is a local,
unsigned MCP bundle, not a Claude Desktop directory listing.

The same bundle is listed in the
[official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.WBXWHT/wayfinder)
as `io.github.WBXWHT/wayfinder`.
Automated installers can follow the conservative
[agent-readable installation guide](https://github.com/WBXWHT/wayfinder/blob/main/llms-install.md).

## Capture And Inspect

For a CLI installation, run from your project:

```bash
wayfinder install claude --root .
wayfinder doctor --root .
wayfinder map --root .
```

Use `trae` or `codex` instead of `claude` for those hosts. Choose `all` only
when you need all three adapters. Do not install project Hooks if an enabled
Wayfinder Plugin already supplies the same capture Hooks.

`doctor` checks project configuration, not host trust or Plugin activation.
After installation, complete one ordinary coding turn and check that a new
node appears. Map data is stored under `~/.wayfinder`.

Remove a project adapter with `wayfinder uninstall claude --root .`. Remove
Plugin-supplied Hooks using the host's Plugin manager. Uninstall does not
delete voyage history.

## Capabilities And Limits

- Capture prompts, tool actions, replies, file changes, and validation results.
- Collect new Codex and Claude Code transcript writes in the background without
  requiring a host connection screen.
- Separate task trees, inspect branches, and keep abandoned paths visible.
- Inspect diffs and restore snapshots in the IDE, with a safety snapshot first.
- Search current-project history; keep personal notes and explicit verdicts.
- Host adapters share one data format and one local Shadow Git store.
- Terminal output is a **text tree**, not an interactive TUI.
- The MCP map supports viewing, panning, zooming, and node previews. IDE-only
  restore/diff commands are not exposed through MCP.
- Claude/Codex adapters have process-level protocol tests; real authenticated
  client acceptance is still pending. Host versions and trust settings matter.
- The Companion and IDE wide map share the final voyage-map renderer. The MCP
  App remains a separate compact renderer for in-conversation use.

Wayfinder does not alter the project's Git index, commits, or branches.
Restores affect captured workspace files only, not databases, remote services,
package installations, or AI chat context.

Wayfinder has no telemetry or cloud backend. **MCP tool calls return project
content to the calling AI host**, whose privacy rules then apply. See
[PRIVACY.md](https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md)
before exposing confidential projects.

## Development

```bash
npm ci
npm run check
npm run release:build
npm run release:verify
```

Chromium UI checks run when a supported Chrome executable is available.
Release verification executes the packaged Core in an isolated project and
checks actual Hook processes, CLI install/uninstall, stdio MCP, and hashes.

See [THIRD_PARTY_NOTICES.md](https://github.com/WBXWHT/wayfinder/blob/main/THIRD_PARTY_NOTICES.md)
for acknowledgements.
Bundled third-party license texts accompany the release artifacts.
