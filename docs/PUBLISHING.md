# Publication Status

Version: **0.3.3 early access**. Checked 2026-09-10.

## Published

| Channel | Public entry | Verification |
| --- | --- | --- |
| Official website | https://wayfinder-ai.pages.dev | Live Cloudflare Pages download site; automatic-transcript-collection copy is updated in the repository and awaits the next Pages deployment |
| GitHub source | https://github.com/WBXWHT/wayfinder | Public repository and CI |
| macOS Companion Alpha | https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.3 | Apple Silicon and Intel DMGs plus SHA-256 checksum files |
| GitHub Releases / VSIX | https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.3 | Ten uploaded assets, SHA-256 manifest |
| Claude Code self-hosted marketplace | `WBXWHT/wayfinder`, plugin `wayfinder@wayfinder` | Official Claude Code 2.1.263 added the marketplace and installed the enabled 0.3.3 plugin from a clean temporary home; Hook process checks also pass |
| Codex self-hosted marketplace | `codex plugin marketplace add WBXWHT/wayfinder` | Public catalog, complete Plugin bundle and Hook process checks |
| Agent Skill distribution | https://skills.sh/wbxwht/wayfinder/wayfinder | Public `skills.sh` page, one recorded install, and actual isolated CLI install; bundled CLI reports 0.3.3 |
| Homebrew Tap | https://github.com/WBXWHT/homebrew-tap | Clean macOS runner installed the formula and passed `brew test` |
| Scoop Bucket | https://github.com/WBXWHT/scoop-wayfinder | Clean Windows runner installed, checked the download hash, ran CLI |
| npm-compatible release tarball | `wbxwht-wayfinder-0.3.3.tgz` in GitHub Releases | Clean macOS, Windows, and Linux installations |
| Official MCP Registry | `io.github.WBXWHT/wayfinder` | Registry API currently returns version 0.3.1 with `active` status; 0.3.3 has not propagated |
| Desktop MCP bundle | `wayfinder-0.3.3.mcpb` in GitHub Releases | Official manifest validation and stdio MCP process checks |
| MCPFind | https://www.mcpfind.org/servers/io-github-wbxwht-wayfinder | Auto-imported from the official Registry and marked `Verified` |

These rows distinguish formats and installation paths, not ten independent
marketplaces. The `skills.sh` page is an automated public listing, not a
ranking, endorsement, or curated placement.

The Claude/Codex catalogs are self-hosted, not official directory approvals.
Wayfinder has also been submitted separately to Anthropic's official plugin
review flow; that submission is pending and is not yet an approval.

## Additional Directory Status

| Directory | Status | Evidence / next prerequisite |
| --- | --- | --- |
| Anthropic Plugin Directory | Submitted for review on 2026-09-08 | The authenticated Claude Platform form confirmed "Plugin submitted for review"; Claude Code was selected as the supported surface |
| MCP.so | Submitted, awaiting review | https://github.com/chatmcp/mcpso/issues/3991 |
| TensorBlock MCP Index | Source issue corrected to 0.3.3; stale generated draft PR awaiting regeneration | https://github.com/TensorBlock/awesome-mcp-servers/pull/2231 |
| OpenModels MCP Registry | PR updated to 0.3.3; all 218 registry files validate | https://github.com/openmodelsrun/mcp/pull/32 |
| Glama | Automatically indexed, not deployable through Glama | https://glama.ai/mcp/servers/WBXWHT/wayfinder |
| Product Hunt | Public launch page is live; its website link and product copy still point to the pre-Companion GitHub positioning | https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6 |
| punkpeye/awesome-mcp-servers | Submitted; automated check passes | https://github.com/punkpeye/awesome-mcp-servers/pull/13982 |
| Awesome Claude Code Workflows | Submitted; CodeRabbit check passes, maintainer review pending | https://github.com/ithiria894/awesome-claude-code-workflows/pull/30 |
| Awesome Claude Skills | Submitted; listing validation and both Socket checks pass, maintainer review pending | https://github.com/ComposioHQ/awesome-claude-skills/pull/1861 |
| Awesome Claude Plugins | Submitted; clean and mergeable, maintainer review pending | https://github.com/composio-community/awesome-claude-plugins/pull/459 |
| skills.sh | Publicly indexed on 2026-09-08 | https://skills.sh/wbxwht/wayfinder/wayfinder; one install recorded, Socket audit passes, and two scanners report expected medium warnings for Hooks, command execution, and the linked GitHub release |
| claude-plugins.dev | Automatic GitHub discovery pending | The live API does not yet return `WBXWHT`; repository topics now include `claude-plugin`, `model-context-protocol`, and `ai-collaboration` to expose accurate discovery metadata |
| PulseMCP | Expected downstream Registry sync, not yet verified | The public site rejected direct HTTP checks and hung in Chromium; no manual listing is claimed |
| SkillsMP | Automatic GitHub indexing pending | No manual submission path is required, and the public catalog does not yet return Wayfinder |
| SkillHub | Not submitted | Publisher login requires an account; the isolated-browser GitHub login action failed in the site's client code, so no account or listing was created |
| appcypher/awesome-mcp-servers | Unavailable | Repository is archived; GitHub rejected PR creation |
| Cline MCP Marketplace | Not submitted | Requires observed Cline-driven installation and a stable-release assertion; these are not yet verified |
| Awesome Claude Code | Not eligible yet | Requires 14 days of development or 100 stars; recommendations must be made by a human through its web form |
| awesome-vibe-coding | Not eligible yet | Maintainer rejection history states a 50-star baseline; Wayfinder currently has 0 stars, so no low-confidence promotional PR was opened |

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
The active community submissions are Awesome MCP Servers `#13982`, OpenModels
`#32`, TensorBlock `#2231`, Awesome Claude Code Workflows `#30`, Awesome Claude
Skills `#1861`, and Awesome Claude Plugins `#459`. The archived
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
- Public Agent Skill page:
  https://skills.sh/wbxwht/wayfinder/wayfinder
- Product Hunt launch page:
  https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6
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
| OpenAI Plugin Directory | The official portal exists and the account is authenticated, but creating either plugin type requires a verified developer identity; the verification flow requires a payment method that the owner does not currently have | Defer the official submission and retain the validated Skills-only artifact; the current local stdio MCPB remains ineligible for the With MCP path |
| TRAE native marketplace | Deferred at the owner's request on 2026-09-08; official docs describe installation but not an independent publisher portal, and the available cooperation route is email | Do not send the prepared inquiry unless the owner explicitly resumes this channel; the VSIX remains publicly downloadable and locally installable |
| Glama claim/release | GitHub disabled the OAuth authorization action; a Glama release would also require a deliberate hosted/container build | Allow automatic re-indexing, then retry claim/sync later; do not create a hosted release that misrepresents this local stdio server |
| Smithery | Its CLI accepts the verified 0.3.3 MCPB, but login requests GitHub write access to Gists, stars, and watched repositories; GitHub also disabled the OAuth authorization action | Do not grant unrelated broad write scopes merely to obtain a directory listing; revisit only if Smithery offers least-privilege authentication |
| LobeHub MCP Marketplace | `lhm.plugin.json` was generated by inspecting the real stdio server and records one tool plus one MCP App resource | Complete the mandatory human `lhm login` and `lhm github connect` steps, then publish `https://github.com/WBXWHT/wayfinder` |
| mcpservers.org / wong2 list | The free submission form requires a deliverable contact email, while the GitHub account has no public email | Supply an owner-approved contact email, then submit the prepared Memory-category listing; do not use the non-deliverable GitHub noreply address |
| Cursor Marketplace / cursor.directory | The generic MCP reader could be packaged, but Wayfinder has no tested Cursor capture adapter or Cursor-specific plugin acceptance evidence | Do not advertise full Wayfinder support until capture, configuration variables, and install behavior are tested in Cursor |

No credentials are stored in this repository. Do not put access tokens into
chat, commits, release notes, or public issues. Authenticate through the
platform's normal login or a protected local environment.

The npm login, Eclipse/Open VSX publisher authorization, and verified OpenAI
developer identity remain unavailable on the publishing machine at the latest
check. The owner explicitly deferred the TRAE email route. Claude Platform
authentication was completed and the official Anthropic submission was
accepted for review. Source-metadata improvements do not replace publisher
authorization.

## Next Release

1. Update `package.json`, `src/version.ts`, and `lhm.plugin.json` together.
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
