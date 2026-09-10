# Wayfinder 0.3.6 Alpha

This macOS release completes the voyage-map interaction and accessibility
work started in 0.3.5.

Status: published as `alpha-v0.3.6`.

## Highlights

- Keeps the visible project and viewport stable when unrelated projects update.
- Defers active-project redraws until a trackpad gesture is idle.
- Discards queued pan and zoom input when the project, voyage, or search
  context changes.
- Discards stale wheel input before keyboard focus reveals an off-screen
  waypoint.
- Keeps every matching waypoint keyboard-accessible and pans focused cards
  into view.
- Preserves imported Skill voyage and stage metadata when live work is later
  collected into the same project.
- Preserves keyboard focus when a narrow project drawer refreshes.
- Detects Codex or Claude transcript roots created after Wayfinder launches.
- Serializes transcript collection and keeps healthy roots watched when
  another source cannot be watched.
- Records file changes only after the corresponding Codex or Claude tool call
  reports success.
- Keeps in-progress turns pending so later responses, actions, and file changes
  are collected when the turn completes.
- Keeps the website voyage canvas painted after viewport changes.
- Uses an architecture-neutral download chooser when a Mac architecture cannot
  be detected reliably.
- Keeps both Mac download controls visible on short mobile viewports.
- Publishes verified release assets as one recoverable set and rejects website
  downloads that do not match the declared release version and architecture.
- Builds the desktop web bundle through a locked staging directory so parallel
  builds cannot expose partial assets.

## Release Gate

Before publication, verify:

- the complete Node and Rust test suites;
- Chromium desktop, 320px portrait, and short landscape rendering;
- a signed Apple Silicon DMG installed in `/Applications`;
- both Apple Silicon and Intel DMGs and `SHA256SUMS`;
- the live download URLs before updating `website/releases.json`.
