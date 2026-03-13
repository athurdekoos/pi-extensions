/**
 * harness.ts — Harness-level command interception and input evaluation.
 *
 * Owns: The harness command registry (placeholder for future commands),
 *       input evaluation logic for phase-based message transformation,
 *       and the harness command matching function.
 *
 * Does NOT own: Pi API calls (delegated to index.ts), state detection,
 *               plan generation, archive lifecycle, phase computation.
 *
 * Invariants:
 *   - evaluateInput() never returns "handled" — it only transforms or continues.
 *     The user's message always reaches the agent (possibly modified).
 *   - evaluateHarnessCommand() checks the registry before phase-based logic.
 *   - Extension-sourced messages always pass through unchanged.
 *   - All functions are pure (no Pi API calls, no side effects).
 *
 * Extend here: Add new harness commands to the registry. Each command
 *   defines a name, description, and handler that returns transform or continue.
 *   Commands are matched against user input text before phase-based evaluation.
 */

import type { AutoPlanPhase } from "./auto-plan.js";

// ---------------------------------------------------------------------------
// Input evaluation result types
// ---------------------------------------------------------------------------

export type InputResult =
	| { action: "continue" }
	| { action: "transform"; text: string };

// ---------------------------------------------------------------------------
// Harness command registry
// ---------------------------------------------------------------------------

export interface HarnessCommand {
	/** Command identifier (matched against input text) */
	name: string;
	/** Human-readable description */
	description: string;
	/** Handler returns transform or continue */
	handler: (
		args: string,
		phase: AutoPlanPhase,
		repoRoot: string | null,
	) => InputResult;
}

/**
 * Registered harness commands.
 *
 * Placeholder for future commands. Add new commands here.
 * Example shapes:
 *
 *   { name: "plan-status", description: "Show plan state inline", handler: ... }
 *   { name: "plan-gate", description: "Require plan checkpoint", handler: ... }
 *   { name: "plan-step", description: "Advance to next plan step", handler: ... }
 */
const harnessCommands: HarnessCommand[] = [
	// Future commands go here
];

// ---------------------------------------------------------------------------
// Harness command matching
// ---------------------------------------------------------------------------

export interface HarnessCommandMatch {
	matched: true;
	result: InputResult;
}

export interface HarnessCommandNoMatch {
	matched: false;
}

/**
 * Check if user input matches a registered harness command.
 *
 * Harness commands are prefixed with "plan:" in user input.
 * E.g., "plan:status" matches a command named "plan-status".
 *
 * Returns { matched: false } if no command matches.
 * Returns { matched: true, result } with the command's output otherwise.
 */
export function evaluateHarnessCommand(
	text: string,
	phase: AutoPlanPhase,
	repoRoot: string | null,
): HarnessCommandMatch | HarnessCommandNoMatch {
	const trimmed = text.trim();

	for (const cmd of harnessCommands) {
		// Match "plan:<command-name>" or "plan:<command-name> <args>"
		const prefix = `plan:${cmd.name}`;
		if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
			const args = trimmed.slice(prefix.length).trim();
			return { matched: true, result: cmd.handler(args, phase, repoRoot) };
		}
	}

	return { matched: false };
}

/**
 * Get all registered harness commands (for help/discovery).
 */
export function getHarnessCommands(): readonly HarnessCommand[] {
	return harnessCommands;
}

// ---------------------------------------------------------------------------
// Phase-based input evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate user input based on the current enforcement phase.
 *
 * This is the core harness-level interception logic. It decides whether
 * to transform the user's message or pass it through unchanged.
 *
 * Rules:
 *   - Extension-sourced messages always pass through (source check is
 *     done in index.ts before calling this function).
 *   - "inactive" phase: always continue (enforcement is off).
 *   - "needs-plan" phase: transform to prepend plan-state context.
 *   - "has-plan" / "executing": continue (plan exists, agent can work).
 *   - "no-repo" / "not-initialized": continue (enforcement not relevant).
 *
 * Never returns "handled" — the user's message always reaches the agent.
 */
export function evaluateInput(
	phase: AutoPlanPhase,
	text: string,
): InputResult {
	if (phase === "inactive") {
		return { action: "continue" };
	}

	if (phase === "needs-plan") {
		return {
			action: "transform",
			text: `[CONTEXT: Plan enforcement is active but no plan exists yet. ` +
				`The user should create a plan with /plan before implementation. ` +
				`Help them think through the task but do not make code changes.]\n\n${text}`,
		};
	}

	// has-plan, executing, no-repo, not-initialized — pass through
	return { action: "continue" };
}
