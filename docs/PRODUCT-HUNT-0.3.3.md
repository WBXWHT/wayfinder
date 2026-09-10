# Product Hunt Launch: Wayfinder 0.3.3

## Positioning

**Tagline**

Turn scattered AI work into experience you can reuse.

**Opening**

Most of the work we do with AI is scattered across one chat after another.
When the chat ends, we keep the output but lose how we got there: the prompts,
attempts, wrong turns, evidence, and decisions that made the result possible.

Wayfinder records that process locally and turns it into a branching voyage
map. You can see how a task evolved, locate the first failed step, restore a
previous state without deleting the abandoned route, and reuse the lesson next
time.

## Product Description

Wayfinder is a local experience layer for AI-assisted work. Its first
production use case is AI coding:

- each prompt becomes a waypoint;
- tool calls, file changes, tests, and human judgment stay attached;
- branches preserve alternative attempts instead of flattening them;
- restore creates a new path while keeping the old future visible.

It works with TraeCode, Claude Code, and Codex. Depending on the host, the map
appears as an IDE sidebar, an in-conversation MCP App, or a terminal tree.

The longer-term model also applies to writing, research, and design workflows
that are advanced through conversation. Those broader capture adapters are a
direction, not a claim of current full support.

## Maker Comment

I built Wayfinder after noticing that AI tools were getting better at producing
answers but not at preserving the reasoning that made those answers useful.
Existing checkpoints answer "can I go back?" Wayfinder asks a different
question: "which path worked, which path failed, and what should I reuse next
time?"

The project is local-first, open source, and has no telemetry or Wayfinder
cloud backend. Version 0.3.3 is available through GitHub Releases, self-hosted
Claude/Codex plugin catalogs, Agent Skills, Homebrew, Scoop, and the official
MCP Registry.

## Suggested Categories

- Developer Tools
- Artificial Intelligence
- Open Source
- Productivity

For future Orbit Awards eligibility, keep the category accurate and collect
detailed, experience-based reviews. Product Hunt states that Orbit is driven by
verified reviews, with extra weight on detailed and founder reviews.

## Launch Status

The public product page is live:

https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6

The live listing still links to the GitHub repository and describes the earlier
AI-coding surfaces. Update it to use `https://wayfinder-ai.pages.dev` and the
current Companion positioning when Product Hunt editing is available.

Submitted assets:

- 400x400 Wayfinder product icon, cropped by Product Hunt to its 240x240
  thumbnail format.
- 1270x760 real Wayfinder voyage-map screenshot.
- 1270x760 workflow graphic showing prompt, branch, validation, wrong turn,
  restore, and reuse.
- 1270x760 host graphic showing the shared Core across TraeCode, Claude Code,
  and Codex.

Product Hunt reported the required launch information as 100% complete. A demo
video and shoutouts remain optional post-scheduling improvements, not launch
blockers.
