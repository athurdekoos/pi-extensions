# Operator Workflows

> **Historical document.** This describes the workflows and validation checklist for the **legacy planning-protocol extension** (`.pi/legacy/planning-protocol.ts`), which is no longer loaded at runtime.
>
> The canonical planning extension is [`pi-plan/`](../../pi-plan/).
> For current validation and manual verification steps, see the **[pi-plan README § Manual verification](../../pi-plan/README.md#manual-verification)**.
>
> This document is preserved as design reference for the legacy command set (`/plan-on`, `/plan-off`, `/plan-status`, `/plan-new`, `/plan-complete`, `/plan-archive`, `/plan-list`, `/plan-show`, `/plan-restore`, `/plan-resume`). These commands do not exist in `pi-plan/`, which exposes only `/plan` and `/plan-debug`.

This document provides step-by-step workflows for all planning protocol operations. Each workflow describes the exact commands, expected behavior, and recovery paths.

## Turning Planning Mode On

**Goal:** Enter inspect-and-plan mode where implementation tools are blocked.

1. Run `/plan-on`.
2. The extension validates `current.md` and transitions to either:
   - `plan-required` — no valid active plan exists. You are prompted to create one.
   - `plan-ready` — a valid active plan already exists.
3. In both cases, the tool whitelist is now active. Only `read`, `grep`, `ls`, `find` are available.
4. The footer and widget update to show planning mode status.

**After this:** Use `/plan` to create or edit your plan, or `/plan-off` when done.

## Recovering from `plan-required`

**Goal:** Create or fix a plan so the system recognizes it.

1. Run `/plan`.
2. The editor opens with the current `current.md` content (or a fresh template if the file doesn't exist).
3. Fill in the plan metadata:
   - Set `slug: my-task-name` (kebab-case)
   - Set `status: active` (when the plan is ready)
   - `updated_at` is typically set by the extension, but you can set it manually
4. Fill in at least `## Goal` and `## Implementation Plan` sections.
5. Save and close the editor.
6. The extension validates the plan. If `status: active` with a valid slug and updated_at, the system transitions to `plan-ready`.
7. If validation fails, the extension notifies you of the specific issue.

**Note:** While in `plan-required`, tools are blocked but `/plan` always works because commands are not tool calls.

## Creating/Updating a Plan with `/plan`

**Goal:** Author or revise the plan in `current.md`.

1. Run `/plan`.
2. If `current.md` doesn't exist, you're prompted for a slug and title, then a fresh template is scaffolded.
3. If `current.md` exists, its current content opens in the editor.
4. Edit the plan content and metadata as needed.
5. Save and close the editor.
6. The extension validates, reconciles status, rebuilds `plans/index.md`, and notifies you of the result.

**Tip:** To transition from draft to active, change `status: draft` to `status: active` in the metadata block.

## Starting a New Task with `/plan-new`

**Goal:** Begin a fresh plan, optionally archiving the current one.

1. Run `/plan-new [slug]` (slug is optional — you'll be prompted if omitted).
2. If the current plan is meaningful (draft/active/completed):
   - You're asked whether to archive it first.
   - If yes, an archive snapshot is created.
   - If no, you're asked to confirm overwriting.
   - If you decline both, the operation is cancelled.
3. If the current plan is only a template, it is replaced directly.
4. You're prompted for a slug (if not provided) and a title.
5. The editor opens with a fresh template pre-filled with your slug.
6. Edit the plan, save, and close.
7. The extension validates, reconciles, and updates the index.

## Completing a Task with `/plan-complete`

**Goal:** Mark the current plan as completed and archive it.

1. Run `/plan-complete`.
2. The extension verifies `current.md` has a meaningful plan (not a template).
3. If valid:
   - The plan status in `current.md` is set to `completed`.
   - An archive snapshot is created with status `completed`.
   - `current.md` is reset to the empty template.
   - `plans/index.md` is rebuilt.
4. If invalid or template-only, the command fails with an explanation.

**After this:** `current.md` is a clean template. System status transitions to `plan-required` (if planning mode is on).

## Archiving with `/plan-archive`

**Goal:** Archive the current plan without marking it completed.

1. Run `/plan-archive`.
2. The extension verifies `current.md` has a meaningful plan.
3. If valid:
   - An archive snapshot is created with status `archived`.
   - `current.md` is reset to the empty template.
   - `plans/index.md` is rebuilt.
4. Template-only plans cannot be archived (the command refuses with a message).

**Difference from `/plan-complete`:** The archive snapshot has status `archived` instead of `completed`. Use `/plan-archive` for plans you're shelving, `/plan-complete` for plans you've finished.

## Listing Archives with `/plan-list`

**Goal:** See what plans exist.

1. Run `/plan-list`.
2. The output shows:
   - **Current plan** — slug, status, updated_at, implementation-readiness
   - **Archived plans** — up to 20 most recent, with slug, status, filename, and timestamp
   - **Total archive count**
3. This command is read-only — it does not modify any files.

## Inspecting an Archive with `/plan-show`

**Goal:** View an archived plan without modifying `current.md`.

1. Run `/plan-show [archive-name|slug]`.
   - With an argument: resolves by exact filename or slug.
   - Without an argument: presents an interactive selection of recent archives.
2. If the argument matches multiple archives (ambiguous slug), you're presented with choices.
3. The output shows metadata (file, slug, status, updated_at, title) and a content preview (up to 80 lines).
4. This command is read-only — it does not modify `current.md`, runtime state, or archives.

## Restoring an Archive with `/plan-restore`

**Goal:** Copy an archived plan back into `current.md` for revision.

1. Run `/plan-restore [archive-name|slug]`.
   - With an argument: resolves by exact filename or slug.
   - Without an argument: presents an interactive selection.
2. If `current.md` has meaningful content, you're asked:
   - **Archive current plan first, then restore** — creates an archive of the current plan before replacing
   - **Replace current plan directly (discard)** — overwrites without archiving
   - **Cancel** — aborts the restore
3. The archived plan's content is copied into `current.md` with:
   - `status` set to `draft`
   - `updated_at` set to now
   - `slug` preserved
4. The archive file is **not modified or removed**.
5. Runtime status is reconciled (typically `plan-required` since status is `draft`).
6. `plans/index.md` is rebuilt.

**After this:** Use `/plan` to edit the restored plan and set `status: active` when ready.

## Resuming Archived Work with `/plan-resume`

**Goal:** Restore an archived plan and immediately start editing it.

1. Run `/plan-resume [archive-name|slug]`.
2. Same restore flow as `/plan-restore` (resolution, confirmation if current is meaningful).
3. After the restore, the plan editor opens automatically (same flow as `/plan`).
4. Edit the restored plan. Set `status: active` when ready.
5. Save and close.

**This is a shortcut for:** `/plan-restore` followed by `/plan`.

## Turning Planning Mode Off with `/plan-off`

**Goal:** Exit planning mode and restore all tools.

1. Run `/plan-off`.
2. `planMode` is set to `false`, `status` transitions to `off`.
3. The tool whitelist is deactivated — all tools are available again.
4. The widget is removed, footer shows `plan:off`.
5. Planning-protocol context messages are cleaned from the agent's context on the next turn.

## Using Debug Mode

**Goal:** Enable diagnostic logging to troubleshoot issues.

1. Run `/plan-debug-on`.
2. All planning protocol events are now logged to `.pi/plans/debug/`.
3. Reproduce the issue.
4. Run `/plan-debug` to see log paths and session ID.
5. Inspect logs:
   ```bash
   cat .pi/plans/debug/current.log | jq .
   ```
6. Run `/plan-debug-off` when done.

See [DEBUGGING.md](DEBUGGING.md) for log format, event reference, and diagnosis patterns.

## What Happens After Restart

When Pi restarts:

1. The extension reads `planning-state.json` from disk.
2. If the file is valid, planning mode state is restored exactly as it was.
3. If the file is invalid JSON, defaults are used and a warning is shown. The malformed file is not overwritten.
4. If the file is missing, it is bootstrapped from `planning-state.example.json`.
5. `current.md` is re-validated and system status is re-derived.
6. If planning mode was on, the tool whitelist is immediately active.
7. Debug mode state is also restored.

**Key point:** Planning mode persists across restarts. If you had planning mode on, it will still be on after restart.

---

## Common Mistakes and Recovery

### Malformed or empty `current.md`

**Symptom:** `/plan-status` shows "Plan valid: no" with a reason like "No metadata block" or "current.md is empty".

**Recovery:**
1. Run `/plan` to open the editor.
2. Ensure the file has the `<!-- pi-plan-meta ... -->` block with `slug`, `status`, and `updated_at`.
3. Save. The extension re-validates automatically.

If the file is severely corrupted, delete it and run `/plan` — the extension will scaffold a fresh template.

### Malformed `planning-state.json`

**Symptom:** On startup, you see "⚠ .pi/planning-state.json contains invalid JSON" and planning mode defaults to off.

**Recovery options:**
- **Fix the file:** Open `.pi/planning-state.json` in an editor and fix the JSON syntax.
- **Delete the file:** Remove it. The extension will recreate it from `planning-state.example.json` on next startup or command.
- **Do nothing:** The extension runs with defaults. The next command that saves state (e.g., `/plan-on`) will overwrite the malformed file with valid state.

### Stuck in `plan-required`

**Symptom:** Tools are blocked, `/plan-status` shows `plan-required`.

**Cause:** Planning mode is on but `current.md` does not have `status: active` with valid metadata.

**Recovery options:**
1. Run `/plan` to create or fix the plan. Set `status: active`, fill in `slug` and content.
2. Or run `/plan-off` to exit planning mode entirely.

### Tool blocked unexpectedly

**Symptom:** The agent reports a tool is blocked with a message about planning mode.

**Cause:** Planning mode is on. Only `read`, `grep`, `ls`, `find` are allowed.

**Recovery:**
1. If you want to implement: run `/plan-off` first.
2. If you want to stay in planning mode: only read-only operations are available. Use `/plan` to work on your plan.

**Note:** The whitelist applies to both `plan-required` and `plan-ready` states. Having an active plan does not unlock tools — you must `/plan-off`.

### Ambiguous archive matches

**Symptom:** `/plan-restore` or `/plan-show` says "Ambiguous: N archives match slug".

**Cause:** Multiple archive files share the same slug (e.g., a plan was archived multiple times).

**Recovery:**
1. Use the full filename instead of the slug (e.g., `2026-03-12-0830-my-plan.md`).
2. Or omit the argument entirely and use the interactive selection.
3. Run `/plan-list` to see all archive filenames.

---

## Validation / Regression Checklist (Legacy Extension)

> **This checklist targets the legacy extension** (`.pi/legacy/planning-protocol.ts`), not the canonical `pi-plan/` package. Commands like `/plan-on`, `/plan-off`, `/plan-status`, etc. are legacy commands that do not exist in `pi-plan/`.
>
> **For validating the canonical runtime**, use the [pi-plan README § Manual verification](../../pi-plan/README.md#manual-verification) checklist, which covers `/plan` and `/plan-debug` against the real `pi-plan/` package.

This checklist covers the core planning protocol behaviors of the legacy extension. Execute each step manually to verify the legacy system works correctly.

### Prerequisites (legacy)

- Pi is installed.
- The legacy extension is loaded explicitly (e.g., `pi -e .pi/legacy/planning-protocol.ts`) — it is **not** auto-discovered from `.pi/extensions/` (it was moved to `.pi/legacy/` to prevent dual-loading with `pi-plan/`).
- The repo has the `.pi/` directory structure with `planning-state.example.json` and `plans/current.md`.
- Start from a clean state: delete `.pi/planning-state.json` if it exists.

### 1. State bootstrap

1. Delete `.pi/planning-state.json` if it exists.
2. Start Pi in the repo directory.
3. **Verify:** `.pi/planning-state.json` is created with the same shape as `.pi/planning-state.example.json`.
4. **Verify:** `planMode` is `false`, `status` is `"off"`.

### 2. `/plan-on` with no valid plan

1. Ensure `current.md` is the empty template (status: `template`).
2. Run `/plan-on`.
3. **Verify:** Status transitions to `plan-required`.
4. **Verify:** You are prompted to create/edit a plan.
5. Cancel the prompt.
6. **Verify:** Footer shows `plan:on | state:plan-required`.

### 3. `/plan` recovery while tools are blocked

1. While in `plan-required` state, attempt to ask the agent to run `bash` or `write`.
2. **Verify:** The tool call is blocked with a reason mentioning planning mode.
3. Run `/plan`.
4. **Verify:** The editor opens with the current template or plan content.
5. Set `slug: test-plan`, `status: active`, and fill in `## Goal` and `## Implementation Plan`.
6. Save.
7. **Verify:** Status transitions to `plan-ready`.
8. **Verify:** Notification confirms plan is active.

### 4. `/plan-off` restoring normal behavior

1. From `plan-ready` state, run `/plan-off`.
2. **Verify:** Status transitions to `off`.
3. **Verify:** Footer shows `plan:off`.
4. **Verify:** Widget is removed.
5. Ask the agent to use `bash` or `write`.
6. **Verify:** The tool call is no longer blocked.

### 5. Whitelist enforcement during planning mode

1. Run `/plan-on`.
2. Ask the agent to use each whitelisted tool: `read`, `grep`, `ls`, `find`.
3. **Verify:** All four are allowed.
4. Ask the agent to use `bash`, `write`, or `edit`.
5. **Verify:** All three are blocked with the planning mode message.

### 6. `/plan-new` with meaningful current plan

1. Ensure `current.md` has a meaningful plan (status: `draft` or `active` with a slug).
2. Run `/plan-new`.
3. **Verify:** You are prompted about the existing plan (archive first or replace).
4. Choose "Archive first".
5. **Verify:** An archive file is created in `.pi/plans/archive/`.
6. **Verify:** The editor opens with a fresh template.
7. Fill in the new plan, save.
8. **Verify:** `current.md` has the new plan content.

### 7. `/plan-complete`

1. Ensure `current.md` has a meaningful plan.
2. Run `/plan-complete`.
3. **Verify:** An archive file is created with status `completed` in its metadata.
4. **Verify:** `current.md` is reset to the empty template (status: `template`, empty slug).
5. **Verify:** `plans/index.md` is updated with the archive entry.

### 8. `/plan-archive`

1. Ensure `current.md` has a meaningful plan (draft or active).
2. Run `/plan-archive`.
3. **Verify:** An archive file is created with status `archived` in its metadata.
4. **Verify:** `current.md` is reset to the empty template.
5. **Verify:** `plans/index.md` is updated.
6. With `current.md` as a template, run `/plan-archive` again.
7. **Verify:** The command refuses with "template placeholder" message.

### 9. `/plan-list`

1. Ensure at least one archive exists.
2. Run `/plan-list`.
3. **Verify:** Current plan summary is shown.
4. **Verify:** Archived plans are listed with slug, status, filename, timestamp.
5. **Verify:** Total archive count is shown.

### 10. `/plan-show`

1. Run `/plan-show` with no argument.
2. **Verify:** Interactive selection of archives is presented.
3. Select one.
4. **Verify:** Metadata and content preview are shown.
5. **Verify:** `current.md` is NOT modified.
6. Run `/plan-show <exact-filename>`.
7. **Verify:** The correct archive is shown without prompting.

### 11. `/plan-restore`

1. Ensure `current.md` is the empty template.
2. Run `/plan-restore <archive-filename>`.
3. **Verify:** The archived plan content appears in `current.md`.
4. **Verify:** `current.md` metadata has `status: draft` and a fresh `updated_at`.
5. **Verify:** The archive file in `plans/archive/` is unchanged.
6. **Verify:** `plans/index.md` is updated.
7. Now restore again while `current.md` has the restored content.
8. **Verify:** You are prompted about the existing meaningful plan.

### 12. `/plan-resume`

1. Run `/plan-resume <archive-filename>`.
2. **Verify:** The restore flow executes (same as `/plan-restore`).
3. **Verify:** The editor opens automatically after restore.
4. Make edits and save.
5. **Verify:** Plan is validated and status reconciled.

### 13. Debug mode on/off

1. Run `/plan-debug-on`.
2. **Verify:** `planning-state.json` has `debugMode: true`.
3. Run `/plan-debug`.
4. **Verify:** Output shows debug mode ON, log paths, and session ID.
5. Run a few commands (`/plan-status`, `/plan-on`, `/plan-off`).
6. **Verify:** `.pi/plans/debug/current.log` contains JSONL entries for those events.
7. Run `/plan-debug-off`.
8. **Verify:** `debugMode` is `false`. No new log entries are written.

### 14. Restart persistence

1. Run `/plan-on` and `/plan-debug-on`.
2. Exit Pi.
3. Restart Pi in the same directory.
4. **Verify:** `/plan-status` shows planning mode ON and debug mode ON.
5. **Verify:** Tool enforcement is active immediately.

### 15. Context pruning

1. Enable planning mode with `/plan-on`.
2. Send several prompts to the agent.
3. Enable debug mode, send one more prompt.
4. Check the debug log for `context_prune` events.
5. **Verify:** Only the newest `planning-protocol-context` message is kept.
6. Run `/plan-off`.
7. Send another prompt.
8. **Verify:** A `context_prune` event with `action: "remove_all"` appears (if debug was still on when the prune happened).
