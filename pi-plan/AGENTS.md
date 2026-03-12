# pi-plan — Maintainer Overview

## Purpose

`pi-plan` is a Pi extension that provides a **repo-local planning workflow** for coding tasks. It gives the agent a structured planning protocol, a plan template, a single active plan, an archive of past plans, and a diagnostics command — all scoped to the current git repository.

The extension is globally installable but **repo-locally activated**. Nothing runs or writes files outside the current repo. No background automation. No silent side effects.

## Commands

### `/plan`

Interactive planning command. Behavior depends on repo state:

| State | Behavior |
|---|---|
| No git repo | Error notification |
| Repo found, not initialized | Offer to create `.pi/` planning structure |
| Initialized, no current plan | Prompt for goal → generate plan → confirm → write `current.md` |
| Initialized, current plan exists | Offer: Resume / Replace / Revisit archives / Cancel |

- **Replace** archives the old plan first, then writes the new one.
- **Revisit** lets the user browse and restore archived plans (archiving current first).
- **Resume** shows a summary of the current plan and tells the agent to continue.
- `/plan <goal text>` passes inline args when `allowInlineGoalArgs` is enabled (default: true).

### `/plan-debug`

Writes a JSON diagnostic snapshot to `.pi/logs/`. Never modifies planning files. Uses the same state-detection logic as `/plan` so diagnostics and planning stay aligned.

## Repo-Local File Layout

All files live under the git repo root:

| Path | Owner | User-Editable | Purpose |
|---|---|---|---|
| `.pi/PLANNING_PROTOCOL.md` | init | ✓ | Agent-facing planning rules |
| `.pi/templates/task-plan.md` | init | ✓ | Plan section template |
| `.pi/plans/current.md` | extension | ✓ after creation | The single active plan |
| `.pi/plans/index.md` | extension | ✗ (regenerated) | Deterministic plan index |
| `.pi/plans/archive/*.md` | extension | ✗ (immutable) | Archived past plans |
| `.pi/logs/plan-debug-*.json` | extension | ✗ | Diagnostic snapshots |
| `.pi/pi-plan.json` | user | ✓ | Optional repo-local config |

## Module Ownership

| File | Owns | Does Not Own |
|---|---|---|
| `index.ts` | Command registration, Pi API bridge to `PlanUI` | Business logic, state detection, file I/O |
| `orchestration.ts` | Command handler logic, `PlanUI` interface, goal resolution, flow orchestration, index reconciliation calls, template repair/reset UX (`ensureTemplateUsable()`) | Command registration, state detection impl, file format |
| `template-core.ts` | Shared template primitives: `TemplateSection` type, `TEMPLATE_PLACEHOLDERS`, `parseTemplate()`, `readTemplateSections()`, `buildCurrentStateValue()` — canonical CURRENT_STATE builder | Template mode classification, plan generation, diagnostics |
| `template-analysis.ts` | Template mode classification, placeholder detection, usability assessment, repair recommendations — single source of truth for template interpretation | Template parsing (delegates to `template-core.ts`), plan generation logic, diagnostics collection |
| `repo.ts` | Repo detection, planning state model, `ExecFn` seam, safe `current.md` writes, initialization | Archive lifecycle, config, diagnostics |
| `defaults.ts` | Default file contents, placeholder text, sentinel constant, `DEFAULT_CURRENT_STATE_TEMPLATE` | File I/O, state detection |
| `plangen.ts` | Template-aware plan scaffold generation, fallback sections, placeholder substitution | File writes, state detection, archive, template mode classification (delegates to `template-analysis.ts`), template parsing (delegates to `template-core.ts`) |
| `archive.ts` | Archive write/read/list, `current.md` force-write, title extraction, slug generation, `index.md` regeneration, `reconcileIndex()` | State detection, plan generation, config loading |
| `diagnostics.ts` | Diagnostic snapshot collection, log file writes, timestamp formatting — uses `template-analysis.ts` for template reporting | State mutation, plan creation, template mode classification |
| `config.ts` | Config loading, validation, normalization, defaults (including `currentStateTemplate`) | File writes beyond config reads |
| `summary.ts` | Plan summary extraction, archive label formatting | File I/O, state detection |

## Key Invariants

These must hold across all changes:

1. **One active current plan.** There is exactly one `current.md`. It is either the placeholder or a real plan.
2. **Archives are immutable.** Once written, archive files are never modified or deleted by the extension.
3. **Destructive actions require confirmation.** Replacing a plan, restoring an archive, and initializing all go through `ui.confirm`.
4. **Placeholder detection is deterministic.** `hasCurrentPlan()` uses the sentinel string from `defaults.ts`. A generated plan must never contain the sentinel.
5. **`/plan` and `/plan-debug` share state logic.** Both use `isFullyInitialized()` and `hasCurrentPlan()` from `repo.ts`. Diagnostics must never drift from the planning state model.
6. **`index.md` is fully regenerated, not patched.** Every call to `updateIndex()` rewrites the file from scratch to stay deterministic. `reconcileIndex()` is called opportunistically before key flows.
7. **Planning is repo-relative.** All paths are relative to the git repo root. The extension never writes outside the repo.
8. **Config never throws.** `loadConfig()` always returns a valid config, falling back to defaults for any invalid fields.
9. **Template placeholder substitution is explicit.** `generatePlan()` substitutes `{{GOAL}}`, `{{REPO_ROOT}}`, and `{{CURRENT_STATE}}` in template section bodies. Unknown tokens are left as-is. Missing/malformed templates degrade to built-in fallback sections. Section-name fallback handles legacy templates without placeholders. `{{CURRENT_STATE}}` is configurable via `currentStateTemplate` in `.pi/pi-plan.json`.
10. **Template interpretation has one source of truth.** `template-analysis.ts` is the canonical module for template mode classification. Both `plangen.ts` (generation) and `diagnostics.ts` (reporting) use it. Template modes: `explicit-placeholders`, `legacy-section-fallback`, `default-fallback`, `invalid`.
11. **CURRENT_STATE content has one canonical builder.** `buildCurrentStateValue()` in `template-core.ts` is the single function that produces current-state text. All generation paths (placeholder, fallback, section-name) use it, ensuring `currentStateTemplate` config overrides are applied consistently.
12. **No circular imports in the template system.** `template-core.ts` owns shared primitives, `template-analysis.ts` owns classification, `plangen.ts` owns generation. The dependency graph is acyclic.
13. **Orchestration is testable.** Command handler logic is in `orchestration.ts` behind the `PlanUI` interface. `index.ts` is a thin bridge.

## Extension Philosophy

- **Visible, not hidden.** Both commands are explicit. No background processes.
- **Concise UX.** Notifications, confirmations, and summaries are short and actionable.
- **Repo-relative.** Everything is scoped to the current repo.
- **No silent destructive behavior.** The user always confirms before data changes.
- **Thin orchestration layer.** `index.ts` delegates to focused modules. It should not grow business logic.

## Safe Extension Points

When adding future capabilities, extend at these seams:

| Future Work | Where to Extend |
|---|---|
| Richer config options | `config.ts` — add fields to `PiPlanConfig`, update `DEFAULT_CONFIG`, add validation in `loadConfig()` |
| Richer plan generation | `plangen.ts` — add new substitution entries in `buildSubstitutions()`; define new placeholders in `template-core.ts` (`TEMPLATE_PLACEHOLDERS`); or extend with LLM-assisted filling |
| New placeholders | `template-core.ts` — add to `TEMPLATE_PLACEHOLDERS`; `plangen.ts` — add to `buildSubstitutions()`; update `docs/file-contracts.md` |
| Template mode extensions | `template-analysis.ts` — add new modes to `TemplateMode`, update `analyzeTemplate()` |
| Custom CURRENT_STATE logic | `template-core.ts` — extend `buildCurrentStateValue()` |
| Richer archive browsing | `archive.ts` — add search, filtering, metadata extraction |
| Resume/review UX improvements | `index.ts` (UI flow) + `summary.ts` (richer summaries) |
| Diagnostics extensions | `diagnostics.ts` — add new snapshot fields; never log file contents |
| New commands | `index.ts` — register via `pi.registerCommand()` |
| Plan validation | New module (e.g. `validate.ts`) — check plan completeness against template |

### Why `index.ts` should stay thin

`index.ts` is the command registration and Pi API bridge layer. It maps `ExtensionAPI` to the `PlanUI` interface and delegates to `orchestration.ts`. If it accumulates business logic (state reasoning, file manipulation, plan parsing), the extension becomes hard to test and hard to extend. Keep logic in `orchestration.ts` and the focused modules; keep `index.ts` as a thin bridge.

### Why state logic must remain shared

`repo.ts` owns the canonical state model. Both `/plan` and `/plan-debug` must use it. If state logic is duplicated (e.g. diagnostics reimplements "has current plan"), the two commands will drift apart and produce contradictory results. Always go through `repo.ts` for state questions.

## Testing

See `tests/TESTING.md` for coverage strategy and what each test file proves.

## Internal Docs

| Document | Purpose |
|---|---|
| `AGENTS.md` | This file — maintainer overview |
| `docs/architecture.md` | Architecture, state model, command flows |
| `docs/file-contracts.md` | Repo-local file semantics and contracts |
| `tests/TESTING.md` | Test coverage strategy |
| `README.md` | User-facing documentation |
