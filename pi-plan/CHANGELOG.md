# Changelog

## 2.2.0 — Branch finishing workflow

### Added
- **`/plan-finish` command** — manually trigger the branch finishing workflow (merge, PR, keep, discard)
- **`finish.ts`** — deterministic branch finishing module with ExecFn seam for testability
- **`"finishing"` phase** — new `AutoPlanPhase` state with write-gating during finishing workflow
- **2 new config options** — `defaultFinishAction` (FinishAction | null), `prTemplate` (string | null)
- **`finish.test.ts`** — 28 tests for finishing module (merge, PR, keep, discard, PR body generation)
- **`finishing-phase.test.ts`** — 10 tests for finishing phase display, write-gating, serialization

### Changed
- `auto-plan.ts` — `AutoPlanPhase` expanded from 8 to 9 phases
- `hooks.ts` — `handleAgentEnd` now orchestrates finishing workflow; `handleToolCallGate` blocks writes during finishing; `handleSessionStart` degrades finishing → has-plan on restore; `HookContext.ui` extended with `select` and `input`
- `worktree.ts` — `cleanupWorktree` now accepts `opts?: { deleteBranch?: boolean }` (default true)
- `config.ts` — added 2 new fields to `PiPlanConfig`
- `index.ts` — registered `/plan-finish` command; imports from `finish.ts`
- Test count: 533 → 571 across 22 → 24 files
- Updated all documentation

## 2.1.0 — TDD enforcement, brainstorming, worktree isolation

### Added
- **`/tdd` command** — toggle TDD enforcement and show compliance summary
- **`submit_spec` tool** — submit design spec during brainstorming phase (params: `specPath` required, `summary` optional)
- **`tdd.ts`** — TDD gate logic, test file detection via configurable globs, step completion validation, daily compliance logging
- **`brainstorm.ts`** — brainstorming spec I/O with `YYYY-MM-DD-HHMM-slug.md` naming, spec listing/reading, `SPEC_TEMPLATE` support
- **`worktree.ts`** — git worktree isolation with `plan/<slug>` branches, setup command detection, state persistence, gitignore management
- **`brainstorming` phase** — new `AutoPlanPhase` state for design-first workflow
- **`executing` phase** — new `AutoPlanPhase` state for active step tracking with TDD gating
- **7 new config options** — `tddEnforcement` (bool), `testFilePatterns` (string[]), `brainstormEnabled` (bool), `worktreeEnabled` (bool), `specDir` (string), `tddLogDir` (string), `worktreeStateDir` (string)
- **3 new `.pi/` subdirectories** — `specs/` (brainstorm specs), `tdd/` (compliance logs), `worktrees/` (state)
- **`.worktrees/` directory** — gitignored repo-root directory for git worktree working copies
- **`tdd.test.ts`** — TDD gate logic, glob-to-regex, test file detection, compliance logging
- **`brainstorm.test.ts`** — spec I/O, filename generation, listing, immutability
- **`worktree.test.ts`** — worktree creation/cleanup, state persistence, branch derivation, gitignore
- **`auto-plan.test.ts`** — 8-phase state machine, phase computation, context messages, serialization
- **`harness.test.ts`** — input evaluation for all phases, never-blocks invariant
- **`phase4.test.ts`** — integration tests for TDD gating, brainstorm-to-plan transition, worktree lifecycle

### Changed
- `auto-plan.ts` — `AutoPlanPhase` expanded from 4 to 8 phases; `AutoPlanState` now includes `tddStepTestWritten`, `worktreeActive`, `worktreePath`, `brainstormSpecPath`
- `config.ts` — added 7 new fields to `PiPlanConfig`
- `index.ts` — registered `/tdd` command, `submit_spec` tool; write-gating extended for brainstorming, TDD, and worktree phases
- `defaults.ts` — added `SPEC_TEMPLATE`
- Test count: 452 → 533 across 19 → 22 files
- Updated all documentation (README, AGENTS.md, architecture.md, file-contracts.md, CONTRIBUTING.md, RELEASE_CHECKLIST.md, TESTING.md)

## 2.0.1 — cleanup

### Changed
- Renamed `assets/plannotator.html` → `assets/plan-review.html` and updated all references in source, docs, and error messages.

### Added
- `tests/smoke.test.ts` — smoke integration test proving the extension entrypoint loads and registers all expected commands, tools, flags, and event hooks without a running Pi instance.

452 tests across 19 files.

## 2.0.0 — plannotator merge

Major release merging plannotator's browser-based review capabilities into pi-plan.

### Added
- **`submit_plan` tool** — agent-callable tool for browser-based plan review with approve/deny/annotate
- **`/plan-review` command** — interactive code review UI for git diffs
- **`/plan-annotate` command** — markdown file annotation UI
- **`--plan` flag** — start with plan enforcement enabled
- **`review-pending` phase** — state machine phase for pending browser review
- **Review records** — append-only JSON records under `.pi/plans/reviews/`
- **Checkbox step support** — `- [ ] Step` format alongside `1. Step` numbered format
- **`## Steps` section support** — alternative section header for step extraction
- **Legacy PLAN.md migration** — auto-detect and migrate plannotator's root-level PLAN.md
- **Write-gating** — blocks file writes outside current.md during needs-plan phase
- **`PI_PLAN_BROWSER` env var** — custom browser for review UIs
- **`reviewDir` config** — configurable review records directory
- **`stepFormat` config** — configurable step format preference (numbered/checkbox/both)
- **HTML assets** — pre-built plannotator.html and review-editor.html in assets/
- **browser.ts** — extracted browser launcher module
- **server.ts** — ephemeral HTTP servers for plan/code/annotate review (no home-dir state)
- **review.ts** — review orchestration coordinating browser lifecycle

### Changed
- Version bumped to 2.0.0
- `auto-plan.ts` — added `review-pending` phase to `AutoPlanPhase`
- `mode-utils.ts` — `extractStepsFromPlan` now supports both numbered and checkbox formats
- `config.ts` — added `reviewDir` and `stepFormat` fields
- `diagnostics.ts` — snapshot includes review state, asset availability, review record count
- `index.ts` — added tool_call hook for write-gating, flag registration, session reconstruction for review-pending

### Removed
- All plannotator attribution
- All `~/.plannotator/` home-directory state references
- Auto-approve fallback (returns error if browser UI unavailable)
- `/plannotator*` command namespace

### Non-negotiable constraints
- Repo filesystem is canonical — no home-directory state
- No auto-approve — browser UI required for review
- `current.md` is the only mutable active plan
- Archives and review records are immutable/append-only

446 tests across 18 files.

## 1.0.0 — Phase 9 (release-ready)

- Renamed `checkTemplateBeforeGeneration` → `ensureTemplateUsable` in `orchestration.ts` to match docs
- Removed backward-compatibility re-exports from `plangen.ts`; import template primitives from `template-core.ts` directly
- Audited and updated all docs (README, AGENTS.md, architecture.md, file-contracts.md, TESTING.md) for accuracy
- Bumped version to 1.0.0

No behavior changes. All 308 tests pass.

## 0.1.0 — Phases 0–8

Initial development through template system consolidation. See README.md for phase-by-phase history.
