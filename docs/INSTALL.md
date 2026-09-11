# Install Wayfinder

Current public version: **0.3.9 early access**.

Wayfinder is distributed as a desktop application for macOS and Windows:

https://github.com/WBXWHT/wayfinder/releases/tag/alpha-v0.3.9

## Choose Your Installer

- `Wayfinder-Alpha-<version>-macOS-aarch64.dmg`: Apple Silicon.
- `Wayfinder-Alpha-<version>-macOS-x86_64.dmg`: Intel.
- `Wayfinder-Alpha-<version>-Windows-x86_64.exe`: Windows 10/11 x64.

On macOS, download the matching DMG, move Wayfinder to Applications, and open
it. On Windows, download and run the x64 installer.

The current zero-cost Alpha is ad-hoc signed rather than Apple-notarized. On
first launch, open **System Settings → Privacy & Security** and choose
**Open Anyway**.

The Windows Alpha is not code-signed. Microsoft Defender SmartScreen may
require **More info → Run anyway** after you verify the checksum.

## Start Recording

Keep Wayfinder running, then continue working normally in Codex or Claude Code.

Wayfinder updates the matching project map in the background. Workspace-backed
plain chat and coding turns can both be collected. Codex and Claude Code
activity from the same project appears in one map while retaining its source.

## Local Requirements

- macOS 12 or newer, or Windows 10/11 x64.
- Git, used by the current local snapshot backend.

## Data And Removal

Wayfinder stores its data under `~/.wayfinder`. Removing the application does
not automatically delete this history.

To erase all Wayfinder data, quit the app and delete `~/.wayfinder`. This
permanently removes recorded history and restore points.

Read [PRIVACY.md](../PRIVACY.md) before deleting or sharing local data.
