# Wayfinder Companion

Wayfinder Companion is the macOS desktop surface for local Claude Code and
Codex work. It watches the hosts' local JSONL session files, stores normalized
turns under `~/.wayfinder`, and renders the complete visual voyage map.

The desktop application is the only supported Wayfinder product surface.
Extensions, host plugins, Skills, command-line packages, and MCP packages are
not distributed for new versions.

Users do not connect hosts or manage Hooks in the Companion UI. The bundled
collector runs once at launch and then reacts to transcript changes in the
background. It reads local session files rather than scraping another
application's interface.

## Download Website

The selected Cloudflare Pages address is:

https://wayfinder-ai.pages.dev

The original `wayfinder.pages.dev` address was already serving another
project when checked on 2026-09-09. The `wayfinder-ai` project name was selected
for the free Pages deployment. No purchased custom domain is required for
early access.

## Architecture

```text
Claude Code / Codex local JSONL transcripts
                   |
       filesystem watcher + bundled collector
                   |
         ~/.wayfinder/projects/*
                   |
      Tauri Companion + final voyage map
```

- One project has one map, regardless of which supported AI host produced a
  turn.
- Host identity remains provenance on every turn and waypoint.
- Related turns may share a topic or waypoint; raw turns are never collapsed
  or overwritten.
- A recursive filesystem watcher coalesces transcript writes for two seconds,
  runs an incremental collection pass, and records per-file progress in
  `~/.wayfinder/collector-state.json`.
- The Companion refreshes the selected map when its project data changes.
- The project sidebar follows the established session-viewer pattern: projects
  are always scannable on wide screens and move into a drawer on narrow
  screens.
- The Companion builds directly from `ExperienceMapPanel`; it does not maintain
  a second simplified map.
- Collected turns show their Codex or Claude Code source in the detail panel.
- File-change summaries are reconstructed only from recorded edit operations
  such as `apply_patch`, `Write`, `Edit`, and `MultiEdit`. Wayfinder does not
  fabricate a historical Diff when the transcript lacks file content.
- Local rules mark only evidence-backed failure candidates or conflicts. Cloud
  model analysis remains disabled.

## Map Hierarchy

Wayfinder keeps three separate concepts:

1. **Project map**: one exact normalized working directory (`cwd/root`) becomes
   one item in the project sidebar and one map under `~/.wayfinder/projects`.
2. **Voyage**: related goals within that project are grouped by structural,
   file, topic, and time signals. A new unrelated goal starts another voyage
   from the same port.
3. **Waypoint**: one or more adjacent turns pursuing the same sub-goal become a
   waypoint on that voyage.

Codex and Claude Code are provenance, not map boundaries. Work from both tools
can appear in the same project map and voyage. Wayfinder does not merge two
different working directories merely because their text looks similar; doing
so would invent a relationship without reliable project evidence.

The horizontal renderer reserves fixed geometry for every waypoint card. Cards
are native SVG so WebKit and Chromium render the same structure. The current
boat overlays a waypoint marker and never replaces its card. The coastline is
overscanned beyond the navigable vertical range, and branch spacing moves whole
subtrees rather than individual cards. Branches leave their parent directly as
long cubic curves, with enough vertical pitch to produce a visibly open fan.

Trackpad interaction mirrors the final narrow-map behavior:

- a two-finger swipe pans the map without changing scale;
- a pinch zooms around the gesture center with the higher-sensitivity factor
  used by the validated narrow map;
- mouse press-and-drag is disabled, so panning does not require a long press;
- the coast is the left world boundary: users can pan back to it but never
  reveal empty space behind it, while movement into the map remains unbounded;
- the initial fit preserves a readable scale floor, while users can pinch out
  to the `0.4` overview scale.

## Privacy And Cloud Analysis Boundary

Complete conversations, workspace roots, snapshots, and source files remain
local. Cloud analysis is not enabled until a service endpoint and an explicit
consent flow are implemented.

The Core currently prepares a minimal versioned request:

- only locally evidenced failures are included;
- topic identifiers are irreversibly hashed;
- raw conversations, prompts, error output, paths, and source code are excluded;
- only structured diagnostics such as failure kind, category, exit code, file
  extension, source host, and local state are retained;
- every returned conclusion must cite evidence IDs present in the request.

The model may classify an evidence-backed candidate as failed,
context-limited, superseded, conflicting, or unresolved. It cannot mark an
uncited conclusion as fact, and conflict/superseded results must match the
local state evidence.

## Local Development

The web bundle can be built without Rust:

```bash
npm run build:companion:web
```

A complete local build requires Rust and the existing Node-based SEA sidecar:

```bash
npm run companion:build
```

Generated files live under `companion/dist`,
`companion/src-tauri/binaries`, and `companion/src-tauri/target`.

## Signed macOS Release

The repository uses Tauri's official GitHub Action and Tauri's built-in
Developer ID signing and notarization flow. A `companion-v*` tag or manual
dispatch runs `.github/workflows/release-macos-companion.yml` for Apple Silicon
and Intel macOS. A prepare job validates every application version declaration
and creates one draft GitHub Release; both architecture builds upload only to
that release.

Configure these GitHub Actions secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | Full Developer ID Application identity |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID |
| `APPLE_API_KEY` | App Store Connect API key ID |
| `APPLE_API_PRIVATE_KEY` | Raw contents of the matching `.p8` key |

The release remains a draft until the downloaded DMG passes:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Wayfinder.app
spctl --assess --type execute --verbose=2 /Applications/Wayfinder.app
xcrun stapler validate /Applications/Wayfinder.app
```

Apple Developer membership and valid signing credentials are external
requirements. They cannot be generated or committed by the project.

## Zero-Cost Alpha Release

Until Apple Developer membership is justified, use
`.github/workflows/release-macos-alpha.yml`. It creates Apple Silicon and Intel
DMGs with ad-hoc signatures, marks the GitHub Release as a prerelease, and
states the required macOS **Open Anyway** step. It does not claim notarization.

## Sources

- [Tauri macOS code signing](https://tauri.app/distribute/sign/macos/)
- [Tauri GitHub Actions pipeline](https://tauri.app/distribute/pipelines/github/)
- [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action)
- [Apple Developer ID](https://developer.apple.com/developer-id/)
