# `.pi/` — Repo-Local Planning Workspace

> **This is the repo-local planning workspace for the `pi-extensions` repository itself.**
> It is **not** the distributable `pi-plan` package.
>
> The canonical shareable planning extension lives in [`pi-plan/`](../pi-plan/).
> Users who want to install the planning extension should go there.

This directory contains planning protocol definitions, plan files, and documentation used to develop and maintain the `pi-extensions` repository. Files here are normal repo-local planning artifacts — they are not part of any installable package.

## What Phase 1 Establishes

Phase 1 creates the filesystem protocol foundation and persistent state model for a planning-mode MVP:

- **`PLANNING_PROTOCOL.md`** — Human-readable protocol rules (source of truth)
- **`planning-state.example.json`** — Default shape for the runtime state file (moved to `legacy/` — legacy-only, not used by `pi-plan/`)
- **`plans/current.md`** — Active plan template/pointer
- **`plans/index.md`** — Plan index (current + archived)
- **`plans/archive/`** — Archived plans directory
- **`plans/debug/`** — Debug/diagnostic log directory
- **`docs/STATE_MODEL.md`** — State model documentation

## What Phase 2 Added

- **`.pi/legacy/planning-protocol.ts`** (originally `.pi/extensions/planning-protocol.ts`) — Project-local Pi extension implementing:
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

## Possible future additions (to this repo-local workspace)

> **Note:** Package extraction is complete — the canonical shareable extension is [`pi-plan/`](../pi-plan/). The items below would only apply to this repo-local workspace if the legacy extension were revived, which is not planned.

- Prompt templates under `.pi/prompts/`
- Implementation-mode unlock while planning mode is still on
- Archive deletion/cleanup UI
- Log rotation/pruning

## Where Things Live

### Committed — protocol and documentation

| Path | Purpose |
|------|---------|
| `PLANNING_PROTOCOL.md` | Protocol rules — shared conventions with `pi-plan/`, legacy command reference |
| `README.md` | This file |
| `docs/STATE_MODEL.md` | Legacy state model docs (historical — `pi-plan/` uses a different model) |
| `docs/DEBUGGING.md` | Legacy debug system documentation (historical — `pi-plan/` uses `/plan-debug`) |
| `docs/EXTENSION_BEHAVIOR.md` | Legacy extension internals and architecture (historical) |
| `docs/OPERATOR_WORKFLOWS.md` | Legacy operator workflows and validation checklist (historical — see `pi-plan/README.md` for current validation) |
| `legacy/planning-state.example.json` | Default state shape for legacy extension (not used by `pi-plan/`) |

### Historical / legacy reference

| Path | Purpose |
|------|---------|
| `legacy/planning-protocol.ts` | Historical predecessor to `pi-plan` (not auto-loaded — see note below) |
| `legacy/README.md` | Explains why the file was moved |

#### Role of `legacy/planning-protocol.ts`

This file is the **repo-local predecessor** to the `pi-plan` package. It was developed through Phases 1–6 as the original planning-mode extension (a single monolithic `.ts` file implementing commands like `/plan-on`, `/plan-off`, `/plan-status`, `/plan`, tool-call whitelist enforcement, and debug logging).

The canonical shareable planning extension now lives in [`pi-plan/`](../pi-plan/), which was built as a properly packaged, tested, and modular replacement.

This file was moved from `.pi/extensions/` to `.pi/legacy/` to prevent Pi's project-local auto-discovery (`.pi/extensions/*.ts`) from loading it alongside `pi-plan/`. It is preserved for historical/design reference only.

**For new contributors:** The canonical planning extension is `pi-plan/`. Do not move this file back to `.pi/extensions/`.

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

This repo-local workspace structure is compatible with:

- **`pi-plan` package** ([`../pi-plan/`](../pi-plan/)) — Uses the same `plans/current.md`, `plans/index.md`, and `plans/archive/` conventions. `pi-plan` is the canonical shareable extension; this workspace is where this repository dogfoods the planning workflow.
- **Pi project-local resources** — Lives under `.pi/` as Pi expects
- **Future prompt templates** — May go under `.pi/prompts/`

## Workspace recommendation

**Keep root `.pi/` as a permanent repo-local dogfooding workspace.** Rationale:

- The `plans/` directory is actively used by `pi-plan` for this repository's own planning workflow. Removing it would break that.
- The protocol and documentation files provide useful historical context for the design decisions behind `pi-plan/`.
- The `legacy/` directory preserves the original monolithic implementation for reference without interfering with runtime (it is outside `.pi/extensions/`).
- The `docs/` files now carry historical-document banners, so they will not mislead new contributors into thinking they describe the current `pi-plan/` runtime.

What could be trimmed later if desired:
- `planning-state.json` is only used by the legacy extension at runtime (already gitignored). `planning-state.example.json` has been moved to `legacy/`.
- `PLANNING_PROTOCOL.md` could eventually be merged into a lighter reference, but it is harmless as-is.

No large deletions are recommended at this time.
