# Wayfinder 0.3.8 Alpha

This release makes project navigation visible, stable, and easier to
understand while aligning Wayfinder's public positioning with its broader AI
collaboration mission.

## Highlights

- Shows every voyage from one folder on the same project map.
- Keeps the current voyage expanded and the others visible as color-coded
  coastal entries that expand in place.
- Replaces the generic folder glyph with a route-aware project icon whose
  color follows the active voyage.
- Uses direct D3/tldraw-style trackpad transforms for continuous, reversible
  pan and zoom in WKWebView.
- Reworks waypoint details as a bottom Peek Sheet that closes with its close
  button, Escape, or a click outside.
- Removes map search and reset controls that duplicated direct canvas
  navigation.
- Clarifies that Wayfinder is for AI collaboration across conversations,
  research, writing, design, coding, and other project work. Codex and Claude
  Code remain the current early-access collectors.

## Verification

- JavaScript and Chromium suite: 102 tests.
- Rust companion suite: 6 tests.
- Desktop, 220px, 320px, and short-landscape rendering.
- Apple Silicon, Intel macOS, and Windows x64 release assets are required
  before publication.
