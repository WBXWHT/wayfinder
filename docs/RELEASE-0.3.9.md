# Wayfinder 0.3.9 Alpha

This patch release closes two navigation edge cases found during the final
adversarial review of the unified voyage experience.

## Fixes

- Clears the selected waypoint and bottom detail sheet whenever the active
  project changes, including keyboard-driven and automatic project switches.
- Keeps same-named Skill definitions from different folders as independent
  voyages by using their source paths as stable internal identities.
- Keeps a renamed Skill in its existing voyage when its source path has not
  changed.

## Release Safety

- Serializes production website deployments and blocks older versions or stale
  main commits from replacing the current site.
- Makes the public Windows smoke test read the website release manifest and
  verify the installer against `SHA256SUMS` before installation.

## Verification

- JavaScript and Chromium suite: 105 tests.
- Rust companion suite: 6 tests.
- Apple Silicon, Intel macOS, and Windows x64 assets verified against the
  published SHA-256 checksums.
