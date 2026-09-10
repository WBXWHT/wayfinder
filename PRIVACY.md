# Privacy And Local Data

Wayfinder has no analytics, advertising, account service, or cloud sync.
Its capture and storage code does not send HTTP requests.

Wayfinder Companion reads the same local data. The current build does not call
a cloud analysis service. It prepares a redacted, evidence-only request format
so that a future opt-in analysis feature has a testable privacy boundary before
any provider is connected.

## Stored Locally

Wayfinder stores prompts, assistant replies, tool summaries, paths, validation
output, optional notes, and snapshots under `~/.wayfinder`. Do not commit or
upload that directory. Treat it as sensitive project data.

On macOS, Companion reads supported JSONL session files from the user's local
Codex and Claude configuration directories. It stores incremental collection
progress in `~/.wayfinder/collector-state.json`. This collection is local and
does not scrape application windows or send transcript content to Wayfinder.

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

## Future Opt-In Analysis

Cloud analysis must remain disabled until the user explicitly enables it for a
project. The request format excludes complete conversations, source code,
workspace roots, prompts, and raw error output. It sends hashed topic IDs plus
locally generated fields such as failure kind, diagnostic category, exit code,
file extensions, source host, and local conflict/superseded state. Only locally
evidenced failures are eligible.

No model conclusion becomes a Wayfinder fact unless it cites evidence IDs from
the same topic in the local request. Conflict and superseded conclusions must
also match the local state evidence. Provider choice, retention guarantees,
transport security, and the consent screen must be completed before this
feature can ship.

## Installation And Removal

Project adapter setup writes `.trae/hooks.json`, `.claude/settings.json`, or
`.codex/hooks.json` and preserves unrelated Hooks. Companion collection is
separate: it watches local Codex and Claude JSONL transcripts and requires no
Hook approval or host connection screen. If both paths observe the same turn,
Wayfinder deduplicates it before writing the project timeline.

`wayfinder uninstall <host> --root <project>` removes project Hooks, not history.
Remove the Plugin in your host to disable Plugin-supplied Hooks. You may delete
the corresponding directory under `~/.wayfinder/projects/` to erase history,
but doing so permanently removes that project's restore points.

## Reports

When reporting bugs, use a synthetic project. Do not attach raw timelines,
transcripts, snapshots, credentials, or confidential source code to public
issues. A version, host version, error message with paths redacted, and
reproduction steps are usually sufficient.
