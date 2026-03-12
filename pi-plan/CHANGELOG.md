# Changelog

## 1.0.0 — Phase 9 (release-ready)

- Renamed `checkTemplateBeforeGeneration` → `ensureTemplateUsable` in `orchestration.ts` to match docs
- Removed backward-compatibility re-exports from `plangen.ts`; import template primitives from `template-core.ts` directly
- Audited and updated all docs (README, AGENTS.md, architecture.md, file-contracts.md, TESTING.md) for accuracy
- Bumped version to 1.0.0

No behavior changes. All 308 tests pass.

## 0.1.0 — Phases 0–8

Initial development through template system consolidation. See README.md for phase-by-phase history.
