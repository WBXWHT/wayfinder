# Wayfinder

Wayfinder is a local desktop app for macOS and Windows that turns work from
Codex and Claude Code into one visual voyage map. It preserves prompts,
responses, tool activity, file changes, branches, failures, and decisions so
the path behind a result remains reviewable.

**Current public release: v0.3.7 early access.** MIT licensed. Your complete
history stays on your computer.

[Website](https://wayfinder-ai.pages.dev) |
[Desktop Downloads](https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.7) |
[Install Guide](https://github.com/WBXWHT/wayfinder/blob/main/docs/INSTALL.md) |
[Privacy](https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md) |
[Report a Bug](https://github.com/WBXWHT/wayfinder/issues)

![Wayfinder voyage map](docs/assets/wayfinder-product-hunt-map.png)

## How It Works

1. Install and open Wayfinder.
2. Continue working normally in Codex or Claude Code.
3. Wayfinder updates the matching project in the background.
4. Open Wayfinder to browse the complete visual voyage map.

Codex and Claude Code activity from the same project appears in one map. Each
turn retains its source, and related work may join the same voyage without
overwriting raw history.

## Product Surface

Wayfinder is a standalone desktop application for macOS and Windows.

## Local Data

Wayfinder stores normalized history, collection cursors, and snapshots under
`~/.wayfinder`. The app has no analytics, advertising, account service, or
Wayfinder cloud backend.

File-change summaries are reconstructed only when the source transcript
contains real edit operations such as `apply_patch`, `Write`, `Edit`, or
`MultiEdit`. Wayfinder does not fabricate historical diffs.

Read [PRIVACY.md](https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md)
before using confidential projects.

## Development

```bash
npm ci
npm run check
npm run companion:prepare
```

A complete application build additionally requires Rust:

```bash
npm run companion:build
```

Chromium tests cover the final voyage-map renderer, project navigation,
search, detail inspection, and 320px responsive behavior.
