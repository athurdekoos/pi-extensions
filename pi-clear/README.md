# pi-clear

A Pi extension that adds a `/clear` command to start a fresh session, optionally carrying over the current editor draft.

## When to use

Use `/clear` when your conversation context has grown stale or too large and you want a clean slate without manually creating a new session.

## Installation

### Local extension

```bash
pi -e ./index.ts
```

### Auto-discovery

Copy or symlink the extension directory into one of:

- `~/.pi/agent/extensions/`
- `.pi/extensions/` (project-local)

Or install via the Pi manifest by pointing `pi.extensions` to the entry file.

## Dependencies

None beyond the Pi runtime. No external CLIs or services required.

## Commands

### `/clear`

Start a new session with empty conversation history.

**Arguments:**

| Argument | Aliases | Description |
|---|---|---|
| `keep` | `--keep`, `-k` | Carry the current editor text into the new session. |
| `--edit` | | Open the carried text in an editor for review before restoring it. Requires `keep`. |
| `--yes` | `-y` | Skip the confirmation prompt. |

Arguments can be combined freely.

**Examples:**

```text
/clear              # confirm, then start a fresh session
/clear --yes        # skip confirmation
/clear keep         # carry over editor text
/clear keep --edit  # carry over editor text, edit it first
/clear keep -y      # carry over editor text, skip confirmation
```

## Behavior

1. If `keep` is specified, the current editor text is captured before clearing.
2. A confirmation dialog is shown unless `--yes` is passed.
3. If the agent is currently streaming a response, a second confirmation asks whether to stop it. With `--yes`, the agent is stopped automatically.
4. A new session is created via `ctx.newSession()`.
5. If `keep` was specified and editor text was present:
   - With `--edit`, the text opens in an editor overlay for review.
   - Without `--edit`, the text is restored directly.
6. A notification confirms the result.

Cancelling any confirmation prompt aborts the clear without side effects.

## RPC mode

In RPC mode, `ctx.ui.getEditorText()` may not have access to the live editor buffer. In that case, `keep` mode degrades gracefully -- no text is carried over and the session still clears normally.

## Security

- Clearing context is destructive to the active conversational state. Confirmation is required by default.
- The extension does not delete files, modify session storage, or execute shell commands.
- Editor text captured for carry-over is not logged, persisted, or transmitted beyond restoring it in the new session.
