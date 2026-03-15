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

New test file covering the extracted template primitives module.

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

Also tests `detectRepoRootWith()` and `detectPlanStateWith()` via the injectable `ExecFn` seam. All five state scenarios are covered: no-repo, not-initialized, partially initialized, initialized-no-plan, initialized-has-plan.

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

Also tests template-aware generation, explicit placeholder substitution (`{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}`), multi-placeholder lines, unknown token preservation, section-name fallback, no double-injection, fallback on missing/malformed templates, `generatePlanWithMeta()`, `TEMPLATE_PLACEHOLDERS`, `{{CURRENT_STATE}}` configurability, template mode reporting, and CURRENT_STATE consistency across all three generation paths.

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

Covers all reconciliation scenarios.

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

Covers all four template modes, placeholder detection, disk-based analysis, and agreement between generation and diagnostics.

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

Also tests multi-step orchestration flows (replace, restore, cancel), inline args, template repair/reset flow (missing template triggers repair offer, legacy template info notice, healthy template no notice), and config `currentStateTemplate` passthrough to plan generation.

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

Also tests template info (`template.usable`, `template.sectionCount`, `template.mode`, `hasExplicitPlaceholders`, `usesFallback`, `repairRecommended`) across states. Verified mode classification matches shared analysis.

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
- `currentStateTemplate` string override not applied
- `currentStateTemplate` null override not accepted
- Invalid `currentStateTemplate` types not caught

### `summary.test.ts`

**Covers**: `summary.ts` — `extractPlanSummary()`, `formatArchiveTimestamp()`, `formatArchiveLabel()`.

**Regressions caught**:
- Summary extraction doesn't find Goal section
- Summary includes placeholder italic lines
- Summary bleeds past section boundaries
- Empty/heading-only content crashes instead of returning fallback
- Timestamp extraction from archive filenames fails
- Label formatting truncation or timestamp display breaks

### `smoke.test.ts`

**Covers**: `index.ts` — extension entrypoint loading, command/tool/flag/event registration.

**Regressions caught**:
- Extension entrypoint fails to load (import error, missing module, factory throws)
- Expected commands not registered (name drift, removed registration, wrong count)
- Expected tools not registered
- Expected flags not registered
- Expected event hooks not wired (missing lifecycle hook, wrong event name)
- New commands/tools/flags/hooks added without updating the smoke test (exact surface assertion)

**How it works**: Calls the default export of `index.ts` with a minimal mock `ExtensionAPI` that records all `registerCommand`, `registerTool`, `registerFlag`, and `on` calls. Asserts the exact expected surface: 6 commands, 2 tools, 1 flag, 7 event hooks.

### `tdd.test.ts`

**Covers**: `tdd.ts` — `globToRegex()`, `isTestFile()`, `evaluateTddGate()`, `validateStepCompletion()`, `logTddCompliance()`.

**Regressions caught**:
- Glob-to-regex conversion fails for common patterns
- Test file detection misses test files or falsely identifies production files
- TDD gate allows production writes before test writes
- TDD gate blocks `.pi/` file writes (should always allow)
- Step completion validation accepts non-compliant steps
- Compliance logging fails to create daily log files
- Compliance logging overwrites existing entries (must be append-only)

### `brainstorm.test.ts`

**Covers**: `brainstorm.ts` — `generateSpecFilename()`, `writeSpec()`, `readSpec()`, `listSpecs()`.

**Regressions caught**:
- Spec filename format doesn't match `YYYY-MM-DD-HHMM-slug.md` pattern
- writeSpec creates files in wrong directory
- readSpec fails for existing files or doesn't return null for missing files
- listSpecs doesn't sort newest-first
- listSpecs returns wrong title or date metadata
- Spec immutability violated (should not overwrite)

### `worktree.test.ts`

**Covers**: `worktree.ts` — `deriveWorktreeBranch()`, `isWorktreeDirIgnored()`, `addWorktreeDirToGitignore()`, `detectSetupCommands()`, `writeWorktreeState()`, `readWorktreeState()`, `createWorktreeForPlan()`, `cleanupWorktree()`.

**Regressions caught**:
- Branch derivation doesn't follow `plan/<slug>` convention
- Gitignore detection fails
- Gitignore addition creates duplicate entries
- Setup command detection misses common package managers
- Worktree state serialization/deserialization fails
- readWorktreeState doesn't return null when no active worktree
- createWorktreeForPlan fails to create worktree or report errors
- cleanupWorktree fails to remove worktree or clean up state

### `auto-plan.test.ts`

**Covers**: `auto-plan.ts` — `computePhase()`, `getContextMessage()`, `extractStepsFromCurrentPlan()`, `getStatusDisplay()`, `getWidgetLines()`, `serializeState()`, `restoreState()`.

**Regressions caught**:
- Phase computation returns wrong phase for given state
- Any of the 8 phases not reachable or not correctly classified
- Context messages missing or wrong for a phase
- Step extraction from current.md fails
- Status display or widget lines incorrect for a phase
- State serialization loses fields (especially new TDD/worktree fields)
- State restoration produces wrong phase or missing data

### `harness.test.ts`

**Covers**: `harness.ts` — `evaluateInput()`, `evaluateHarnessCommand()`.

**Regressions caught**:
- Input evaluation blocks user messages (must never block)
- Wrong context injection for a given phase
- Inactive phase doesn't pass through cleanly
- Brainstorming phase context missing
- Executing phase context missing
- Harness command matching fails

### `phase2.test.ts`

**Covers**: Config extensions, review records, step format support, and legacy migration paths.

**Regressions caught**:
- Config extensions not applied correctly
- Review record format or write path incorrect
- Step format detection broken for numbered or checkbox formats
- Legacy PLAN.md migration fails

### `phase3.test.ts`

**Covers**: Template primitives, section parsing, and section extraction integration scenarios.

**Regressions caught**:
- Template section parsing produces wrong structure
- Section extraction misses sections or includes wrong content
- Integration between template parsing and plan generation broken

### `phase4.test.ts`

**Covers**: Integration scenarios spanning TDD, brainstorming, and worktree modules.

**Regressions caught**:
- TDD gating doesn't integrate correctly with execution phase
- Brainstorm-to-plan transition broken
- Worktree lifecycle doesn't integrate with plan creation/completion
- New config options not applied correctly end-to-end

### `browser.test.ts`

**Covers**: `browser.ts` — `openBrowser()` system browser launcher.

**Regressions caught**:
- Browser launch fails or uses wrong browser
- `PI_PLAN_BROWSER` env var override not respected
- `BROWSER` env var fallback not used
- Non-interactive environments not handled gracefully

### `server.test.ts`

**Covers**: `server.ts` — ephemeral HTTP servers for plan review, code review, and markdown annotation UIs.

**Regressions caught**:
- Server fails to start or bind to a port
- Plan review endpoint serves wrong content or assets
- Code review endpoint fails for different diff modes
- Annotation endpoint fails to load markdown content
- Server cleanup doesn't release ports

## What Is NOT Automated

1. ~~**Full command registration.**~~ Now covered by `smoke.test.ts`. The Pi `registerCommand` wiring in `index.ts` is tested at the registration level (names, counts). Handler logic is tested via `orchestration.ts`.

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
18. `/tdd` → should toggle TDD enforcement and show compliance summary
19. With TDD ON, try writing production file before test → should be blocked
20. Write test file first, then production file → both succeed
21. Check `.pi/tdd/compliance-YYYY-MM-DD.json` → should contain compliance entries
22. With brainstorming enabled, start new plan → should enter brainstorming phase
23. Agent writes spec, calls `submit_spec` → should transition to planning
24. With worktree enabled, create plan → should create `.worktrees/<slug>/`
25. Check `.pi/worktrees/active.json` → should contain worktree info
26. Complete/archive plan → worktree should be cleaned up

## Test Isolation

All tests use unique temporary directories (`os.tmpdir()` + random suffix) and clean up in `afterEach`. Tests do not depend on each other or on global state.
