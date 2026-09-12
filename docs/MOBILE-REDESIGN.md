# Mobile Presentation

Reviewed: 2026-09-13.

## Decision

The desktop site remains the visual source of truth, but phone layouts preserve
its hierarchy instead of shrinking its coordinates. Desktop selectors,
dimensions, copy, and assets are frozen.

Reference patterns:

- Granola: one promise followed by one dominant product proof.
- Pieces: explain automatic memory as a short sequence, not a feature wall.
- SpecStory: place the outcome and primary action before secondary detail.
- Raycast: end with a compact action area rather than another full-screen hero.

## Visual Thesis

A compact field guide: quiet typography on open paper, one clear voyage at a
time, and restrained navigation marks that connect the sections.

## Review Prototype

The isolated review surface is `docs/mobile-review/index.html`. It does not
load or modify production website styles.

Deterministic 390x844 views:

- `docs/mobile-review/index.html?screen=hero`
- `docs/mobile-review/index.html?screen=proof`
- `docs/mobile-review/index.html?screen=final`

Rendered review images:

- `docs/mobile-review/renders/hero-390x844.png`
- `docs/mobile-review/renders/proof-390x844.png`
- `docs/mobile-review/renders/final-390x844.png`

## Content Plan

### Hero

Job: identify Wayfinder, explain the value, and make every current installer
available before showing the decorative voyage.

Order:

1. Brand navigation.
2. Product category, name, and one-sentence promise.
3. Three equal platform downloads.
4. One mobile voyage scene with a complete coast, sea, branch, and vessel.

The voyage cannot overlap the copy or downloads. Its successful endpoint and
vessel sit on the coast; the failed branch stays on land.

The phone composition uses four short labels attached to the route so the
voyage remains understandable without desktop-sized annotations. The coast is
a complete field boundary, not a clipped sliver.

### Product Proof

Job: show that a result can be traced back to attempts and evidence.

Order:

1. Eyebrow and two-line heading.
2. Focused product image.
3. One short explanatory paragraph.
4. Three proof labels and the privacy link.

The image is the dominant element. On phones it uses the focused public voyage
asset instead of shrinking the full desktop overview.

The phone asset is a dedicated portrait render of one branch with three
readable evidence cards. It is not a crop of the 16:9 desktop image.

### Final Download

Job: close the story and provide one final download action.

Order:

1. Eyebrow and two-line heading.
2. One short sentence.
3. Three compact platform choices in one segmented row.
4. Footer metadata.

The section is content-height, not a forced viewport. The background route
supports the text and never crosses the download labels.

The review view includes the tail of the preceding section to make the
content-driven final band visible in its real scroll context. Production keeps
the band below 500 CSS pixels at phone widths.

## Interaction Thesis

- The hero vessel follows one failure and one successful route.
- Content reveals use the existing restrained section transition.
- Download controls keep the existing hover and press feedback.

Reduced-motion users receive the final successful state without animation.

## Implementation

- `website/index.html` keeps the desktop hero intact and adds a separate
  `.mobile-hero-voyage` scene that is visible only at 540px and below.
- `website/login-voyage-mobile-2k.png` is a 2800x3024 synthetic portrait
  render selected through `<picture>` only on phones.
- The product-proof copy uses mobile grid ordering so the heading, image,
  explanation, proof labels, and privacy link remain in narrative order.
- The final phone section is content-driven, uses one segmented download row,
  and gives its decorative route a dedicated band between copy and downloads.
- `website/app.js` drives desktop and phone voyages from the same timeline but
  keeps their SVG nodes and coordinates independent.

## Acceptance

- At 320x568, 390x844, and 430x932, each module has one dominant element and no
  horizontal overflow, clipping, text overlap, or coastline intrusion.
- The first phone viewport contains the product name, promise, all three
  platform choices, and at least part of the voyage scene.
- Product-proof text inside the image remains legible at 390 CSS pixels.
- The final download choices remain in one row at 320 CSS pixels.
- The 1440x900 desktop viewport and full-page screenshots remain pixel
  identical to the frozen baseline.

## Verification

- `npm run check`: 213 tests pass, including Chromium at 320x568, 390x844,
  430x932, 812x375, and 1440x900.
- `cargo test --manifest-path companion/src-tauri/Cargo.toml`: 10 tests pass.
- `cargo clippy --manifest-path companion/src-tauri/Cargo.toml --all-targets
  -- -D warnings`: passes.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Same-process Chromium captures of the old and new 1440x900 first viewport
  and 1440x3996 full page are pixel-identical.
