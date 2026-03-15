/**
 * tools.ts — Tool handler implementations for submit_plan and submit_spec.
 *
 * Owns: The execute logic for submit_plan and submit_spec tools, extracted
 *       from index.ts for testability and readability.
 *
 * Does NOT own: Tool registration (index.ts), state machine (auto-plan.ts),
 *               review orchestration (review.ts), config loading (config.ts).
 *
 * Invariants:
 *   - Tool handlers receive shared state by reference and may mutate it.
 *   - All Pi API calls go through the injected deps interface.
 *   - Tool handlers return the tool result object (content + details).
 */

import { resolve } from "node:path";
import type { AutoPlanState } from "./auto-plan.js";
import { extractStepsFromCurrentPlan } from "./auto-plan.js";
import { loadConfig, type PiPlanConfig } from "./config.js";
import { readCurrentPlan, extractPlanTitle } from "./archive.js";
import { readSpec } from "./brainstorm.js";
import {
  handlePlanSubmission,
  handleAnnotation,
  hasPlanReviewUI,
} from "./review.js";
import {
  createWorktreeForPlan,
  writeWorktreeState,
} from "./worktree.js";

// ---------------------------------------------------------------------------
// Shared dependencies interface
// ---------------------------------------------------------------------------

export interface ToolDeps {
  state: AutoPlanState;
  config: { config: PiPlanConfig; warnings: string[]; source: string } | null;
  applyUI: (ctx: ToolContext) => void;
  persistState: () => void;
  exec: (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<{ code: number; stdout: string }>;
}

export interface ToolContext {
  hasUI: boolean;
  ui: {
    notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
    confirm: (title: string, message: string) => Promise<boolean>;
    select: (title: string, options: string[]) => Promise<string | null>;
    input: (title: string, placeholder: string) => Promise<string | null>;
  };
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// submit_plan handler
// ---------------------------------------------------------------------------

export async function executeSubmitPlan(
  _params: Record<string, unknown>,
  ctx: ToolContext,
  deps: ToolDeps,
): Promise<ToolResult> {
  const { state } = deps;

  if (state.phase !== "has-plan" && state.phase !== "executing") {
    return {
      content: [{ type: "text", text: "Error: No active plan to submit. Create a plan first with /plan." }],
      details: { approved: false },
    };
  }

  if (!state.repoRoot) {
    return {
      content: [{ type: "text", text: "Error: No repository root detected." }],
      details: { approved: false },
    };
  }

  if (!hasPlanReviewUI()) {
    return {
      content: [{ type: "text", text: "Error: Plan review UI not available. Ensure assets/plan-review.html is built." }],
      details: { approved: false },
    };
  }

  try {
    state.phase = "review-pending";
    deps.applyUI(ctx);
    deps.persistState();

    const config = loadConfig(state.repoRoot);
    const result = await handlePlanSubmission(state.repoRoot, config.config, ctx);

    if (result.approved) {
      tryTransitionToExecuting(state);

      // Offer worktree creation
      const currentConfig = config.config;
      if (currentConfig.worktreeEnabled && ctx.hasUI) {
        const useWorktree = await ctx.ui.confirm(
          "Create worktree?",
          "Create an isolated git worktree for this work?",
        );

        if (useWorktree) {
          const planContent = readCurrentPlan(state.repoRoot!);
          const planTitle = planContent ? extractPlanTitle(planContent) : "work";

          const wtResult = await createWorktreeForPlan(
            state.repoRoot!,
            planTitle,
            deps.exec,
          );

          if (wtResult.success && wtResult.info) {
            state.worktreeActive = true;
            state.worktreePath = wtResult.info.path;
            writeWorktreeState(state.repoRoot!, wtResult.info, currentConfig.worktreeStateDir);
            ctx.ui.notify(`Worktree created at ${wtResult.info.path}`, "success");
          } else {
            ctx.ui.notify(`Worktree creation failed: ${wtResult.error}`, "warning");
          }
        }
      }

      deps.applyUI(ctx);
      deps.persistState();

      const doneMsg = state.todoItems.length > 0
        ? " After completing each step, include [DONE:n] in your response where n is the step number."
        : "";

      if (result.feedback) {
        return {
          content: [{
            type: "text",
            text: `Plan approved with notes! Execute the plan in .pi/plans/current.md.${doneMsg}\n\n## Implementation Notes\n\n${result.feedback}\n\nProceed with implementation, incorporating these notes where applicable.`,
          }],
          details: { approved: true, feedback: result.feedback },
        };
      }

      return {
        content: [{
          type: "text",
          text: `Plan approved. Execute the plan in .pi/plans/current.md.${doneMsg}`,
        }],
        details: { approved: true },
      };
    }

    // Denied
    const feedbackText = result.feedback || "Plan rejected. Please revise.";
    return {
      content: [{
        type: "text",
        text: `Plan not approved.\n\nUser feedback: ${feedbackText}\n\nRevise the plan:\n1. Read .pi/plans/current.md to see the current plan.\n2. Use the edit tool to make targeted changes addressing the feedback — do not rewrite the entire file.\n3. Call submit_plan again when ready.`,
      }],
      details: { approved: false, feedback: feedbackText },
    };
  } catch (err) {
    state.phase = "has-plan";
    deps.applyUI(ctx);
    deps.persistState();
    return {
      content: [{ type: "text", text: `Error during plan review: ${String(err)}` }],
      details: { approved: false },
    };
  }
}

// ---------------------------------------------------------------------------
// submit_spec handler
// ---------------------------------------------------------------------------

export async function executeSubmitSpec(
  params: Record<string, unknown>,
  ctx: ToolContext,
  deps: ToolDeps,
): Promise<ToolResult> {
  const { state } = deps;

  if (state.phase !== "brainstorming") {
    return {
      content: [{ type: "text", text: "Error: submit_spec is only available during the brainstorming phase." }],
      details: { approved: false },
    };
  }

  if (!state.repoRoot) {
    return {
      content: [{ type: "text", text: "Error: No repository root detected." }],
      details: { approved: false },
    };
  }

  const specPath = params.specPath as string;
  const currentConfig = deps.config?.config ?? loadConfig(state.repoRoot).config;

  if (!specPath.startsWith(currentConfig.specDir)) {
    return {
      content: [{ type: "text", text: `Error: Spec must be under ${currentConfig.specDir}/. Got: ${specPath}` }],
      details: { approved: false },
    };
  }

  const specContent = readSpec(state.repoRoot, specPath);
  if (!specContent) {
    return {
      content: [{ type: "text", text: `Error: Spec not found at ${specPath}` }],
      details: { approved: false },
    };
  }

  // Use browser annotation UI if available, otherwise use confirm
  if (hasPlanReviewUI()) {
    try {
      const specAbsPath = resolve(state.repoRoot, specPath);
      const annotationResult = await handleAnnotation(specAbsPath, ctx);

      const approved = await ctx.ui.confirm(
        "Approve spec?",
        annotationResult.feedback
          ? `Spec reviewed with feedback:\n\n${annotationResult.feedback}\n\nApprove this spec?`
          : "Approve this spec and proceed to planning?",
      );

      if (approved) {
        state.brainstormSpecPath = specPath;
        state.phase = "needs-plan";
        deps.applyUI(ctx);
        deps.persistState();

        const feedbackNote = annotationResult.feedback
          ? `\n\nReview feedback to incorporate:\n${annotationResult.feedback}`
          : "";

        return {
          content: [{
            type: "text",
            text: `Spec approved! Transitioning to planning phase. The spec at ${specPath} will be incorporated into the plan. Run /plan to create the implementation plan.${feedbackNote}`,
          }],
          details: { approved: true, specPath },
        };
      }

      return {
        content: [{
          type: "text",
          text: `Spec not approved. ${annotationResult.feedback || "Please revise the spec."}\n\nRevise the spec document and call submit_spec again.`,
        }],
        details: { approved: false, feedback: annotationResult.feedback },
      };
    } catch {
      // Fall through to confirm-based flow
    }
  }

  // Fallback: use confirm dialog
  const approved = await ctx.ui.confirm(
    "Approve spec?",
    `Review the spec at ${specPath}:\n\n${(params.summary as string) || "(no summary provided)"}`,
  );

  if (approved) {
    state.brainstormSpecPath = specPath;
    state.phase = "needs-plan";
    deps.applyUI(ctx);
    deps.persistState();

    return {
      content: [{
        type: "text",
        text: `Spec approved! Transitioning to planning phase. Run /plan to create the implementation plan.`,
      }],
      details: { approved: true, specPath },
    };
  }

  return {
    content: [{
      type: "text",
      text: `Spec not approved. Revise the spec document and call submit_spec again.`,
    }],
    details: { approved: false },
  };
}

// ---------------------------------------------------------------------------
// Helper (shared with index.ts)
// ---------------------------------------------------------------------------

function tryTransitionToExecuting(state: AutoPlanState): void {
  if (state.phase === "has-plan" && state.repoRoot) {
    const steps = extractStepsFromCurrentPlan(state.repoRoot);
    if (steps.length > 0) {
      state.todoItems = steps;
      state.phase = "executing";
    }
  }
}
