# pi-plan Test Coverage Strategy

## Overview

Tests use **vitest** and run via `npm test`. All tests are pure-helper / module-level tests that exercise logic against temp directories. No tests require a running Pi instance or real git repos.

## Test Files

### `template-core.test.ts`

**Covers**: `template-core.ts` — `parseTemplate()`, `readTemplateSections()`, `TEMPLATE_PLACEHOLDERS`, `buildCurrentStateValue()`.

**Regressions caught**:
- Template parsing fails for valid templates or accepts invalid ones
- H1 skipping broken
- Section body trimming broken
- `TEMPLATE_PLACEHOLDERS` constant drifts
- `readTemplateSections()` fails for missing/empty/valid template files
- `buildCurrentStateValue()` does not use default template when no override
- `buildCurrentStateValue()` ignores custom template
- `buildCurrentStateValue()` does not substitute `{{REPO_ROOT}}` in custom template
- `buildCurrentStateValue()` breaks with null/undefined override
- `buildCurrentStateValue()` output disagrees with manual `DEFAULT_CURRENT_STATE_TEMPLATE` substitution

**Phase 8 addition**: New test file covering the extracted template primitives module.

### `repo.test.ts`

**Covers**: `repo.ts` — path constants, `hasPlanningProtocol()`, `isFullyInitialized()`, `hasCurrentPlan()`, `initPlanning()`, `writeCurrentPlan()`, `detectRepoRootWith()`, `detectPlanStateWith()`.

**Regressions caught**:
- Path constant values drift
- Initialization creates wrong files or overwrites existing ones
- Placeholder detection fails (sentinel matching, empty files, whitespace)
- `writeCurrentPlan()` overwrites a meaningful plan (safe-write guard)
- Missing parent directories cause failures
- Repo detection seam returns wrong values for success/failure/edge cases
- State classification drifts from expected state model
- Exec args are incorrect

**Phase 5 additions**: `detectRepoRootWith()` and `detectPlanStateWith()` are now tested via the injectable `ExecFn` seam. All five state scenarios are covered: no-repo, not-initialized, partially initialized, initialized-no-plan, initialized-has-plan.

### `plangen.test.ts`

**Covers**: `plangen.ts` — `deriveTitle()`, `generatePlan()`, `generatePlanWithMeta()`, `hasAllSections()`, `extractSectionHeadings()`. Also template primitives from `template-core.ts` (`parseTemplate()`, `readTemplateSections()`, `TEMPLATE_PLACEHOLDERS`) and integration with `repo.ts` (`writeCurrentPlan`, `hasCurrentPlan`).

**Regressions caught**:
- Generated plan missing expected sections
- Title derivation fails for edge cases (empty, long, multiline)
- Generated plan contains the placeholder sentinel (critical invariant)
- Plan generation is non-deterministic
- Writing a generated plan doesn't transition state from no-plan to has-plan
- Plan creation modifies other planning files (protocol, template, index)
- Plan creation creates spurious archive files
- Template parsing fails for valid templates
- Template parsing accepts invalid templates
- Custom template sections not reflected in generated plans
- Template body content lost during generation
- Fallback not triggered when template is missing/empty/malformed
- Sentinel leaks through template content
- Placeholder substitution fails for `{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}`
- Multiple placeholders on the same line not all substituted
- Unknown `{{...}}` tokens removed instead of preserved
- Section-name fallback not triggered for legacy templates without placeholders
- Double injection of goal when `{{GOAL}}` is present
- `generatePlanWithMeta()` misreports template usage

**Phase 5 additions**: Template-aware generation is now fully tested.

**Phase 6 additions**: Explicit placeholder substitution tested: `{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}` substitution, multi-placeholder lines, unknown token preservation, section-name fallback for Goal/Current State without placeholders, no double-injection, fallback on missing/malformed templates. `generatePlanWithMeta()` tested; `TEMPLATE_PLACEHOLDERS` tested (imported from `template-core.ts` since Phase 9).

**Phase 7 additions**: `{{CURRENT_STATE}}` configurability tested: default block used when no override, custom `currentStateTemplate` applied correctly, `{{REPO_ROOT}}` substituted within custom template, null/undefined falls back to default. `generatePlanWithMeta()` now returns `templateMode` — tested for all four modes.

**Phase 8 additions**: CURRENT_STATE consistency tested across all three generation paths: section-name fallback uses config override, fallback sections use config override, explicit `{{CURRENT_STATE}}` and section-name fallback produce identical content, default CURRENT_STATE is consistent across all three paths.

### `archive.test.ts`

**Covers**: `archive.ts` — `extractPlanTitle()`, `slugify()`, `archiveFilename()`, `readCurrentPlan()`, `forceWriteCurrentPlan()`, `archivePlan()`, `listArchives()`, `countArchives()`, `readArchive()`, `updateIndex()`. Also replace and restore flow sequences.

**Regressions caught**:
- Title extraction fails for various heading formats
- Slug generation produces unsafe or empty filenames
- Archive filename format or sortability breaks
- Collision handling fails (counter suffix)
- Archive content is modified during write
- `listArchives` sort order drifts from newest-first
- `maxArchiveListEntries` cap doesn't work
- Custom `archiveDir` or `archiveFilenameStyle` ignored
- `updateIndex()` produces non-deterministic output
- Replace/restore flows corrupt current plan or lose archive content
- Cancel flows accidentally modify files

### `reconcile.test.ts`

**Covers**: `archive.ts` — `reconcileIndex()`.

**Regressions caught**:
- Reconciliation runs when repo is not initialized (should skip)
- Missing or stale index.md not regenerated
- Manual archive additions/removals not reflected after reconciliation
- Reconciliation corrupts current plan or archive files
- Reconciliation is not idempotent
- Custom archive dir not respected during reconciliation
- Placeholder current.md causes reconciliation errors
- Large archive counts cause issues

**Phase 5 addition**: New test file covering all reconciliation scenarios.

### `template-analysis.test.ts`

**Covers**: `template-analysis.ts` — `detectPlaceholders()`, `analyzeTemplate()`, `analyzeTemplateFromDisk()`.

**Regressions caught**:
- Placeholder detection misses recognized placeholders or includes unknown ones
- Template mode misclassified (wrong mode for given sections/file state)
- `explicit-placeholders` not detected when placeholders present
- `legacy-section-fallback` not detected when sections exist but no placeholders
- `default-fallback` not detected when file is missing
- `invalid` not detected when file exists but has no H2 sections
- Repair recommendations incorrect for mode
- Disk-based analysis disagrees with pure analysis
- Generation and diagnostics disagree on template classification

**Phase 7 addition**: New test file covering all four template modes, placeholder detection, disk-based analysis, and agreement between generation and diagnostics. Imports template primitives from `template-core.ts` directly (since Phase 9).

### `orchestration.test.ts`

**Covers**: `orchestration.ts` — `handlePlan()`, `handlePlanDebug()`, `resolveGoal()`, template repair/reset flow.

**Regressions caught**:
- No-repo state doesn't produce error notification
- Not-initialized state doesn't offer init or doesn't create files on confirm
- Not-initialized cancellation still creates files
- Initialized-no-plan doesn't prompt for goal or create plan
- Inline args ignored when allowed
- Empty/null goal input doesn't cancel properly
- Confirm rejection doesn't prevent writes
- Has-plan cancel/null selection modifies files
- Resume doesn't show plan info
- Replace flow doesn't archive old plan or write new plan
- Replace cancellation modifies files
- Replace with no goal modifies files
- Replace with inline args doesn't use them
- Restore flow doesn't archive current or restore selected archive
- Restore cancellation modifies files
- Restore with no archives doesn't show correct message
- Archive list cancel modifies files
- Plan-debug doesn't write log or handle no-repo
- resolveGoal doesn't respect inline args config

**Phase 5 addition**: New test file covering the important command branches through the extracted `PlanUI` interface.

**Phase 6 additions**: Multi-step orchestration flows now tested at the orchestration layer: replace success (archives old, writes new), replace cancel (no file changes), replace with inline args, restore success (archives current, restores selected), restore cancel (no file changes), archive list cancel, no-archives path.

**Phase 7 additions**: Template repair/reset flow: missing template triggers repair offer, user can accept (template restored) or decline (fallback used), legacy template shows info notice without blocking, healthy template shows no notice, repair also offered during replace flow. Config `currentStateTemplate` passthrough to plan generation.

### `diagnostics.test.ts`

**Covers**: `diagnostics.ts` — `formatTimestamp()`, `logFilename()`, `logRelPath()`, `collectDiagnostics()`, `writeDiagnosticLog()`.

**Regressions caught**:
- Timestamp format or sortability breaks
- Snapshot misclassifies state vs what `repo.ts` would return
- Snapshot includes file body content (privacy/safety invariant)
- Log directory not created automatically
- Log file is invalid JSON
- Log file overwrites existing logs
- Config-aware fields not reflected in snapshot
- Template info misreports usability or section count

**Phase 6 additions**: Template info (`template.usable`, `template.sectionCount`) tested across states: not-initialized, initialized with default template, malformed template, custom template, no-repo. Notes about template usability/fallback verified.

**Phase 7 additions**: Template mode (`template.mode`), `hasExplicitPlaceholders`, `usesFallback`, `repairRecommended` tested across states. Verified mode classification matches shared analysis. No file contents leak into mode or repair fields.

### `config.test.ts`

**Covers**: `config.ts` — `loadConfig()`, `DEFAULT_CONFIG` values.

**Regressions caught**:
- Default values change unexpectedly
- Missing config file causes errors instead of clean defaults
- Malformed JSON causes throws instead of warnings
- Invalid field types accepted without warning
- Valid overrides ignored
- Per-field fallback doesn't work (valid fields lost when one field is bad)
- Unknown keys cause warnings (they should be silent)
- `currentStateTemplate` string override not applied (Phase 7)
- `currentStateTemplate` null override not accepted (Phase 7)
- Invalid `currentStateTemplate` types not caught (Phase 7)

### `summary.test.ts`

**Covers**: `summary.ts` — `extractPlanSummary()`, `formatArchiveTimestamp()`, `formatArchiveLabel()`.

**Regressions caught**:
- Summary extraction doesn't find Goal section
- Summary includes placeholder italic lines
- Summary bleeds past section boundaries
- Empty/heading-only content crashes instead of returning fallback
- Timestamp extraction from archive filenames fails
- Label formatting truncation or timestamp display breaks

## What Is NOT Automated

1. **Full command registration.** The Pi `registerCommand` wiring in `index.ts` is not unit-tested. It is a thin bridge to `orchestration.ts` which IS tested.

2. **`detectRepoRoot()` and `detectPlanState()` via real Pi runtime.** The `pi.exec`-based wrappers are thin delegators to `detectRepoRootWith`/`detectPlanStateWith` which ARE tested via the `ExecFn` seam.

3. **End-to-end command flows.** The full chain from user typing `/plan` through all UI interactions to file writes is not automated. It is verified manually by running `pi -e ./index.ts` in a test repo.

4. **Config file read errors** (permission issues, symlinks, etc.) — only file-missing and malformed-content cases are tested.

## Manual Verification

To verify command behavior manually:

```bash
cd /path/to/any/git/repo
pi -e /path/to/pi-plan/index.ts
```

Then test:

1. `/plan` in a repo with no `.pi/` → should offer init
2. `/plan` after init → should prompt for goal and create plan
3. `/plan` with existing plan → should show Resume/Replace/Revisit/Cancel
4. `/plan some goal text` → should use inline args
5. `/plan-debug` → should write a log and show summary
6. Replace flow → verify old plan appears in archive, new plan is current
7. Restore flow → verify current is archived, selected archive becomes current
8. Cancel at any confirmation → verify no files changed
9. Custom template with placeholders → edit `.pi/templates/task-plan.md` with `{{GOAL}}` / `{{REPO_ROOT}}`, run `/plan`, verify substitution
10. Legacy template without placeholders → verify section-name fallback still injects goal and repo root
11. Stale index → manually add/remove archive files, run `/plan`, verify `index.md` updated
12. `/plan-debug` → check JSON log includes `template.usable`, `template.sectionCount`, `template.mode`, `template.repairRecommended`
13. Delete `.pi/templates/task-plan.md`, run `/plan` → should offer to restore default template
14. Accept template restore → verify template file restored, plan created
15. Decline template restore → verify template not restored, plan still created with fallback sections
16. Legacy template (no placeholders) → should show info notice, not offer repair
17. Set `currentStateTemplate` in `.pi/pi-plan.json`, create plan with `{{CURRENT_STATE}}` → verify custom expansion

## Test Isolation

All tests use unique temporary directories (`os.tmpdir()` + random suffix) and clean up in `afterEach`. Tests do not depend on each other or on global state.
