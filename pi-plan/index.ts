/**
 * index.ts — Command registration, Pi API bridge, and lifecycle hook wiring.
 *
 * Owns: /plan (toggle + document workflow), /plan-debug, /todos command
 *       registration. Bridges Pi's ExtensionAPI to the orchestration layer's
 *       PlanUI interface. Wires enforcement lifecycle hooks (input,
 *       session_start, before_agent_start, context, turn_end, agent_end)
 *       to the auto-plan state machine and harness layer.
 *
 * Does NOT own: Business logic, state detection, file I/O, plan generation,
 *               archive logic, enforcement decisions (auto-plan.ts),
 *               input evaluation (harness.ts).
 *
 * Invariants:
 *   - This file is a bridge. Enforcement decisions come from auto-plan.ts
 *     and harness.ts.
 *   - State is always detected via repo.ts (detectPlanState / detectRepoRoot).
 *   - /plan is a toggle: ON activates enforcement, OFF deactivates it.
 *   - When enforcement is ON and a plan exists, /plan shows the document
 *     workflow menu (resume/replace/revisit).
 *   - The input hook never blocks — it only transforms or passes through.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { detectPlanState, detectRepoRoot, CURRENT_PLAN_REL } from "./repo.js";
import { handlePlan, handlePlanDebug, type PlanUI } from "./orchestration.js";
import { loadConfig } from "./config.js";
import { readCurrentPlan, archivePlan, forceWriteCurrentPlan, updateIndex } from "./archive.js";
import { CURRENT_PLAN_PLACEHOLDER } from "./defaults.js";
import { markCompletedSteps } from "./mode-utils.js";
import { evaluateInput, evaluateHarnessCommand } from "./harness.js";
import {
  handlePlanSubmission,
  handleCodeReview,
  handleAnnotation,
  hasPlanReviewUI,
  hasCodeReviewUI,
} from "./review.js";
import {
  createInitialState,
  computePhase,
  getContextMessage,
  getStatusDisplay,
  getWidgetLines,
  extractStepsFromCurrentPlan,
  serializeState,
  restoreState,
  type AutoPlanState,
  type PersistedAutoState,
} from "./auto-plan.js";

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Bridge Pi's ctx.ui to PlanUI
// ---------------------------------------------------------------------------

function bridgeUI(ctx: {
  ui: {
    notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
    confirm: (title: string, message: string) => Promise<boolean>;
    select: (title: string, options: string[]) => Promise<string | null>;
    input: (title: string, placeholder: string) => Promise<string | null>;
  };
}): PlanUI {
  return {
    notify: (msg, level) => ctx.ui.notify(msg, level),
    confirm: (title, message) => ctx.ui.confirm(title, message),
    select: (title, options) => ctx.ui.select(title, options),
    input: (title, placeholder) => ctx.ui.input(title, placeholder),
  };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // ----- Mutable state -----
  let state: AutoPlanState = createInitialState();

  // ----- UI helpers -----

  function applyUI(ctx: ExtensionContext): void {
    const status = getStatusDisplay(state.phase, state.todoItems);
    ctx.ui.setStatus(status.key, status.text
      ? (state.phase === "executing"
        ? ctx.ui.theme.fg("accent", status.text)
        : ctx.ui.theme.fg("warning", status.text))
      : undefined);

    const widgetLines = getWidgetLines(state.phase, state.todoItems);
    if (widgetLines) {
      const themed = widgetLines.map((line) =>
        line.includes("☑")
          ? ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(line.replace(/\s*☑\s*~~(.+)~~/, "$1")))
          : ctx.ui.theme.fg("muted", "☐ ") + line.replace(/\s*☐\s*/, ""),
      );
      ctx.ui.setWidget("pi-plan", themed);
    } else {
      ctx.ui.setWidget("pi-plan", undefined);
    }
  }

  function persistState(): void {
    pi.appendEntry("pi-plan-auto", serializeState(state));
  }

  async function refreshPhase(): Promise<void> {
    const planState = await detectPlanState(pi);
    state.phase = computePhase(state.enforcementActive, planState);
    if (planState.status !== "no-repo" && "repoRoot" in planState) {
      state.repoRoot = planState.repoRoot;
    }
  }

  // ----- Flags -----

  pi.registerFlag("plan", {
    description: "Start with plan enforcement enabled",
    type: "boolean",
    default: false,
  });

  // ----- Commands -----

  pi.registerCommand("plan", {
    description: "Toggle plan enforcement, or manage current plan when enforcement is active",
    handler: async (args, ctx) => {
      const planState = await detectPlanState(pi);

      if (!state.enforcementActive) {
        // --- Toggle ON ---
        state.enforcementActive = true;
        state.phase = computePhase(true, planState);

        if (planState.status !== "no-repo" && "repoRoot" in planState) {
          state.repoRoot = planState.repoRoot;
        }

        if (state.phase === "no-repo") {
          state.enforcementActive = false;
          state.phase = "inactive";
          ctx.ui.notify("No repository detected. /plan only works inside a git repository.", "error");
          return;
        }

        // If not initialized, offer to initialize (reuse orchestration logic)
        if (state.phase === "not-initialized") {
          await handlePlan(planState, args, bridgeUI(ctx));
          // Re-check after potential initialization
          await refreshPhase();
        }

        // If initialized with no plan, offer to create one
        if (state.phase === "needs-plan") {
          ctx.ui.notify("Plan enforcement ON. No plan exists yet — create one with /plan.", "info");
          // Trigger plan creation flow
          const freshState = await detectPlanState(pi);
          await handlePlan(freshState, args, bridgeUI(ctx));
          await refreshPhase();
        }

        // If a plan exists, extract steps for tracking
        if (state.phase === "has-plan" && state.repoRoot) {
          const steps = extractStepsFromCurrentPlan(state.repoRoot);
          if (steps.length > 0) {
            state.todoItems = steps;
            state.phase = "executing";
          }
          ctx.ui.notify("Plan enforcement ON.", "info");
        }

        applyUI(ctx);
        persistState();
        return;
      }

      // --- Already ON: check for toggle OFF or document workflow ---
      // If user runs /plan with no args and enforcement is on, show menu
      if (args.trim().length === 0) {
        const hasActivePlan = state.phase === "has-plan" || state.phase === "executing";

        const options = hasActivePlan
          ? ["Resume current plan", "Replace current plan", "Revisit archived plans", "Turn off plan enforcement", "Cancel"]
          : ["Create a plan", "Turn off plan enforcement", "Cancel"];

        const choice = await ctx.ui.select("Plan enforcement is active", options);

        if (!choice || choice === "Cancel") return;

        if (choice === "Turn off plan enforcement") {
          state.enforcementActive = false;
          state.phase = "inactive";
          state.todoItems = [];
          ctx.ui.notify("Plan enforcement OFF.", "info");
          applyUI(ctx);
          persistState();
          return;
        }

        if (choice === "Create a plan") {
          const freshState = await detectPlanState(pi);
          await handlePlan(freshState, "", bridgeUI(ctx));
          await refreshPhase();

          if (state.phase === "has-plan" && state.repoRoot) {
            const steps = extractStepsFromCurrentPlan(state.repoRoot);
            if (steps.length > 0) {
              state.todoItems = steps;
              state.phase = "executing";
            }
          }

          applyUI(ctx);
          persistState();
          return;
        }

        // Delegate to orchestration for resume/replace/revisit
        await handlePlan(planState, "", bridgeUI(ctx));
        await refreshPhase();

        if (state.phase === "has-plan" && state.repoRoot) {
          const steps = extractStepsFromCurrentPlan(state.repoRoot);
          if (steps.length > 0) {
            state.todoItems = steps;
            state.phase = "executing";
          }
        }

        applyUI(ctx);
        persistState();
        return;
      }

      // /plan <goal text> with enforcement on — create/replace plan with inline goal
      await handlePlan(planState, args, bridgeUI(ctx));
      await refreshPhase();

      if (state.phase === "has-plan" && state.repoRoot) {
        const steps = extractStepsFromCurrentPlan(state.repoRoot);
        if (steps.length > 0) {
          state.todoItems = steps;
          state.phase = "executing";
        }
      }

      applyUI(ctx);
      persistState();
    },
  });

  pi.registerCommand("plan-debug", {
    description: "Write a diagnostic snapshot of the repo planning state to .pi/logs/",
    handler: async (_args, ctx) => {
      const repoRoot = await detectRepoRoot(pi);
      const cwd = process.cwd();
      await handlePlanDebug(repoRoot, cwd, bridgeUI(ctx));
    },
  });

  pi.registerCommand("todos", {
    description: "Show current plan step progress",
    handler: async (_args, ctx) => {
      if (state.todoItems.length === 0) {
        ctx.ui.notify("No steps tracked. Create a plan with /plan first.", "info");
        return;
      }
      const list = state.todoItems
        .map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`)
        .join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    },
  });

  // ----- submit_plan tool -----

  pi.registerTool({
    name: "submit_plan",
    label: "Submit Plan for Review",
    description:
      "Submit the current plan for user review in a browser-based UI. " +
      "Call this after drafting or revising the plan in .pi/plans/current.md. " +
      "The user will review the plan visually and can approve, deny with feedback, or annotate it. " +
      "If denied, use the edit tool to make targeted revisions, then call this again.",
    parameters: Type.Object({
      summary: Type.Optional(
        Type.String({ description: "Brief summary of the plan for the user's review" }),
      ),
    }),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      // Guard: must have enforcement active and a plan
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
        const config = loadConfig(state.repoRoot);
        const result = await handlePlanSubmission(state.repoRoot, config.config, ctx);

        if (result.approved) {
          // Transition to executing
          if (state.repoRoot) {
            const steps = extractStepsFromCurrentPlan(state.repoRoot);
            if (steps.length > 0) {
              state.todoItems = steps;
              state.phase = "executing";
            }
          }
          applyUI(ctx);
          persistState();

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
        return {
          content: [{ type: "text", text: `Error during plan review: ${String(err)}` }],
          details: { approved: false },
        };
      }
    },
  });

  // ----- /plan-review command -----

  pi.registerCommand("plan-review", {
    description: "Open interactive code review for current git changes in a browser UI",
    handler: async (_args, ctx) => {
      if (!hasCodeReviewUI()) {
        ctx.ui.notify("Code review UI not available. Ensure assets/review-editor.html is built.", "error");
        return;
      }

      ctx.ui.notify("Opening code review UI...", "info");

      try {
        const result = await handleCodeReview(ctx);

        if (result.feedback) {
          pi.sendUserMessage(`# Code Review Feedback\n\n${result.feedback}\n\nPlease address this feedback.`);
        } else {
          ctx.ui.notify("Code review closed (no feedback).", "info");
        }
      } catch (err) {
        ctx.ui.notify(`Code review error: ${String(err)}`, "error");
      }
    },
  });

  // ----- /plan-annotate command -----

  pi.registerCommand("plan-annotate", {
    description: "Open a markdown file in the browser-based annotation UI",
    handler: async (args, ctx) => {
      const filePath = args?.trim();
      if (!filePath) {
        ctx.ui.notify("Usage: /plan-annotate <file.md>", "error");
        return;
      }

      if (!hasPlanReviewUI()) {
        ctx.ui.notify("Annotation UI not available. Ensure assets/plan-review.html is built.", "error");
        return;
      }

      ctx.ui.notify(`Opening annotation UI for ${filePath}...`, "info");

      try {
        const absolutePath = resolve(ctx.cwd, filePath);
        const result = await handleAnnotation(absolutePath, ctx);

        if (result.feedback) {
          pi.sendUserMessage(
            `# Markdown Annotations\n\nFile: ${absolutePath}\n\n${result.feedback}\n\nPlease address the annotation feedback above.`,
          );
        } else {
          ctx.ui.notify("Annotation closed (no feedback).", "info");
        }
      } catch (err) {
        ctx.ui.notify(`Annotation error: ${String(err)}`, "error");
      }
    },
  });

  // ----- Lifecycle hooks -----

  // Write-gating during planning: block writes outside current.md when enforcement is active
  pi.on("tool_call", async (event, ctx) => {
    // Only gate during has-plan or executing phases
    if (state.phase !== "has-plan" && state.phase !== "needs-plan") return;

    const toolName = event.toolName;
    if (toolName !== "write" && toolName !== "edit") return;

    // In "needs-plan" phase, only allow writes to current.md
    if (state.phase === "needs-plan" && state.repoRoot) {
      const targetPath = resolve(ctx.cwd, event.input.path as string);
      const allowedPath = resolve(state.repoRoot, CURRENT_PLAN_REL);
      if (targetPath !== allowedPath) {
        return {
          block: true,
          reason: `Plan enforcement: writes are restricted to .pi/plans/current.md during planning. Blocked: ${event.input.path}`,
        };
      }
    }
  });

  // Harness-level input interception
  pi.on("input", async (event) => {
    // Never intercept extension-injected messages
    if (event.source === "extension") return { action: "continue" };

    // Check harness command registry first
    const cmdResult = evaluateHarnessCommand(event.text, state.phase, state.repoRoot);
    if (cmdResult.matched) return cmdResult.result;

    // Phase-based input evaluation
    return evaluateInput(state.phase, event.text);
  });

  // Filter stale plan enforcement context messages when inactive
  pi.on("context", async (event) => {
    if (state.phase !== "inactive") return;

    return {
      messages: event.messages.filter((m) => {
        const msg = m as AgentMessage & { customType?: string };
        if (msg.customType === "pi-plan-context") return false;
        if (msg.role !== "user") return true;

        const content = msg.content;
        if (typeof content === "string") {
          return !content.includes("[PLAN ENFORCEMENT ACTIVE") && !content.includes("[CONTEXT: Plan enforcement");
        }
        if (Array.isArray(content)) {
          return !content.some(
            (c) => c.type === "text" && ((c as TextContent).text?.includes("[PLAN ENFORCEMENT ACTIVE") || (c as TextContent).text?.includes("[CONTEXT: Plan enforcement")),
          );
        }
        return true;
      }),
    };
  });

  // Inject context message before agent starts
  pi.on("before_agent_start", async () => {
    if (state.phase === "inactive") return;

    // Re-check state in case user ran /plan or edited files
    await refreshPhase();

    const config = state.repoRoot ? loadConfig(state.repoRoot) : null;
    const injectContext = config?.config.injectPlanContext ?? true;
    if (!injectContext) return;

    const message = getContextMessage(state.phase, state.todoItems);
    if (!message) return;

    return {
      message: {
        customType: "pi-plan-context",
        content: message,
        display: false,
      },
    };
  });

  // Track [DONE:n] markers during execution
  pi.on("turn_end", async (event, ctx) => {
    if (state.phase !== "executing" || state.todoItems.length === 0) return;
    if (!isAssistantMessage(event.message)) return;

    const text = getTextContent(event.message);
    if (markCompletedSteps(text, state.todoItems) > 0) {
      applyUI(ctx);
      persistState();
    }
  });

  // Check for plan completion after agent finishes
  pi.on("agent_end", async (_event, ctx) => {
    if (state.phase !== "executing" || state.todoItems.length === 0) return;

    if (state.todoItems.every((t) => t.completed)) {
      const completedList = state.todoItems.map((t) => `~~${t.text}~~`).join("\n");
      pi.sendMessage(
        { customType: "pi-plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
        { triggerTurn: false },
      );

      // Offer to archive
      if (ctx.hasUI && state.repoRoot) {
        const shouldArchive = await ctx.ui.confirm(
          "Archive completed plan?",
          "The plan is complete. Archive it and clear current.md?",
        );

        if (shouldArchive) {
          const config = loadConfig(state.repoRoot);

          const content = readCurrentPlan(state.repoRoot);
          if (content) {
            archivePlan(state.repoRoot, content, new Date(), {
              archiveDir: config.config.archiveDir,
              archiveFilenameStyle: config.config.archiveFilenameStyle,
            });
            forceWriteCurrentPlan(state.repoRoot, CURRENT_PLAN_PLACEHOLDER);
            updateIndex(state.repoRoot, { archiveDir: config.config.archiveDir });
            ctx.ui.notify("Plan archived.", "success");
          }
        }
      }

      // Reset execution state
      state.todoItems = [];
      await refreshPhase();
      applyUI(ctx);
      persistState();
    }
  });

  // Session start: restore persisted state, detect filesystem state, apply UI
  pi.on("session_start", async (_event, ctx) => {
    const repoRoot = await detectRepoRoot(pi);

    // Restore persisted state if available
    const entries = ctx.sessionManager.getEntries();
    const persistedEntry = entries
      .filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "pi-plan-auto")
      .pop() as { data?: PersistedAutoState } | undefined;

    if (persistedEntry?.data) {
      state = restoreState(persistedEntry.data, repoRoot);
    } else {
      state.repoRoot = repoRoot;
    }

    // Check --plan flag for fresh sessions (no persisted state)
    if (!persistedEntry?.data && pi.getFlag("plan") === true) {
      state.enforcementActive = true;
    }

    // Always re-detect from filesystem (persisted state may be stale)
    if (state.enforcementActive) {
      // review-pending is transient — if session restarts, the browser server is gone
      if (state.phase === "review-pending") {
        state.phase = "has-plan";
      }

      await refreshPhase();

      // Re-scan messages for [DONE:n] if we were executing
      if (state.phase === "executing" && state.todoItems.length > 0) {
        const messages: AssistantMessage[] = [];
        for (const entry of entries) {
          if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
            messages.push(entry.message as AssistantMessage);
          }
        }
        const allText = messages.map(getTextContent).join("\n");
        markCompletedSteps(allText, state.todoItems);
      }
    }

    applyUI(ctx);
  });
}
