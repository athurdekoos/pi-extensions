# pi-plan

Repo-local planning extension for [Pi Coding Agent](https://github.com/badlogic/pi-mono) with browser-based visual plan review, code review, and markdown annotation.

## Status: v2.2.0

v2.2.0 adds a deterministic branch finishing workflow (merge, PR, keep, discard) on top of TDD enforcement, brainstorming, worktree isolation, and browser-based review. All canonical state lives in `.pi/` — no home-directory state, no auto-approve.

## How pi-plan Works

pi-plan enforces a **plan-before-code discipline** via a 9-phase state machine that progressively gates what the AI agent can do. It is not just plan storage — it actively prevents implementation until a plan exists and is approved.

### The planning lifecycle

When enforcement is enabled, pi-plan moves through these phases:

```
inactive → not-initialized → needs-plan → brainstorming → has-plan → review-pending → executing → finishing
```

1. **`not-initialized`** — You're in a git repo but `.pi/` doesn't exist yet. `/plan` offers to create the planning structure.
2. **`needs-plan`** — Planning is initialized but no plan exists. The agent receives context telling it to create a plan before coding.
3. **`brainstorming`** (optional) — The agent writes design specs before committing to a plan. Submitting a spec via `submit_spec` transitions to planning.
4. **`has-plan`** — A plan exists in `current.md`. The agent submits it for review via `submit_plan`.
5. **`review-pending`** — The plan is open in the browser review UI. You approve or deny with feedback.
6. **`executing`** — The plan is approved. The agent works through steps, marking each complete with `[DONE:n]`. TDD enforcement gates file writes if enabled.
7. **`finishing`** — All steps done. The user chooses how to land the work: merge locally, create a pull request, keep the branch for later, or discard. Write-gated — the agent cannot interfere with the finishing decision.

Most phases are **computed, not stored** — derived from the enforcement toggle and filesystem state (does `.pi/` exist? does `current.md` have a real plan?). A few lifecycle phases (`brainstorming`, `review-pending`, `finishing`) are set imperatively by specific actions but degrade gracefully to computed phases on session restore.

### What makes pi-plan special

1. **Computed state, not stored state** — Phase is derived from filesystem + toggle. No stored state to drift or corrupt. Restarting a session picks up exactly where you left off.
2. **Immutable history** — Archives are write-once. `index.md` is always fully regenerated (never patched). Manual file additions/removals are auto-corrected on next command.
3. **No auto-approve** — Browser review is mandatory. If the browser UI is unavailable, `submit_plan` returns an error. Plans are never silently approved.
4. **Graceful degradation** — Missing config uses defaults. Malformed JSON falls back with warnings. Missing templates use built-in fallback sections. Invalid config fields degrade per-field, not all-or-nothing. Nothing crashes.
5. **Repo-local, no home-directory state** — Everything lives in `.pi/`. No global state, no background processes, no silent side effects.
6. **Deterministic finishing** — When a plan completes, the user controls what happens to the branch via a menu (merge, PR, keep, discard). The agent never decides how to land work.

## Quick Start

```bash
# 1. Load the extension
pi -e /path/to/pi-extensions/pi-plan

# 2. Initialize planning (in any git repo)
/plan  # → accept initialization

# 3. Create a plan
/plan Build a JWT auth layer  # → confirm to write

# 4. Enable enforcement for plan-before-code discipline
pi -e /path/to/pi-extensions/pi-plan --plan

# 5. Work through steps — agent marks [DONE:n] as it goes
/todos  # → see progress
```

See [docs/quickstart.md](docs/quickstart.md) for a complete walkthrough.

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

Once installed globally, all commands are available in every Pi session but only do meaningful work inside git repositories.

## Commands

### `/plan` — planning state, initialization, plan creation, and lifecycle

- Detects the current git repository root
- Distinguishes four states and acts accordingly:

| State | Behavior |
|-------|----------|
| **No repo** | Refuses to run |
| **Repo found, not initialized** | Offers to create the full `.pi/` planning structure |
| **Repo initialized, no current plan** | Asks for a task goal (or accepts inline args), generates a plan scaffold, confirms, writes to `current.md` |
| **Repo initialized, current plan exists** | Presents an action menu: resume, replace, revisit archives, or cancel |

#### Inline goal passthrough

`/plan` accepts goal text directly as arguments:

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

#### Active plan flow

When a meaningful current plan exists, `/plan` presents a short interactive action menu:

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

### `/todos` — step progress

Show current plan step progress — numbered list with checkmark/circle completion markers.

### `/tdd` — TDD enforcement toggle

Toggles TDD enforcement on or off and shows a compliance summary. When TDD enforcement is active:
- The extension gates file writes: test files must be written before production files within each implementation step
- Compliance is logged to `.pi/tdd/compliance-YYYY-MM-DD.json` (append-only)
- Step completion via `[DONE:n]` markers is validated against TDD compliance

Configurable via `tddEnforcement` and `testFilePatterns` in `.pi/pi-plan.json`.

### `/plan-review` — interactive code review

Opens a browser-based code review UI for current git changes. Shows uncommitted, staged, last-commit, or branch diffs with annotation support. Feedback is sent back to the agent.

### `/plan-annotate <file.md>` — markdown annotation

Opens any markdown file in a browser-based annotation UI. Feedback is sent back to the agent.

### `/plan-finish` — branch finishing workflow

Manually triggers the branch finishing workflow. Available whenever a worktree exists, regardless of current phase. Presents a menu with four options:

- **Merge into base branch locally** — `git merge --no-ff`, cleanup worktree + branch
- **Create pull request** — push branch, `gh pr create`, cleanup worktree only (if `gh` is available)
- **Keep branch** — remove worktree, keep branch for later
- **Discard** — remove both worktree and branch

Useful for recovery from interrupted sessions where the phase degraded on restore but the worktree is still present. Configurable via `defaultFinishAction` and `prTemplate` in `.pi/pi-plan.json`.

## Tools

### `submit_plan`

The agent calls `submit_plan` after drafting a plan to `.pi/plans/current.md`. This opens a browser-based visual review UI where you can:
- Approve the plan (optionally with implementation notes)
- Deny with detailed feedback and annotations
- See diffs against the previous archived plan

No auto-approve: if the browser UI is unavailable, the tool returns an error.

### `submit_spec`

The agent calls `submit_spec` during the brainstorming phase to submit a design spec for review. Parameters: `specPath` (required, path to the spec file) and `summary` (optional). Transitions the workflow from brainstorming to planning phase.

## Flags

### `--plan`

Start Pi with plan enforcement enabled:
```bash
pi -e ~/dev/pi-extensions/pi-plan --plan
```

### Environment variable

Set `PI_PLAN_BROWSER` to specify a custom browser for review UIs.

## Configuration

`pi-plan` supports a lightweight repo-local configuration file:

```
.pi/pi-plan.json
```

All settings are optional. Missing or absent config uses sensible defaults.
Invalid values fall back to defaults with warnings — never crashes.

### Config options

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
| `injectPlanContext` | boolean | `true` | Inject plan-state context messages into agent turns |
| `reviewDir` | string | `".pi/plans/reviews"` | Relative path for review records |
| `stepFormat` | `"numbered"` \| `"checkbox"` \| `"both"` | `"both"` | Step format for plan tracking |
| `tddEnforcement` | boolean | `true` | Enable TDD write-gating (test before prod) |
| `testFilePatterns` | string[] | `["*.test.*", "*.spec.*", "__tests__/**", "test/**", "tests/**"]` | Glob patterns for test file detection |
| `brainstormEnabled` | boolean | `true` | Enable brainstorming phase before planning |
| `worktreeEnabled` | boolean | `true` | Enable git worktree isolation for plans |
| `specDir` | string | `".pi/specs"` | Relative path for brainstorm design specs |
| `tddLogDir` | string | `".pi/tdd"` | Relative path for TDD compliance logs |
| `worktreeStateDir` | string | `".pi/worktrees"` | Relative path for worktree state files |
| `defaultFinishAction` | `"merge"` \| `"pr"` \| `"keep"` \| `"discard"` \| `null` | `null` | Default finishing action (skips menu when set; `null` = always ask) |
| `prTemplate` | string \| null | `null` | PR body template with `{{BRANCH}}` and `{{PLAN_TITLE}}` placeholders |

### Example config

```json
{
  "archiveDir": ".pi/plans/archive",
  "resumeShowSummary": true,
  "maxArchiveListEntries": 10,
  "archiveFilenameStyle": "date-only"
}
```

### Config behavior

- Missing config file → all defaults, no warnings
- Malformed JSON → all defaults, warning notification
- Invalid field values → default for that field, warning notification
- Unknown keys → silently ignored
- Valid fields survive alongside invalid ones

**Limitation:** This implements repo-local config only. Global defaults
(e.g. `~/.pi/agent/settings.json`) are not yet supported.

## Planning Structure

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
    reviews/                 # Review records (append-only)
      review-TIMESTAMP.json
  specs/                     # Brainstorm design specs (immutable after write)
    YYYY-MM-DD-HHMM-slug.md
  tdd/                       # TDD compliance logs (append-only)
    compliance-YYYY-MM-DD.json
  worktrees/                 # Worktree state
    active.json
  pi-plan.json               # Optional config file
.worktrees/                  # Git worktree directories (gitignored)
  <slug>/
```

### Review records

All review decisions are recorded as append-only JSON files under `.pi/plans/reviews/`. Each record includes timestamp, approved/denied status, feedback, and plan title.

### Current plan detection

`current.md` is considered to have a real plan when:
- The file exists
- It is not empty or whitespace-only
- It does not contain the placeholder sentinel string

This makes the "no plan yet" vs "plan exists" distinction deterministic.

## State Model — `AutoPlanPhase`

The enforcement state machine recognizes 9 phases:

| Phase | Condition |
|---|---|
| `inactive` | Enforcement toggled OFF |
| `no-repo` | Toggled ON but not in a git repo |
| `not-initialized` | Toggled ON but `.pi/` doesn't exist |
| `needs-plan` | Toggled ON, initialized, no current plan |
| `brainstorming` | Design phase active (writing specs) |
| `has-plan` | Toggled ON, current plan exists |
| `review-pending` | Plan submitted for browser review |
| `executing` | Actively tracking step completion |
| `finishing` | Plan complete, finishing workflow active (write-gated) |

Most phase transitions are pure functions of the toggle state and filesystem state. The lifecycle phases (`brainstorming`, `review-pending`, `finishing`) are set imperatively by specific actions but degrade to computed phases on session restore. The `AutoPlanState` interface tracks: phase, repoRoot, todoItems, enforcementActive, tddStepTestWritten, worktreeActive, worktreePath, and brainstormSpecPath.

### Step format support

Plans support both numbered steps (`1. Step`) and checkbox steps (`- [ ] Step`). The extension auto-detects which format is used. Configurable via `stepFormat` in `.pi/pi-plan.json`.

## Template System

Generated plans derive their section structure from `.pi/templates/task-plan.md` and use explicit placeholder substitution.

### Available placeholders

| Placeholder | Value |
|---|---|
| `{{GOAL}}` | The user's goal text |
| `{{REPO_ROOT}}` | Absolute repo root path |
| `{{CURRENT_STATE}}` | Current-state block (configurable via `currentStateTemplate` config) |

### Template modes

- **Explicit placeholders**: Template uses `{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}`. These are substituted with actual values during plan generation.
- **Section-name fallback**: For templates without placeholders, "Goal" and "Current State" sections still get special handling — Goal is filled with the user's goal, Current State includes the repo root path.
- **Default fallback**: If the template is missing, empty, or has no H2 sections, the built-in default sections (which use placeholders) are used.
- **Invalid**: Template file exists but has no H2 sections. Falls back to built-in sections.

Unknown `{{TOKENS}}` are left as-is — no error, no removal. Generated plans never contain the placeholder sentinel.

### Configurable `{{CURRENT_STATE}}`

The `{{CURRENT_STATE}}` expansion can be customized in `.pi/pi-plan.json`:

```json
{
  "currentStateTemplate": "Project root: `{{REPO_ROOT}}`\n\nDescribe the current state of the codebase."
}
```

The custom template may include `{{REPO_ROOT}}` which is substituted at generation time.
If not set (or `null`), the default expansion includes the repo root path and a prompt to describe the starting point.

### Template repair/reset

When `/plan` detects a missing or unusable template before plan generation, it offers a concise confirmation to restore the default template:

- **Missing or unusable template**: Confirm to restore default → writes `.pi/templates/task-plan.md` from built-in defaults
- **Legacy template (no placeholders)**: Brief info notice — generation proceeds normally with section-name fallback
- **Healthy template**: No notice

Declining the repair still allows plan generation using built-in fallback sections. Cancel leaves files unchanged.

## Archive Strategy

- Archives live in the configured archive directory (default `.pi/plans/archive/`)
- Filenames are deterministic and sortable
  - `date-slug` style: `YYYY-MM-DD-HHMM-<slug>.md` (default)
  - `date-only` style: `YYYY-MM-DD-HHMM.md`
- Slugs are derived from the plan title (lowercase, alphanumeric, max 40 chars)
- Collisions are handled by appending a counter suffix
- Archives are immutable once written
- The archive directory is created on first archive, not during init

### Archive browsing

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

`index.md` is opportunistically reconciled at the start of `/plan` and
`/plan-debug` flows. This means if files are manually added, removed, or
edited outside the extension, the index will be corrected on the next command
invocation. Reconciliation is safe, deterministic, and idempotent — it only
writes `index.md` and never modifies current.md or archives.

## TDD Enforcement

When `tddEnforcement` is enabled (default: `true`), the extension gates file writes during plan execution:

- **Test-first requirement**: Within each implementation step, test files must be written before production files
- **Test file detection**: Uses configurable glob patterns (`testFilePatterns`) to identify test files
- **Compliance logging**: Each step's TDD compliance is logged to `.pi/tdd/compliance-YYYY-MM-DD.json` (append-only JSON arrays)
- **Step validation**: `[DONE:n]` markers are validated — a step cannot be marked complete unless TDD compliance was met
- **`.pi/` files are always allowed**: Writes to planning infrastructure are never gated

## Brainstorming Phase

When `brainstormEnabled` is enabled (default: `true`), the workflow includes a design phase before planning:

- **Spec creation**: The agent writes design specs to `.pi/specs/` using `YYYY-MM-DD-HHMM-slug.md` format
- **Spec template**: Specs follow a built-in template with sections for Problem Statement, Context, Constraints, Proposed Approach, Alternatives Considered, Open Questions, and Success Criteria
- **`submit_spec` tool**: Submits a spec for review, transitioning from brainstorming to planning phase
- **Spec listing**: `listSpecs()` returns specs sorted newest-first with titles and dates
- **Immutability**: Specs are immutable after write

## Git Worktree Isolation

When `worktreeEnabled` is enabled (default: `true`), each plan executes in an isolated git worktree:

- **Automatic creation**: `createWorktreeForPlan()` creates a worktree at `.worktrees/<slug>/` with branch `plan/<slug>`
- **State persistence**: Active worktree info is stored in `.pi/worktrees/active.json`
- **Setup detection**: Auto-detects and runs setup commands (npm install, yarn install, pip install, etc.)
- **Finishing workflow**: On plan completion, a menu offers four options: merge locally (`--no-ff`), create a pull request (via `gh`), keep the branch (remove worktree only), or discard both. See `/plan-finish`.
- **Gitignore**: `.worktrees/` is automatically added to `.gitignore`

## What it does NOT do yet

- No global config defaults (repo-local only)
- No multi-step plan editing or revision
- No auto-planning before coding
- No plan linting
- No background automation
- No telemetry upload
- No advanced archive search/filtering
- No multiple simultaneous current plans

## Running tests

```bash
cd pi-plan && npm test
```

Tests cover (571 tests across 24 files):
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
- **`detectRepoRootWith`** — success, failure, whitespace trimming, empty stdout, arg passing
- **`detectPlanStateWith`** — all five state scenarios via mock ExecFn
- **`formatTimestamp`** — deterministic sortable timestamps
- **`logFilename` / `logRelPath`** — filename pattern and path structure
- **`collectDiagnostics`** — all four states, field presence, archive info, title, config awareness
- **`writeDiagnosticLog`** — directory creation, valid JSON, no-overwrite
- **Snapshot safety** — no file body content in diagnostics (title is metadata)
- **`parseTemplate`** — section extraction, body capture, malformed input, H1 skipping
- **`readTemplateSections`** — missing file, empty file, no-H2 file, valid file
- **`deriveTitle`** — title extraction, truncation, edge cases
- **`generatePlan` (fallback)** — goal inclusion, section completeness, determinism, no sentinel
- **`generatePlan` (template-aware)** — custom sections, body preservation, Goal/CurrentState handling, malformed fallback, sentinel safety, determinism
- **Placeholder substitution** — `{{GOAL}}`, `{{REPO_ROOT}}`, `{{CURRENT_STATE}}` substitution, multi-placeholder lines, unknown token preservation, section-name fallback, no double-injection, fallback on missing/malformed templates
- **`generatePlanWithMeta`** — template usage metadata reporting
- **`TEMPLATE_PLACEHOLDERS`** — constant correctness
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
- **`reconcileIndex`** — skip when not initialized, regenerate stale/missing index, manual add/remove correction, idempotency, no corruption, custom archive dir
- **`handlePlan`** — no-repo error, init offer/cancel, create/cancel/confirm, inline args, has-plan cancel/resume, replace success/cancel/inline-args, restore success/cancel, no-archives path
- **`handlePlanDebug`** — no-repo error, log writing, not-initialized state
- **Template diagnostics** — template.usable and template.sectionCount across states, fallback notes
- **`resolveGoal`** — inline args, interactive prompt, disabled inline, empty/null input
- **Template primitives** — `parseTemplate`, `readTemplateSections`, `TEMPLATE_PLACEHOLDERS`, `buildCurrentStateValue` from `template-core.ts`
- **CURRENT_STATE consistency** — config override affects all generation paths (placeholder, section-name fallback, built-in fallback), consistent output across paths
- **State integration** — hasCurrentPlan works with archives, archive dir doesn't break state
- **TDD enforcement** — `globToRegex`, `isTestFile`, `evaluateTddGate`, `validateStepCompletion`, `logTddCompliance`, test-first gating, `.pi/` file allowlisting
- **Brainstorming** — `generateSpecFilename`, `writeSpec`, `readSpec`, `listSpecs`, spec immutability, filename format, newest-first ordering
- **Worktree isolation** — `deriveWorktreeBranch`, `isWorktreeDirIgnored`, `addWorktreeDirToGitignore`, `detectSetupCommands`, `writeWorktreeState`, `readWorktreeState`, `createWorktreeForPlan`, `cleanupWorktree`, state persistence
- **Auto-plan state machine** — `computePhase` for all 9 phases, `getContextMessage`, `extractStepsFromCurrentPlan`, `getStatusDisplay`, `getWidgetLines`, `serializeState`, `restoreState`, TDD and worktree state fields
- **Harness interception** — `evaluateInput` for all phases, context injection, never-blocks invariant
- **Integration** — TDD gating during execution, brainstorm-to-plan transition, worktree lifecycle, config options

Tests do **not** cover:
- `detectRepoRoot` / `detectPlanState` via real Pi runtime (tested via `ExecFn` seam)
- Full Pi command registration wiring (thin bridge in `index.ts`)
- Config file permission errors

These are covered by the manual verification path below.

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

### 13. Verify template placeholder substitution

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

### 13b. Verify legacy template fallback

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

### 14. Verify index reconciliation

```bash
# Manually add an archive file:
echo "# Plan: Manual\n\n## Goal\n\nManually added." > .pi/plans/archive/2026-01-01-1000-manual.md
# Type: /plan (or /plan-debug)
# Verify: index.md now includes the manually added archive
```

### 15. Verify TDD gating

```
# With enforcement ON and a plan in executing phase:
# Try to write a production file before a test file
# Expected: write blocked with TDD gate message
# Write a test file first, then the production file
# Expected: both writes succeed
# Type: /tdd
# Expected: TDD compliance summary
```

### 16. Verify brainstorming flow

```
# With brainstormEnabled: true and enforcement ON:
# Start a new plan flow
# Expected: brainstorming phase activates
# Agent writes a spec to .pi/specs/
# Agent calls submit_spec with the spec path
# Expected: transitions to planning phase
```

### 17. Verify worktree lifecycle

```
# With worktreeEnabled: true and enforcement ON:
# Create a new plan
# Expected: worktree created at .worktrees/<slug>/, .worktrees/ added to .gitignore
# Verify: .pi/worktrees/active.json contains worktree info
# Complete/archive the plan
# Expected: worktree cleaned up, active.json removed
```

## File structure

```
pi-plan/
  index.ts              # Extension entry — commands, tools, lifecycle hooks (thin bridge)
  orchestration.ts      # Command handler logic, PlanUI interface, template repair
  template-core.ts      # Shared template primitives: types, parsing, CURRENT_STATE builder
  template-analysis.ts  # Template mode classification
  repo.ts               # Repo detection, state detection, review records, migration
  defaults.ts           # Default file contents for planning structure
  config.ts             # Lightweight config loader/normalizer
  summary.ts            # Plan summary and archive label helpers
  diagnostics.ts        # Diagnostic snapshot model, collection, log writing
  plangen.ts            # Template-aware plan generation
  archive.ts            # Archive lifecycle — archive, list, restore, index, reconciliation
  auto-plan.ts          # Plan enforcement state machine (9 phases)
  harness.ts            # Harness-level input interception
  mode-utils.ts         # Step extraction and [DONE:n] tracking
  tdd.ts                # TDD enforcement — write-gating, compliance logging
  brainstorm.ts         # Brainstorming phase — spec I/O, filename generation
  worktree.ts           # Git worktree isolation — creation, cleanup, state
  finish.ts             # Branch finishing workflow — merge, PR, keep, discard
  hooks.ts              # Lifecycle hook handlers (tool_call, input, context, turn_end, agent_end, session_start)
  tools.ts              # Tool implementations (submit_plan, submit_spec)
  review.ts             # Review orchestration — browser review lifecycle
  server.ts             # Ephemeral HTTP servers for plan/code/annotate review
  browser.ts            # System browser launcher
  assets/
    plan-review.html    # Pre-built plan review + annotation UI
    review-editor.html  # Pre-built code review UI
  package.json          # Pi package manifest
  vitest.config.ts      # Test config
  tests/                # 571 tests across 24 files
  README.md
```

## Architecture

- **`defaults.ts`** — All default file contents as named constants. Includes the
  sentinel string used for placeholder detection.
- **`config.ts`** — Lightweight config loader/normalizer. Reads `.pi/pi-plan.json`,
  validates each field, falls back to sensible defaults. Returns config + warnings +
  source. Pure helper, no Pi UI dependencies.
- **`summary.ts`** — Plan summary extraction for resume and archive polish.
  Exports `extractPlanSummary()`, `formatArchiveTimestamp()`, `formatArchiveLabel()`.
  Pure helpers, no filesystem dependencies.
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
- **`tdd.ts`** — TDD enforcement gate logic. Exports `evaluateTddGate()`,
  `isTestFile()`, `validateStepCompletion()`, `logTddCompliance()`. Pure
  helper, no Pi UI dependencies.
- **`brainstorm.ts`** — Brainstorming spec I/O. Exports `generateSpecFilename()`,
  `writeSpec()`, `readSpec()`, `listSpecs()`. Pure filesystem operations.
- **`worktree.ts`** — Git worktree isolation. Exports `createWorktreeForPlan()`,
  `cleanupWorktree()`, `writeWorktreeState()`, `readWorktreeState()`,
  `deriveWorktreeBranch()`. Manages `.worktrees/` directories and `.pi/worktrees/active.json`.
- **`finish.ts`** — Deterministic branch finishing workflow. Pure functions with `ExecFn`
  seam. `executeFinishing()` orchestrates the four-option menu (merge, PR, keep, discard).
  `generatePrBody()` extracts title/goal/steps from plan content with template support.
  `detectBaseBranch()` finds the remote HEAD. `isGhAvailable()` checks gh CLI.
- **`hooks.ts`** — Lifecycle hook handlers. Exports handlers for `tool_call` (write-gating
  for brainstorming, finishing, planning, TDD, worktree), `input` (phase-based message
  transformation), `context` (plan state injection), `turn_end` (step completion tracking),
  `agent_end` (plan completion and finishing workflow orchestration), and `session_start`
  (state restoration with phase degradation).
- **`tools.ts`** — Tool implementations. Exports `handleSubmitPlan()` and
  `handleSubmitSpec()`. Coordinates browser review lifecycle and brainstorm transitions.
- **`index.ts`** — Thin entry point. Registers `/plan`, `/plan-debug`, `/todos`,
  `/tdd`, `/plan-review`, `/plan-annotate`, and `/plan-finish`. Registers `submit_plan`
  and `submit_spec` tools. Bridges Pi's `ExtensionAPI` to the `PlanUI` interface
  and delegates to `orchestration.ts`, `hooks.ts`, `tools.ts`, and `finish.ts`.

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

## Documentation

| Document | Purpose |
|---|---|
| [`docs/quickstart.md`](docs/quickstart.md) | Getting started tutorial |
| [`docs/workflows.md`](docs/workflows.md) | Common workflow patterns |
| [`docs/architecture.md`](docs/architecture.md) | Architecture, state model, command flows |
| [`docs/file-contracts.md`](docs/file-contracts.md) | Repo-local file semantics and contracts |
| [`AGENTS.md`](AGENTS.md) | Maintainer overview, module ownership, invariants |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor guide |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Pre-release verification |
| [`tests/TESTING.md`](tests/TESTING.md) | Test coverage strategy |

## Future work

- Plan linting and validation
- Richer revision flows
- Global config defaults
- Ctrl+Alt+P keyboard shortcut

## Dependencies

- Git (for repo root detection via `git rev-parse --show-toplevel`)
- Pi Coding Agent (`@mariozechner/pi-coding-agent`)
