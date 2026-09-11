# Contributing to Wayfinder

Wayfinder is a local-first desktop app for reviewing how work with AI reached
its result. Contributions must preserve the accuracy of that history and the
privacy boundary described in [PRIVACY.md](PRIVACY.md).

## Before You Change Code

1. Open an issue for behavior changes that affect stored data, session
   collection, voyage grouping, or release packaging.
2. Keep changes focused on one observable outcome.
3. Use synthetic fixtures in tests, screenshots, bug reports, and pull
   requests. Never commit a real `~/.wayfinder` workspace or raw conversation.

## Development

```bash
npm ci
npm run check
npm run companion:prepare
cargo test --manifest-path companion/src-tauri/Cargo.toml
```

## Commit Messages

Use an imperative subject with a conventional type:

```text
feat(map): preserve the selected voyage during refresh
fix(collector): ignore incomplete tool calls
docs(release): publish verified Windows download
test(viewport): cover the 320px inspector layout
```

For non-trivial changes, add a body that answers:

- **Why:** the user-visible problem or risk.
- **What:** the behavior that changed.
- **Verification:** the commands or manual checks performed.

Avoid vague subjects such as `update`, `changes`, `fix stuff`, or
`misc improvements`. Do not rewrite published history only to restyle old
commit messages.

## Pull Requests

Include:

- a short problem statement and the chosen behavior;
- screenshots for visual changes;
- tests or reproducible verification steps;
- privacy and migration notes when stored data or collectors change;
- explicit follow-ups for work intentionally left out.

Generated files, release binaries, and screenshots must not be edited by hand.
Public screenshots must use synthetic data and be at least 2560 pixels wide.
