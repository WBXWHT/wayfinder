# Wayfinder Download Website

The static download website lives in `website/`. It has no backend, account,
analytics, cookies, or runtime dependency. Download URLs come from
`website/releases.json` and point to versioned GitHub Release assets.

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

## Release Updates

Before publishing the site for a new Companion release, update
`website/releases.json` with the matching versioned Alpha or stable asset
names, publish the GitHub Release, and set `published` to `true`. Both
architecture links must return a DMG before deployment; until then the local
preview sends download actions to the general Releases page.
