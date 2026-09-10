# External Recognition

Status reviewed: 2026-09-11.

Only externally verifiable outcomes may be described as recognition. A
submission, open pull request, self-authored community post, or pending review
is not an award and must not be presented as one.

## Comparable Products

| Product | Public signal | Evidence |
| --- | --- | --- |
| SpecStory | 10K+ installs, 3K+ active developers, 50K+ conversations saved | https://specstory.com |
| Pieces for Developers | Four Product Hunt awards, 2.5K followers, 35 reviews | https://www.producthunt.com/products/pieces-for-developers |
| XHawk | Product Hunt #4 Product of the Day with 245 points | https://www.producthunt.com/products/xhawk |
| Warp | Product Hunt Golden Kitty runner-up for Developer Tools | https://www.producthunt.com/products/warp |

These products show that durable adoption metrics and selective, recognizable
platform awards carry more weight than broad directory counts.

## Primary Targets

### Microsoft WinGet

- Submission: https://github.com/microsoft/winget-pkgs/pull/432783
- Value: inclusion makes `winget install WBXWHT.Wayfinder` available from
  Microsoft's official Windows Package Manager community source.
- Current status: the pull request now targets the public 0.3.7 installer.
  All three manifests pass Microsoft's 1.12.0 schemas locally; upstream
  validation is rerunning. The previous 0.3.5 revision passed all ten WinGet
  validation stages. Merge remains blocked until the repository owner
  personally confirms Microsoft's CLA; that legal confirmation must not be
  automated or delegated.

### awesome-mac

- Submission: https://github.com/jaywcjlove/awesome-mac/pull/2828
- Value: independently maintained macOS software list with more than 110K
  GitHub stars.
- Current status: pull request open and mergeable; maintainer review pending.

## Supporting Exposure

- Tauri official GitHub Show and Tell:
  https://github.com/orgs/tauri-apps/discussions/16004
- OpenAI Codex official GitHub Show and Tell:
  https://github.com/openai/codex/discussions/44618
- Made with Tauri directory: submitted successfully for manual review on
  2026-09-11.
- Console.dev: an evidence-based pitch was sent to `hello@console.dev` on
  2026-09-11 for editorial consideration. Console.dev reviews only 2-3 tools
  per week for more than 30K subscribers and explicitly accepts pre-1.0
  developer-tool releases. Its automated reply confirmed that Wayfinder will
  be reviewed for the next newsletter. Treat this as a submission until a
  public issue includes Wayfinder.
- Changelog News: the 0.3.5 release was submitted through Changelog's official
  news form on 2026-09-11 and the site confirmed receipt. Changelog explicitly
  permits maintainers to submit their own non-commercial open-source work.
  Treat this as an editorial pitch until a public news item includes Wayfinder.

## Excluded Channels

- `tauri-apps/awesome-tauri` stopped accepting application submissions and
  removed its application section on 2026-08-20. Do not open an application
  pull request there.
- The withdrawn `awesome-claude-code-workflows` submission described obsolete
  hook, skill, and MCP surfaces. Wayfinder is now a standalone desktop app and
  does not meet that list's multi-primitive workflow requirement.
- Homebrew Cask requires macOS executables to pass Gatekeeper checks. The
  current ad-hoc-signed Alpha is not eligible; reconsider only after Apple
  Developer ID signing and notarization are in place.

## Deferred Target

- `hesreallyhim/awesome-claude-code` is a relevant curated list with more than
  53K GitHub stars, but a resource must have 14 days of active development or
  100 stars. Wayfinder's first commit was 2026-09-08, so the age gate opens on
  2026-09-22. Its rules also require the recommendation to be created by a
  human; do not automate or impersonate that attestation.

## Product Hunt

The first Wayfinder launch finished unfeatured at daily rank 380 with one
point. Do not cite it as an award. A future launch is justified only after a
substantial product iteration and a prepared user community; Product Hunt
permits relaunch requests for significant updates, but approval and ranking
remain external decisions.

## Resume Rule

Do not add WinGet, awesome-mac, or Made with Tauri as an achieved distinction
until the corresponding listing is publicly live. Community posts may be
linked as launch activity, but must not be called awards or curated features.
