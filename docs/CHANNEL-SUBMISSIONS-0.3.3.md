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

Status: blocked on GitHub OAuth consent, publisher agreement, namespace
ownership, and a PAT.

Required account action:

1. Sign in at https://open-vsx.org/user-settings/tokens.
2. Create or claim namespace `wayfinder`.
3. Generate a token.
4. Run `npx ovsx publish wayfinder-0.3.3.vsix -p <token>`.

## TRAE Marketplace

Status: no independent third-party publisher portal was found in current
official documentation. TraeCode officially supports local VSIX import and
installing compatible extensions from the VS Code Marketplace.

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

Status: Wayfinder already has a working self-hosted Claude Code marketplace.
Current official Plugin documentation documents local and self-hosted
marketplaces, but no general public curated-directory submission route could be
verified. Do not describe the self-hosted catalog as Anthropic approval.

## OpenAI Codex Plugin Directory

Status: Wayfinder already has a working self-hosted Codex marketplace. No
public curated-directory submission route could be verified in current
official documentation. Do not describe the self-hosted catalog as OpenAI
approval.

## Product Hunt / Orbit Awards

Status: launch copy is ready in
[`PRODUCT-HUNT-0.3.3.md`](PRODUCT-HUNT-0.3.3.md). Publishing is blocked on the
account owner's GitHub OAuth and Cloudflare verification.

Recommended categories:

- Developer Tools
- Artificial Intelligence
- Open Source
- Productivity

Orbit Awards are not a separate one-off application. Product Hunt says
eligibility is driven by correct categorization, traction, verified reviews,
and especially detailed and founder reviews. Launch first, then collect genuine
usage-based reviews; do not solicit empty votes or claim a nomination early.
