# Wayfinder 0.3.12 Alpha

This release closes cross-platform collection, lifecycle, compatibility, and
distribution gaps found by a full repository review and adversarial recheck.

## Highlights

- Dispatches installed Claude Code and Codex hooks through the bundled
  companion runtime with no external Node.js dependency.
- Preserves repeated turns and upgrades partial rollover records using stable
  host turn identities instead of prompt-text guesses.
- Rejects failed tool output before deriving file facts, and merges Hook and
  transcript evidence without duplicate voyage nodes.
- Handles transcript replacement, truncation, case-only renames, Windows file
  sharing errors, and host configuration rollback.
- Keeps final successful outcomes out of failure analysis and bounds
  long-history voyage parent lookup without dropping the structural-semantic
  optimum.
- Restores macOS 12 WebKit fallbacks, visible keyboard focus, narrow-window
  actions, search framing, and stale project-request behavior.
- Requires successful CI and latest-main release refs, validates release
  checksums, and installs the Windows NSIS package to verify its x64 sidecar.

## Verification

- JavaScript and Chromium suite: 186 tests.
- Rust companion suite: 9 tests.
- ESLint, TypeScript, Clippy, npm audit, and cargo audit passed.
- Browser checks cover 220px, 320px, short landscape, and desktop viewports.
- Release gates build Apple Silicon, Intel macOS, and Windows x64 artifacts.
