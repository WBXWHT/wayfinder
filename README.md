# Wayfinder

Wayfinder is a local macOS app that turns work from Codex and Claude Code into
one visual voyage map. It preserves prompts, responses, tool activity, file
changes, branches, failures, and decisions so the path behind a result remains
reviewable.

**Current public release: v0.3.5 early access.** The next source version is
v0.3.6, which is not yet published. MIT licensed. Your complete history stays
on your Mac.

[Website](https://wayfinder-ai.pages.dev) |
[macOS Download](https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.5) |
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

Wayfinder is a standalone macOS application.

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
