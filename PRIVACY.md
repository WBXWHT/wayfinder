# Privacy And Local Data

Wayfinder has no analytics, advertising, account service, or cloud sync.
Its capture and storage code does not send HTTP requests.

## Stored Locally

Wayfinder stores prompts, assistant replies, tool summaries, paths, validation
output, optional notes, and snapshots under `~/.wayfinder`. Do not commit or
upload that directory. Treat it as sensitive project data.

Snapshot exclusions include Git internals, host configuration directories,
dependencies, common build output, and files over the configured size limit.
Exclusion rules are not secret detection: unignored source files can contain
credentials. Review the files you allow to be captured.

## What An MCP Host Can See

Calling `wayfinder_show_map` returns the selected project's timeline and forest
to the calling MCP host, including prompts, replies, notes, and file metadata.
That host may send tool results to its model provider or retain them under its
own policies. Wayfinder's local storage does not make that host interaction
offline. Do not connect confidential projects without appropriate permission.

The local MCP bundle is read-only at the tool interface. It can read Wayfinder
history for a root explicitly provided by the caller; the project selector is
a default, not a filesystem access sandbox.

## Installation And Removal

Project adapter setup writes `.trae/hooks.json`, `.claude/settings.json`, or
`.codex/hooks.json`. It preserves unrelated Hooks. Capture does not begin until
the host enables/trusts the adapter and emits supported events.

`wayfinder uninstall <host> --root <project>` removes project Hooks, not history.
Remove the Plugin in your host to disable Plugin-supplied Hooks. You may delete
the corresponding directory under `~/.wayfinder/projects/` to erase history,
but doing so permanently removes that project's restore points.

## Reports

When reporting bugs, use a synthetic project. Do not attach raw timelines,
transcripts, snapshots, credentials, or confidential source code to public
issues. A version, host version, error message with paths redacted, and
reproduction steps are usually sufficient.
