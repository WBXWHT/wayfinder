# Publication Status

Version: **0.3.3 early access**. Checked 2026-09-08.

## Published

| Channel | Public entry | Verification |
| --- | --- | --- |
| GitHub source | https://github.com/WBXWHT/wayfinder | Public repository and CI |
| GitHub Releases / VSIX | https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.3 | Ten uploaded assets, SHA-256 manifest |
| Claude Code self-hosted marketplace | `WBXWHT/wayfinder`, plugin `wayfinder@wayfinder` | Public catalog, complete Plugin bundle and Hook process checks |
| Codex self-hosted marketplace | `codex plugin marketplace add WBXWHT/wayfinder` | Public catalog, complete Plugin bundle and Hook process checks |
| Agent Skill distribution | `npx skills add WBXWHT/wayfinder --skill wayfinder` | Public discovery and actual isolated install; bundled CLI reports 0.3.3 |
| Homebrew Tap | https://github.com/WBXWHT/homebrew-tap | Clean macOS runner installed the formula and passed `brew test` |
| Scoop Bucket | https://github.com/WBXWHT/scoop-wayfinder | Clean Windows runner installed, checked the download hash, ran CLI |
| npm-compatible release tarball | `wbxwht-wayfinder-0.3.3.tgz` in GitHub Releases | Clean macOS, Windows, and Linux installations |
| Official MCP Registry | `io.github.WBXWHT/wayfinder` | Registry API returns version 0.3.3 with `active` status |
| Desktop MCP bundle | `wayfinder-0.3.3.mcpb` in GitHub Releases | Official manifest validation and stdio MCP process checks |
| MCPFind | https://www.mcpfind.org/servers/io-github-wbxwht-wayfinder | Auto-imported from the official Registry and marked `Verified` |

These rows distinguish formats and installation paths, not ten independent
marketplaces. The Skill is distributable through the open skills CLI; no
claim is made about a skills.sh ranking or curated placement.

The Claude/Codex catalogs are self-hosted, not official directory approvals.
Authenticated end-to-end acceptance in those clients remains pending.

## Additional Directory Status

| Directory | Status | Evidence / next prerequisite |
| --- | --- | --- |
| MCP.so | Submitted, awaiting review | https://github.com/chatmcp/mcpso/issues/3991 |
| TensorBlock MCP Index | Source issue corrected to 0.3.3; stale generated draft PR awaiting regeneration | https://github.com/TensorBlock/awesome-mcp-servers/pull/2231 |
| OpenModels MCP Registry | PR updated to 0.3.3; all 218 registry files validate | https://github.com/openmodelsrun/mcp/pull/32 |
| Glama | Automatically indexed, not deployable through Glama | https://glama.ai/mcp/servers/WBXWHT/wayfinder |
| Product Hunt | Scheduled for 2026-09-09 (Pacific Time) | https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6 |
| punkpeye/awesome-mcp-servers | Submitted; automated check passes | https://github.com/punkpeye/awesome-mcp-servers/pull/13982 |
| skills.sh | CLI installation verified; directory page not indexed yet | The repository route currently returns a 404 and must not be presented as a live listing |
| appcypher/awesome-mcp-servers | Unavailable | Repository is archived; GitHub rejected PR creation |
| Cline MCP Marketplace | Not submitted | Requires observed Cline-driven installation and a stable-release assertion; these are not yet verified |
| Awesome Claude Code | Not eligible yet | Requires 14 days of development or 100 stars; recommendations must be made by a human through its web form |

Glama currently imports the README and repository metadata, but its latest
crawl still shows `0.3.1`, reports no Glama release or tool-schema inspection,
and links to the unrelated unscoped `wayfinder` npm package. The repository now
marks the VSIX project package as private and supplies `glama.json` with the
actual maintainer. A manual claim/sync was attempted, but GitHub disabled the
OAuth **Authorize** action with "You can't perform that action at this time."
Use the verified GitHub tarball or MCPB while Glama's automatic crawl catches
up.

MCPFind's generated page is discoverable, but it currently turns the MCPB URL
into an invalid `npx` command. This is an importer bug, not a supported
installation path. It is tracked at
https://github.com/MCPFind/mcp-find/issues/191. Repository-relative README
links were changed to absolute GitHub links so directory mirrors do not rewrite
them to nonexistent local paths.

Submission payloads are retained under [submissions/](submissions/) so that
the same reviewed facts can be reused without claiming unverified features.
The active Awesome MCP Servers PR is `#13982`; the archived
`appcypher/awesome-mcp-servers` list remains unavailable.

## Public Evidence

- The current release runs 50 automated tests, including Chromium checks at
  220px and 320px sidebar widths:
  https://github.com/WBXWHT/wayfinder/actions/runs/34200350782
- The 0.3.3 Homebrew, Scoop, and cross-platform tarball installations:
  https://github.com/WBXWHT/wayfinder/actions/runs/34200816132
- The 0.3.3 official MCP Registry publish using GitHub OIDC:
  https://github.com/WBXWHT/wayfinder/actions/runs/34200822012
- Registry query:
  https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.WBXWHT/wayfinder
- Glama profile quality details:
  https://glama.ai/mcp/servers/WBXWHT/wayfinder/score
- OpenModels schema validation was run locally against all 218 entries before
  PR #32 was opened.

## Not Published Yet

| Channel | Missing prerequisite | Next action |
| --- | --- | --- |
| npm Registry | npm account login and package-scope ownership | Log in, confirm the scope, publish the verified tarball |
| VS Code Marketplace | Deferred on 2026-09-08: Microsoft account creation repeatedly returned to the press-and-hold human-verification challenge; no publisher or listing was created | Stop retries for at least 24 hours; retry later in a normal browser on another device/network, preferably with an existing Microsoft account |
| Open VSX | Required Eclipse Foundation account, publisher agreement, namespace, and PAT | Create the Eclipse account with the owner's identity, complete hCaptcha, link it under Open VSX Profile, then publish the VSIX |
| Anthropic community/curated directory | Official submission page exists, but no Claude Platform account is authenticated on this machine | Log in at https://platform.claude.com/plugins/submit, inspect the current review requirements, and submit only if Wayfinder meets them |
| OpenAI Plugin Directory | Official submission portal exists, but no OpenAI Platform account is authenticated on this machine | Log in at https://platform.openai.com/plugins, verify the publisher identity, and submit Wayfinder as Skills only; the current local stdio MCPB is not eligible for the With MCP path |
| TRAE native marketplace | Official docs describe installation but not an independent publisher portal; the official cooperation route is email, but no outgoing mail account is configured here | Send the prepared inquiry to `feedback@mail.trae.cn`; VSIX remains publicly downloadable and locally installable |
| Glama claim/release | GitHub disabled the OAuth authorization action; a Glama release would also require a deliberate hosted/container build | Allow automatic re-indexing, then retry claim/sync later; do not create a hosted release that misrepresents this local stdio server |

No credentials are stored in this repository. Do not put access tokens into
chat, commits, release notes, or public issues. Authenticate through the
platform's normal login or a protected local environment.

The npm login, Eclipse/Open VSX publisher authorization, Claude Platform login,
and outgoing mail account remain unavailable on the publishing machine at the
latest check. Source-metadata improvements do not replace publisher
authorization.

## Next Release

1. Update `package.json` and `src/version.ts` together.
2. Run `npm ci` and `npm run check`.
3. Run `npm run release:build` and `npm run release:verify`.
4. Validate `release/mcpb/manifest.json` with `@anthropic-ai/mcpb`.
5. Review the source allowlist and release archives for personal data and
   secrets. Do not upload `~/.wayfinder`, transcripts, or test-run output.
6. Commit source changes, push, and publish a new versioned GitHub Release
   with the built assets, `SHA256SUMS`, and `artifacts.json`.
7. Update each tap/bucket with the generated files under `release/channels/`.
8. Copy the generated `release/server.json` to the repository root, then run
   the `Publish MCP Registry` workflow for the new tag.
9. Update the pinned version in the `Verify Published Downloads` workflow,
   run it, and inspect each installation job before declaring success.
10. Before preparing a community submission, check that the destination is
    not archived, read its current contribution gates, and search for an
    existing submission. Record a pending issue/PR as pending, not published.

Never overwrite an existing published asset to fix a package: publish a new
version so recorded hashes and MCP Registry metadata remain consistent.
