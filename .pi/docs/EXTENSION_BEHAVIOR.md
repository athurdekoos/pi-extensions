# Extension Behavior

> **Historical document.** This describes the internal architecture of the **legacy planning-protocol extension** (`.pi/legacy/planning-protocol.ts`), which is no longer loaded at runtime. The canonical planning extension is [`pi-plan/`](../../pi-plan/). This document is preserved for historical/design reference.

This document explains how the planning protocol extension works internally. It is intended for developers who need to understand, debug, or extend the system without reverse-engineering the implementation.

## Location and Discovery

> **Note:** This document describes the legacy planning-protocol extension, which has been **moved to `.pi/legacy/planning-protocol.ts`** and is no longer auto-loaded. The canonical planning extension is [`pi-plan/`](../../pi-plan/). This document is preserved as historical/design reference.

The extension originally lived at `.pi/extensions/planning-protocol.ts`, where Pi auto-discovers project-local extensions from `.pi/extensions/*.ts`. It was moved to `.pi/legacy/` to prevent dual-loading with the canonical `pi-plan/` package.

The extension is a single TypeScript file loaded via [jiti](https://github.com/unjs/jiti) (no compilation step). It uses only Node.js built-in modules (`node:fs`, `node:path`) and the Pi extension API types.

## Extension Entry Point

The file exports a default function that receives `ExtensionAPI`:

```typescript
export default function planningProtocolExtension(pi: ExtensionAPI): void { ... }
```

During this function, the extension:

1. Registers 14 commands
2. Subscribes to 5 event types
3. Initializes in-memory state (populated later on `session_start`)

No tools are registered. No shortcuts or flags are registered. The extension operates entirely through commands and event hooks.

## Registered Commands

| Command | Description |
|---------|-------------|
| `/plan-on` | Enable planning mode |
| `/plan-off` | Disable planning mode |
| `/plan-status` | Show current status |
| `/plan` | Create or edit the current plan |
| `/plan-debug-on` | Enable debug logging |
| `/plan-debug-off` | Disable debug logging |
| `/plan-debug` | Show debug info and log paths |
| `/plan-new` | Start a new plan (archives current if meaningful) |
| `/plan-complete` | Mark current plan completed, archive, reset |
| `/plan-archive` | Archive current plan, reset |
| `/plan-list` | Show summary of current and archived plans |
| `/plan-show` | Inspect an archived plan (read-only) |
| `/plan-restore` | Copy an archived plan into `current.md` as draft |
| `/plan-resume` | Restore an archived plan and open the editor |

Commands are Pi extension commands, not agent tools. They are invoked by the user via `/command-name` and are never blocked by the tool whitelist.

`/plan-show`, `/plan-restore`, and `/plan-resume` provide argument auto-completion via `getArgumentCompletions`, offering archive filenames and slugs.

## Event Subscriptions

| Event | Purpose |
|-------|---------|
| `session_start` | Initialize state, logger, validate plan, reconcile status |
| `session_switch` | Re-initialize for the new session |
| `session_shutdown` | Log shutdown event |
| `tool_call` | Enforce the hard tool whitelist during planning mode |
| `before_agent_start` | Inject compact planning context into the agent's messages |
| `context` | Prune stale planning-protocol messages to prevent accumulation |

## Runtime State: Loading and Persistence

### State file: `.pi/planning-state.json`

This file is the live runtime state. It is gitignored and local to each developer's machine.

On `session_start`:

1. The extension calls `loadState(cwd)`.
2. If `.pi/planning-state.json` exists and contains valid JSON with the expected shape (`version` is a number, `planMode` is a boolean), it is used as-is.
3. If the file exists but contains invalid JSON or an unexpected shape, the extension uses defaults (`planMode: false`, `status: "off"`) and sets a `_loadError` flag. A notification warns the user. **The malformed file is not overwritten** — the user must fix or delete it manually.
4. If the file does not exist, the extension copies `.pi/planning-state.example.json` to create it with default values.
5. If neither file exists, hard-coded defaults are used.

After loading, `refreshAndReconcile()` validates `current.md` and derives the correct system status.

### State file: `.pi/planning-state.example.json`

This committed file defines the default state shape. It is the template used to bootstrap `planning-state.json` on first run. It should not be modified at runtime.

### Persistence

State is written to disk via `saveState()` after every command that modifies `planMode`, `debugMode`, or `status`. This means state survives Pi process restarts.

## Plan Parsing: `current.md`

The extension parses `current.md` using a deterministic metadata grammar. The parser looks for the sentinel `<!-- pi-plan-meta` and extracts key-value pairs from the comment block.

### Parsing steps

1. Find `<!-- pi-plan-meta` in the file content.
2. Find the closing `-->`.
3. Extract lines between sentinel and close.
4. Parse each line as `key: value` (split on first colon).
5. Validate that `slug`, `status`, and `updated_at` are all present.
6. Validate that `status` is one of: `template`, `draft`, `active`, `completed`, `archived`.
7. Check for `## Goal` and `## Implementation Plan` H2 sections.

### Validation result

The parser returns either:

- `{ valid: false, reason: string, meta: null }` — parse or validation failure
- `{ valid: true, reason: null, meta: PlanMeta, hasRequiredSections: boolean }` — successful parse

A plan is considered **implementation-ready** when:
- `valid` is `true`
- `meta.status` is `"active"`
- `meta.slug` is non-empty
- `meta.updated_at` is non-empty

A plan is considered **meaningful** (worth preserving/archiving) when:
- `valid` is `true`
- `meta.status` is not `"template"`

## Two Status Levels

The system maintains two distinct status concepts:

### System/runtime status (`planning-state.json` → `status`)

Describes the enforcement state of the planning system.

| Value | Meaning |
|-------|---------|
| `off` | Planning mode inactive. No enforcement. |
| `plan-required` | Planning mode on, no valid active plan. Tools blocked. |
| `plan-ready` | Planning mode on, valid active plan exists. Tools still blocked. |

### Plan-document status (`current.md` → `status` metadata)

Describes the lifecycle state of the plan document.

| Value | Meaning |
|-------|---------|
| `template` | Empty placeholder. Not a real plan. |
| `draft` | Work in progress. Not yet ready for implementation. |
| `active` | Accepted plan. Implementation-ready (but tools are still blocked while planning mode is on). |
| `completed` | Fully implemented. Awaiting archive. |
| `archived` | Moved to archive. Should not appear in `current.md`. |

### Derivation

System status is derived from plan-document status:

- `planMode` is `false` → system status is `off`
- `planMode` is `true` and plan status is `active` (with valid slug and updated_at) → `plan-ready`
- `planMode` is `true` and anything else → `plan-required`

This derivation happens in `reconcileStatus()` and is called after every state-changing operation.

## How `before_agent_start` and `context` Work Together

### `before_agent_start`

Fires before each agent turn. When planning mode is on, the extension returns a message with `customType: "planning-protocol-context"` containing:

- Current system status
- Plan path
- Enforcement status (which tools are allowed)
- Plan validity summary

This message is injected into the agent's context so the LLM is aware of planning mode and enforcement. The message has `display: false` so it does not appear in the TUI.

### `context`

Fires before each LLM call. The extension uses this to prevent planning-protocol messages from accumulating in the context:

- **Planning mode on:** Keep only the newest `planning-protocol-context` message. Older ones are removed.
- **Planning mode off:** Remove all `planning-protocol-context` messages.

This ensures the LLM always sees at most one planning-protocol message (the most recent), preventing context bloat across multiple turns.

## How `tool_call` Enforcement Works

When `planMode` is `true`, the `tool_call` handler checks every tool call against the whitelist:

```
Whitelist: read, grep, ls, find
```

- If the tool is in the whitelist → `return undefined` (allow, do not interfere)
- If the tool is not in the whitelist → `return { block: true, reason: "..." }` (block with explanation)

The block reason includes:
- The current system status
- The blocked tool name
- The list of allowed tools
- Instructions to use `/plan` or `/plan-off`

### Why enforcement applies to both `plan-required` and `plan-ready`

`/plan-on` enters **inspect-and-plan mode**. The whitelist stays active regardless of whether a valid plan exists. The user must explicitly `/plan-off` to begin implementation. This prevents accidental code changes while the user is still thinking.

### Why commands are not blocked

Extension commands (`/plan`, `/plan-on`, etc.) are not agent tools. They bypass the tool_call hook entirely. This is a Pi architectural property — commands are user-invoked and handled directly by the extension, not routed through the LLM's tool-calling system.

## How Archive/Index Rebuilding Works

### Archive creation

When `/plan-complete`, `/plan-archive`, or `/plan-new` (with archival) runs:

1. Generate a filename: `YYYY-MM-DD-HHMM-<slug>.md` with collision counter
2. Copy `current.md` content with updated status metadata (`completed` or `archived`)
3. Write to `.pi/plans/archive/<filename>`
4. Archive files are immutable once written — never overwritten or modified

### Index rebuilding

`rebuildIndex()` is called after every lifecycle operation. It:

1. Reads and parses `current.md` for the "Current" section
2. Scans all `.md` files in `plans/archive/` (newest first)
3. Parses metadata from each archive file
4. Writes the complete `plans/index.md` from scratch

The index is fully deterministic — it is rebuilt from the filesystem, not incrementally maintained.

## How Restore/Resume Works

### `/plan-restore`

1. Resolve the archive target (by filename, slug, or interactive selection)
2. If `current.md` has meaningful content, prompt the user:
   - Archive current first, then restore
   - Replace directly (discard current)
   - Cancel
3. Copy the archived plan's content into `current.md`
4. Mutate metadata: set `status: draft`, update `updated_at`, preserve `slug`
5. The archive file is **not** modified or removed — restore is a copy
6. Reconcile runtime status (typically becomes `plan-required` since status is `draft`)
7. Rebuild `plans/index.md`

### `/plan-resume`

Same as `/plan-restore`, then immediately opens the guided plan editor (same flow as `/plan`). The user can edit the restored plan and set it to `active` if ready.

### Archive resolution

Resolution is deterministic:
1. Exact filename match (with or without `.md` suffix)
2. Exact slug match against parsed metadata in archive files
3. If multiple archives match the same slug → ambiguous, present choices
4. If no match → fail with clear error
5. If no argument given → present interactive selection of up to 20 recent archives

## UI Components

The extension uses these Pi UI features:

| Feature | Usage |
|---------|-------|
| `ctx.ui.setStatus()` | Footer status line showing plan mode, state, debug status |
| `ctx.ui.setWidget()` | Widget panel (visible when planning mode is on) showing mode, debug, state, plan metadata, enforcement status |
| `ctx.ui.notify()` | All user-facing messages (info, warning, error, success) |
| `ctx.ui.confirm()` | Confirmation dialogs for archival before replacement |
| `ctx.ui.input()` | Slug and title input for new plans |
| `ctx.ui.editor()` | Multi-line editor for plan content |
| `ctx.ui.select()` | Selection dialogs for archive resolution and restore actions |
| `ctx.ui.theme` | Theme colors for styled footer/widget text |

No custom TUI components (`ctx.ui.custom()`) are used. No shortcuts or flags are registered.

## What Is Intentionally Deferred (in the legacy extension)

The following were not implemented in the legacy extension. Some have been addressed by the canonical [`pi-plan/`](../../pi-plan/) package:

- **~~Package extraction~~** — Completed. The canonical shareable extension is [`pi-plan/`](../../pi-plan/). This legacy file is preserved for historical reference only.
- **Prompt templates** — No `.pi/prompts/` directory
- **Implementation unlock** — No way to unlock tools while planning mode stays on; must `/plan-off`
- **Archive deletion/cleanup** — No command to remove old archives
- **Log rotation/pruning** — Session logs accumulate without limit
- **Automatic reconciliation from external edits** — If `current.md` or archives are edited outside the extension, the system reconciles on next command/startup but does not watch for changes
- **Scan-result caching** — Archive scans read from disk every time
- **Custom TUI components** — Only standard Pi UI methods are used
