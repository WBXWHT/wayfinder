# Wayfinder 0.3.3 Official Plugin Submission Pack

Checked: 2026-09-08

## Submission Decision

- Anthropic: complete local Claude plugin submitted for review on 2026-09-08.
- OpenAI / Codex: validated Skills-only package retained for a later attempt;
  no submission was created because developer identity verification is
  blocked on the owner's unavailable payment method.

The OpenAI **With MCP** path is not currently valid for Wayfinder. OpenAI
requires a production HTTPS Streamable HTTP MCP endpoint, domain verification,
CSP, tool annotations, and reviewer-ready tests. Wayfinder currently exposes a
local `stdio` server and `.mcpb`; those formats must not be entered as a remote
MCP URL.

## Local Upload Artifacts

These files are generated locally under the ignored `release/` directory:

| Portal | File | SHA-256 |
| --- | --- | --- |
| Anthropic | `release/wayfinder-anthropic-plugin-0.3.3.zip` | `9982ba9089a2ea70fde1fa4f4a46ba4317e31114e24bf9321fcd6c2264eac685` |
| OpenAI | `release/wayfinder-openai-skills-only-0.3.3.zip` | `8e687ea24016c100dc2970517f231f9c0b18739945f85e281ab4063bebe3ac43` |

The Anthropic archive passes:

```text
npx @anthropic-ai/claude-code@2.1.263 plugin validate <plugin-directory>
Validation passed
```

The OpenAI archive passes the validator bundled with the current
`openai/codex` `plugin-creator` skill:

```text
Plugin validation passed
```

## Shared Listing Facts

- Name: `Wayfinder`
- Version: `0.3.3`
- Developer: `WBXWHT`
- Repository: https://github.com/WBXWHT/wayfinder
- Release: https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.3
- Website: https://github.com/WBXWHT/wayfinder
- Support: https://github.com/WBXWHT/wayfinder/issues
- Privacy: https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md
- Terms / license: https://github.com/WBXWHT/wayfinder/blob/main/LICENSE
- License: MIT
- Category: Developer Tools or Productivity

## Anthropic Submission

Portal:

https://platform.claude.com/plugins/submit

Status: **submitted for review** on 2026-09-08. The authenticated form returned
**Plugin submitted for review**. No public listing or approval is claimed.

Submitted source:

```text
Repository: https://github.com/WBXWHT/wayfinder
Repository path: plugins/wayfinder
Homepage: https://github.com/WBXWHT/wayfinder
Supported surface: Claude Code
License: MIT
```

Submitted description:

```text
Wayfinder is an open-source, local-first experience history for AI-assisted
coding. It records prompts, tool activity, file changes, validation results,
decisions, and wrong turns, then turns them into branching voyage maps that can
be inspected and restored without deleting abandoned paths. It includes Claude
Code hooks, a read-only local MCP server with an interactive MCP App, and a
bundled skill and CLI. It has no telemetry or Wayfinder cloud backend.
```

The optional privacy-policy field was left empty; the repository and submission
description disclose the local-first, no-telemetry behavior, and the public
privacy document remains available at the URL listed above.

The official submission form feeds Anthropic's community plugin marketplace.
It is not a claim of inclusion in Anthropic's separately curated built-in
marketplace until Anthropic explicitly grants that status.

## OpenAI / Codex Submission

Portal:

https://platform.openai.com/plugins

Submission type: **Skills only**

Status: not submitted. The authenticated Plugins console exposed both
**With MCP** and **Skills only**, confirming that the official route exists.
Selecting **Skills only** produced a blocking **Complete identity
verification** dialog before draft creation. The owner's verification flow
requires a payment method that is not currently available.

Short description:

```text
Map and revisit AI work
```

Long description:

```text
Wayfinder records Codex prompts, tool activity, file changes, validation
results, decisions, and wrong turns locally. The bundled skill checks the
current project, asks for approval before changing project hooks, diagnoses
the capture adapter, and renders recorded paths as a terminal tree. Graphical
inspection and restore remain separate Wayfinder IDE-extension capabilities
and are not claimed by this skills-only plugin.
```

Starter prompts:

```text
Inspect this Codex project and tell me whether Wayfinder capture is connected.
Install Wayfinder capture for this Codex project, then verify the configuration.
Show this project's Wayfinder history as a terminal tree.
```

### Positive Test Cases

1. Prompt: inspect whether Wayfinder is connected.
   Expected: run the bundled version and doctor commands, report each host
   adapter, and make no configuration changes.
2. Prompt: install Wayfinder for this Codex project.
   Expected: explain the target `.codex/hooks.json` change, request approval,
   preserve unrelated hooks, install only the Codex adapter, then run doctor.
3. Prompt: install Wayfinder again in an already connected project.
   Expected: remain idempotent and avoid duplicate hook entries.
4. Prompt: show the current Wayfinder history.
   Expected: run the bundled map command and return a terminal task tree
   without opening an external browser.
5. Prompt: remove the Codex capture adapter.
   Expected: request approval, remove only Wayfinder hook entries, preserve
   unrelated hooks and all existing `~/.wayfinder` history.

### Negative Test Cases

1. A malformed existing hooks file is present.
   Expected: refuse to overwrite it and report the file that needs repair.
2. The user has not approved installation or removal.
   Expected: do not change project configuration.
3. No Wayfinder history exists for the project.
   Expected: report the empty state without inventing sessions or claiming
   capture succeeded.

## Account Requirements

Anthropic authentication and the directory terms acknowledgement were
completed by the account owner before the form was submitted.

OpenAI requires:

1. An authenticated OpenAI Platform organization.
2. A verified individual or business identity.
3. Owner access or a role with **Apps Management: Write**.
4. Final policy attestations completed by the verified publisher.

The account is authenticated, but requirement 2 remains blocked because the
available verification flow requires a payment method.

Passwords, verification documents, access tokens, and CAPTCHA responses must
never be placed in the repository or chat.
