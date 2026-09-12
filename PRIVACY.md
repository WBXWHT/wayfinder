# Privacy And Local Data

Wayfinder has no analytics, advertising, account service, or cloud sync.
Its capture and storage code does not send HTTP requests.

Wayfinder Companion reads the same local data. The current build does not call
a cloud analysis service. It prepares a redacted, evidence-only request format
so that a future opt-in analysis feature has a testable privacy boundary before
any provider is connected.

## Stored Locally

Wayfinder stores prompts, assistant replies, tool summaries, paths, validation
output, optional notes, file-change summaries, and map state under
`~/.wayfinder`. Do not commit or upload that directory. Treat it as sensitive
project data.

On macOS and Windows, Companion reads supported local session files from active
and archived Codex storage, Claude Code projects, and Claude Cowork session
storage. It stores incremental collection progress in
`~/.wayfinder/collector-state.json`. This collection is local and does not
modify source transcripts, scrape application windows, or send transcript
content to Wayfinder.

Desktop collection does not capture workspace snapshots or reconstruct
historical file contents. File-change summaries are recorded only when the
source session contains verifiable edit details. Prompts and replies can still
contain credentials or other sensitive material, so treat the stored history
accordingly.

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

## Removal

Removing the application leaves `~/.wayfinder` intact. You may delete the
corresponding directory under `~/.wayfinder/projects/` to erase one project, or
delete `~/.wayfinder` to erase all Wayfinder data. Both actions permanently
remove the affected history and map data.

## Reports

When reporting bugs, use a synthetic project. Do not attach raw timelines,
transcripts, project maps, credentials, or confidential source code to public
issues. A version, host version, error message with paths redacted, and
reproduction steps are usually sufficient.
