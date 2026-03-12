# pi-plan File Contracts

This document defines the expected purpose, ownership, and semantics of each repo-local file managed by `pi-plan`. Future changes should respect these contracts.

## `.pi/PLANNING_PROTOCOL.md`

- **Purpose**: Agent-facing document that instructs the agent to read and follow the planning protocol before starting work.
- **Created by**: `initPlanning()` in `repo.ts`
- **Content source**: `PLANNING_PROTOCOL` constant in `defaults.ts`
- **User-editable**: Yes. Users may customize the protocol for their repo.
- **Extension-modified after creation**: No. `initPlanning()` skips existing files.
- **Invariants**: Must exist for the repo to be considered "initialized" (checked by `isFullyInitialized()`).

## `.pi/templates/task-plan.md`

- **Purpose**: Reference template showing the expected section structure of a plan. Drives generated plan content via explicit placeholder substitution.
- **Created by**: `initPlanning()` in `repo.ts`
- **Content source**: `TASK_PLAN_TEMPLATE` constant in `defaults.ts`
- **User-editable**: Yes. Users may customize sections and use template placeholders.
- **Extension-modified after creation**: No.
- **Invariants**: Must exist for "initialized" status. `plangen.ts` reads this file at plan generation time to determine section structure and substitute placeholders. If the file is missing, empty, or has no H2 sections, the built-in fallback sections are used. Customizing this file meaningfully affects generated plans.

### Template placeholder contract (Phase 6)

The template supports three explicit placeholders that are substituted during plan generation:

| Placeholder | Substitution |
|---|---|
| `{{GOAL}}` | The user's goal text (verbatim) |
| `{{REPO_ROOT}}` | The absolute repo root path |
| `{{CURRENT_STATE}}` | A default current-state block: repo root line + description prompt |

**Substitution rules:**

1. Placeholders are replaced literally wherever they appear in section body text.
2. A placeholder may appear multiple times or on the same line as other text.
3. Unknown `{{...}}` tokens are left as-is (no error, no removal).
4. Placeholders are NOT substituted in section headings.
5. `{{CURRENT_STATE}}` expands to a multi-line block via `buildCurrentStateValue()` from `template-core.ts`.

**Section-name fallback:**

If a section has a well-known heading but contains no recognized placeholders:
- **"Goal"** section: the user's goal text is injected as body content
- **"Current State"** section: canonical current-state content (from `buildCurrentStateValue()`) is injected, and any existing body content is preserved below it

This fallback ensures basic plan quality with legacy templates that predate the placeholder contract. The section-name fallback for "Current State" uses the same canonical builder as `{{CURRENT_STATE}}` placeholder substitution, so `currentStateTemplate` config overrides apply consistently.

**Graceful degradation:**

- Missing template file → built-in fallback sections (which contain `{{CURRENT_STATE}}`, substituted normally)
- Empty template file → fallback sections
- Template with no H2 sections → fallback sections
- Template with unrecognized placeholders → tokens left as-is

### Template system modules (Phase 8)

The template system is split across three modules:

| Module | Owns |
|---|---|
| `template-core.ts` | Primitives: `TemplateSection`, `TEMPLATE_PLACEHOLDERS`, `parseTemplate()`, `readTemplateSections()`, `buildCurrentStateValue()` |
| `template-analysis.ts` | Classification: `TemplateMode`, `analyzeTemplate()`, `analyzeTemplateFromDisk()`, `detectPlaceholders()` |
| `plangen.ts` | Generation: `generatePlan()`, `generatePlanWithMeta()`, placeholder substitution, section-name fallback, fallback sections |

Import template primitives (`parseTemplate`, `readTemplateSections`, `TEMPLATE_PLACEHOLDERS`, `TemplateSection`, `TemplatePlaceholder`) directly from `template-core.ts`.

### Template modes (Phase 7)

`template-analysis.ts` classifies every template into one of four modes:

| Mode | Condition | Behavior |
|---|---|---|
| `explicit-placeholders` | Valid H2 sections + recognized `{{...}}` placeholders | Placeholders substituted, template sections used |
| `legacy-section-fallback` | Valid H2 sections, no recognized placeholders | Section-name fallback for Goal/Current State |
| `default-fallback` | File missing | Built-in fallback sections |
| `invalid` | File exists, no H2 sections | Built-in fallback sections |

Both `plangen.ts` and `diagnostics.ts` use `template-analysis.ts` for classification. This ensures they always agree on the template state.

### CURRENT_STATE consistency (Phase 8)

All paths that produce current-state content use `buildCurrentStateValue()` from `template-core.ts`:

1. **Placeholder path**: `{{CURRENT_STATE}}` → substituted via `buildSubstitutions()`
2. **Section-name fallback path**: "Current State" heading without placeholders → direct call
3. **Fallback sections path**: Built-in sections contain `{{CURRENT_STATE}}` → same as path 1

The `currentStateTemplate` config override affects all three paths consistently.

### Configurable `{{CURRENT_STATE}}` (Phase 7 + 8)

The `{{CURRENT_STATE}}` expansion can be overridden via `currentStateTemplate` in `.pi/pi-plan.json`. The value may contain `{{REPO_ROOT}}` which is substituted at generation time. Default is `null` (uses `DEFAULT_CURRENT_STATE_TEMPLATE` from `defaults.ts`). The override applies consistently across all generation paths — explicit placeholder, section-name fallback, and built-in fallback.

### Template repair/reset (Phase 7)

When `orchestration.ts` detects `default-fallback` or `invalid` mode before plan generation (via `ensureTemplateUsable()`), it offers to restore the default template file. The restore requires confirmation, writes the deterministic default content from `defaults.ts`, and is non-blocking (declining still allows generation with fallback sections). The same helper is used in both create and replace flows.

## `.pi/plans/current.md`

- **Purpose**: The single active plan. The agent reads and follows this file during implementation.
- **Created by**: `initPlanning()` (placeholder) or `writeCurrentPlan()` / `forceWriteCurrentPlan()` (real content).
- **User-editable**: Yes, after the extension creates it. The user fills in plan details.
- **Extension-modified**: Yes — replaced on create, replace, and restore flows.

### Placeholder detection

`hasCurrentPlan()` in `repo.ts` determines whether `current.md` holds a real plan:

- **No plan** if: file missing, empty, whitespace-only, or content includes `CURRENT_PLAN_SENTINEL`.
- **Has plan** otherwise.

The sentinel string is: `"No active plan. Use the task plan template to create one."` (defined in `defaults.ts`).

**Critical invariant**: `generatePlan()` must never produce output containing the sentinel. This is tested.

### Safe vs. force writes

- `writeCurrentPlan()` — Refuses to write if `hasCurrentPlan()` returns true. Used for initial plan creation.
- `forceWriteCurrentPlan()` — Writes unconditionally. Used by replace and restore flows after the caller has already archived the old plan.

## `.pi/plans/index.md`

- **Purpose**: Human-readable index of the current plan and all archived plans, with relative links.
- **Created by**: `initPlanning()` (initial), `updateIndex()` in `archive.ts` (regenerated).
- **User-editable**: No. It is fully regenerated on every call to `updateIndex()`.
- **Extension-modified**: Yes — regenerated after replace and restore operations.
- **Invariants**:
  - Always fully regenerated, never patched.
  - Lists all archives (not capped by `maxArchiveListEntries`), newest-first.
  - Links use paths relative to `.pi/plans/`.
  - Deterministic: same input produces same output.
- **Reconciliation**: `reconcileIndex()` in `archive.ts` provides a safe, idempotent way to regenerate index.md from actual files on disk. It is called opportunistically at the start of `/plan` and `/plan-debug` flows (when initialized) to keep the index consistent even after manual file changes. It delegates to `updateIndex()` internally.
- **Staleness guarantee**: Because reconciliation runs on every command invocation, manual file moves or deletes are corrected the next time `/plan` or `/plan-debug` is used. Between invocations, the index may be stale.

## `.pi/plans/archive/*.md`

- **Purpose**: Immutable copies of past plans, preserved when replaced or swapped out.
- **Created by**: `archivePlan()` in `archive.ts`
- **User-editable**: No. Archives are considered immutable by the extension.
- **Extension-modified after creation**: Never.

### Filename rules

Format depends on `archiveFilenameStyle` config:

- `"date-slug"` (default): `YYYY-MM-DD-HHMM-<slug>.md`
  - Example: `2026-03-11-1730-add-jwt-auth.md`
- `"date-only"`: `YYYY-MM-DD-HHMM.md`
  - Example: `2026-03-11-1730.md`

Slug is derived by `slugify()`: lowercase, alphanumeric + hyphens, max 40 chars.

**Collision handling**: If the target filename already exists, a counter suffix is appended: `-1`, `-2`, etc.

**Sortability**: Filenames sort chronologically by string comparison (newest-last in filesystem order; `listArchives()` reverses to newest-first).

### Content

Archive content is the exact byte-for-byte copy of the plan at archive time. No metadata headers or wrappers are added.

## `.pi/logs/plan-debug-*.json`

- **Purpose**: JSON diagnostic snapshots for debugging planning state.
- **Created by**: `writeDiagnosticLog()` in `diagnostics.ts`
- **User-editable**: No (informational only).
- **Extension-modified after creation**: Never.

### What is logged

The `DiagnosticSnapshot` includes:

- Timestamp, cwd, repo root
- Planning state classification
- File existence flags (protocol, template, current, index)
- Current plan metadata: exists, isPlaceholder, sizeBytes, lineCount, title
- Archive count and latest filename
- Template info: usable (boolean), sectionCount (Phase 6)
- Effective config (source, all fields, warnings)
- Warnings and notes

### What is intentionally NOT logged

- **File contents.** Diagnostic logs never include the body text of plans, templates, or the protocol. Only metadata (size, line count, title, template section count) is captured.
- **Git history or branch information.**
- **Environment variables or credentials.**

### Filename rules

Format: `plan-debug-YYYY-MM-DD-HHMMSS.json`

Collision handling: counter suffix (`-1`, `-2`, etc.) if the exact filename exists.

The log directory defaults to `.pi/logs/` but is configurable via `debugLogDir`.

## `.pi/pi-plan.json`

- **Purpose**: Optional repo-local configuration for `pi-plan` behavior.
- **Created by**: The user (manually).
- **User-editable**: Yes — this is the primary way to customize behavior.
- **Extension-modified**: Never. The extension only reads this file.
- **Format**: JSON object. Unknown keys are ignored without warnings.

### Recognized fields

| Field | Type | Default | Purpose |
|---|---|---|---|
| `archiveDir` | string | `".pi/plans/archive"` | Archive directory (repo-relative) |
| `archiveFilenameStyle` | `"date-slug"` \| `"date-only"` | `"date-slug"` | Archive filename format |
| `archiveCollisionStrategy` | `"counter"` | `"counter"` | Collision handling (only option currently) |
| `resumeShowSummary` | boolean | `true` | Show plan summary on resume |
| `allowInlineGoalArgs` | boolean | `true` | Enable `/plan <goal>` passthrough |
| `debugLogDir` | string | `".pi/logs"` | Debug log directory (repo-relative) |
| `debugLogFilenameStyle` | `"timestamp"` | `"timestamp"` | Log filename format (only option currently) |
| `maxArchiveListEntries` | integer ≥ 1 | `15` | Max entries in archive browse list |
| `currentStateTemplate` | string \| null | `null` | Custom template for `{{CURRENT_STATE}}` expansion (may contain `{{REPO_ROOT}}`) |

### Validation behavior

- Missing file → defaults, no warnings, source = `"default"`
- Malformed JSON → defaults, warning, source = `"default"`
- Non-object JSON → defaults, warning, source = `"default"`
- Invalid field value → default for that field, per-field warning, source = `"file"`
- Valid override → applied, source = `"file"`
- Unknown keys → silently ignored
- `loadConfig()` never throws
