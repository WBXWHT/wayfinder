# Publication Status

Version: **0.3.1 early access**. Checked 2026-09-08.

## Published

| Channel | Public entry | Verification |
| --- | --- | --- |
| GitHub source | https://github.com/WBXWHT/wayfinder | Public repository and CI |
| GitHub Releases / VSIX | https://github.com/WBXWHT/wayfinder/releases/tag/v0.3.1 | Ten uploaded assets, SHA-256 manifest |
| Claude Code self-hosted marketplace | `WBXWHT/wayfinder`, plugin `wayfinder@wayfinder` | Public catalog, complete Plugin bundle and Hook process checks |
| Codex self-hosted marketplace | `codex plugin marketplace add WBXWHT/wayfinder` | Public catalog, complete Plugin bundle and Hook process checks |
| Agent Skill distribution | `npx skills add WBXWHT/wayfinder --skill wayfinder` | Public discovery and actual isolated install; bundled CLI reports 0.3.1 |
| Homebrew Tap | https://github.com/WBXWHT/homebrew-tap | Clean macOS runner installed the formula and passed `brew test` |
| Scoop Bucket | https://github.com/WBXWHT/scoop-wayfinder | Clean Windows runner installed, checked the download hash, ran CLI |
| npm-compatible release tarball | `wbxwht-wayfinder-0.3.1.tgz` in GitHub Releases | Clean macOS, Windows, and Linux installations |
| Official MCP Registry | `io.github.WBXWHT/wayfinder` | Registry API returns version 0.3.1 with `active` status |
| Desktop MCP bundle | `wayfinder-0.3.1.mcpb` in GitHub Releases | Official manifest validation and stdio MCP process checks |

These rows distinguish formats and installation paths, not ten independent
marketplaces. The Skill is distributable through the open skills CLI; no
claim is made about a skills.sh ranking or curated placement.

The Claude/Codex catalogs are self-hosted, not official directory approvals.
Authenticated end-to-end acceptance in those clients remains pending.

## Public Evidence

- Build, 49-test suite, archive build, and packaged-Core verification:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166355120
- Homebrew, Scoop, and cross-platform npm-tarball installations:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166371656
- Official MCP Registry publish using GitHub OIDC:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166101484
- Registry query:
  https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.WBXWHT/wayfinder

## Not Published Yet

| Channel | Missing prerequisite | Next action |
| --- | --- | --- |
| npm Registry | npm account login and package-scope ownership | Log in, confirm the scope, publish the verified tarball |
| VS Code Marketplace | Microsoft/Azure publisher account and publishing authorization | Create or verify the `wayfinder` publisher, then upload VSIX |
| Open VSX | Signed-in publisher, namespace ownership, applicable publisher agreement | Log in at https://open-vsx.org/user-settings/extensions |
| Anthropic community/curated directory | Submitter login, contact details, and review | Use https://platform.claude.com/plugins/submit |
| OpenAI curated directory | Publisher submission access and review | Use the official Codex directory's submission process when available |
| TRAE native marketplace | Verified independent third-party submission route | VSIX remains the supported distribution route |

No credentials are stored in this repository. Do not put access tokens into
chat, commits, release notes, or public issues. Authenticate through the
platform's normal login or a protected local environment.

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

Never overwrite an existing published asset to fix a package: publish a new
version so recorded hashes and MCP Registry metadata remain consistent.
