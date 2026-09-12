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

## Downloads

- macOS Apple Silicon: `Wayfinder-Alpha-0.3.14-macOS-aarch64.dmg`
- macOS Intel: `Wayfinder-Alpha-0.3.14-macOS-x86_64.dmg`
- Windows x64: `Wayfinder-Alpha-0.3.14-Windows-x86_64.exe`
- Integrity manifest: `SHA256SUMS`

## Verification

- 210 JavaScript and Chromium checks.
- 10 Rust checks, plus Clippy and dependency audits.
- Packaged SEA collection with no system Git or Node.js on `PATH`.
- Native Apple Silicon, Intel macOS, and Windows x64 release builds.

The macOS builds are ad-hoc signed and are not Apple-notarized. The Windows
build is not code-signed. See the installation guide for first-launch steps.
