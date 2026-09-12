# Publication Status

Public release: **0.3.13 early access**. Status reviewed 2026-09-12.

## Current Product

Wayfinder is distributed as a desktop application for macOS and Windows.

| Channel | Public entry | Status |
| --- | --- | --- |
| Official website | https://wayfinder-ai.pages.dev | Live download site |
| Desktop app | https://github.com/StayCurious-Xuan/wayfinder/releases/tag/alpha-v0.3.13 | Apple Silicon and Intel DMGs plus Windows x64 NSIS installer |
| Source | https://github.com/StayCurious-Xuan/wayfinder | Public repository and CI |
| Product Hunt | https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6 | Public listing updated to the macOS and Windows desktop positioning |
| Issues | https://github.com/StayCurious-Xuan/wayfinder/issues | Public support channel |
| Privacy | https://github.com/StayCurious-Xuan/wayfinder/blob/main/PRIVACY.md | Local-data policy |

Public screenshots must use synthetic demo data rather than a real
`~/.wayfinder` workspace. The current reusable assets live under
`docs/assets/public/` and are at least 2560 pixels wide.

The website, README, install guide, and future release notes must first explain
Wayfinder's value across AI-assisted conversations, research, writing, design,
coding, and other project work. The current early-access flow is then:
install Wayfinder, continue working in Codex or Claude Code, and inspect the
resulting visual voyage map in the app.

Public positioning must describe Wayfinder as an AI collaboration history
product for coding, research, writing, design, and other project work. Codex
and Claude Code are the current early-access collection adapters, not the
boundary of the product category.

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
The five open GitHub submissions owned by StayCurious-Xuan for plugins, Skills,
workflows, and MCP directories were closed as withdrawn on the same date.

## Release Process

1. Update `package.json`, `src/version.ts`,
   `companion/src-tauri/Cargo.toml`, and
   `companion/src-tauri/tauri.conf.json` together.
2. Run `npm ci`, `npm run check`, and `npm run companion:prepare`.
3. Run the Rust test suite.
4. Push the source commit and confirm the main CI workflow passes.
5. Run `.github/workflows/release-macos-alpha.yml` for the zero-cost
   cross-platform Alpha. The signed
   `.github/workflows/release-macos-companion.yml` workflow builds only the two
   macOS artifacts and is not a complete website release until a matching
   Windows installer has also been produced.
6. Verify both architecture DMGs, the Windows x64 installer, and
   `SHA256SUMS`, then publish the draft GitHub Release.
7. Update `website/releases.json` only after all three download URLs return
   successfully.
8. Deploy `.github/workflows/deploy-website.yml` and verify the public site.

Never overwrite an existing published asset. Publish a new version so recorded
hashes and user downloads remain reproducible.

External showcase and package-catalog submissions are tracked in
[RECOGNITION.md](RECOGNITION.md). Pending submissions must not be described as
awards or accepted listings.

## GitHub Identity

The project owner is `StayCurious-Xuan`; `WBXWHT` is the retired username.
GitHub redirects old repository URLs, but it does not redirect the old profile
URL or GitHub Pages sites. Keep public links on the current username. The Tauri
bundle identifier `io.github.WBXWHT.wayfinder` remains unchanged because it is
an installed-application identity, not a public profile link.
