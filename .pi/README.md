# `.pi/` — Repo-Local Pi Resources

This directory contains repo-local resources for [Pi Coding Agent](https://github.com/badlogic/pi-mono), including planning protocol definitions, plan files, and documentation.

## What Phase 1 Establishes

Phase 1 creates the filesystem protocol foundation and persistent state model for a planning-mode MVP:

- **`PLANNING_PROTOCOL.md`** — Human-readable protocol rules (source of truth)
- **`planning-state.example.json`** — Default shape for the runtime state file
- **`plans/current.md`** — Active plan template/pointer
- **`plans/index.md`** — Plan index (current + archived)
- **`plans/archive/`** — Archived plans directory
- **`plans/debug/`** — Debug/diagnostic log directory
- **`docs/STATE_MODEL.md`** — State model documentation

## What Phase 2 Added

- **`.pi/extensions/planning-protocol.ts`** — Project-local Pi extension implementing:
  - `/plan-on`, `/plan-off` — toggle planning mode with persistent state
  - `/plan-status` — show runtime state, plan validity, and system status
  - `/plan` — guided plan creation/editing for `plans/current.md`
  - `/plan-debug-on`, `/plan-debug-off`, `/plan-debug` — debug mode controls
  - Footer status and widget UI
  - `before_agent_start` context injection when plan mode is on
  - Deterministic plan metadata parsing and validation
  - Runtime state bootstrap from `planning-state.example.json`

## What Phase 3 Added

- **Hard tool_call whitelist enforcement** — When planning mode is on (both `plan-required` and `plan-ready`), only `read`, `grep`, `ls`, `find` are allowed. All other tools are blocked via the `tool_call` hook with an explicit reason.
- **`/plan-on` = inspect-and-plan mode** — The whitelist stays active until `/plan-off`. There is no automatic unlock.
- **Real debug logging** — When `debugMode` is true, JSONL logs are written to `.pi/plans/debug/current.log` (overwritten per session) and a session-specific log file.
- **Context pruning** — Planning-protocol injected messages no longer accumulate; only the newest is kept. When planning mode is off, all are removed.
- **Upgraded `/plan-debug`** — Shows real log paths, session ID, recent session logs, and what events are logged.

## What Phase 4 Adds

- **`/plan-new [slug]`** — Start a new plan. If the current plan is meaningful (draft/active/completed), prompts the user to archive it first before replacing. Opens the editor with a fresh template.
- **`/plan-complete`** — Mark the current plan as completed, create an archive snapshot with status `completed`, reset `current.md` to the empty template, and update `plans/index.md`.
- **`/plan-archive`** — Archive the current plan (with status `archived`), reset `current.md` to the empty template, and update `plans/index.md`. Refuses to archive template placeholders.
- **`/plan-list`** — Show a compact summary of the current plan and all archived plans.
- **Deterministic `plans/index.md` automation** — `index.md` is rebuilt automatically after every lifecycle operation (`/plan`, `/plan-new`, `/plan-complete`, `/plan-archive`).
- **Archive snapshot creation** — Deterministic, append-only snapshots in `plans/archive/` using the `YYYY-MM-DD-HHMM-<slug>.md` naming convention with collision avoidance.
- **`current.md` lifecycle semantics** — After `/plan-complete` and `/plan-archive`, `current.md` is reset to the empty template (status: `template`, no slug). This prevents stale active plans from misleading the operator.
- **Extended debug logging** — New events: `command:plan-new`, `command:plan-complete`, `command:plan-archive`, `command:plan-list`, `archive_created`, `index_updated`, `current_plan_reset`, `lifecycle_validation_failure`.

## What Phase 5 Adds

- **`/plan-show [archive-name|slug]`** — Inspect an archived plan without modifying `current.md` or runtime state. Shows metadata and content summary. Supports interactive selection if no argument is given.
- **`/plan-restore [archive-name|slug]`** — Copy an archived plan back into `current.md` as a draft. Prompts before replacing meaningful current content. Offers to archive the current plan first. Archive files remain untouched.
- **`/plan-resume [archive-name|slug]`** — Restore an archived plan and immediately open the editor for revision. Performs restore, then launches the guided plan flow.
- **Deterministic archive resolution** — Resolves archive targets by exact filename, slug match, or interactive selection. Fails clearly on ambiguity.
- **Safe restore semantics** — Restored plans default to `status: draft` with fresh `updated_at`. Meaningful current content is never silently replaced.
- **Extended debug logging** — New events: `command:plan-show`, `command:plan-restore`, `command:plan-resume`, `archive_resolution`, `restore_confirmation`, `restore_cancelled`, `restored_metadata`, `plan_shown`.

## What Phase 6 Adds

- **`docs/DEBUGGING.md`** — Complete debug system documentation: log format, event reference, diagnosis patterns, limitations
- **`docs/EXTENSION_BEHAVIOR.md`** — Internal extension architecture: discovery, hooks, state management, parsing, enforcement, UI components
- **`docs/OPERATOR_WORKFLOWS.md`** — Step-by-step workflows for all commands, common mistakes and recovery, validation/regression checklist
- **Documentation consistency pass** — Verified all docs match the actual implementation (commands, whitelist, status model, restore/resume behavior, debug events)
- **Small operator-hardening fix** — `/plan-status` now shows explicit recovery hints when in `plan-required` state

## What Later Phases Will Add

- **Future**: Prompt templates under `.pi/prompts/`
- **Future**: Package extraction / npm shareable structure
- **Future**: Integration with `pi-plan` extension for plan generation
- **Future**: Implementation-mode unlock while planning mode is still on
- **Future**: Archive deletion/cleanup UI
- **Future**: Log rotation/pruning

## Where Things Live

### Committed — protocol and documentation

| Path | Purpose |
|------|---------|
| `PLANNING_PROTOCOL.md` | Protocol rules (source of truth) |
| `README.md` | This file |
| `docs/STATE_MODEL.md` | State model docs |
| `docs/DEBUGGING.md` | Debug system documentation |
| `docs/EXTENSION_BEHAVIOR.md` | Extension internals and architecture |
| `docs/OPERATOR_WORKFLOWS.md` | Operator workflows, recovery, validation checklist |
| `planning-state.example.json` | Default state shape (reference/template) |

### Committed — extension code

| Path | Purpose |
|------|---------|
| `extensions/planning-protocol.ts` | Phase 6 planning protocol extension |

### Committed — plan artifacts

| Path | Purpose |
|------|---------|
| `plans/current.md` | Active plan |
| `plans/index.md` | Plan index |
| `plans/archive/` | Archived plans |

### Ignored — runtime state

| Path | Purpose |
|------|---------|
| `planning-state.json` | Live toggle and status cache (created at runtime) |
| `plans/debug/*` | Diagnostic snapshots |

The live `planning-state.json` is created by the extension at runtime by copying `planning-state.example.json`. If it is missing, the extension treats it as default state.

## Compatibility

This structure is designed to be compatible with:

- **`pi-plan` extension** — Uses the same `plans/current.md`, `plans/index.md`, and `plans/archive/` conventions
- **Pi project-local resources** — Lives under `.pi/` as Pi expects
- **Future extensions** — Extension code will go under `.pi/extensions/`
- **Future prompt templates** — Will go under `.pi/prompts/`
