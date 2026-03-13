# Changelog

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
