# pi-plan Architecture

## High-Level Overview

```
User ─→ /plan, /plan-debug, /todos, /tdd, /plan-review, /plan-annotate, /plan-finish
         │
         ▼
     index.ts          ← command/tool registration + UI orchestration
         │
         ▼
   orchestration.ts    ← command handler logic, PlanUI interface, template repair UX
         │
    ┌────┼────────────────────────────────────────┐
    │    │                        │                │
    ▼    ▼         ▼         ▼    ▼                ▼
 repo.ts  plangen.ts  archive.ts  diagnostics.ts  auto-plan.ts
    │         │          │             │               │
    ▼         ▼          │             │          ┌────┼────┐
 defaults.ts  │     config.ts     summary.ts      │    │    │
              │          │                         ▼    ▼    ▼
              ▼          ▼                    tdd.ts brainstorm.ts worktree.ts
         template-core.ts  ← shared template primitives
              │
              ▼
         template-analysis.ts  ← mode classification

    hooks.ts  ← lifecycle hook handlers (tool_call, input, agent_end, etc.)
        │
        ▼
    finish.ts  ← branch finishing workflow (merge, PR, keep, discard)
        │
        ├── archive.ts (auto-archive before action)
        ├── config.ts (loadConfig for archive settings)
        ├── defaults.ts (CURRENT_PLAN_PLACEHOLDER)
        └── worktree.ts (cleanupWorktree with deleteBranch option)
```

### Module Dependency Graph (Template System)

Phase 8 eliminated the circular import between `plangen.ts` and `template-analysis.ts`
by extracting shared primitives into `template-core.ts`:

```
template-core.ts          ← owns: TemplateSection, TEMPLATE_PLACEHOLDERS,
    │                        parseTemplate, readTemplateSections,
    │                        buildCurrentStateValue
    │                     ← depends on: repo.ts (path), defaults.ts (DEFAULT_CURRENT_STATE_TEMPLATE)
    │
    ├── template-analysis.ts  ← owns: mode classification, placeholder detection
    │                         ← depends on: template-core.ts, repo.ts
    │
    └── plangen.ts            ← owns: plan generation, substitution, fallback sections
                              ← depends on: template-core.ts, template-analysis.ts, repo.ts, defaults.ts
```

No circular dependencies exist. `template-core.ts` is a leaf-level module in the
template system.

### Module Roles

- **`tdd.ts`** — TDD enforcement gate logic. Pure function `evaluateTddGate()` decides whether a file write is allowed based on test-first requirements. `isTestFile()` detects test files via configurable glob patterns. `validateStepCompletion()` checks TDD compliance before `[DONE:n]` markers. `logTddCompliance()` appends to daily JSON logs.
- **`brainstorm.ts`** — Brainstorming spec I/O. `writeSpec()` creates immutable spec files in `.pi/specs/` with `YYYY-MM-DD-HHMM-slug.md` naming. `listSpecs()` returns specs newest-first. `readSpec()` reads spec content. Pure filesystem operations.
- **`worktree.ts`** — Git worktree isolation. `createWorktreeForPlan()` creates an isolated worktree at `.worktrees/<slug>/` with branch `plan/<slug>`. `cleanupWorktree()` removes worktrees and optionally deletes the branch (`opts.deleteBranch`, default: true). State is persisted via `writeWorktreeState()` / `readWorktreeState()` in `.pi/worktrees/active.json`. Auto-detects setup commands (npm, yarn, pip, etc.).
- **`finish.ts`** — Deterministic branch finishing workflow. Pure functions with `ExecFn` seam. `executeFinishing()` orchestrates the four-option menu (merge, PR, keep, discard). `mergeLocally()` does a `--no-ff` merge with conflict abort. `createPullRequest()` pushes and runs `gh pr create`. `generatePrBody()` extracts title/goal/steps from plan content, supports `prTemplate` config with `{{BRANCH}}` and `{{PLAN_TITLE}}` substitution. `detectBaseBranch()` finds the remote HEAD. `isGhAvailable()` checks `gh` CLI availability.
- **`index.ts`** — Thin command registration. Registers `/plan`, `/plan-debug`, `/todos`, `/tdd`, `/plan-review`, `/plan-annotate`, and `/plan-finish`. Registers `submit_plan` and `submit_spec` tools. Bridges Pi's `ExtensionAPI` to the `PlanUI` interface, delegates logic to `orchestration.ts`, `hooks.ts`, `tools.ts`, and `finish.ts`.
- **`orchestration.ts`** — Command handler logic for `/plan` and `/plan-debug`. Defines the `PlanUI` interface for testability. Owns the business flow: state handling, goal resolution, plan creation/replace/resume/revisit, debug snapshot writing, template repair/reset UX (via `ensureTemplateUsable()`). Calls `reconcileIndex()` before key flows.
- **`template-core.ts`** — Shared template primitives that both `plangen.ts` and `template-analysis.ts` depend on. Owns `TemplateSection` type, `TEMPLATE_PLACEHOLDERS` constant, `parseTemplate()`, `readTemplateSections()`, and `buildCurrentStateValue()` — the canonical builder for `{{CURRENT_STATE}}` content. Has no circular dependencies.
- **`template-analysis.ts`** — Single source of truth for template interpretation. Classifies templates into four modes (`explicit-placeholders`, `legacy-section-fallback`, `default-fallback`, `invalid`). Detects placeholders, assesses usability, recommends repair. Used by both `plangen.ts` and `diagnostics.ts` so they never drift apart.
- **`repo.ts`** — Repo detection (`git rev-parse`), planning state model, file-existence checks, initialization, safe `current.md` writes. Exports an `ExecFn` seam for testable repo/state detection.
- **`defaults.ts`** — Pure constants: default file contents, placeholder text, sentinel string, `DEFAULT_CURRENT_STATE_TEMPLATE`. No I/O.
- **`plangen.ts`** — Template-aware plan generation with explicit placeholder substitution. Uses `template-core.ts` for parsing and `template-analysis.ts` for mode classification. Substitutes `{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}` placeholders, falls back to built-in sections. Accepts optional `currentStateTemplate` for configurable `{{CURRENT_STATE}}` expansion. All CURRENT_STATE content flows through `buildCurrentStateValue()` — both placeholder and section-name fallback paths.
- **`archive.ts`** — Archive lifecycle: write archives, list/count/read archives, force-write `current.md`, extract titles, generate slugs, regenerate `index.md`, reconcile index.
- **`diagnostics.ts`** — Collect a read-only snapshot of repo state (including template mode, placeholder info, repair recommendations from `template-analysis.ts`), write it as JSON to the logs directory.
- **`config.ts`** — Load and validate `.pi/pi-plan.json`. Never throws. Returns defaults for missing/invalid fields. Includes `currentStateTemplate` field.
- **`summary.ts`** — Extract concise plan summaries and format archive labels. Pure functions, no I/O.

## State Model

### Document State (`PlanState`)

The document layer recognizes four states:

| State | Condition |
|---|---|
| `no-repo` | `git rev-parse --show-toplevel` fails |
| `not-initialized` | Repo exists, but not all four planning files exist |
| `initialized-no-plan` | All four files exist, but `current.md` is placeholder/empty |
| `initialized-has-plan` | All four files exist, and `current.md` has real content |

### State detection

Canonical functions in `repo.ts`:

- `detectRepoRootWith(exec)` → `string | null` (async, uses injected `ExecFn`)
- `detectRepoRoot(pi)` → `string | null` (async, thin wrapper over `detectRepoRootWith`)
- `isFullyInitialized(repoRoot)` → `boolean` (checks four files)
- `hasCurrentPlan(repoRoot)` → `boolean` (sentinel-based detection)
- `detectPlanStateWith(exec)` → `PlanState` (async, uses injected `ExecFn`)
- `detectPlanState(pi)` → `PlanState` (async, thin wrapper over `detectPlanStateWith`)

The `ExecFn` seam allows testing repo/state detection without a Pi runtime. The `*With` variants accept a minimal command runner; the non-`With` variants bridge to `pi.exec`.

`diagnostics.ts` has its own `classifyState()` that reuses `isFullyInitialized` and `hasCurrentPlan` from `repo.ts` — this is intentional to keep state logic shared.

### Placeholder vs. real plan

`current.md` is considered a placeholder (no real plan) when:

1. File does not exist
2. File is empty / whitespace-only
3. File content includes `CURRENT_PLAN_SENTINEL` from `defaults.ts`

A generated plan (`plangen.ts`) is guaranteed to never contain the sentinel string.

### Enforcement State (`AutoPlanPhase`)

When enforcement is active (`/plan` toggle or `--plan` flag), the state machine recognizes 9 phases:

| Phase | Condition | Write-gating |
|---|---|---|
| `inactive` | Enforcement toggled OFF | None |
| `no-repo` | Toggled ON, not in a git repo | None |
| `not-initialized` | Toggled ON, `.pi/` missing | Blocks writes outside `current.md` |
| `needs-plan` | Initialized, no current plan | Blocks writes outside `current.md` |
| `brainstorming` | Design phase active | Allows spec writes, blocks prod writes |
| `has-plan` | Current plan exists | None (transition to executing) |
| `review-pending` | Plan submitted for browser review | Blocks all writes |
| `executing` | Tracking step completion | TDD gating (test before prod) |
| `finishing` | Plan complete, finishing workflow active | Blocks all writes |

Most phase computation is a pure function in `auto-plan.ts:computePhase()`. The lifecycle phases (`brainstorming`, `review-pending`, `finishing`) are set imperatively by specific actions (not computed from filesystem state) but degrade to computed phases on session restore. The `AutoPlanState` interface tracks:

```typescript
interface AutoPlanState {
  phase: AutoPlanPhase;
  repoRoot: string | null;
  todoItems: TodoItem[];
  enforcementActive: boolean;
  tddStepTestWritten: boolean;
  worktreeActive: boolean;
  worktreePath: string | null;
  brainstormSpecPath: string | null;
}
```

### `/tdd` command flow

1. If TDD enforcement is currently ON → toggle OFF, show status
2. If TDD enforcement is currently OFF → toggle ON, show compliance summary
3. Compliance summary shows: steps completed, steps compliant, daily log path

## Template System (Phase 6 + 7 + 8)

### Architecture

The template system is split across three modules with clear ownership boundaries:

| Module | Owns |
|---|---|
| `template-core.ts` | Primitives: `TemplateSection` type, `TEMPLATE_PLACEHOLDERS`, `parseTemplate()`, `readTemplateSections()`, `buildCurrentStateValue()` |
| `template-analysis.ts` | Classification: `TemplateMode`, `analyzeTemplate()`, `analyzeTemplateFromDisk()`, `detectPlaceholders()` |
| `plangen.ts` | Generation: `generatePlan()`, `generatePlanWithMeta()`, placeholder substitution, section-name fallback, fallback sections |

`orchestration.ts` owns the template repair/reset UX flow.

### Recognized placeholders

| Placeholder | Value |
|---|---|
| `{{GOAL}}` | The user's goal text |
| `{{REPO_ROOT}}` | Absolute repo root path |
| `{{CURRENT_STATE}}` | Default current-state block (repo root + description prompt) |

### Substitution behavior

1. Placeholders in section bodies are replaced with their values.
2. Multiple placeholders on the same line are all substituted.
3. Unknown `{{...}}` tokens are left as-is.
4. `{{CURRENT_STATE}}` expands to a multi-line block via `buildCurrentStateValue()`.
5. Headings are not substituted.

### Section-name fallback

When a section has no recognized placeholders but has a well-known heading:
- **"Goal"**: user's goal text is injected
- **"Current State"**: canonical current-state content (from `buildCurrentStateValue()`) is injected, body preserved below

This supports legacy templates that predate the placeholder contract.

### CURRENT_STATE consistency (Phase 8)

All paths that produce current-state content use `buildCurrentStateValue()` from `template-core.ts`:

1. **Placeholder path**: `{{CURRENT_STATE}}` in a template → substituted via `buildSubstitutions()` which calls `buildCurrentStateValue()`
2. **Section-name fallback path**: "Current State" heading without placeholders → `buildCurrentStateValue()` called directly
3. **Fallback sections path**: Built-in `FALLBACK_SECTIONS` contain `{{CURRENT_STATE}}` → same substitution as path 1

The `currentStateTemplate` config override affects all three paths consistently.

### Template modes

Templates are classified into four explicit modes by `template-analysis.ts`:

| Mode | Condition | Behavior |
|---|---|---|
| `explicit-placeholders` | Valid template with recognized `{{...}}` placeholders | Placeholders substituted, template sections used |
| `legacy-section-fallback` | Valid template with H2 sections but no recognized placeholders | Section-name fallback for Goal/Current State |
| `default-fallback` | Template file missing | Built-in fallback sections used |
| `invalid` | Template file exists but has no H2 sections | Built-in fallback sections used |

### Fallback chain

1. Template with placeholders → explicit substitution (`explicit-placeholders`)
2. Template without placeholders → section-name fallback for Goal/Current State (`legacy-section-fallback`)
3. Missing/malformed template → built-in fallback sections (contain placeholders) (`default-fallback` or `invalid`)

### Template repair/reset

Before plan generation, `orchestration.ts` checks the template state via `ensureTemplateUsable()`:
- `explicit-placeholders`: no action
- `legacy-section-fallback`: brief info notice (non-blocking)
- `default-fallback` or `invalid`: offer to restore default template with confirmation
- Declining repair still allows generation (fallback sections used)
- Repair writes the default template from `defaults.ts` and is deterministic

The same `ensureTemplateUsable()` helper is used in both `initialized-no-plan` and replace flows.

### Template lifecycle states

| State | Description | Action |
|---|---|---|
| Missing template | File does not exist | Offer restore; use fallback if declined |
| Invalid template | File exists, no H2 sections | Offer restore; use fallback if declined |
| Legacy template | File exists, H2 sections, no placeholders | Info notice; section-name fallback |
| Healthy template | File exists, H2 sections, placeholders | No action; use as-is |

### Configurable `{{CURRENT_STATE}}`

The `{{CURRENT_STATE}}` placeholder expansion can be customized via `currentStateTemplate` in `.pi/pi-plan.json`. The custom template may contain `{{REPO_ROOT}}` which is substituted at generation time. If absent or null, the default expansion from `DEFAULT_CURRENT_STATE_TEMPLATE` in `defaults.ts` is used. The override affects all generation paths (placeholder, fallback, section-name) consistently through `buildCurrentStateValue()`.

### Metadata

`generatePlanWithMeta()` returns `{ text, usedTemplate, templateMode }` to indicate whether a repo-local template was used and which mode was active. This is consumed by diagnostics.

## Command Flows

### `/plan` — State: `no-repo`

1. Detect state → `no-repo`
2. Notify error → return

### `/plan` — State: `not-initialized`

1. Detect state → `not-initialized`
2. Notify warning (repo found but not initialized)
3. Confirm: "Initialize planning?"
4. If confirmed → `initPlanning(repoRoot)` → notify created files
5. If cancelled → return

### `/plan` — State: `initialized-no-plan`

1. Detect state → `initialized-no-plan`
2. Load config (emit warnings)
3. Reconcile index
4. Check template usability (offer repair if needed)
5. Get goal: inline args (if enabled) or interactive prompt
6. If no goal → notify cancelled → return
7. `generatePlan({ goal, repoRoot, currentStateTemplate })` → plan text
8. Confirm: "Create plan?"
9. If confirmed → `writeCurrentPlan(repoRoot, planText)` (safe write, refuses if plan exists)
10. Notify success or warning

### `/plan` — State: `initialized-has-plan`

1. Detect state → `initialized-has-plan`
2. Load config
3. Reconcile index
4. Select: Resume / Replace / Revisit archives / Cancel

**Resume:**
- Read current plan → extract title and summary
- Count archives → show count
- Notify: "Resuming — read the plan and continue"

**Replace:**
- Check template usability (offer repair if needed)
- Get new goal (inline args or prompt)
- Confirm (shows old plan title)
- Archive old plan → force-write new plan → update index
- Notify success

**Revisit archived plans:**
- List archives (capped by `maxArchiveListEntries`)
- Select from list
- Confirm restore (archives current first)
- Force-write restored content → update index
- Notify success

### `/plan-debug`

1. Detect repo root (async)
2. If no repo → error notification → return
3. Load config (emit warnings)
4. Reconcile index
5. `collectDiagnostics(repoRoot, cwd, configResult)` → snapshot (includes template info)
6. `writeDiagnosticLog(repoRoot, snapshot, config)` → write JSON file
7. Notify with state summary and log path

## State Transition Table

| Current State | Action | Next State |
|---|---|---|
| `no-repo` | any command | `no-repo` (error) |
| `not-initialized` | `/plan` → init confirmed | `initialized-no-plan` |
| `not-initialized` | `/plan` → init cancelled | `not-initialized` |
| `initialized-no-plan` | `/plan` → create confirmed | `initialized-has-plan` |
| `initialized-no-plan` | `/plan` → create cancelled | `initialized-no-plan` |
| `initialized-has-plan` | `/plan` → resume | `initialized-has-plan` (no change) |
| `initialized-has-plan` | `/plan` → replace confirmed | `initialized-has-plan` (new plan, old archived) |
| `initialized-has-plan` | `/plan` → replace cancelled | `initialized-has-plan` (no change) |
| `initialized-has-plan` | `/plan` → restore confirmed | `initialized-has-plan` (restored plan, old archived) |
| `initialized-has-plan` | `/plan` → restore cancelled | `initialized-has-plan` (no change) |
| `initialized-has-plan` | `/plan` → cancel | `initialized-has-plan` (no change) |
| any | `/plan-debug` | no state change (read-only) |
| `needs-plan` | brainstorm enabled + goal provided | `brainstorming` |
| `brainstorming` | `submit_spec` approved | `needs-plan` → plan creation → `has-plan` |
| `has-plan` | enforcement active + steps detected | `executing` |
| `executing` | all steps completed | `has-plan` (plan complete, offer archive) |
| `has-plan` | `submit_plan` called | `review-pending` |
| `review-pending` | review approved | `has-plan` → `executing` |
| `review-pending` | review denied | `has-plan` (feedback returned) |
| `executing` | all steps marked `[DONE:n]` | `finishing` |
| `finishing` | merge/PR/keep/discard completed | reset (phase recomputed) |
| `finishing` | user cancels | stays `finishing` until action or session end |
| `finishing` | session interrupted + restored | `has-plan` (graceful degradation) |

## How Config Influences Behavior

Config is loaded from `.pi/pi-plan.json` via `loadConfig(repoRoot)`. It affects:

| Config Field | Affects |
|---|---|
| `archiveDir` | Where archives are written and read |
| `archiveFilenameStyle` | `"date-slug"` or `"date-only"` format |
| `archiveCollisionStrategy` | Always `"counter"` (append `-1`, `-2`, etc.) |
| `resumeShowSummary` | Whether resume shows a plan summary |
| `allowInlineGoalArgs` | Whether `/plan <text>` passthrough works |
| `debugLogDir` | Where `/plan-debug` writes logs |
| `debugLogFilenameStyle` | Always `"timestamp"` |
| `maxArchiveListEntries` | Cap on browse list (not on total stored) |
| `currentStateTemplate` | Custom `{{CURRENT_STATE}}` expansion (affects all generation paths) |
| `injectPlanContext` | Whether plan-state context messages are injected into agent turns |
| `reviewDir` | Where review records are written |
| `stepFormat` | Which step format to recognize (numbered/checkbox/both) |
| `tddEnforcement` | Whether TDD write-gating is active during execution |
| `testFilePatterns` | Glob patterns for test file detection |
| `brainstormEnabled` | Whether brainstorming phase precedes planning |
| `worktreeEnabled` | Whether plans execute in isolated worktrees |
| `specDir` | Where brainstorm specs are stored |
| `tddLogDir` | Where TDD compliance logs are written |
| `worktreeStateDir` | Where worktree state files are stored |
| `defaultFinishAction` | Default finishing action (skips menu when set; `null` = always ask) |
| `prTemplate` | PR body template with `{{BRANCH}}` and `{{PLAN_TITLE}}` placeholders |

Config loading never throws. Invalid fields fall back to defaults with per-field warnings.

## How Diagnostics Stay Aligned

`diagnostics.ts` reuses `isFullyInitialized()` and `hasCurrentPlan()` from `repo.ts` via its internal `classifyState()`. This means:

- `/plan` and `/plan-debug` always agree on the current state.
- If state detection logic changes, it changes in one place (`repo.ts`).
- Diagnostics never log file contents — only metadata (size, line count, title, placeholder status, template usability).

### Template diagnostics (Phase 6 + Phase 7 + Phase 8)

The diagnostic snapshot includes a `template` field with mode classification from `template-analysis.ts`:

```typescript
template: {
  usable: boolean;                // whether the template has valid H2 sections
  sectionCount: number;           // number of sections found (0 if not usable)
  mode: TemplateMode;             // "explicit-placeholders" | "legacy-section-fallback" | "default-fallback" | "invalid"
  hasExplicitPlaceholders: boolean; // whether recognized placeholders were found
  usesFallback: boolean;          // whether built-in fallback sections are used
  repairRecommended: boolean;     // whether a template reset is recommended
}
```

Notes include a human-readable summary from the template analysis. Both generation and diagnostics use `template-analysis.ts` for classification, ensuring they always agree.

## Index Reconciliation

`reconcileIndex()` in `archive.ts` provides a safe, idempotent way to regenerate `index.md` from actual files on disk:

1. Checks `isFullyInitialized(repoRoot)` — skips if not initialized
2. Calls `updateIndex()` to fully regenerate from current plan + archives
3. Returns `true` if reconciliation was performed, `false` if skipped

Reconciliation is called opportunistically at the start of `/plan` and `/plan-debug` flows. This ensures `index.md` stays consistent even if files are manually moved or edited outside the extension.

Properties:
- **Safe**: Only writes `index.md`, never modifies current plan or archives
- **Deterministic**: Same files → same index content
- **Idempotent**: Calling twice produces the same result
- **Non-disruptive**: Skips silently when repo is not initialized

## Archive Lifecycle

1. **Write**: `archivePlan()` creates a timestamped `.md` file in the archive directory. Handles filename collisions with a counter suffix.
2. **List**: `listArchives()` reads the archive directory, sorts newest-first, extracts titles from content, caps results.
3. **Count**: `countArchives()` counts all `.md` files (not capped).
4. **Read**: `readArchive()` reads a specific archive by relative path.
5. **Index**: `updateIndex()` fully regenerates `index.md` from current plan + all archives.
6. **Reconcile**: `reconcileIndex()` wraps `updateIndex()` with an initialization guard for opportunistic use.
7. **Immutability**: Archives are never modified or deleted by the extension. Only new files are created.

Archive filenames are sortable by date prefix: `YYYY-MM-DD-HHMM-slug.md` or `YYYY-MM-DD-HHMM.md`.
