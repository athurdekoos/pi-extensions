/**
 * defaults.ts — Default file contents and sentinel constants.
 *
 * Owns: The text content used to initialize planning files, the placeholder
 *       content for current.md, and the CURRENT_PLAN_SENTINEL string used
 *       for deterministic placeholder detection.
 *
 * Does NOT own: File I/O, state detection logic, or plan generation.
 *
 * Invariants:
 *   - CURRENT_PLAN_SENTINEL must appear in CURRENT_PLAN_PLACEHOLDER.
 *   - CURRENT_PLAN_SENTINEL must NEVER appear in generated plans (plangen.ts).
 *   - Changing the sentinel string is a breaking change — it affects whether
 *     existing repos are detected as having a plan or not.
 *
 * Extend here: New default file contents, new sentinel/marker strings.
 * Do NOT extend here: File writes, state logic, config.
 */

// ---------------------------------------------------------------------------
// Default file contents for repo-local planning structure
// ---------------------------------------------------------------------------

export const PLANNING_PROTOCOL = `# Planning Protocol

Read this file before starting any task in this repository.

## Rules

1. **Read the protocol first.** Before writing code, read this file.
2. **Check for a current plan.** Read \`.pi/plans/current.md\`. If a plan exists, follow it.
3. **Always plan before coding.** Create or refresh a plan before implementation.
4. **Use the standard template.** Plans follow the template in \`.pi/templates/task-plan.md\`.
5. **Save the active plan.** Write the plan to \`.pi/plans/current.md\` before starting work.
6. **Do not begin implementation until the plan is written and saved.**

## File Layout

| Path | Purpose |
|------|---------|
| \`.pi/PLANNING_PROTOCOL.md\` | This file — the planning rules |
| \`.pi/templates/task-plan.md\` | Standard plan template |
| \`.pi/plans/current.md\` | The active plan for the current task |
| \`.pi/plans/index.md\` | Plan index and history |

## Notes

- Archive support may be added in a future phase.
- This protocol is enforced by the \`pi-plan\` extension via the \`/plan\` command.
`;

export const TASK_PLAN_TEMPLATE = `# Plan: [TITLE]

## Goal

{{GOAL}}

## Current State

Repository root: \`{{REPO_ROOT}}\`

_Describe what exists today. What is the starting point?_

## Locked Decisions

- _List constraints and non-negotiable choices._

## Scope

- _What is in scope for this task?_

## Non-Goals

- _What is explicitly out of scope?_

## Files to Inspect

- _Which files should be read before implementation?_

## Implementation Plan

1. _First step_
2. _Second step_
3. _Third step_

## Acceptance Criteria

- [ ] _How do we know this task is done?_

## Tests

- _What tests should be added or updated?_

## Manual Verification

- _How to verify the result manually?_

## Risks / Notes

- _Any risks, open questions, or notes?_
`;

// ---------------------------------------------------------------------------
// current.md placeholder — used to detect "no meaningful plan yet"
// ---------------------------------------------------------------------------

export const CURRENT_PLAN_PLACEHOLDER = `# Current Plan

No active plan. Use the task plan template to create one.

Template: \`.pi/templates/task-plan.md\`
`;

/**
 * Marker line embedded in the placeholder.
 * Used for deterministic detection of "untouched placeholder" vs "real plan".
 * If current.md starts with this exact first line AND contains the sentinel,
 * it is treated as empty/placeholder.
 */
export const CURRENT_PLAN_SENTINEL = "No active plan. Use the task plan template to create one.";

// ---------------------------------------------------------------------------
// Default CURRENT_STATE expansion template
// ---------------------------------------------------------------------------

/**
 * Default text that {{CURRENT_STATE}} expands to during plan generation.
 * Uses {{REPO_ROOT}} internally so it can be substituted at generation time.
 *
 * Can be overridden via `currentStateTemplate` in `.pi/pi-plan.json`.
 */
export const DEFAULT_CURRENT_STATE_TEMPLATE =
  "Repository root: `{{REPO_ROOT}}`\n\n_Describe what exists today. What is the starting point?_";

// ---------------------------------------------------------------------------
// Spec template for brainstorming
// ---------------------------------------------------------------------------

export const SPEC_TEMPLATE = `# Spec: [TITLE]

## Problem Statement

{{GOAL}}

## Context

_What is the current state? What led to this problem/opportunity?_

## Constraints

- _List technical, business, or timeline constraints._

## Proposed Approach

_Describe the high-level approach._

## Alternatives Considered

- _What other approaches were evaluated and why were they rejected?_

## Open Questions

- _What needs to be resolved before implementation?_

## Success Criteria

- _How do we know this design is correct?_
`;

export const PLANS_INDEX = `# Plan Index

## Current

- [current.md](current.md)

## Archived

_None yet._
`;
