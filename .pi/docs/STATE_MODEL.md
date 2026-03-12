# State Model

This document describes the runtime state model in `.pi/planning-state.json`.

The live state file is **not committed** — it is gitignored local runtime state. The committed file `.pi/planning-state.example.json` defines the default shape and is used as a template on first run.

## Fields

### `version`

- **Type**: `number`
- **Current value**: `1`
- **Purpose**: Schema version for forward compatibility. A future extension reads this to know how to interpret the rest of the file.
- **Category**: Set once at creation. Incremented only on schema changes.

### `planMode`

- **Type**: `boolean`
- **Purpose**: Whether planning mode is active. Set by future `/plan-on` (true) and `/plan-off` (false) commands.
- **Persistence**: Written to local disk. Survives Pi process restarts. Not committed to git.
- **Category**: Runtime state. Can be manually edited in emergencies.

### `debugMode`

- **Type**: `boolean`
- **Purpose**: Whether debug/diagnostic logging is enabled. When true, future `/plan-debug` writes detailed snapshots to `.pi/plans/debug/`.
- **Category**: Runtime state. Can be manually toggled.

### `status`

- **Type**: `string` — one of `"off"`, `"plan-required"`, `"plan-ready"`
- **Purpose**: The computed system-level planning status. Derived from `planMode` and the validity of `current.md` metadata.
- **Persistence**: Written to local disk as a cached value. Recomputed on state transitions.
- **Category**: Runtime state (derived). Should not be manually edited — it is recomputed.

#### System status values

| Status | Meaning |
|--------|---------|
| `"off"` | Planning mode inactive. No enforcement. |
| `"plan-required"` | Planning mode active, but `current.md` does not have `status: active`. Implementation is blocked. |
| `"plan-ready"` | Planning mode active and `current.md` has `status: active` with valid metadata. Tool whitelist still enforced until `/plan-off`. |

### `currentPlanPath`

- **Type**: `string`
- **Purpose**: Repo-relative path to the active plan file. Always `".pi/plans/current.md"` unless the protocol changes.
- **Category**: Structural constant. Set at creation.

### `lastValidatedAt`

- **Type**: `string | null` — ISO 8601 timestamp or null
- **Purpose**: When the plan state was last validated (metadata checked against `current.md`). Null means never validated.
- **Category**: Runtime state. Set by extension logic.

### `lastKnownSlug`

- **Type**: `string | null`
- **Purpose**: The slug of the last known active plan (from `current.md` metadata). Used for continuity — if a plan is archived and a new one created, this tracks what was last active. Null means no plan has been active yet.
- **Category**: Runtime state. Set by extension logic.

## Two Levels of Status

This system has two distinct status concepts that must not be confused:

### System status (`planning-state.json` → `status` field)

Describes whether the planning enforcement system is active and whether implementation is allowed. Values: `"off"`, `"plan-required"`, `"plan-ready"`.

### Plan status (`current.md` → `status` metadata key)

Describes the lifecycle of the plan document itself. Values: `template`, `draft`, `active`, `completed`, `archived`.

The system status is **derived from** the plan status:
- If `planMode` is false → system status is `"off"`
- If `planMode` is true and plan status is `active` (with valid slug and updated_at) → system status is `"plan-ready"`
- If `planMode` is true and plan status is anything else → system status is `"plan-required"`

## Relationship to `current.md`

`planning-state.json` and `current.md` are complementary:

- **`planning-state.json`** is the machine-readable toggle and system status cache (runtime, gitignored)
- **`current.md`** is the human-readable plan content with metadata (committed)

The system `status` field in `planning-state.json` is derived from:
1. Whether `planMode` is true or false
2. Whether `current.md` has `status: active` in its metadata block, with non-empty `slug` and `updated_at`

## Status Transitions

```
                    /plan-on                     plan status → active
    ┌─────┐  ──────────────────>  ┌───────────────┐  ──────────────>  ┌────────────┐
    │ off │                       │ plan-required  │                   │ plan-ready  │
    └─────┘  <──────────────────  └───────────────┘  <──────────────  └────────────┘
                    /plan-off                     plan status ≠ active
                                       /plan-off
                    ┌────────────────────────────────────────────────>  ┌─────┐
                    │                                                   │ off │
                    └────────────────────────────────────────────────<  └─────┘
```

Transitions are triggered by:
- `/plan-on` → `off` → `plan-required` or `plan-ready` (depends on `current.md` metadata)
- `/plan-off` → any → `off`
- Setting plan `status: active` in `current.md` → `plan-required` → `plan-ready`
- Setting plan `status` to anything other than `active` → `plan-ready` → `plan-required`
- `/plan-complete` → resets `current.md` to template → `plan-ready` → `plan-required`
- `/plan-archive` → resets `current.md` to template → `plan-ready` → `plan-required`
- `/plan-new` → creates fresh plan from template → status depends on what user writes
- `/plan-restore` → copies archive into `current.md` as draft → usually `plan-required`
- `/plan-resume` → same as restore, then opens editor → status depends on what user writes

## Filesystem as Source of Truth

The filesystem is the authoritative source of truth:

- `planning-state.json` on local disk is the authoritative runtime state — not in-memory caches
- `current.md` on disk is the authoritative plan content and metadata
- If `planning-state.json` is missing, the extension treats it as default state and creates it from `planning-state.example.json`
- If `planning-state.json` is stale or inconsistent with `current.md`, reconciliation re-derives system `status` from the plan metadata
- No database, no remote service — everything is local files

This design ensures:
- Runtime state survives process restarts
- Runtime state can be inspected and fixed by humans with a text editor
- Runtime state does not dirty git — each developer has their own local copy
- Plan content and protocol docs are version-controlled and shared

## Field Categories

| Field | Set by | Runtime or committed? | Safe to edit manually? |
|-------|--------|----------------------|----------------------|
| `version` | Creation / migration | Runtime (local) | No (unless migrating) |
| `planMode` | `/plan-on`, `/plan-off` | Runtime (local) | Yes (emergency toggle) |
| `debugMode` | Extension commands | Runtime (local) | Yes |
| `status` | Extension logic (derived) | Runtime (local) | No (will be overwritten) |
| `currentPlanPath` | Creation | Runtime (local) | No |
| `lastValidatedAt` | Extension logic | Runtime (local) | No |
| `lastKnownSlug` | Extension logic | Runtime (local) | No |
