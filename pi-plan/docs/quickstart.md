# Quick Start Guide

This guide walks you through a complete first plan cycle with pi-plan.

## 1. Load the extension

```bash
pi -e /path/to/pi-extensions/pi-plan
```

Or install globally for persistent access:

```bash
pi install /path/to/pi-extensions/pi-plan
```

## 2. Initialize planning in a repo

Navigate to any git repository and type:

```
/plan
```

pi-plan detects you haven't initialized yet and offers to create the `.pi/` planning structure. Accept to create:

- `.pi/PLANNING_PROTOCOL.md` — rules the agent follows
- `.pi/templates/task-plan.md` — plan template (customizable)
- `.pi/plans/current.md` — placeholder for the active plan
- `.pi/plans/index.md` — plan history index

## 3. Create your first plan

Run `/plan` again (or `/plan Build a JWT auth layer` with inline args):

1. pi-plan prompts: _"What do you want to build?"_
2. A plan scaffold is generated from your template
3. You confirm before it's written to `.pi/plans/current.md`

## 4. Review the plan in your browser

The agent calls `submit_plan` to open a browser-based review UI where you can:

- Approve the plan (with optional implementation notes)
- Deny with feedback and annotations

## 5. Enable enforcement

For the full plan-before-code workflow, start Pi with the `--plan` flag:

```bash
pi -e /path/to/pi-extensions/pi-plan --plan
```

With enforcement enabled, the agent cannot write production code until a plan exists and is approved. The status line shows `⏸ plan` to indicate enforcement is active.

## 6. Execute with step tracking

As the agent works through the plan, it marks steps complete with `[DONE:n]` markers in `current.md`. Use `/todos` to see progress:

```
✓ 1. Set up project structure
✓ 2. Create database schema
○ 3. Implement API endpoints
○ 4. Write integration tests
```

## 7. Archive and start a new plan

When you're ready for a new task:

1. Run `/plan`
2. Choose **Replace current plan**
3. The old plan is archived to `.pi/plans/archive/` (immutable, never deleted)
4. Enter your new goal

You can revisit archived plans anytime via `/plan` → **Revisit archived plans**.

## What's next

- **TDD enforcement**: Toggle with `/tdd` to require tests before production code
- **Brainstorming**: Enable `brainstormEnabled` in `.pi/pi-plan.json` to add a design phase before planning
- **Worktree isolation**: Enable `worktreeEnabled` to give each plan its own git branch
- **Custom templates**: Edit `.pi/templates/task-plan.md` to shape generated plans
- **Configuration**: See the [configuration reference](../README.md#configuration) for all 18 options

See [docs/workflows.md](workflows.md) for common workflow patterns.
