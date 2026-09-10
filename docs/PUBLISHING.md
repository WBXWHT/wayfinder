# Publication Status

Public release: **0.3.5 early access**. Product model updated 2026-09-11.

## Current Product

Wayfinder is distributed as a desktop application for macOS and Windows.

| Channel | Public entry | Status |
| --- | --- | --- |
| Official website | https://wayfinder-ai.pages.dev | Live download site |
| Desktop app | https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.5 | Apple Silicon and Intel DMGs plus Windows x64 NSIS installer |
| Source | https://github.com/WBXWHT/wayfinder | Public repository and CI |
| Product Hunt | https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6 | Public listing updated to the desktop-only positioning |
| Issues | https://github.com/WBXWHT/wayfinder/issues | Public support channel |
| Privacy | https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md | Local-data policy |

The website, README, install guide, and future release notes must present one
path: install Wayfinder, continue working in Codex or Claude Code, and inspect
the resulting visual voyage map in the app.

## Retired Distribution Surfaces

The following formats were published for earlier releases but are no longer
supported product surfaces:

- TraeCode and VS Code VSIX;
- Claude Code and Codex plugins;
- Agent Skill;
- standalone CLI and npm-compatible tarball;
- Homebrew Tap and Scoop Bucket;
- MCP bundle and MCP directory listings.

Historical release assets remain available for reproducibility. They must not
be updated, relabeled as current, or linked as recommended installation paths.
The self-hosted Homebrew and Scoop repositories were archived on 2026-09-10.
The five open GitHub submissions owned by WBXWHT for plugins, Skills,
workflows, and MCP directories were closed as withdrawn on the same date.

## Release Process

1. Update `package.json`, `src/version.ts`,
   `companion/src-tauri/Cargo.toml`, and
   `companion/src-tauri/tauri.conf.json` together.
2. Run `npm ci`, `npm run check`, and `npm run companion:prepare`.
3. Run the Rust test suite.
4. Push the source commit and confirm the main CI workflow passes.
5. Run `.github/workflows/release-macos-alpha.yml` for the zero-cost desktop
   Alpha, or
   `.github/workflows/release-macos-companion.yml` when signing credentials are
   available for a macOS-only signed release.
6. Verify both architecture DMGs, the Windows x64 installer, and
   `SHA256SUMS`, then publish the draft GitHub Release.
7. Update `website/releases.json` only after all three download URLs return
   successfully.
8. Deploy `.github/workflows/deploy-website.yml` and verify the public site.

Never overwrite an existing published asset. Publish a new version so recorded
hashes and user downloads remain reproducible.
