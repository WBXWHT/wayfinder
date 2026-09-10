# Wayfinder Download Website

The static download website lives in `website/`. It has no backend, account,
analytics, cookies, or runtime dependency. Download URLs come from
`website/releases.json` and point to versioned GitHub Release assets.

The public copy describes the current Companion flow: install the app, continue
working in Codex or Claude Code, and inspect the automatically updated local
voyage map. It must not tell Companion users to configure or approve Hooks.

## Local Preview

Serve the repository root and open `/website/`:

```bash
python3 -m http.server 4180
```

## Cloudflare Pages

The selected free address is:

https://wayfinder-ai.pages.dev

The originally requested `wayfinder.pages.dev` address was already serving an
unrelated project on 2026-09-09. Configure:

- Repository variable `CLOUDFLARE_PROJECT_NAME=wayfinder-ai`
- Secret `CLOUDFLARE_ACCOUNT_ID`
- Secret `CLOUDFLARE_API_TOKEN`

Then run `.github/workflows/deploy-website.yml`. A purchased custom domain is
not required.

## Public Links

| Purpose | Address |
| --- | --- |
| Official website | https://wayfinder-ai.pages.dev |
| Source and overview | https://github.com/WBXWHT/wayfinder |
| Desktop Alpha | https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.5 |
| Installation guide | https://github.com/WBXWHT/wayfinder/blob/main/docs/INSTALL.md |
| Privacy policy | https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md |
| Issue tracker | https://github.com/WBXWHT/wayfinder/issues |
| MIT license | https://github.com/WBXWHT/wayfinder/blob/main/LICENSE |
| Product Hunt | https://www.producthunt.com/products/wayfinder-5?launch=wayfinder-6 |

## Release Updates

Before publishing the site for a new Companion release, update
`website/releases.json` with the matching versioned Alpha or stable asset
names, publish the GitHub Release, and set `published` to `true`. Both macOS
DMGs and the Windows installer must return successfully before deployment;
until then unavailable download actions remain hidden or point to the general
Releases page.
