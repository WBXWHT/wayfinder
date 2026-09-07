# Third-Party Notices

Wayfinder is an independent project. Its implementation was informed by these
open-source projects:

## Trace Your Code

- Source: https://github.com/shreedharv16/Trace-Your-Code
- License: MIT
- Reused pattern: isolated Shadow Git repository with a separate `GIT_DIR`
  and workspace tree, plus virtual documents for native editor diffs.

## Rewindo

- Source: https://github.com/utkarshranaa/rewindo
- License: MIT
- Reused pattern: pairing `UserPromptSubmit` and `Stop` events into one
  prompt-level checkpoint and preserving compact timeline metadata.

## pi-rewind

- Source: https://github.com/arpagon/pi-rewind
- License: MIT
- Reused pattern: one checkpoint per completed turn, deduplication, a
  before-restore safety snapshot, conservative exclusions, and branch guards.

## Variantree

- Source: https://github.com/NilotpalK/Variantree
- License: Apache-2.0
- Reused pattern: explicit parent links for branches and checkpoints, keeping
  abandoned futures instead of deleting them.

## Cline

- Source: https://github.com/cline/cline
- License: Apache-2.0
- Reused pattern: complete workspace snapshots in an isolated Git repository
  and separate code-state restoration from conversation history.

## Lucide

- Source: https://github.com/lucide-icons/lucide
- License: ISC
- The activity-bar branch icon is based on Lucide's `git-branch` icon.

## VS Code Codicons

- Source: https://github.com/microsoft/vscode-codicons
- License: CC BY 4.0
- Used for command and webview interface icons.

## D3

- Source: https://github.com/d3/d3
- License: ISC
- Used for hierarchical layout, SVG rendering, and zoom behavior in the
  full-size experience map.
