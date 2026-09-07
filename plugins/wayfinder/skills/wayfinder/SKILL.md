---
name: "wayfinder"
description: "Installs and operates the complete Wayfinder experience. Invoke when the user wants to capture, inspect, map, or recover AI coding sessions."
---

# Wayfinder

This skill bundles the Wayfinder Core CLI. Resolve every `scripts/` path from
this SKILL.md directory, not from the user's project. Node.js 22+ and Git are
required. Never upload the user's `.wayfinder` data or conversation history.

## Inspect Before Installing

1. Identify the absolute project directory and current host.
2. Run the bundled `scripts/wayfinder-cli.cjs --version`, then `doctor --root
   <absolute-project>`. A `connected` result checks project Hook configuration
   only, not Plugin activation, host trust, or successful capture.
3. If the Wayfinder Plugin already supplies Hooks, do not install duplicate
   project Hooks. Confirm its activation using the host's plugin UI.
4. Explain the configuration files to be changed and obtain approval before
   installing a project adapter. Select only the user's actual host:

   ```bash
   node "<skill-directory>/scripts/wayfinder-cli.cjs" install claude --root "<project>"
   node "<skill-directory>/scripts/wayfinder-cli.cjs" doctor --root "<project>"
   ```

   Replace `claude` with `trae` or `codex` as appropriate. Use `all` only when
   the user requests all three. Existing unrelated Hooks are preserved.

## Open Inside The Host

1. If the host supports VS Code extensions, install the Wayfinder VSIX from
   https://github.com/WBXWHT/wayfinder/releases and open its activity-bar view.
   The CLI alone does not install the sidebar extension.
2. If no extension sidebar is available but the host exposes
   `wayfinder_show_map` and supports MCP Apps, call it with the project root.
   This skill alone does not register an MCP server. The Claude/Codex Plugin
   or the separately packaged MCP bundle supplies that server.
3. Otherwise run the bundled CLI `map --root <absolute-project>` and keep its
   tree output in the conversation or terminal. Do not launch a browser as
   the default map surface.

After setup, request one ordinary coding turn and verify that the map gains a
node before claiming capture works. Never equate skill loading with recording.
For project Hook removal, run `uninstall <host> --root <project>` with approval.
Remove Plugin-supplied Hooks using the host's Plugin manager instead.
