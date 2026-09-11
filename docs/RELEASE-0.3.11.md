# Wayfinder 0.3.11 Alpha

This release hardens local collection, voyage grouping, desktop lifecycle, and
short-window map behavior.

## Highlights

- Preserves Codex commentary until the final answer so later tool and file
  evidence is not lost during incremental collection.
- Normalizes macOS path aliases, rejects project-external paths, and keeps
  rename, delete, and round-trip file identities truthful.
- Improves cross-tool handoffs, source/test matching, deterministic ordering,
  and long-history parent lookup without an arbitrary candidate cutoff.
- Prevents stale project reads from replacing the last successfully loaded map.
- Uses stable lock identities, rechecks stale locks before reclaiming them, and
  terminates the complete collector process group on timeout or shutdown.
- Keeps short landscape maps vertically framed and restores the exact viewport
  after the right-side inspector closes.
- Adds macOS and Windows CI coverage plus public-site security headers.

## Verification

- JavaScript and Chromium suite: 160 tests.
- Rust companion suite: 9 tests.
- ESLint, TypeScript, Clippy, npm audit, and cargo audit passed.
- Browser checks cover 320x568, 812x375, 1080x720, and 1440x900.
- Clean macOS and Windows builds are verified by GitHub Actions before release.
