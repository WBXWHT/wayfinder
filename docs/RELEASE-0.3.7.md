# Wayfinder 0.3.7 Alpha (Unreleased)

This cross-platform release carries the 0.3.6 voyage-map and collector
improvements to macOS and Windows.

Status: release-candidate validation. The current public macOS release remains
`alpha-v0.3.6`; the public Windows build remains `alpha-v0.3.5` until all
0.3.7 assets pass their native runners.

## Highlights

- Restores Windows x64 as a first-class supported desktop target.
- Preserves the 0.3.6 interaction, accessibility, collection, and release
  hardening.
- Builds the Windows Node SEA sidecar and Tauri NSIS installer on a native
  Windows runner.
- Publishes both macOS DMGs, the Windows installer, and `SHA256SUMS` as one
  verified release-asset set.
- Keeps the public website on the last complete release until every required
  asset exists.

## Release Gate

Before publication, verify:

- the complete Node and Rust test suites;
- Chromium desktop, 220px and 320px portrait, and short landscape rendering;
- both Apple Silicon and Intel macOS DMGs;
- the Windows x64 NSIS installer on a native Windows runner;
- all three installers and `SHA256SUMS` in the draft release;
- the live download URLs before updating `website/releases.json`.
