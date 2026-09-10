# Wayfinder 0.3.5 Alpha

This release brings Wayfinder to Windows and makes the voyage map faster,
clearer, and easier to navigate.

Status: published as `alpha-v0.3.5` with Apple Silicon, Intel macOS, and
Windows x64 installers.

## Highlights

- Native Windows x64 desktop installer alongside Apple Silicon and Intel macOS
  builds.
- Smooth two-finger panning with frame-batched viewport updates.
- Stable return to the coastline after exploring deeper parts of a map.
- Richer waypoint cards with titles, summaries, source details, and file size.
- A quieter desktop toolbar with clearer search and full-map controls.
- Wayfinder branding and voyage-map icons throughout the desktop app.
- A refined download site built around the same coastline and route language.

## Verification

The release pipeline verified:

- the Node test suite;
- the Rust companion test suite;
- Chromium desktop and 320px rendering;
- real macOS WKWebView panning, reverse-panning, cards, and inspector behavior;
- the Windows x64 build on a native GitHub Actions runner;
- both macOS DMGs, the Windows NSIS installer, and their checksums.
