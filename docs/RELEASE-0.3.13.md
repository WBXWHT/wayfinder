# Wayfinder 0.3.13 Alpha

This release restores compatible local AI history that predates Wayfinder and
keeps it current without adding an import workflow.

## Highlights

- Backfills active and archived Codex rollout files on first launch.
- Backfills Claude Code project transcripts and Claude Cowork audit logs.
- Watches every supported transcript location for later changes.
- Routes sessions without a project folder into one local general-collaboration
  map instead of dropping them.
- Records Cowork provenance internally while keeping the existing Claude
  source label and product interface unchanged.
- Preserves stable session and turn provenance across active/archive moves,
  repeated scans, file replacement, and partial writes.
- Records historical file changes only when the transcript contains sufficient
  evidence.

## Release Gates

- JavaScript, Chromium, Rust, Clippy, and dependency checks.
- Synthetic active, archived, Cowork, no-folder, malformed-tail, and
  incremental-update fixtures.
- Apple Silicon, Intel macOS, and Windows x64 release builds are required
  before publication.
