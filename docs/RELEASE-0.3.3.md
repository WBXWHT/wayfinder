# Wayfinder 0.3.3: Readable Sidebar

> **Historical plugin/CLI release.** These packages are retained for
> reproducibility and are not supported installation paths. Wayfinder is now
> distributed only as a macOS and Windows desktop application. Download the
> current release from
> [Wayfinder 0.3.9 Alpha](https://github.com/StayCurious-Xuan/wayfinder/releases/tag/alpha-v0.3.9).

AI work is usually scattered across one chat after another. When the chat ends,
the reasoning, failed attempts, and useful decisions are easy to lose.
Wayfinder records that process locally and turns it into a voyage map that can
be revisited, restored, and reused.

This release restores the readable sidebar scale from the final pre-rename
build while preserving the multi-host distribution added in 0.3.1.

## What Changed

- Preserves a measured minimum sidebar scale of `0.7935`, keeping 128px design
  cards at about 101.6 rendered pixels instead of shrinking them into labels
  that are difficult to read.
- Packs same-depth branches into aligned columns while retaining a 14px
  design-space gap between cards.
- Keeps routes, waypoints, cards, and descendants aligned when compacting the
  tree; cards are never moved independently.
- Restores the full-height ocean treatment in tall sidebars.
- Keeps the recording summary on one line and moves secondary title-bar
  commands into the overflow menu.
- Removes native hover text from disabled voyage buttons so it cannot cover the
  map.

## Downloads

- `wayfinder-0.3.3.vsix`: TraeCode / VS Code-compatible sidebar extension.
- `wayfinder-plugin-0.3.3.zip`: Claude/Codex Plugin bundle.
- `wayfinder-skill-0.3.3.zip`: Agent Skill with the bundled Core CLI.
- `wayfinder-core-0.3.3.tar.gz` / `.zip`: standalone Core.
- `wbxwht-wayfinder-0.3.3.tgz`: npm-compatible GitHub release tarball.
- `wayfinder-0.3.3.mcpb`: local desktop MCP bundle.
- `server.json`, `SHA256SUMS`, and `artifacts.json`: registry metadata and
  integrity records.

Install guide: https://github.com/StayCurious-Xuan/wayfinder#install

## Verification

The release passes 50 automated tests, including Chromium checks at 220px and
320px sidebar widths. The packaged Core verification covers three real Hook
process sequences, CLI install/uninstall, shared timeline reading, stdio MCP
tool/resource calls, and artifact hashes.

## Early-Access Limits

- Claude/Codex authenticated client acceptance still depends on host version,
  plugin trust, and user configuration.
- The MCP interface is read-only; restore and native diffs remain IDE-only.
- Self-hosted Claude/Codex marketplaces are not curated directory approvals.
- VSIX and MCPB assets are unsigned.
- Wayfinder has no telemetry or cloud backend. MCP calls expose selected
  project content to the calling AI host under that host's privacy terms.
