# Wayfinder 0.3.1: Early Access

> **Historical plugin/CLI release.** These packages are retained for
> reproducibility and are not supported installation paths. Wayfinder is now
> distributed only as a macOS and Windows desktop application. Download the
> current release from
> [Wayfinder 0.3.8 Alpha](https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.8).

A local voyage map for AI coding sessions, with an IDE sidebar, Claude/Codex
capture adapters, an Agent Skill, an in-conversation MCP App, and a terminal
text tree. The primary experience stays inside the host.

## Downloads

- `wayfinder-0.3.1.vsix`: TraeCode / VS Code-compatible sidebar extension.
- `wayfinder-plugin-0.3.1.zip`: Claude/Codex Plugin, with its dependencies.
- `wayfinder-skill-0.3.1.zip`: Agent Skill and bundled Core CLI.
- `wayfinder-core-0.3.1.tar.gz` / `.zip`: standalone Core for Node.js 22.13+.
- `wbxwht-wayfinder-0.3.1.tgz`: npm-installable tarball, hosted on GitHub.
- `wayfinder-0.3.1.mcpb`: local desktop MCP bundle; choose a project on install.
- `server.json`: official MCP Registry submission metadata.
- `SHA256SUMS` and `artifacts.json`: integrity and artifact inventory.

Install guides: https://github.com/WBXWHT/wayfinder#install

## Verification

49 automated tests pass locally, including actual Chromium map interactions.
The packaged Core was independently unpacked and tested with three real Hook
process sequences, CLI install/uninstall, shared timeline reading, and stdio
MCP tool/resource calls. The MCP bundle passes the official manifest validator.

## Early-Access Limits

- Claude/Codex authenticated client acceptance is pending; protocol tests are
  not a substitute for testing every host version.
- Terminal output is a text tree, not a full interactive TUI.
- The MCP interface is read-only. Restore and native diffs remain IDE-only.
- MCP Apps depend on client support. Claude Web cannot start a local stdio
  server; this release does not ship remote hosting.
- Self-hosted Plugin marketplaces are not curated directory approvals.
- VSIX and MCPB assets are unsigned. Review the source and checksums.

No telemetry or Wayfinder cloud backend is included. MCP calls expose selected
project content to the calling AI host. Read
https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md before connecting
confidential projects.
