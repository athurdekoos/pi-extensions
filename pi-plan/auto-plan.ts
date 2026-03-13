/**
 * auto-plan.ts — Plan enforcement state machine.
 *
 * Owns: AutoPlanPhase computation, context message generation,
 *       step extraction from current.md, status/widget display,
 *       session persistence serialization.
 *
 * Does NOT own: Pi API calls (delegated to index.ts), plan generation,
 *               archive lifecycle, file writes, config loading,
 *               harness-level input evaluation (harness.ts).
 *
 * Invariants:
 *   - computePhase() is a pure function of enforcement toggle + PlanState.
 *   - No function in this module calls any Pi API directly.
 *   - The state machine is deterministic: same input → same output.
 *   - "inactive" phase means enforcement is toggled off — all pass-through.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PlanState } from "./repo.js";
import { CURRENT_PLAN_REL } from "./repo.js";
import { extractStepsFromPlan, type TodoItem } from "./mode-utils.js";

// ---------------------------------------------------------------------------
// Phase model
// ---------------------------------------------------------------------------

/**
 * The enforcement phases for plan enforcement.
 *
 * - "inactive": Enforcement toggled OFF via /plan. Pass-through mode.
 * - "no-repo": Toggled ON but not in a git repo.
 * - "not-initialized": Toggled ON but .pi/ doesn't exist.
 * - "needs-plan": Toggled ON, initialized, no current.md with real content.
 * - "has-plan": Toggled ON, current.md exists with real content.
 * - "review-pending": Toggled ON, plan submitted for browser review, awaiting decision.
 * - "executing": Toggled ON, actively tracking step completion.
 */
export type AutoPlanPhase =
	| "inactive"
	| "no-repo"
	| "not-initialized"
	| "needs-plan"
	| "has-plan"
	| "review-pending"
	| "executing";

// ---------------------------------------------------------------------------
// Mutable runtime state (managed by index.ts lifecycle hooks)
// ---------------------------------------------------------------------------

export interface AutoPlanState {
	phase: AutoPlanPhase;
	repoRoot: string | null;
	todoItems: TodoItem[];
	/** Whether enforcement is toggled on via /plan */
	enforcementActive: boolean;
}

export function createInitialState(): AutoPlanState {
	return {
		phase: "inactive",
		repoRoot: null,
		todoItems: [],
		enforcementActive: false,
	};
}

// ---------------------------------------------------------------------------
// Phase computation (pure)
// ---------------------------------------------------------------------------

/**
 * Compute the enforcement phase from toggle state and plan state.
 * Pure function — no side effects.
 *
 * If enforcement is not active, always returns "inactive".
 */
export function computePhase(enforcementActive: boolean, planState: PlanState): AutoPlanPhase {
	if (!enforcementActive) return "inactive";

	switch (planState.status) {
		case "no-repo":
			return "no-repo";
		case "not-initialized":
			return "not-initialized";
		case "initialized-no-plan":
			return "needs-plan";
		case "initialized-has-plan":
			return "has-plan";
	}
}

// ---------------------------------------------------------------------------
// Context message generation (pure)
// ---------------------------------------------------------------------------

/**
 * Generate the context message to inject before each agent turn.
 * Returns null if no message should be injected.
 * Pure function — no side effects.
 */
export function getContextMessage(
	phase: AutoPlanPhase,
	todoItems: TodoItem[],
): string | null {
	switch (phase) {
		case "inactive":
		case "no-repo":
		case "not-initialized":
			return null;

		case "needs-plan":
			return `[PLAN ENFORCEMENT ACTIVE — No plan exists]
A plan is required before implementation can begin.
The user should run /plan to create a plan.
You can help them think through the task, explore the codebase, and discuss approach.
Do not make code changes until a plan exists in .pi/plans/current.md.`;

		case "has-plan":
			return `[PLAN ENFORCEMENT ACTIVE]
A plan exists at .pi/plans/current.md. Read it and follow the implementation steps.`;

		case "review-pending":
			return `[PLAN ENFORCEMENT ACTIVE — Review Pending]
The plan has been submitted for review. Wait for the user's decision in the browser UI.
Do not proceed with implementation until the review is complete.`;

		case "executing": {
			if (todoItems.length === 0) return null;
			const remaining = todoItems.filter((t) => !t.completed);
			if (remaining.length === 0) return null;
			const stepList = remaining
				.map((t) => `${t.step}. ${t.text}`)
				.join("\n");
			return `[PLAN ENFORCEMENT ACTIVE — Executing]

Remaining steps:
${stepList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response (e.g. [DONE:1]).`;
		}
	}
}

// ---------------------------------------------------------------------------
// Step extraction from current.md
// ---------------------------------------------------------------------------

/**
 * Read current.md from disk and extract implementation steps.
 * Returns an empty array if the file doesn't exist or has no steps.
 */
export function extractStepsFromCurrentPlan(repoRoot: string): TodoItem[] {
	const filePath = join(repoRoot, CURRENT_PLAN_REL);
	if (!existsSync(filePath)) return [];

	const content = readFileSync(filePath, "utf-8");
	return extractStepsFromPlan(content);
}

// ---------------------------------------------------------------------------
// Status display (pure)
// ---------------------------------------------------------------------------

export interface StatusDisplay {
	key: string;
	text: string | undefined;
}

/**
 * Compute what the status line should show.
 * Returns undefined text to clear the status.
 *
 * Yellow "⏸ plan" is the universal indicator that enforcement is active.
 * It shows in every enforced phase except "executing" (where progress takes over).
 */
export function getStatusDisplay(
	phase: AutoPlanPhase,
	todoItems: TodoItem[],
): StatusDisplay {
	switch (phase) {
		case "inactive":
		case "no-repo":
			return { key: "pi-plan", text: undefined };
		case "not-initialized":
		case "needs-plan":
		case "has-plan":
			return { key: "pi-plan", text: "⏸ plan" };
		case "review-pending":
			return { key: "pi-plan", text: "👁 review" };
		case "executing": {
			if (todoItems.length === 0) return { key: "pi-plan", text: "⏸ plan" };
			const completed = todoItems.filter((t) => t.completed).length;
			return { key: "pi-plan", text: `📋 ${completed}/${todoItems.length}` };
		}
	}
}

/**
 * Compute the widget lines for step tracking.
 * Returns undefined to hide the widget.
 */
export function getWidgetLines(
	phase: AutoPlanPhase,
	todoItems: TodoItem[],
): string[] | undefined {
	if (phase === "review-pending") return ["  👁 Plan review in progress..."];
	if (phase !== "executing" || todoItems.length === 0) return undefined;

	return todoItems.map((item) => {
		if (item.completed) {
			return `  ☑ ~~${item.text}~~`;
		}
		return `  ☐ ${item.text}`;
	});
}

// ---------------------------------------------------------------------------
// Serialization for session persistence
// ---------------------------------------------------------------------------

export interface PersistedAutoState {
	phase: AutoPlanPhase;
	todoItems: TodoItem[];
	enforcementActive: boolean;
}

export function serializeState(state: AutoPlanState): PersistedAutoState {
	return {
		phase: state.phase,
		todoItems: state.todoItems,
		enforcementActive: state.enforcementActive,
	};
}

export function restoreState(
	persisted: PersistedAutoState,
	repoRoot: string | null,
): AutoPlanState {
	return {
		phase: persisted.phase,
		repoRoot,
		todoItems: persisted.todoItems,
		enforcementActive: persisted.enforcementActive,
	};
}
