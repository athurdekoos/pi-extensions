# pi-plan

Repo-local planning extension for [Pi Coding Agent](https://github.com/badlogic/pi-mono).

## Status: Phase 9 (release-ready)

Phases 0–8 built the full planning workflow: repo-local structure, four-state detection, plan creation/replace/resume/revisit, template-driven generation with explicit placeholders, archive lifecycle, diagnostics, lightweight config, and template system consolidation.

Phase 9 is a cleanup/polish pass: resolved naming inconsistencies (`ensureTemplateUsable`), removed temporary backward-compatibility re-exports from `plangen.ts`, audited docs for accuracy, and tightened packaging.

## What it does

### `/plan` — planning state, initialization, plan creation, and lifecycle

- Detects the current git repository root
- Distinguishes four states and acts accordingly:

| State | Behavior |
|-------|----------|
| **No repo** | Refuses to run |
| **Repo found, not initialized** | Offers to create the full `.pi/` planning structure |
| **Repo initialized, no current plan** | Asks for a task goal (or accepts inline args), generates a plan scaffold, confirms, writes to `current.md` |
| **Repo initialized, current plan exists** | Presents an action menu: resume, replace, revisit archives, or cancel |

#### Inline goal passthrough (Phase 4)

`/plan` now accepts goal text directly as arguments:

```
/plan Build a repo-local planning extension
```

When inline args are provided and no meaningful current plan exists:
- The goal text is used directly (no interactive prompt)
- Confirmation is still required before writing

When a current plan exists and the user chooses Replace:
- Inline args are used as the replacement goal if provided
- Otherwise the interactive input flow is used

This can be disabled via config: `"allowInlineGoalArgs": false`.

#### Plan creation flow (no active plan)

When planning is initialized but no meaningful current plan exists:

1. `/plan` prompts: _"What do you want to build?"_ (or uses inline args)
2. A plan scaffold is generated from `.pi/templates/task-plan.md` (or built-in fallback sections if the template is missing/malformed)
3. `/plan` asks for confirmation before writing
4. If confirmed, the plan is saved to `.pi/plans/current.md`
5. If cancelled, `current.md` remains unchanged

#### Template-driven generation with explicit placeholders (Phase 5 + Phase 6)

Generated plans derive their section structure from `.pi/templates/task-plan.md` and use explicit placeholder substitution:

- **Placeholders**: Templates may use `{{GOAL}}`, `{{REPO_ROOT}}`, and `{{CURRENT_STATE}}` anywhere in section bodies. These are substituted with actual values during plan generation.
- **Custom template**: If the template file exists and contains H2 sections, those sections define the generated plan structure.
- **Section-name fallback**: For templates without placeholders, "Goal" and "Current State" sections still get special handling — Goal is filled with the user's goal, Current State includes the repo root path.
- **Fallback**: If the template is missing, empty, or has no H2 sections, the built-in default sections (which use placeholders) are used.
- **Unknown tokens**: `{{UNKNOWN}}` tokens are left as-is — no error, no removal.
- **Safety**: Generated plans never contain the placeholder sentinel, even if the template does.

This means customizing `.pi/templates/task-plan.md` meaningfully affects the plans `/plan` generates.

##### Available template placeholders

| Placeholder | Value |
|---|---|
| `{{GOAL}}` | The user's goal text |
| `{{REPO_ROOT}}` | Absolute repo root path |
| `{{CURRENT_STATE}}` | Current-state block (configurable via `currentStateTemplate` config) |

##### Configurable `{{CURRENT_STATE}}` (Phase 7)

The `{{CURRENT_STATE}}` expansion can be customized in `.pi/pi-plan.json`:

```json
{
  "currentStateTemplate": "Project root: `{{REPO_ROOT}}`\n\nDescribe the current state of the codebase."
}
```

The custom template may include `{{REPO_ROOT}}` which is substituted at generation time.
If not set (or `null`), the default expansion includes the repo root path and a prompt to describe the starting point.

##### Template repair/reset (Phase 7)

When `/plan` detects a missing or unusable template before plan generation, it offers a concise confirmation to restore the default template:

- **Missing or unusable template**: Confirm to restore default → writes `.pi/templates/task-plan.md` from built-in defaults
- **Legacy template (no placeholders)**: Brief info notice — generation proceeds normally with section-name fallback
- **Healthy template**: No notice

Declining the repair still allows plan generation using built-in fallback sections. Cancel leaves files unchanged.

#### Active plan flow

When a meaningful current plan exists, `/plan` presents a short interactive
action menu (similar to `pi-clear` and the `pi-google-adk` wizard):

**Resume current plan**
- Shows the plan title, path, and a concise summary from the Goal section
- Shows archive count if any exist
- Summary display can be disabled via config: `"resumeShowSummary": false`

**Replace current plan**
- Asks what the user wants to build (or uses inline args)
- Generates a new plan scaffold
- Archives the old plan, writes the new plan, updates `index.md`
- Requires confirmation

**Revisit archived plans**
- Lists archived plans newest-first with polished labels (title + timestamp)
- Respects `maxArchiveListEntries` config (default 15)
- Shows total count if more archives exist than displayed
- Restoring archives the current plan first
- Requires confirmation

**Cancel**
- Clean cancellation, no file changes

Every destructive action (replace, restore) requires explicit confirmation.
Cancellation always leaves files unchanged.

### `/plan-debug` — diagnostics snapshot

- Collects a structured diagnostic snapshot of the planning state
- Writes a JSON log to the debug log directory
- Includes effective config info: archive dir, log dir, limits, source
- Returns a concise human-readable summary with the log path
- Respects config for log directory location
- Config warnings are surfaced as notifications

### Configuration (Phase 4)

`pi-plan` supports a lightweight repo-local configuration file:

```
.pi/pi-plan.json
```

All settings are optional. Missing or absent config uses sensible defaults.
Invalid values fall back to defaults with warnings — never crashes.

#### Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `archiveDir` | string | `".pi/plans/archive"` | Relative path for archive directory |
| `archiveFilenameStyle` | `"date-slug"` \| `"date-only"` | `"date-slug"` | Archive filename format |
| `archiveCollisionStrategy` | `"counter"` | `"counter"` | How to handle filename collisions |
| `resumeShowSummary` | boolean | `true` | Show plan summary on resume |
| `allowInlineGoalArgs` | boolean | `true` | Allow `/plan <goal text>` passthrough |
| `debugLogDir` | string | `".pi/logs"` | Relative path for debug log directory |
| `debugLogFilenameStyle` | `"timestamp"` | `"timestamp"` | Debug log filename format |
| `maxArchiveListEntries` | integer ≥ 1 | `15` | Max entries in archive browse list |
| `currentStateTemplate` | string \| null | `null` | Custom template for `{{CURRENT_STATE}}` expansion (may use `{{REPO_ROOT}}`) |

#### Example config

```json
{
  "archiveDir": ".pi/plans/archive",
  "resumeShowSummary": true,
  "maxArchiveListEntries": 10,
  "archiveFilenameStyle": "date-only"
}
```

#### Config behavior

- Missing config file → all defaults, no warnings
- Malformed JSON → all defaults, warning notification
- Invalid field values → default for that field, warning notification
- Unknown keys → silently ignored
- Valid fields survive alongside invalid ones

**Limitation:** This phase implements repo-local config only. Global defaults
(e.g. `~/.pi/agent/settings.json`) are not yet supported. If Pi conventions
make a global settings hook practical in a future phase, it can be added
cleanly on top of this config layer.

### Planning structure

When initialized, `/plan` creates:

```
.pi/
  PLANNING_PROTOCOL.md       # Rules: always plan before coding
  templates/
    task-plan.md             # Expert-style plan template
  plans/
    current.md               # Active plan (placeholder until written)
    index.md                 # Plan index with current + archived plans
    archive/                 # Archived plans (created on first archive)
      YYYY-MM-DD-HHMM-slug.md
  pi-plan.json               # Optional config file
```

### Archive strategy

- Archives live in the configured archive directory (default `.pi/plans/archive/`)
- Filenames are deterministic and sortable
  - `date-slug` style: `YYYY-MM-DD-HHMM-<slug>.md` (default)
  - `date-only` style: `YYYY-MM-DD-HHMM.md`
- Slugs are derived from the plan title (lowercase, alphanumeric, max 40 chars)
- Collisions are handled by appending a counter suffix
- Archives are immutable once written
- The archive directory is created on first archive, not during init

### Archive browsing polish (Phase 4)

- Labels show both title and human-readable timestamp: `Auth Module  (2026-03-11 17:30)`
- Long titles are truncated cleanly with ellipsis
- Archives are ordered newest-first
- List is capped by `maxArchiveListEntries` (shows total count if more exist)
- `"(N more not shown)"` indicator when list is capped

### Index tracking and reconciliation

`index.md` is regenerated (not patched) whenever:
- A plan is archived
- A current plan is replaced
- An archived plan is restored as current
- `/plan` or `/plan-debug` is invoked (opportunistic reconciliation)

It lists the current plan title with a link and all archived plans
(newest first) with links and filenames. The index always includes all
archives, not capped by `maxArchiveListEntries`.

#### Reconciliation (Phase 5)

`index.md` is now opportunistically reconciled at the start of `/plan` and
`/plan-debug` flows. This means if files are manually added, removed, or
edited outside the extension, the index will be corrected on the next command
invocation. Reconciliation is safe, deterministic, and idempotent — it only
writes `index.md` and never modifies current.md or archives.

### Current plan detection

`current.md` is considered to have a real plan when:
- The file exists
- It is not empty or whitespace-only
- It does not contain the placeholder sentinel string

This makes the "no plan yet" vs "plan exists" distinction deterministic.

## What it does NOT do yet

- No global config defaults (repo-local only)
- No multi-step plan editing or revision
- No auto-planning before coding
- No plan linting or enforcement
- No background automation
- No telemetry upload
- No advanced archive search/filtering
- No multiple simultaneous current plans
- No "open in editor" from resume (Pi UI primitives don't expose this cleanly)

## Installation

### Quick test (no install)

```bash
pi -e ~/dev/pi-extensions/pi-plan
```

### Global install (persistent)

```bash
pi install /path/to/pi-extensions/pi-plan
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "/home/YOU/dev/pi-extensions/pi-plan"
  ]
}
```

### Project-local install

```bash
pi install -l /path/to/pi-extensions/pi-plan
```

Once installed globally, `/plan` and `/plan-debug` are available in every Pi
session but only do meaningful work inside git repositories.

## Manual verification

### 1. Load the extension

```bash
pi -e ~/dev/pi-extensions/pi-plan
```

### 2. `/plan` outside a git repo

```bash
cd /tmp && pi -e ~/dev/pi-extensions/pi-plan
# Type: /plan
# Expected: error — "No repository detected."
```

### 3. `/plan` in a repo without planning

```bash
cd ~/dev/some-repo
pi -e ~/dev/pi-extensions/pi-plan
# Type: /plan
# Expected: initialization prompt listing all four files
# Accept → files created, success notification
```

### 4. `/plan <goal text>` (inline passthrough)

```
# Type: /plan Build a repo-local planning extension
# Expected: confirmation — "Write plan to .pi/plans/current.md?" with goal shown
# Accept → plan created, success notification
# Verify: no interactive "What do you want to build?" prompt
```

### 5. `/plan` after initialization (no plan, no args)

```
# Type: /plan
# Expected: input prompt — "What do you want to build?"
# Enter: "Add JWT-based authentication to the API"
# Expected: confirmation — "Write plan to .pi/plans/current.md?"
# Accept → plan created
```

### 6. `/plan` with an active plan — resume

```
# Type: /plan
# Expected: select menu — Resume / Replace / Revisit / Cancel
# Select: "Resume current plan"
# Expected: info with plan title, path, Goal summary, and archive count
```

### 7. `/plan` with an active plan — replace with inline args

```
# Type: /plan Refactor the database layer
# Select: "Replace current plan"
# Expected: confirmation showing old plan will be archived
# (Goal comes from inline args, no "What do you want to build?" prompt)
# Accept → archived + new plan written
```

### 8. Verify archive labels

```
# Type: /plan
# Select: "Revisit archived plans"
# Expected: polished labels like "Auth Module  (2026-03-11 17:30)"
```

### 9. Verify config

```bash
# Create config:
echo '{"maxArchiveListEntries": 3, "resumeShowSummary": false}' > .pi/pi-plan.json
# Type: /plan → resume → verify no summary shown
# Type: /plan → revisit → verify max 3 entries shown
```

### 10. Verify invalid config graceful fallback

```bash
echo 'not json' > .pi/pi-plan.json
# Type: /plan
# Expected: warning about invalid JSON, then normal behavior
```

### 11. `/plan-debug` with config

```
# Type: /plan-debug
# Expected: log written, config info in snapshot JSON
```

### 12. Verify cancellation

```
# Type: /plan → Cancel → "Cancelled." — no file changes
# Type: /plan → Replace → enter goal → Cancel → "Cancelled."
```

### 13. Verify template placeholder substitution (Phase 6)

```bash
# Edit the template to use explicit placeholders:
cat > .pi/templates/task-plan.md << 'EOF'
# Plan: [TITLE]

## Goal

{{GOAL}}

## Current State

Repository root: `{{REPO_ROOT}}`

_Describe what exists today._

## Design

Describe the design approach.

## Rollback Plan

How to revert if things go wrong.
EOF

# Type: /plan Build a new feature
# Accept → verify generated plan has:
#   - Goal section with "Build a new feature" (from {{GOAL}})
#   - Current State with actual repo root (from {{REPO_ROOT}})
#   - Design and Rollback Plan sections from custom template
#   - No fallback sections like Non-Goals, Acceptance Criteria, etc.
```

### 13b. Verify legacy template fallback (Phase 6)

```bash
# Edit the template WITHOUT placeholders:
cat > .pi/templates/task-plan.md << 'EOF'
# Plan: [TITLE]

## Goal

What is the objective?

## Context

Additional context here.
EOF

# Type: /plan Build something
# Accept → verify Goal section contains "Build something" (section-name fallback)
```

### 14. Verify index reconciliation (Phase 5)

```bash
# Manually add an archive file:
echo "# Plan: Manual\n\n## Goal\n\nManually added." > .pi/plans/archive/2026-01-01-1000-manual.md
# Type: /plan (or /plan-debug)
# Verify: index.md now includes the manually added archive
```

## Running tests

```bash
cd pi-plan && npm test
```

Tests cover (308 tests across 10 files):
- **Config handling** — defaults when missing, valid overrides, invalid fallback with warnings,
  resolved paths, per-field validation, mixed valid/invalid fields, unknown keys
- **Summary extraction** — Goal section lines, maxLines, placeholder skipping, fallback behavior
- **Archive timestamps** — human-readable formatting, null for non-matching filenames
- **Archive labels** — title + timestamp combination, truncation, fallback
- **Path constants** — relative paths for all planning files
- **`hasPlanningProtocol`** — protocol file detection
- **`isFullyInitialized`** — all-four-files check
- **`hasCurrentPlan`** — placeholder vs real plan detection
- **`initPlanning`** — file creation, skip-existing, directory creation, idempotency
- **`detectRepoRootWith`** — success, failure, whitespace trimming, empty stdout, arg passing (Phase 5)
- **`detectPlanStateWith`** — all five state scenarios via mock ExecFn (Phase 5)
- **`formatTimestamp`** — deterministic sortable timestamps
- **`logFilename` / `logRelPath`** — filename pattern and path structure
- **`collectDiagnostics`** — all four states, field presence, archive info, title, config awareness
- **`writeDiagnosticLog`** — directory creation, valid JSON, no-overwrite
- **Snapshot safety** — no file body content in diagnostics (title is metadata)
- **`parseTemplate`** — section extraction, body capture, malformed input, H1 skipping (Phase 5)
- **`readTemplateSections`** — missing file, empty file, no-H2 file, valid file (Phase 5)
- **`deriveTitle`** — title extraction, truncation, edge cases
- **`generatePlan` (fallback)** — goal inclusion, section completeness, determinism, no sentinel
- **`generatePlan` (template-aware)** — custom sections, body preservation, Goal/CurrentState handling, malformed fallback, sentinel safety, determinism (Phase 5)
- **Placeholder substitution** — `{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}` substitution, multi-placeholder lines, unknown token preservation, section-name fallback, no double-injection, fallback on missing/malformed templates (Phase 6)
- **`generatePlanWithMeta`** — template usage metadata reporting (Phase 6)
- **`TEMPLATE_PLACEHOLDERS`** — constant correctness (Phase 6)
- **`hasAllSections` / `extractSectionHeadings`** — section validation
- **`writeCurrentPlan`** — placeholder replacement, refusal on meaningful plan
- **`extractPlanTitle`** — from H1, from `# Plan:`, from Goal section, fallback
- **`slugify`** — normalization, special chars, length cap, empty input
- **`archiveFilename`** — format, padding, sortability, determinism, date-only style
- **`readCurrentPlan` / `forceWriteCurrentPlan`** — read/write, unconditional write
- **`archivePlan`** — directory creation, content preservation, collision handling, config-aware
- **`listArchives`** — empty states, sort order, label extraction, non-md filtering, maxArchiveListEntries
- **`countArchives`** — total count independent of list cap
- **`readArchive`** — content reading, nonexistent file
- **Replace flow** — archive old + write new, cancellation leaves unchanged
- **Restore flow** — archive current + restore archive, cancellation leaves unchanged
- **`updateIndex`** — current title, archive listing, determinism, after replace
- **`reconcileIndex`** — skip when not initialized, regenerate stale/missing index, manual add/remove correction, idempotency, no corruption, custom archive dir (Phase 5)
- **`handlePlan`** — no-repo error, init offer/cancel, create/cancel/confirm, inline args, has-plan cancel/resume, replace success/cancel/inline-args, restore success/cancel, no-archives path (Phase 5 + Phase 6)
- **`handlePlanDebug`** — no-repo error, log writing, not-initialized state (Phase 5)
- **Template diagnostics** — template.usable and template.sectionCount across states, fallback notes (Phase 6)
- **`resolveGoal`** — inline args, interactive prompt, disabled inline, empty/null input (Phase 5)
- **Template primitives** — `parseTemplate`, `readTemplateSections`, `TEMPLATE_PLACEHOLDERS`, `buildCurrentStateValue` from `template-core.ts` (Phase 8)
- **CURRENT_STATE consistency** — config override affects all generation paths (placeholder, section-name fallback, built-in fallback), consistent output across paths (Phase 8)
- **State integration** — hasCurrentPlan works with archives, archive dir doesn't break state

Tests do **not** cover:
- `detectRepoRoot` / `detectPlanState` via real Pi runtime (tested via `ExecFn` seam)
- Full Pi command registration wiring (thin bridge in `index.ts`)
- Config file permission errors

These are covered by the manual verification path above.

## File structure

```
pi-plan/
  index.ts              # Extension entry — registers /plan and /plan-debug (thin bridge)
  orchestration.ts      # Command handler logic, PlanUI interface, template repair (Phase 5+7+8)
  template-core.ts      # Shared template primitives: types, parsing, CURRENT_STATE builder (Phase 8)
  template-analysis.ts  # Template mode classification (Phase 7+8)
  repo.ts               # Repo detection, state detection, ExecFn seam, initialization
  defaults.ts           # Default file contents for planning structure
  config.ts             # Lightweight config loader/normalizer (Phase 4+7)
  summary.ts            # Plan summary and archive label helpers (Phase 4)
  diagnostics.ts        # Diagnostic snapshot model, collection, log writing
  plangen.ts            # Template-aware plan generation (Phase 5+6+7+8+9)
  archive.ts            # Archive lifecycle — archive, list, restore, index, reconciliation
  package.json          # Pi package manifest
  vitest.config.ts      # Test config
  tests/
    repo.test.ts        # Unit tests for detection, initialization, ExecFn seam (Phase 5)
    diagnostics.test.ts # Unit tests for diagnostics, logging, snapshot safety, config awareness
    plangen.test.ts     # Unit tests for plan generation, template parsing, writing, safety (Phase 5+8)
    archive.test.ts     # Unit tests for archive helpers, flows, index, state integration
    config.test.ts      # Unit tests for config loading, validation, fallback (Phase 4)
    summary.test.ts     # Unit tests for summary extraction and archive labels (Phase 4)
    orchestration.test.ts # Unit tests for command handler branches (Phase 5+7)
    reconcile.test.ts   # Unit tests for index reconciliation (Phase 5)
    template-analysis.test.ts # Unit tests for shared template analysis (Phase 7)
    template-core.test.ts # Unit tests for template primitives and CURRENT_STATE builder (Phase 8)
  README.md
```

## Architecture

- **`defaults.ts`** — All default file contents as named constants. Includes the
  sentinel string used for placeholder detection.
- **`config.ts`** — Lightweight config loader/normalizer. Reads `.pi/pi-plan.json`,
  validates each field, falls back to sensible defaults. Returns config + warnings +
  source. Pure helper, no Pi UI dependencies. (Phase 4)
- **`summary.ts`** — Plan summary extraction for resume and archive polish.
  Exports `extractPlanSummary()`, `formatArchiveTimestamp()`, `formatArchiveLabel()`.
  Pure helpers, no filesystem dependencies. (Phase 4)
- **`orchestration.ts`** — Command handler logic extracted from `index.ts`. Defines
  the `PlanUI` interface for testability. Exports `handlePlan()`, `handlePlanDebug()`,
  `resolveGoal()`. Calls `reconcileIndex()` before key flows.
- **`repo.ts`** — Pure detection and filesystem helpers. Exports `detectRepoRoot()`,
  `detectRepoRootWith()`, `detectPlanStateWith()`, `hasPlanningProtocol()`,
  `isFullyInitialized()`, `hasCurrentPlan()`, `detectPlanState()`, `initPlanning()`,
  `writeCurrentPlan()`, and the `ExecFn` type. No Pi UI dependencies.
- **`diagnostics.ts`** — Pure diagnostics model. Imports state helpers from
  `repo.ts` and archive helpers from `archive.ts`. Exports `collectDiagnostics()`,
  `writeDiagnosticLog()`, and timestamp/filename helpers. Config-aware: includes
  effective archive/log paths and config metadata in snapshots. No Pi UI dependencies.
- **`template-core.ts`** — Shared template primitives used by both `plangen.ts`
  and `template-analysis.ts`. Owns `TemplateSection` type, `TEMPLATE_PLACEHOLDERS`,
  `parseTemplate()`, `readTemplateSections()`, and `buildCurrentStateValue()` —
  the single canonical builder for `{{CURRENT_STATE}}` content. No circular
  dependencies.
- **`plangen.ts`** — Template-aware plan generation with explicit placeholder
  substitution (`{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}`). Uses
  `template-core.ts` for parsing and `template-analysis.ts` for mode classification.
  Falls back to built-in sections. All CURRENT_STATE content flows through
  `buildCurrentStateValue()` for consistency. No Pi UI or filesystem
  write dependencies.
- **`archive.ts`** — Pure archive lifecycle helpers. Exports `extractPlanTitle()`,
  `slugify()`, `archiveFilename()`, `readCurrentPlan()`, `forceWriteCurrentPlan()`,
  `archivePlan()`, `listArchives()`, `countArchives()`, `readArchive()`,
  `updateIndex()`, `reconcileIndex()`. Config-aware: respects custom archive dir,
  filename style, and list limits. All pure filesystem operations, no Pi UI dependencies.
- **`index.ts`** — Thin entry point. Registers `/plan` and `/plan-debug`.
  Bridges Pi's `ExtensionAPI` to the `PlanUI` interface and delegates to
  `orchestration.ts`.

The separation means:
- `/plan` and `/plan-debug` use the same state helpers (no drift)
- Config loading is pure and testable without Pi runtime
- Summary/label helpers are pure and testable without filesystem
- Plan generation and archive management are pure and testable without Pi runtime
- Plan writing is guarded by `hasCurrentPlan` (refuses to overwrite real plans)
- Archive operations are guarded by confirmation flows in the command handler
- `index.md` is always regenerated deterministically, not patched
- Later phases can extend with enforcement, richer flows, or global config
  without changing the core state model or archive infrastructure

## Internal Documentation

For maintainers and contributors, see:

- [`AGENTS.md`](AGENTS.md) — maintainer overview, module ownership, invariants, extension points
- [`docs/architecture.md`](docs/architecture.md) — architecture, state model, command flows
- [`docs/file-contracts.md`](docs/file-contracts.md) — repo-local file semantics and contracts
- [`tests/TESTING.md`](tests/TESTING.md) — test coverage strategy

## Expected future phases

- **Phase 10+**: Plan linting/enforcement, richer revision flows, global config defaults

## Dependencies

- Git (for repo root detection via `git rev-parse --show-toplevel`)
- Pi Coding Agent (`@mariozechner/pi-coding-agent`)
