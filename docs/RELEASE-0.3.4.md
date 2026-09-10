# Wayfinder 0.3.4 Alpha

Wayfinder is now a desktop-only product. Install one macOS application, keep
working in Codex or Claude Code, and review both tools in one visual voyage map.

## Highlights

- Automatically collects local Codex and Claude Code JSONL sessions.
- Watches for new turns in the background without host plugins or Hooks.
- Reuses the final voyage-map renderer in the desktop application.
- Replaces the project dropdown with a scannable project sidebar and mobile
  drawer.
- Labels automatically collected turns with their Codex or Claude Code source.
- Reconstructs real file-change summaries from recorded edit operations instead
  of showing empty or fabricated diffs.
- Removes VSIX, host plugin, Agent Skill, CLI package, Homebrew, Scoop, and MCP
  as supported distribution surfaces.

## Downloads

- Apple Silicon: `Wayfinder-Alpha-0.3.4-macOS-aarch64.dmg`
- Intel: `Wayfinder-Alpha-0.3.4-macOS-x86_64.dmg`
- Checksums: `SHA256SUMS`

This zero-cost Alpha is ad-hoc signed and is not Apple-notarized. On first
launch, macOS may require **System Settings → Privacy & Security → Open
Anyway**.

All Wayfinder history remains under `~/.wayfinder`.
