# pi-plan + plannotator Merge — Handoff Document

## What we're doing

Merging two Pi extensions — `pi-plan` (repo-local planning) and `plannotator` (browser-based plan review/annotation) — into one unified extension under `pi-plan`. pi-plan is the core; plannotator contributes visual review, code review, and markdown annotation as a layer on top.

## Why

- pi-plan has the right architecture: canonical state in repo files under `.pi/`, immutable archives, deterministic index regeneration, confirmation gates, 308+ tests, 12 focused modules.
- plannotator has browser-based review UX that pi-plan lacks: approve/deny/annotate plans visually, code review with git diff annotation, markdown file annotation.
- plannotator has architectural problems: hidden authoritative state under `~/.plannotator/history/`, auto-approve fallback in non-interactive mode, no archiving, no config, no tests, `PLAN.md` at repo root instead of `.pi/plans/current.md`.
- The merge fixes all of these by placing plannotator's review capabilities on top of pi-plan's deterministic filesystem model.

## Non-negotiable constraints

1. **Repo filesystem is canonical.** No `~/.plannotator/` or any home-dir state. No second source of truth.
2. **Canonical layout stays repo-local.** Plans live at `.pi/plans/current.md`, archives at `.pi/plans/archive/`, etc.
3. **Deterministic write model.** `current.md` is the only mutable active plan. Archives are immutable. `index.md` is regenerated from disk. Destructive actions require confirmation. No auto-approve.
4. **One extension, one command/tool namespace.** Not two glued extensions.

## Decisions already made

- **HTML assets**: Ship pre-built in `assets/` (committed artifacts, no build step for consumers).
- **Plan diff**: Archive-based — most recent `.pi/plans/archive/*.md` as previous version for browser diff display.
- **Attribution**: All plannotator attribution stripped.
- **Package name**: `pi-plan`, version 2.0.0.
- **Tool name**: `submit_plan` (replaces plannotator's `exit_plan_mode`).
- **Commands**: `/plan-review` (code review), `/plan-annotate` (annotation). `/plannotator*` commands removed.
- **Env var**: `PI_PLAN_BROWSER` replaces `PLANNOTATOR_BROWSER`.

## 5-phase implementation plan

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Architecture consolidation — copy/clean server.ts, extract browser.ts, create assets/, review.ts skeleton, package.json bump, AGENTS.md update | **In progress** — file creation done, validation remaining (see below) |
| **Phase 2** | Canonical filesystem + migration — extend init/config/state for reviews, merge step formats (numbered + checkbox) | Not started |
| **Phase 3** | Review/annotation integration — implement submit_plan tool, review.ts, /plan-review, /plan-annotate, write gating during planning | Not started |
| **Phase 4** | State/session/branch correctness — review-pending phase, --plan flag, Ctrl+Alt+P, session reconstruction | Not started |
| **Phase 5** | Polish, diagnostics, docs | Not started |

## Phase 1 — what's already done

| File | Action | Status |
|---|---|---|
| `pi-plan/browser.ts` | Created — `openBrowser()` extracted from plannotator server.ts | ✅ |
| `pi-plan/server.ts` | Created — cleaned from plannotator, all `~/.plannotator/history/` code deleted, `previousPlan` is now an explicit parameter | ✅ |
| `pi-plan/review.ts` | Created — skeleton with stubbed exports (Phase 3 implementation) | ✅ |
| `pi-plan/package.json` | Version bumped to 2.0.0 | ✅ |
| `pi-plan/tests/server.test.ts` | Created — tests for all three server types | ✅ |
| `pi-plan/tests/browser.test.ts` | Created — smoke tests for openBrowser | ✅ |
| `pi-plan/AGENTS.md` | Updated — new module ownership, invariants 20-21, extension points | ✅ |
| `pi-plan/assets/` | NOT YET CREATED — needs HTML build (see below) | ⏸ |

## Phase 1 — remaining validation steps (this document)

# Phase 1 Remaining Actions

## Step 1-2: Build and copy HTML assets

```bash
cd ~/dev/pi-extensions/plannotator && bun install && bun run build:pi
mkdir -p ~/dev/pi-extensions/pi-plan/assets
cp ~/dev/pi-extensions/plannotator/apps/pi-extension/plannotator.html ~/dev/pi-extensions/pi-plan/assets/
cp ~/dev/pi-extensions/plannotator/apps/pi-extension/review-editor.html ~/dev/pi-extensions/pi-plan/assets/
```

## Step 12: Run tests

```bash
cd ~/dev/pi-extensions/pi-plan && npm test
```

All existing 308+ tests must pass. New server.test.ts and browser.test.ts must pass.

## Step 13: Load extension

```bash
pi -e ~/dev/pi-extensions/pi-plan
```

Verify: extension loads without errors. `/plan` and `/plan-debug` work unchanged. No new commands appear yet (review commands are Phase 3).

## Step 14: Verify no home-dir references

```bash
grep -r "\.plannotator" ~/dev/pi-extensions/pi-plan/ --include="*.ts" | grep -v node_modules
grep -r "os\.homedir" ~/dev/pi-extensions/pi-plan/ --include="*.ts" | grep -v node_modules
```

Both must return zero matches.

## After Phase 1 validation passes

Proceed to Phase 2: Canonical Filesystem + Migration Layer (see architecture plan in this session).
