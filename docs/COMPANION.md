# Wayfinder Companion

Wayfinder Companion is the macOS desktop surface for local Claude Code and
Codex voyages. The host adapters capture new activity, the Core stores it under
`~/.wayfinder`, and the Companion reads that local state to render the existing
voyage map.

The Companion does not import conversations created before Wayfinder was
connected. It does not scrape another application's UI or private database.

## Download Website

The selected Cloudflare Pages address is:

https://wayfinder-ai.pages.dev

The original `wayfinder.pages.dev` address was already serving another
project when checked on 2026-09-09. The `wayfinder-ai` project name was selected
for the free Pages deployment. No purchased custom domain is required for
early access.

## Architecture

```text
Claude Code / Codex lifecycle Hooks
                |
        bundled Wayfinder sidecar
                |
      ~/.wayfinder/projects/*
                |
       Tauri Companion WebView
```

- One project has one map, regardless of which supported AI host produced a
  turn.
- Host identity remains provenance on every turn and waypoint.
- Related turns may share a topic or waypoint; raw turns are never collapsed
  or overwritten.
- The Companion polls local project metadata and refreshes the selected map
  when its `updatedAt` value changes.
- Connecting a host adds Wayfinder's global Hooks incrementally. Existing Hook
  configuration is preserved.
- Claude Code and current Codex releases open the installed Companion when
  they emit `SessionEnd`. Turn capture remains silent while the session is
  active.
- Local rules mark only evidence-backed failure candidates or conflicts. Cloud
  model analysis remains disabled.

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
that release. The separate tag namespace avoids colliding with the existing
Core, Plugin, VSIX, and MCP release channel.

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
