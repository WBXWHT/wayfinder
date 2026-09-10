# Wayfinder 0.3.3 Channel Submission Pack

Checked: 2026-09-08

## Shared Facts

- Product: Wayfinder
- Repository: https://github.com/WBXWHT/wayfinder
- Release: https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.3
- VSIX: `wayfinder-0.3.3.vsix`
- License: MIT
- Publisher / extension ID: `wayfinder.wayfinder`
- Official MCP Registry ID: `io.github.WBXWHT/wayfinder`
- Privacy: local storage, no telemetry, no Wayfinder cloud backend
- Supported capture hosts: TraeCode, Claude Code, Codex

## Short Description

Most work with AI is scattered across one chat after another. Wayfinder records
the prompts, attempts, changes, evidence, decisions, and wrong turns locally,
then turns them into a branching voyage map that can be revisited and reused.

## VS Code Marketplace

Status: deferred on 2026-09-08. GitHub authentication reached Microsoft account
creation, but Microsoft's press-and-hold human-verification challenge repeated
after successful user completion. No Marketplace publisher or listing was
created.

Submission asset:

https://github.com/WBXWHT/wayfinder/releases/download/v0.3.3/wayfinder-0.3.3.vsix

Do not retry before 2026-09-09. Repeated attempts can extend Microsoft's
temporary risk block. On a later attempt:

1. Use an existing Microsoft account if available.
2. Otherwise create the account outside the Marketplace flow, using a normal
   Chrome, Edge, or Safari profile with JavaScript enabled.
3. Use another device or network, such as a phone on mobile data, if the
   challenge still loops.
4. After the account works at https://account.microsoft.com, sign in at
   https://marketplace.visualstudio.com/manage.
5. Create or verify publisher `wayfinder`.
6. Generate a Marketplace PAT with extension management permission.
7. Run `npx @vscode/vsce publish --packagePath wayfinder-0.3.3.vsix`.

## Open VSX

Status: GitHub authentication now succeeds, but publishing is blocked on the
required first-time Eclipse Foundation account. The account form requires the
owner's public email, username, real name, employment status, country,
password, agreement acceptance, and hCaptcha. No account, publisher agreement,
namespace, or PAT was created.

Required account action:

1. Create the Eclipse account at https://accounts.eclipse.org/user/register
   with GitHub username `WBXWHT`.
2. Return to https://open-vsx.org/user-settings/profile and select
   **Log in with Eclipse**.
3. Review and accept the Open VSX Publisher Agreement.
4. Generate a token under **Access Tokens**.
5. Run `npx ovsx create-namespace wayfinder -p <token>`.
6. Run `npx ovsx publish wayfinder-0.3.3.vsix -p <token>`.

## TRAE Marketplace

Status: deferred at the owner's request on 2026-09-08. No independent
third-party publisher portal was found in current official documentation.
TraeCode officially supports its own marketplace, local VSIX import, and
compatible extensions from the VS Code Marketplace. The available cooperation
route remains `feedback@mail.trae.cn`, but no message should be sent unless the
owner explicitly resumes this channel.

Cooperation email: `feedback@mail.trae.cn`

Suggested subject:

```text
Wayfinder 开源 AI 协作经验航海图申请接入 TraeCode 插件市场
```

Suggested body:

```text
您好，

Wayfinder 是一个开源、本地优先的 AI 协作经验版本库。它通过 TraeCode
Hooks 自动记录 Prompt、工具调用、文件变化和验证结果，并在 Activity Bar
中展示可分叉、可复盘、可非破坏恢复的航海图。

项目已发布 v0.3.3，并获 MCP 项目官方 Registry 收录：
https://github.com/WBXWHT/wayfinder
https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.WBXWHT/wayfinder

希望了解独立开发者向 TraeCode 插件市场提交 VSIX 的审核流程。项目采用 MIT
许可证，无遥测、无 Wayfinder 云端后端，并已通过 50 项自动化测试及
220px/320px Chromium 侧栏检查。

谢谢。
```

## Anthropic Plugin Directory

Status: submitted for Anthropic review on 2026-09-08 through the authenticated
form at https://platform.claude.com/plugins/submit. The form confirmed
**Plugin submitted for review** and stated that the review team may contact the
publisher for more information. Claude Code was selected as the supported
surface; Claude Cowork was not selected because it has not completed a
host-specific acceptance test.

Submitted source:

- Repository: https://github.com/WBXWHT/wayfinder
- Repository path: `plugins/wayfinder`
- License: MIT
- Privacy: local-first, no telemetry, no Wayfinder cloud backend

Wayfinder also retains its working self-hosted Claude Code marketplace. The
official submission is pending review and must not be described as Anthropic
approval or directory inclusion until Anthropic accepts it.

The self-hosted path was re-tested from a clean temporary home with official
Claude Code `2.1.263`. The following commands cloned and validated the public
marketplace, then installed Wayfinder `0.3.3` in enabled state:

```text
claude plugin marketplace add WBXWHT/wayfinder
claude plugin install wayfinder@wayfinder
```

The validated upload artifact and form copy are documented in
[`OFFICIAL-PLUGIN-SUBMISSIONS-0.3.3.md`](OFFICIAL-PLUGIN-SUBMISSIONS-0.3.3.md).

## OpenAI Codex Plugin Directory

Status: an official public submission route now exists at
https://platform.openai.com/plugins. Approved plugins enter the universal
Plugin Directory shared by ChatGPT and Codex.

Wayfinder's local `stdio` MCP server and `.mcpb` cannot be submitted through
OpenAI's **With MCP** path: OpenAI requires a production HTTPS Streamable HTTP
endpoint, domain verification, CSP, tool annotations, and reviewer test cases.
The current viable route is a **Skills only** submission containing the
Wayfinder skill and bundled local CLI. This requires an authenticated OpenAI
Platform organization, a verified individual or business identity, and Owner
or **Apps Management: Write** permission.

The OpenAI Platform login succeeded on 2026-09-08 and the official Plugins
console exposed both **With MCP** and **Skills only** creation paths. Selecting
**Skills only** opened a blocking **Complete identity verification** dialog:
OpenAI requires a verified developer identity before any plugin can be created
or uploaded. The owner's verification flow requires a payment method, which is
not currently available, so no official OpenAI submission was made. This is an
account prerequisite, not an absent submission route or package validation
failure.

The existing GitHub marketplace remains a valid independent Codex distribution
source:

```text
codex plugin marketplace add WBXWHT/wayfinder
```

The validated Skills-only upload artifact, listing copy, and five positive plus
three negative test cases are documented in
[`OFFICIAL-PLUGIN-SUBMISSIONS-0.3.3.md`](OFFICIAL-PLUGIN-SUBMISSIONS-0.3.3.md).

## Product Hunt / Orbit Awards

Status: successfully scheduled for September 9, 2026 (Pacific Time). Product
Hunt reported the required submission fields as 100% complete.

Pre-launch dashboard:

https://www.producthunt.com/products/wayfinder-5/wayfinder-6/prelaunch

Public product route:

https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6

Public pre-launch discussion:

https://www.producthunt.com/p/wayfinder-5/what-part-of-your-ai-workflow-do-you-wish-you-could-revisit

The discussion asks which context is hardest to reconstruct after AI-assisted
work: why a decision was made, which attempt failed, or how to reuse the
successful path. It does not solicit votes or claim unverified adoption.

The submitted launch includes the Wayfinder icon, a real voyage-map screenshot,
two purpose-built 1270x760 gallery graphics, the launch description, the first
Maker comment, the `Developer Tools` tag, and maker `@xuan_world`.

Recommended categories:

- Developer Tools
- Artificial Intelligence
- Open Source
- Productivity

Orbit Awards are not a separate one-off application. Product Hunt says
eligibility is driven by correct categorization, traction, verified reviews,
and especially detailed and founder reviews. Launch first, then collect genuine
usage-based reviews; do not solicit empty votes or claim a nomination early.

## Community MCP Directories

- MCP.so: issue open and awaiting review:
  https://github.com/chatmcp/mcpso/issues/3991
- OpenModels MCP Registry: PR updated to `0.3.3`; local validator passed all
  218 entries:
  https://github.com/openmodelsrun/mcp/pull/32
- TensorBlock MCP Index: source issue updated to `0.3.3`; automated draft PR
  still contains stale `0.3.1` data and has been asked to regenerate:
  https://github.com/TensorBlock/awesome-mcp-servers/pull/2231
- Awesome MCP Servers: PR open, current automated submission check passes:
  https://github.com/punkpeye/awesome-mcp-servers/pull/13982
- Glama: automatically indexed, but its current crawl still shows `0.3.1`.
  Manual claim/sync was attempted; GitHub disabled the OAuth **Authorize**
  action with "You can't perform that action at this time."
- MCPFind: imported and marked Verified. Its incorrect MCPB-to-`npx` conversion
  remains reported at:
  https://github.com/MCPFind/mcp-find/issues/191
- PulseMCP: expected to ingest from the official MCP Registry, but the public
  site rejected direct HTTP checks and did not finish loading in Chromium. No
  listing is claimed until a public Wayfinder page can be verified.
- Smithery: its CLI accepts the verified `wayfinder-0.3.3.mcpb`, but its login
  asks for GitHub write access to Gists, stars, and watched repositories.
  GitHub also disabled the OAuth authorization action. No broad account
  permission was granted for a directory listing.
- LobeHub MCP Marketplace: the official CLI inspected the real stdio server
  and generated root [`lhm.plugin.json`](../lhm.plugin.json) with one tool and
  one MCP App resource. Publishing now requires the two mandatory human steps:

  ```bash
  npx -y @lobehub/market-cli login
  npx -y @lobehub/market-cli github connect
  npx -y @lobehub/market-cli plugin publish \
    https://github.com/WBXWHT/wayfinder \
    --dir /absolute/path/to/wayfinder
  ```

  Do not bypass the OIDC/GitHub ownership checks or inspect credential files
  under `~/.lobehub-market`.
- mcpservers.org / wong2 list: its repository no longer accepts PRs and routes
  submissions to https://mcpservers.org/submit. The free form is ready except
  for its required contact email; the owner's GitHub account has no public
  email, and the non-deliverable GitHub noreply address must not be substituted.
  Prepared fields:

  ```text
  Server name: Wayfinder
  Category: Memory
  Description: Read local AI coding history as branching voyage maps for
  failure diagnosis, evidence review, and non-destructive recovery.
  Repository: https://github.com/WBXWHT/wayfinder
  ```

- Cline MCP Marketplace: not submitted. Its issue template requires an actual
  Cline-driven install test and a declaration that the server is stable for
  public use; Wayfinder is explicitly an early-access release and has not
  completed that Cline-specific test.
- Cursor Marketplace and cursor.directory: not submitted. Cursor can package
  Agent Plugins and local MCP servers, but Wayfinder has no tested Cursor
  capture adapter or host-specific installation evidence. A read-only listing
  must not be presented as the complete Wayfinder experience.

## Community Claude and Skill Directories

- `skills.sh`: publicly indexed with one recorded install:
  https://skills.sh/wbxwht/wayfinder/wayfinder
  The live page exposes the reviewed `SKILL.md`; Socket passes, while Gen Agent
  Trust Hub and Snyk report expected medium warnings for persistent Hooks,
  command execution, and the linked GitHub release.
- Awesome Claude Code Workflows: PR open; CodeRabbit passes with no actionable
  findings, while maintainer review remains pending:
  https://github.com/ithiria894/awesome-claude-code-workflows/pull/30
- Awesome Claude Skills: PR open and mergeable; listing validation and both
  Socket checks pass:
  https://github.com/ComposioHQ/awesome-claude-skills/pull/1861
- Awesome Claude Plugins: PR open and mergeable in the `Developer
  Productivity` category:
  https://github.com/composio-community/awesome-claude-plugins/pull/459
- `claude-plugins.dev`: automatically discovers public GitHub plugins, but its
  live API does not yet return `WBXWHT/wayfinder`. Repository topics now
  include `claude-plugin`, `model-context-protocol`, and `ai-collaboration` for
  the next crawl.
- SkillsMP: automatically indexes public `SKILL.md` files and has no required
  manual submission flow; Wayfinder is not yet discoverable there.
- SkillHub: not submitted. Its publisher flow requires an account, and the
  isolated-browser GitHub login action failed in the site's client code before
  OAuth began.
- `awesome-vibe-coding`: not submitted. Maintainer rejection records state a
  50-star baseline; Wayfinder currently has 0 stars.
- Awesome Claude Code: not eligible yet. Its form requires at least 14 days of
  development or 100 stars and a human-authored recommendation.
