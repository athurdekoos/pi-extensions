# Planning Protocol

> **Context:** This file documents the planning protocol as designed for the **legacy planning-protocol extension** (`.pi/legacy/planning-protocol.ts`). The plan metadata contract (slug, status, updated_at), file locations (`plans/current.md`, `plans/archive/`), and archive naming convention are shared with the canonical [`pi-plan/`](../pi-plan/) package. However, the commands documented below (`/plan-on`, `/plan-off`, `/plan-status`, `/plan-new`, `/plan-complete`, `/plan-archive`, `/plan-list`, `/plan-show`, `/plan-restore`, `/plan-resume`) are legacy commands. The canonical `pi-plan/` package exposes only `/plan` and `/plan-debug`.

This file is the human-readable source of truth for the repo-local planning protocol.

## Purpose

The planning protocol enforces a plan-before-code discipline. When planning mode is active, implementation must not proceed unless a valid plan exists. This prevents drift, scope creep, and uncoordinated changes.

## Required Repo-Local File Locations

| Path | Purpose | Committed? |
|------|---------|------------|
| `.pi/PLANNING_PROTOCOL.md` | This file — protocol rules and conventions | Yes |
| `.pi/planning-state.example.json` | Default shape for runtime state | Yes |
| `.pi/planning-state.json` | Live runtime state (created locally) | No (gitignored) |
| `.pi/README.md` | Overview of the `.pi/` area | Yes |
| `.pi/docs/STATE_MODEL.md` | State model documentation | Yes |
| `.pi/plans/current.md` | The active plan (stable pointer) | Yes |
| `.pi/plans/index.md` | Plan index — current + archived plans | Yes |
| `.pi/plans/archive/` | Archived plans (immutable once written) | Yes |
| `.pi/plans/debug/` | Debug/diagnostic logs | No (gitignored) |

## File Categories

**Committed protocol and documentation:**
Files that define the planning contract. Reviewed and versioned.
- `PLANNING_PROTOCOL.md`, `README.md`, `docs/STATE_MODEL.md`, `planning-state.example.json`

**Committed plan artifacts:**
Plan content that is versioned and shared.
- `plans/current.md`, `plans/index.md`, `plans/archive/*.md`

**Ignored runtime state:**
Local machine state created by the extension at runtime. Never committed.
- `planning-state.json` — live toggle and status cache
- `plans/debug/*` — diagnostic snapshots

The legacy extension (originally `.pi/extensions/planning-protocol.ts`, now at `.pi/legacy/planning-protocol.ts`) created `planning-state.json` by copying `planning-state.example.json` on first use. If the live file is missing, the extension treats it as default state (`planMode: false`, `status: "off"`).

## Retrieval / Read Order

When checking planning state, read in this order:

1. `.pi/planning-state.json` — authoritative machine state (if missing, assume defaults)
2. `.pi/plans/current.md` — active plan content
3. `.pi/plans/index.md` — plan history (informational)

## Write / Update Order

When modifying planning state, write in this order:

1. `.pi/plans/current.md` — plan content first
2. `.pi/plans/index.md` — update index to reflect changes
3. `.pi/planning-state.json` — persist state last (commits the transition)

This ordering ensures that if a write is interrupted, the state file is the last thing updated, and a stale state file can be reconciled against the filesystem.

## Plan Metadata Contract

Every `current.md` must begin with an H1 title line followed by a metadata block in an HTML comment. The metadata block uses a fixed grammar so future validation is deterministic, not heuristic.

### Metadata block format

```markdown
# Plan: [TITLE]

<!-- pi-plan-meta
slug: <value>
status: <value>
updated_at: <value>
-->
```

The opening line `<!-- pi-plan-meta` is the sentinel. The validator looks for exactly this string to locate the metadata block. If the sentinel is missing, the file has no valid metadata.

### Required metadata keys

| Key | Required? | Type | Description |
|-----|-----------|------|-------------|
| `slug` | Yes | `string` | Kebab-case identifier for the plan (e.g., `auth-module`). Used in archive filenames. |
| `status` | Yes | `enum` | Plan lifecycle status. See allowed values below. |
| `updated_at` | Yes | `string` | ISO 8601 timestamp of last meaningful update (e.g., `2026-03-12T06:07:50-07:00`). |

All three keys must be present. Empty values (e.g., `slug:` with no value) mean the field is unset.

### Allowed `status` values (plan-level)

These describe the lifecycle of the plan document itself. They are distinct from the system-level status in `planning-state.json`.

| Value | Meaning | Unlocks implementation? |
|-------|---------|------------------------|
| `template` | Unfilled template / placeholder. No real plan content. | No |
| `draft` | Work-in-progress plan. Being authored but not yet reviewed or accepted. | No |
| `active` | Accepted plan. Ready to drive implementation. | Yes |
| `completed` | Plan has been fully implemented. Awaiting archive. | No (work is done) |
| `archived` | Plan has been moved to archive. Should not appear in `current.md`. | No |

Only `active` unlocks implementation when planning mode is on.

### How to distinguish plan states

The Phase 2 validator determines plan validity using these deterministic rules:

1. **No metadata block?** → Invalid. File has no `<!-- pi-plan-meta` sentinel.
2. **Status is `template`?** → Placeholder. Not a real plan. Treat as missing.
3. **Status is `draft`?** → Incomplete. Plan exists but is not ready. Implementation blocked.
4. **Status is `active` AND `slug` is non-empty AND `updated_at` is non-empty?** → Valid plan. Implementation may proceed.
5. **Status is `active` but `slug` or `updated_at` is empty?** → Malformed. Treat as invalid.
6. **Status is `completed` or `archived`?** → Stale. Should be archived or replaced.

No heuristics. No content sniffing. The metadata block is the sole authority.

### Required H2 sections

A valid plan with `status: active` must also contain these H2 sections:

- `## Goal`
- `## Implementation Plan`

Other sections (Current State, Scope, Non-Goals, etc.) are recommended but not required for validation.

## `current.md` — Active Plan Pointer

`current.md` is the stable active-plan pointer. There is always exactly one `current.md`. It either contains a valid active plan or a placeholder/draft indicating no actionable plan exists.

A plan in `current.md` is considered **valid for implementation** when:

- The file exists and is not empty
- It contains the `<!-- pi-plan-meta` sentinel
- The `status` metadata field is `active`
- The `slug` metadata field is non-empty
- The `updated_at` metadata field is non-empty
- It contains `## Goal` and `## Implementation Plan` sections

A plan is considered **invalid or missing** when any of the above conditions fail.

## Archive Naming Convention

Archived plans are stored in `.pi/plans/archive/` with deterministic, sortable filenames:

```
YYYY-MM-DD-HHMM-<slug>.md
```

- Slugs are taken from the plan metadata `slug` field
- Collisions are handled by appending a counter suffix (e.g., `-2`)
- Archives are immutable once written
- The `status` metadata in an archived plan should be set to `archived`

This convention is compatible with `pi-plan`'s archive strategy.

## Plan Lifecycle Commands (Phase 4)

Phase 4 adds explicit lifecycle commands for managing plan transitions.

### `/plan-new [slug]`

Start a new plan for a new task.

Behavior:
1. Inspects the existing `current.md`.
2. If the existing plan is only a template/placeholder, replaces it directly.
3. If the existing plan is meaningful (draft/active/completed with real metadata), prompts the user to archive it first.
4. If the user declines archival, asks for explicit confirmation before overwriting.
5. Creates a fresh `current.md` from the plan template with the provided slug.
6. Opens the editor for the user to author the new plan.
7. Validates after save, reconciles runtime/system status, updates `plans/index.md`.

### `/plan-complete`

Mark the current active plan as completed.

Behavior:
1. Verifies `current.md` exists and contains a meaningful plan (not a template).
2. If not, fails with a clear error.
3. Updates plan-document status in `current.md` to `completed` and `updated_at` to now.
4. Creates an archive snapshot in `plans/archive/` with status `completed`.
5. Resets `current.md` to the empty template.
6. Updates `plans/index.md`.
7. Reconciles runtime/system status.

### `/plan-archive`

Archive the current plan without completing it.

Behavior:
1. Verifies `current.md` contains a meaningful plan (not a template).
2. If the plan is only a template, refuses to create meaningless archive spam.
3. Creates an archive snapshot in `plans/archive/` with status `archived`.
4. Resets `current.md` to the empty template.
5. Updates `plans/index.md`.
6. Reconciles runtime/system status.

### `/plan-list`

Show a compact summary of current and archived plans.

Behavior:
1. Shows the current plan summary (slug, status, updated_at, impl-readiness).
2. Shows up to 20 most recent archived plans with slug, status, filename, and timestamp.
3. Shows total archive count.
4. If `index.md` is missing, explains how to generate it.

### `current.md` After Lifecycle Commands

After `/plan-complete` and `/plan-archive`, `current.md` is always reset to the standard empty template:
- Status: `template`
- Slug: empty
- No real content

This prevents stale plans from misleading the operator. The completed or archived content is preserved in the archive snapshot.

### Archive Snapshot Rules

- Archive snapshots are created by `/plan-complete`, `/plan-archive`, and optionally by `/plan-new` when replacing a meaningful plan.
- Naming convention: `YYYY-MM-DD-HHMM-<slug>.md` with counter suffix for collisions.
- Archives are append-only — existing snapshots are never overwritten.
- Snapshot from `/plan-complete` has status `completed` in its metadata.
- Snapshot from `/plan-archive` and `/plan-new` (archival) has status `archived` in its metadata.
- Template-only plans are never archived.

### `plans/index.md` Automation

`plans/index.md` is rebuilt deterministically after every lifecycle operation. Structure:

```markdown
# Plan Index

## Current
- [current.md](current.md) — <summary>

## Archived Plans
| Slug | File | Status | Archived |
|------|------|--------|----------|
| ... | ... | ... | ... |

## Notes
Archived plans are stored in `archive/` with filenames: `YYYY-MM-DD-HHMM-<slug>.md`
```

The index is rebuilt by scanning `current.md` and all files in `plans/archive/`. It is not a manual file.

## Plan Restore/Resume Commands (Phase 5)

Phase 5 adds commands to inspect, restore, and resume archived plans.

### `/plan-show [archive-name|slug]`

Inspect an archived plan without making it current.

Behavior:
1. Resolves the target archive by exact filename, slug match, or interactive selection.
2. Shows plan metadata and a concise content summary.
3. Does not mutate `current.md`, runtime state, or system status.

If no argument is given, presents a selection of recent archived plans.

### `/plan-restore [archive-name|slug]`

Copy an archived plan back into `current.md` as a draft.

Behavior:
1. Resolves the target archive deterministically.
2. If `current.md` contains a meaningful plan (draft/active/completed), prompts the user:
   - Archive current plan first, then restore
   - Replace current plan directly (discard)
   - Cancel
3. Copies the archived plan content into `current.md`.
4. Mutates restored metadata: sets `status: draft`, updates `updated_at`, preserves slug.
5. The archive file in `plans/archive/` is not modified or removed — restore is a copy, not a move.
6. Reconciles runtime/system status (typically becomes `plan-required`).
7. Rebuilds `plans/index.md`.

After restore, use `/plan` to edit the restored plan and set it to `active` when ready.

### `/plan-resume [archive-name|slug]`

Restore an archived plan and immediately open the editor for revision.

Behavior:
1. Performs the same restore behavior as `/plan-restore`.
2. Then opens the guided plan editor (same flow as `/plan`).
3. Encourages the user to revise the restored plan before continuing.
4. After save, validates and reconciles runtime/system status.
5. The restored plan does not automatically become `active` — the user controls that via the metadata in the editor.

### Archive Resolution Rules

Archive targets are resolved deterministically:
1. Exact filename match (with or without `.md` suffix)
2. Exact slug match against parsed metadata
3. If multiple archives share the same slug → ambiguous, user is presented with choices
4. If no match → fails with a clear error

When no argument is given, `/plan-show`, `/plan-restore`, and `/plan-resume` present an interactive selection of recent archived plans.

### Restore Semantics

- Restoring does not destroy archive files — restore is a copy into `current.md`.
- Restored `current.md` represents working state, not historical archive state.
- Restored metadata defaults to `status: draft` with a fresh `updated_at`.
- Meaningful current content is never silently replaced — the user must confirm.
- After restore, runtime/system status is usually `plan-required` (unless the user edits to `active`).

## Debug Log Location (Phase 3)

Debug logs are written to `.pi/plans/debug/` when `debugMode` is true. All contents of this directory except `.gitkeep` are gitignored.

### Log Files

| File | Purpose |
|------|---------|
| `current.log` | Overwritten at each session start. Contains logs for the current/last session only. |
| `<timestamp>-session.log` | Append-only session-specific log. Persists across sessions for history. |

### Log Format

JSONL (one JSON object per line). Each entry contains:

| Field | Description |
|-------|-------------|
| `ts` | ISO 8601 timestamp |
| `event` | Event name (e.g., `session_start`, `tool_call`, `command:plan-on`) |
| `status` | Current system status (`off`, `plan-required`, `plan-ready`) |
| `planMode` | Whether planning mode is on |
| `debugMode` | Whether debug mode is on |
| `planPath` | Current plan path |
| `details` | Event-specific details (tool name, allowed/blocked, reasons, etc.) |

### Logged Events

- `session_start`, `session_switch`, `session_shutdown`
- `before_agent_start`
- `context_prune` (when stale planning messages are removed)
- `command:plan-on`, `command:plan-off`, `command:plan`, `command:plan-status`
- `command:plan-debug-on`, `command:plan-debug-off`, `command:plan-debug`
- `command:plan-new`, `command:plan-complete`, `command:plan-archive`, `command:plan-list`
- `command:plan-show`, `command:plan-restore`, `command:plan-resume`
- `tool_call` (allowed vs blocked, with tool name and reason)
- `plan_validated` (after `/plan` or `/plan-new` saves)
- `reconcile` (status transitions)
- `archive_created` (after a snapshot is written to `plans/archive/`)
- `archive_resolution` (archive target resolution results for restore/show)
- `restore_confirmation` (which branch the user chose: archive+replace, replace, cancel)
- `restore_cancelled` (user cancelled a restore operation)
- `restored_metadata` (metadata transformation from archived to draft)
- `plan_shown` (archive inspected via `/plan-show`)
- `index_updated` (after `plans/index.md` is rebuilt)
- `current_plan_reset` (after `current.md` is reset to the empty template)
- `lifecycle_validation_failure` (when a lifecycle command cannot proceed)

### `/plan-debug`

Shows:
- Whether debug mode is on and whether logging is active
- Debug directory, current log path, session log path, session ID
- Log format description
- Recent session log filenames
- List of all logged event categories (including Phase 4 lifecycle and Phase 5 restore/resume events)

## System Status Model

The system-level status in `planning-state.json` describes the overall planning enforcement state. It is distinct from the plan-level `status` metadata in `current.md`.

### `"off"`

Planning mode is inactive. Normal agent behavior — no plan enforcement.

### `"plan-required"`

Planning mode is active, but no valid plan exists in `current.md` (plan-level status is not `active`, or metadata is missing/malformed). Implementation is **blocked**.

### `"plan-ready"`

Planning mode is active and `current.md` contains a valid plan with `status: active`. Implementation may proceed according to the plan.

## Hard Tool Enforcement (Phase 3)

When planning mode is on (`planMode: true`), the extension enforces a hard tool whitelist via the `tool_call` hook. This applies to **both** `plan-required` and `plan-ready` states.

### Whitelist

Only these tools are allowed while planning mode is on:

- `read`
- `grep`
- `ls`
- `find`

All other tools are blocked with an explicit reason explaining:
- Planning mode is active
- Which tools are allowed
- How to create a plan (`/plan`) or disable planning mode (`/plan-off`)

### `/plan-on` = Inspect-and-Plan Mode

`/plan-on` activates the whitelist. The whitelist stays active for **both** `plan-required` and `plan-ready` states. There is no automatic unlock when a valid plan is created.

`/plan-off` disables planning mode and restores normal agent behavior with all tools available.

### Why `plan-ready` Still Blocks

This MVP treats `/plan-on` as inspect-and-plan mode. The user explicitly enters planning mode to investigate and write a plan, then explicitly exits with `/plan-off` to begin implementation. This prevents accidental implementation while the user is still thinking.

### Commands Are Not Blocked

Extension commands (`/plan`, `/plan-on`, `/plan-off`, `/plan-status`, `/plan-debug-on`, `/plan-debug-off`, `/plan-debug`) are not agent tools and are not affected by the whitelist. The user can always use `/plan` to create or update a plan even while tool enforcement is active.

### Whitelist Approach

This is a **whitelist approach**, not a blocklist:

- New tools added to the agent are blocked by default during planning mode
- Only explicitly whitelisted tools are permitted
- The whitelist is intentionally minimal to support read-only investigation while blocking implementation

## Persistent State Rules

### `/plan-on`

- Sets `planMode: true` in `planning-state.json`
- Validates `current.md` metadata and transitions to `"plan-required"` or `"plan-ready"`
- **Persists to disk** — survives Pi process restarts
- Creates `planning-state.json` from `planning-state.example.json` if it does not exist
- If status is `plan-required`, prompts the user to create/edit a plan via `/plan`

### `/plan-off`

- Sets `planMode: false` in `planning-state.json`
- Transitions system status to `"off"`
- **Persists to disk** — restores normal agent behavior across restarts

### `/plan`

- Opens the guided plan editor for `.pi/plans/current.md`
- If `current.md` does not exist, scaffolds from the plan template
- Validates the result after save and updates runtime state

### `/plan-status`

- Shows current runtime state: plan mode, debug mode, system status, plan validity, metadata

### `/plan-debug-on` / `/plan-debug-off`

- Toggles `debugMode` in `planning-state.json`
- Persists to disk

### `/plan-debug`

- Shows debug mode status, log paths, session ID, and recent session logs
- Shows what events are logged and the log format
- Debug logging writes JSONL to `.pi/plans/debug/` when `debugMode` is true

## Rule: No Implementation While Planning Mode Is On

When planning mode is active, this rule is absolute:

> Implementation tools are blocked via hard whitelist enforcement. Only `read`, `grep`, `ls`, and `find` are available. This applies to both `plan-required` and `plan-ready` states.

To implement, the user must run `/plan-off` to exit planning mode and restore all tools.

If planning mode is on and no valid active plan exists (`plan-required`), the system routes the user to `/plan` to create or fix the plan. If a valid plan exists (`plan-ready`), the whitelist still applies — the user must explicitly `/plan-off` to begin implementation.
