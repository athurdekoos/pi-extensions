/**
 * Delegation-time remediation UX (Phase 5B).
 *
 * Given a DelegationAdvice, this module computes actionable remediation
 * guidance: exact safeCustomTools suggestions, missing-extension next
 * steps, concise user messaging, and whether a UI confirm/warn step
 * is warranted.
 *
 * All output is advisory. Nothing here mutates user-provided inputs
 * or silently grants tools.
 */

import type { DelegationAdvice } from "./adk-delegation-advice.js";

// ---------------------------------------------------------------------------
// Remediation action types
// ---------------------------------------------------------------------------

export type RemediationActionKind =
  | "add_safe_custom_tools"
  | "load_missing_extension"
  | "continue_with_limited_tools"
  | "review_project_tool_plan";

export interface RemediationAction {
  kind: RemediationActionKind;
  description: string;
  /** Relevant tool names for this action, if applicable. */
  tools?: string[];
}

// ---------------------------------------------------------------------------
// Remediation result model
// ---------------------------------------------------------------------------

export interface DelegationRemediation {
  /**
   * The full set of safe custom tools this project recommends.
   * Sourced directly from the tool plan's required_safe_custom_tools.
   */
  suggested_safe_custom_tools: string[];

  /**
   * The safe custom tools that will actually be used for the child session.
   * Mirrors advice.effective_safe_custom_tools.
   */
  effective_safe_custom_tools: string[];

  /**
   * Recommended tools that are NOT in the effective set.
   * These are the ones the user would need to add.
   */
  omitted_recommended_safe_custom_tools: string[];

  /**
   * Extension tools expected by metadata but not detected.
   * Mirrors advice.missing_expected_extension_tools.
   */
  missing_expected_extension_tools: string[];

  /** Structured remediation actions the user could take. */
  remediation_actions: RemediationAction[];

  /** Human-readable message summarizing what the user should know. */
  concise_user_message: string;

  /** Whether delegation can safely continue despite issues. */
  can_continue_safely: boolean;

  /** Whether there are issues worth the user's attention. */
  needs_attention: boolean;

  /** Whether an interactive UI prompt is recommended. */
  ui_prompt_recommended: boolean;

  /** Whether a UI prompt was actually shown (set by the caller). */
  ui_prompt_shown?: boolean;

  /** Whether the user chose to continue after a prompt (set by the caller). */
  user_chose_to_continue?: boolean;
}

// ---------------------------------------------------------------------------
// Remediation builder
// ---------------------------------------------------------------------------

/**
 * Derive remediation guidance from delegation advice.
 *
 * @param advice  The DelegationAdvice produced by buildDelegationAdvice.
 * @param userProvidedSafeTools  The user's explicit safeCustomTools (if any).
 * @returns DelegationRemediation with actionable guidance.
 */
export function buildDelegationRemediation(
  advice: DelegationAdvice,
  userProvidedSafeTools: string[] | undefined,
): DelegationRemediation {
  const recommended = advice.recommended_safe_custom_tools;
  const effective = advice.effective_safe_custom_tools;
  const missing = advice.missing_expected_extension_tools;

  // Compute omitted: recommended tools not in the effective set.
  const effectiveSet = new Set(effective);
  const omitted = recommended.filter((t) => !effectiveSet.has(t));

  // Build remediation actions
  const actions = buildRemediationActions(omitted, missing, advice);

  // Determine flags
  const needsAttention = omitted.length > 0 || missing.length > 0;
  const canContinue = true; // Advisory-first: always allow continuation
  const uiPromptRecommended = needsAttention && actions.length > 0;

  // Build concise user message
  const message = buildConciseMessage(omitted, missing, advice, userProvidedSafeTools);

  return {
    suggested_safe_custom_tools: [...recommended],
    effective_safe_custom_tools: [...effective],
    omitted_recommended_safe_custom_tools: omitted,
    missing_expected_extension_tools: [...missing],
    remediation_actions: actions,
    concise_user_message: message,
    can_continue_safely: canContinue,
    needs_attention: needsAttention,
    ui_prompt_recommended: uiPromptRecommended,
  };
}

// ---------------------------------------------------------------------------
// Remediation action builder
// ---------------------------------------------------------------------------

function buildRemediationActions(
  omitted: string[],
  missing: string[],
  advice: DelegationAdvice,
): RemediationAction[] {
  const actions: RemediationAction[] = [];

  if (omitted.length > 0) {
    actions.push({
      kind: "add_safe_custom_tools",
      description:
        `Add the following to safeCustomTools: ${omitted.join(", ")}. ` +
        `These are recommended by the project's tool plan.`,
      tools: omitted,
    });
  }

  if (missing.length > 0) {
    actions.push({
      kind: "load_missing_extension",
      description:
        `Ensure the extension(s) providing these tools are loaded: ${missing.join(", ")}. ` +
        `These tools are expected by the project metadata but are not currently detected ` +
        `in the Pi environment.`,
      tools: missing,
    });
  }

  if ((omitted.length > 0 || missing.length > 0) && advice.has_tool_plan) {
    actions.push({
      kind: "continue_with_limited_tools",
      description:
        "Continue delegation now with reduced capability. " +
        "The ADK agent may not have access to all intended tools.",
    });
  }

  // If there's a tool plan but advice has warnings beyond missing/omitted,
  // suggest reviewing it.
  if (advice.has_tool_plan && advice.warnings.length > 0) {
    actions.push({
      kind: "review_project_tool_plan",
      description:
        "Review the project's tool plan in .pi-adk-metadata.json for full details " +
        "on expected tools and capabilities.",
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Concise message builder
// ---------------------------------------------------------------------------

function buildConciseMessage(
  omitted: string[],
  missing: string[],
  advice: DelegationAdvice,
  userProvidedSafeTools: string[] | undefined,
): string {
  if (omitted.length === 0 && missing.length === 0) {
    return "Delegation looks well-configured. No remediation needed.";
  }

  const parts: string[] = [];

  if (omitted.length > 0) {
    const userExplicit = userProvidedSafeTools && userProvidedSafeTools.length > 0;
    if (userExplicit) {
      parts.push(
        `This project recommends safeCustomTools: ${advice.recommended_safe_custom_tools.join(", ")}. ` +
        `Your current delegation includes: ${userProvidedSafeTools!.join(", ")}. ` +
        `Missing: ${omitted.join(", ")}.`
      );
    } else {
      parts.push(
        `This project recommends safeCustomTools: ${omitted.join(", ")}. ` +
        `None were provided in this delegation call.`
      );
    }
  }

  if (missing.length > 0) {
    parts.push(
      `Expected extension tools not currently detected: ${missing.join(", ")}. ` +
      `Ensure the required extensions are loaded, then re-delegate.`
    );
  }

  parts.push("Delegation can continue with reduced capability.");

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// UI prompt text builder
// ---------------------------------------------------------------------------

/**
 * Build a short confirm-prompt message for UI contexts.
 *
 * @param remediation  The computed remediation.
 * @returns title and body strings suitable for ctx.ui.confirm().
 */
export function buildRemediationPromptText(
  remediation: DelegationRemediation,
): { title: string; body: string } {
  const title = "Delegation mismatch detected";

  const lines: string[] = [];

  if (remediation.omitted_recommended_safe_custom_tools.length > 0) {
    lines.push(
      `Recommended safe custom tools not included: ${remediation.omitted_recommended_safe_custom_tools.join(", ")}.`
    );
  }

  if (remediation.missing_expected_extension_tools.length > 0) {
    lines.push(
      `Expected extension tools not detected: ${remediation.missing_expected_extension_tools.join(", ")}.`
    );
  }

  lines.push("");
  lines.push("Delegation may proceed with reduced capability.");
  lines.push("Continue?");

  return { title, body: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Format remediation for output text
// ---------------------------------------------------------------------------

/**
 * Format remediation guidance as a text block for tool output.
 */
export function formatRemediationForOutput(
  remediation: DelegationRemediation,
): string {
  if (!remediation.needs_attention) {
    return "";
  }

  const lines: string[] = [];
  lines.push("── Delegation Remediation ──");

  if (remediation.omitted_recommended_safe_custom_tools.length > 0) {
    lines.push(
      `Suggested safeCustomTools to add: ${remediation.omitted_recommended_safe_custom_tools.join(", ")}`
    );
    lines.push(
      `Full suggested list: [${remediation.suggested_safe_custom_tools.map((t) => `"${t}"`).join(", ")}]`
    );
  }

  if (remediation.missing_expected_extension_tools.length > 0) {
    lines.push(
      `Missing expected extension tools: ${remediation.missing_expected_extension_tools.join(", ")}`
    );
    lines.push(
      "Next step: ensure the extensions providing these tools are loaded."
    );
  }

  for (const action of remediation.remediation_actions) {
    if (action.kind !== "continue_with_limited_tools" && action.kind !== "review_project_tool_plan") {
      // Skip the ones already covered above to avoid redundancy
      continue;
    }
    lines.push(`→ ${action.description}`);
  }

  lines.push("");
  lines.push("All remediation is advisory. Your explicit configuration takes precedence.");

  return lines.join("\n");
}
