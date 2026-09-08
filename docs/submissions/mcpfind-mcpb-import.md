## Summary

The official MCP Registry import for
`io.github.WBXWHT/wayfinder` is live and marked Verified at:

https://www.mcpfind.org/servers/io-github-wbxwht-wayfinder

The generated install configuration is not executable. It currently treats
the GitHub Release `.mcpb` asset as an npm package:

```json
{
  "command": "npx",
  "args": [
    "-y",
    "https://github.com/WBXWHT/wayfinder/releases/download/v0.3.1/wayfinder-0.3.1.mcpb"
  ]
}
```

An MCPB is a desktop MCP extension archive, not an npm package. Running that
URL through `npx` does not start the server.

## Source metadata

The official Registry entry correctly declares:

```json
{
  "registryType": "mcpb",
  "identifier": "https://github.com/WBXWHT/wayfinder/releases/download/v0.3.1/wayfinder-0.3.1.mcpb",
  "fileSha256": "058f603cee0af0293e7b03f3a030d7a6c9e3bde8ef9bf68c424fad59d96a2fc3",
  "transport": { "type": "stdio" }
}
```

Registry evidence:

https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.WBXWHT/wayfinder

## Expected behavior

For `registryType: mcpb`, please show an MCPB download/install action and do
not synthesize an `npx` configuration. If MCPB installation is unsupported,
show the artifact link with a clear unsupported/manual-install notice.

The project also publishes a separate npm-compatible GitHub tarball, but it is
not an npm Registry package:

```bash
npm install -g https://github.com/WBXWHT/wayfinder/releases/download/v0.3.1/wbxwht-wayfinder-0.3.1.tgz
```

After that explicit install, the MCP command is `wayfinder-mcp` with
`WAYFINDER_PROJECT_DIR` set. MCPFind should not infer this fallback from the
MCPB metadata unless it has a way to represent the prior installation step.

## Related README-link behavior

The imported page rewrites repository-relative links such as `docs/INSTALL.md`
to `mcpfind.org/servers/docs/INSTALL.md`, which returns the wrong location. The
upstream README is being changed to absolute GitHub links as a workaround, but
preserving the repository base URL during Markdown rendering would make other
imports safer.

Thank you for importing the official Registry entry. This issue is about
correct installation semantics, not removal of the listing.
