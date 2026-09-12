# Wayfinder 0.3.14 Alpha

This release removes the last external runtime requirement from the desktop
collection path and tightens evidence, performance, and release safeguards.

## Highlights

- Runs desktop collection without a system Node.js or Git installation.
- Rejects textual nonzero tool exit codes before recording file-change facts.
- Skips transcript-content hashing when file metadata and Cowork context are
  unchanged.
- Keeps the visible project selected until a requested project finishes
  loading.
- Recovers interrupted Hook configuration updates on the next install attempt.
- Fails CI when the Chromium UI regression suite cannot run.

## Release Gates

- JavaScript, Chromium, Rust, Clippy, and dependency checks must pass.
- Native Apple Silicon, Intel macOS, and Windows x64 builds must pass.
- Published installers and `SHA256SUMS` must agree before the website changes.
