# Common Workflows

This document covers common workflow patterns with pi-plan.

## 1. Basic planning (no enforcement)

Use pi-plan as a document manager without enforcement:

```bash
pi -e /path/to/pi-plan
```

```
/plan                          # Initialize and create plans
/plan Build a new feature      # Create plan with inline goal
/plan                          # Resume / Replace / Revisit archives
/plan-debug                    # Write diagnostic snapshot
```

The agent can freely write code — plans are reference documents only.

## 2. Enforced planning

Start with the `--plan` flag to activate enforcement:

```bash
pi -e /path/to/pi-plan --plan
```

With enforcement active:
- The agent receives plan-state context before every turn
- If no plan exists, the agent is guided to create one before coding
- The `submit_plan` tool opens browser-based review (no auto-approve)
- Step progress is tracked via `[DONE:n]` markers

Toggle enforcement on/off at any time with `/plan`.

## 3. TDD-enforced planning

Enable TDD enforcement to require tests before production code:

```
/tdd
```

Or set in `.pi/pi-plan.json`:

```json
{
  "tddEnforcement": true,
  "testFilePatterns": ["*.test.*", "*.spec.*", "__tests__/**"]
}
```

When active:
- Within each implementation step, test files must be written before production files
- `.pi/` files are always allowed (planning infrastructure is exempt)
- Compliance is logged daily to `.pi/tdd/compliance-YYYY-MM-DD.json`
- `[DONE:n]` markers are validated against TDD compliance

## 4. Brainstorm, plan, execute

Enable brainstorming for a design-first workflow:

```json
{
  "brainstormEnabled": true
}
```

The lifecycle becomes:
1. **Brainstorm** — Agent writes design specs to `.pi/specs/`
2. **Submit spec** — Agent calls `submit_spec` to transition to planning
3. **Plan** — Agent generates a plan informed by the approved spec
4. **Review** — Plan is reviewed in browser via `submit_plan`
5. **Execute** — Agent implements the plan with step tracking

Specs are immutable after write and listed newest-first.

## 5. Worktree-isolated planning

Enable worktree isolation to give each plan its own git branch:

```json
{
  "worktreeEnabled": true
}
```

When active:
- Each plan creates a worktree at `.worktrees/<slug>/` with branch `plan/<slug>`
- Setup commands (npm install, pip install, etc.) are auto-detected and run
- State is persisted in `.pi/worktrees/active.json`
- On plan completion/archive, the worktree is cleaned up

## 6. Plan review and annotation

### Plan review

The agent calls `submit_plan` after drafting a plan. This opens a browser UI where you can:
- View the plan with syntax highlighting
- See diffs against the previous archived plan
- Approve with implementation notes
- Deny with detailed feedback and annotations

Review decisions are recorded as append-only JSON in `.pi/plans/reviews/`.

### Code review

```
/plan-review
```

Opens a browser UI for current git changes. Supports uncommitted, staged, last-commit, and branch diffs. Feedback is sent back to the agent.

### Markdown annotation

```
/plan-annotate path/to/file.md
```

Opens any markdown file in a browser annotation UI. Feedback is sent back to the agent.

## 7. Archive browsing and restoration

```
/plan
```

Choose **Revisit archived plans** to browse past plans:
- Archives are listed newest-first with polished labels (title + timestamp)
- Selecting an archive restores it as the current plan (after archiving the current one)
- The list is capped by `maxArchiveListEntries` (default: 15)
- Archives are immutable — restoring copies, never moves

## 8. Custom templates

Edit `.pi/templates/task-plan.md` to customize generated plans:

```markdown
# Plan: [TITLE]

## Goal

{{GOAL}}

## Current State

{{CURRENT_STATE}}

## Design

Describe the design approach.

## Rollback Plan

How to revert if things go wrong.
```

Available placeholders:

| Placeholder | Value |
|---|---|
| `{{GOAL}}` | The user's goal text |
| `{{REPO_ROOT}}` | Absolute repo root path |
| `{{CURRENT_STATE}}` | Current-state block (configurable via `currentStateTemplate` config) |

Templates without placeholders still work — "Goal" and "Current State" sections get special handling via section-name fallback.

If the template is missing or malformed, `/plan` offers to restore the default. Declining still allows plan generation using built-in fallback sections.

## 9. Finishing a plan with branch actions

When all steps are marked `[DONE:n]` and a worktree is active, pi-plan enters the **finishing phase** — a write-gated state where you decide how to land your work. The agent cannot interfere; this is entirely user-controlled via a deterministic menu.

### Automatic finishing (on plan completion)

When the last step is marked done, pi-plan automatically:
1. Archives the completed plan
2. Presents a finishing menu with four options:

- **Merge into base branch locally** — runs `git merge --no-ff`, cleans up worktree + branch
- **Create pull request** — pushes branch, runs `gh pr create`, cleans up worktree only (branch stays for the PR)
- **Keep branch** — removes the worktree but keeps the branch for manual work later
- **Discard** — removes both the worktree and the branch

If `gh` CLI is not installed, the PR option is hidden automatically.

### Manual finishing

If a session is interrupted during finishing, the phase degrades to `has-plan` on restore. The worktree remains intact. Use `/plan-finish` to re-enter the finishing workflow:

```
/plan-finish
```

This command is available whenever a worktree exists, regardless of phase.

### Configuring defaults

Skip the menu entirely by setting a default action:

```json
{
  "defaultFinishAction": "pr",
  "prTemplate": "## {{PLAN_TITLE}}\n\nBranch: `{{BRANCH}}`"
}
```

The `prTemplate` supports `{{BRANCH}}` and `{{PLAN_TITLE}}` placeholders for PR body customization.

### Edge cases

| Scenario | Behavior |
|---|---|
| No worktree active | Finishing menu is skipped; plan is auto-archived |
| Merge conflict | Merge is aborted, error shown, user re-selects |
| Push failure | Error with git stderr, user re-selects |
| No `gh` CLI | PR option hidden from menu |
