# Wayfinder 0.3.10 Alpha

This release gives multi-voyage maps more breathing room and moves waypoint
details out of the route canvas on desktop.

## Highlights

- Increases the vertical rhythm between voyage entries and spreads branches
  farther apart.
- Docks waypoint details in a compact right-side inspector on desktop so the
  panel never covers route nodes.
- Keeps a shorter bottom sheet on narrow screens and automatically moves the
  selected waypoint above the sheet.
- Matches the inspector border, header tint, markers, notes, and scrollbar to
  the selected waypoint color.
- Refits the map when the inspector opens or closes while preserving keyboard
  focus and all existing detail content.

## Verification

- JavaScript and Chromium suite: 105 tests.
- Rust companion suite: 6 tests.
- Visual checks at 1440x900, 1080x720, and 320x720.
- Apple Silicon, Intel macOS, and Windows x64 assets are required before
  publication.
