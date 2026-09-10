# Wayfinder Project Guide

## Product

Wayfinder is a standalone macOS application that turns local Codex and Claude
Code sessions into one visual voyage map. The complete history stays under
`~/.wayfinder`.

## Stack And Commands

- TypeScript/Node.js core and D3/SVG map renderer.
- Tauri/Rust desktop shell with a bundled Node SEA sidecar.
- Install: `npm ci`
- Full checks: `npm run check`
- Prepare desktop assets: `npm run companion:prepare`
- Rust tests: `cargo test --manifest-path companion/src-tauri/Cargo.toml`
- Version gate: `node scripts/verify-companion-version.cjs --prefix alpha-v`

## Structure

- `src/sessionCollector.ts`: local Codex/Claude JSONL collection and edit replay.
- `src/forestMapPanel.ts`: voyage-map rendering and interaction.
- `companion/`: desktop shell and generated web surface.
- `website/`: static download site; public downloads come from
  `website/releases.json`.
- `docs/`: product, install, privacy, release, and publication contracts.

## Rules

- The desktop app is the only supported product surface.
- Do not advertise VSIX, plugins, Skills, CLI packages, Homebrew, Scoop, or MCP
  packages as current installation paths.
- Do not fabricate historical diffs or send raw conversations/source files to
  a cloud service.
- Keep `package.json`, `package-lock.json`, `src/version.ts`, Cargo metadata,
  and Tauri config versions synchronized.
- Do not update `website/releases.json` until both public DMGs exist.
- Do not edit generated `out/`, `companion/dist/`, binaries, or `target/`.

## Current State

- Public/live release: `0.3.4` early access.
- Local source version: `0.3.5`, not yet released.
- Next step: finish local verification, commit and push `0.3.5`, publish both
  architecture DMGs, then update and deploy `website/releases.json`.
