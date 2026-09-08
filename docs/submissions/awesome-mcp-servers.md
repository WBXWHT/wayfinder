## Summary

Add [Wayfinder](https://github.com/WBXWHT/wayfinder) under Development Tools.

Wayfinder's local stdio MCP server reads existing AI coding session history,
decisions, notes, file-change metadata, and task branches. It exposes one
read-only tool, `wayfinder_show_map`, and an interactive `ui://wayfinder/map`
resource for MCP Apps-compatible clients.

The broader project includes capture adapters and an IDE sidebar; the MCP
server does not expose code restoration or claim to capture every client's
chat history.

## Verification

- No duplicate suggestion for `WBXWHT/wayfinder` was found.
- This PR adds one entry at the bottom of the relevant category, as requested.
- TypeScript implementation, MIT license, Node.js 22.13+, stdio transport.
- Official MCP Registry entry: `io.github.WBXWHT/wayfinder`, version `0.3.3`.
- Public release, installation guide, and privacy statement are in the repo.
- Clean macOS, Windows, and Linux installation checks:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166371656
- Packaged MCP startup/tool/resource checks and source tests:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166940002

This is an early-access project, submitted under the list's stated inclusion
of experimental servers. Authenticated end-to-end testing in every AI client
is still pending. Calling its MCP tool exposes selected project history to
the calling host, as described in the privacy statement.
