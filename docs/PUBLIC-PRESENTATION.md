# Public Presentation Standard

Reviewed: 2026-09-12.

This document is the consistency contract for Wayfinder's public surfaces. It
keeps positioning factual while applying patterns used by established
local-first, AI-history, and desktop productivity products.

## Positioning Contract

**Category**

Local-first AI collaboration history for desktop.

**Promise**

See how work with AI moved from a goal through attempts and branches to a
result.

**Distinctive proof**

- Related work becomes a project-level voyage map.
- Failed and successful paths remain visible together.
- Waypoints link back to available conversations, file changes, and
  validation.
- Complete history stays on the user's computer.

**Current availability**

- macOS: Apple Silicon and Intel
- Windows: x64
- Current collectors: Codex and Claude Code
- Current public release: 0.3.13 early access

Do not describe Codex and Claude Code as the product boundary. Do not claim
support for an unreleased collector, package manager, plugin, Skill, or MCP
surface.

## Benchmarks

| Reference | Pattern worth adopting | Wayfinder application |
| --- | --- | --- |
| [SpecStory](https://specstory.com/) | Outcome-led promise, explicit local privacy, concrete workflow | Lead with the reviewable project path; state the current collectors separately |
| [Pieces](https://pieces.app/) | Describe capture, recall, and reuse as one continuous loop | Explain collection, voyage grouping, evidence review, and reuse |
| [Agent Sessions](https://github.com/jazzyalex/agent-sessions) | Direct download, current scope, plain privacy statement, real product image | Keep platform downloads one click away and state what remains local |
| [claude-devtools](https://github.com/matt1398/claude-devtools) | Name the problem before listing capabilities; show proof visually | Explain why final output alone is insufficient, then show the voyage |
| [Warp](https://www.warp.dev/) | Short category statement followed by concrete operating model | Keep each section focused on one job instead of a feature inventory |
| [Granola](https://www.granola.ai/) | Concise category language and a memorable privacy distinction | Use “local-first”, “no account”, and “no cloud sync” only where true |

Adopt the structure and clarity of these references, not their claims,
metrics, visual identity, or category boundaries.

## Surface Rules

### Website

- The first viewport names Wayfinder, the product category, the primary value,
  and all supported download platforms.
- Open Graph, Twitter card, canonical URL, and structured application metadata
  must agree with visible copy.
- Check desktop, 320px portrait, and 844x390 short-landscape viewports for
  overflow, clipping, and overlap before publishing.
- Do not add testimonials, usage counts, awards, or trust logos without a
  public source.

### GitHub

- The repository description states category and outcome in one sentence.
- The README leads with a product visual, a concise promise, trust boundaries,
  and direct platform downloads.
- The social preview uses the 2560x1280 synthetic website image.
- Release notes use: purpose, available builds, highlights, and verification.

### Product Hunt

- Keep one concise tagline and a description that separates broad product
  scope from current collector support.
- Use exactly three synthetic gallery images at 2560 pixels wide or higher.
- Keep the website first and the current GitHub repository second.

### Community Posts

- State the audience-specific reason for posting before technical details.
- Link only the current website, repository, and release.
- Mark submissions and open pull requests as pending, never as awards.

## Commit And Pull Request Standard

Commit subjects use an imperative conventional form:

```text
feat(map): preserve the selected voyage during refresh
fix(collector): ignore incomplete tool calls
docs(showcase): align public product messaging
```

For non-trivial changes, the body explains why the change is needed, what
behavior changed, and how it was verified. Published history is not rewritten
solely to restyle old messages.

Pull requests use the repository template and include screenshots for visual
changes, verification evidence, and privacy or migration impact where
applicable.

## Image Standard

- Use only the synthetic `登录回跳稳定性` demo for public product screenshots.
- Never capture a real `~/.wayfinder` workspace.
- Product screenshots must be at least 2560 pixels wide.
- The GitHub social preview is 2560x1280 and under GitHub's 1 MB limit.
- Keep one dominant product state per image; do not use dense collages.

Canonical assets:

- `docs/assets/public/wayfinder-social-preview-2k.png`
- `docs/assets/public/wayfinder-voyage-overview-2k.png`
- `docs/assets/public/wayfinder-voyage-branch-2k.png`

## Audit Checklist

- No current public copy contains `WBXWHT/wayfinder`.
- No current public copy advertises a retired plugin, Skill, MCP, Homebrew, or
  Scoop installation path.
- The website, README, Product Hunt, current release, Tauri post, Codex post,
  and active awesome-mac pull request agree on product scope and availability.
- All current download links return successfully.
- Public screenshots use synthetic data and meet the resolution standard.
- GitHub commit and pull request descriptions follow the documented structure.
