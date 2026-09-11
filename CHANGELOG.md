# Changelog

Notable public changes to Wayfinder are recorded here. Release notes describe
user-visible behavior; implementation detail remains in the linked commits.

## [0.3.11] - 2026-09-12

### Fixed

- Preserved Codex commentary and subsequent tool evidence in one turn.
- Hardened cross-platform path, rename, lock, process-tree, and state writes.
- Made voyage grouping deterministic and bounded for long project histories.
- Prevented stale project reads and short-window layout changes from replacing
  the current map or viewport.

### Verification

- 160 JavaScript and Chromium checks.
- 9 Rust checks, plus Clippy, npm audit, and cargo audit.
- Apple Silicon, Intel macOS, and Windows x64 release builds.

## [0.3.10] - 2026-09-11

### Added

- Windows x64 installer alongside Apple Silicon and Intel macOS builds.
- Responsive waypoint inspector that stays outside the selected route.
- Project-level voyage layout with clearer spacing between independent paths.

### Changed

- Waypoint details now follow the selected route color and scroll as one panel.
- Opening and closing details preserves the map viewport and selected waypoint.
- Public website and release materials now present all supported platforms
  equally.

### Fixed

- Prevented background refreshes and stale gesture queues from resetting or
  blocking map navigation.
- Restored imported Skill titles, summaries, source files, and line counts.

### Verification

- 105 JavaScript and Chromium checks.
- 6 Rust checks.
- Desktop, 320px portrait, and short-screen landscape visual checks.
- Published installers verified against `SHA256SUMS`.

[0.3.10]: https://github.com/StayCurious-Xuan/wayfinder/releases/tag/alpha-v0.3.10
[0.3.11]: https://github.com/StayCurious-Xuan/wayfinder/releases/tag/alpha-v0.3.11
