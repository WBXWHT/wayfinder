## Summary

Add Wayfinder to the OpenModels MCP Registry under Development.

Wayfinder's local stdio MCP server gives agents read-only access to existing AI
coding session history as task trees and branches. Its single tool returns text
and structured data plus an interactive `ui://wayfinder/map` resource for MCP
Apps-capable clients.

## Metadata scope

- Repository: https://github.com/WBXWHT/wayfinder
- Official MCP Registry: `io.github.WBXWHT/wayfinder`, active version `0.3.1`
- Transport: stdio
- Tool: `wayfinder_show_map`
- Resource: `ui://wayfinder/map`
- License: MIT

The entry deliberately omits an `install` block. This project currently ships
a verified GitHub Release tarball and MCPB, not an npm Registry package. It
would be inaccurate to associate the entry with the unrelated unscoped npm
package named `wayfinder`. Installation instructions remain in the repository.

The tool description also distinguishes the MCP read interface from Wayfinder's
separate capture adapters and IDE-only restore actions.

## Verification

```text
OpenModels MCP Server Registry Validator
==================================================
Validating MCP server registry...

Validation Passed
Validated 218 files successfully.
```

Additional public evidence:

- Source tests and packaged-Core verification:
  https://github.com/WBXWHT/wayfinder/actions/runs/34174258060
- Cross-platform public installations:
  https://github.com/WBXWHT/wayfinder/actions/runs/34166371656
- Privacy:
  https://github.com/WBXWHT/wayfinder/blob/main/PRIVACY.md
