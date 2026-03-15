/**
 * index.ts — Command registration, Pi API bridge, and lifecycle hook wiring.
 *
 * Owns: /plan (toggle + document workflow), /plan-debug, /todos, /tdd,
 *       /plan-review, /plan-annotate, /plan-finish command registration. Bridges Pi's
 *       ExtensionAPI to the orchestration layer's PlanUI interface. Wires
 *       lifecycle hooks to extracted handler modules (tools.ts, hooks.ts).
 *
 * Does NOT own: Business logic, state detection, file I/O, plan generation,
 *               archive logic, enforcement decisions (auto-plan.ts),
 *               input evaluation (harness.ts), tool handlers (tools.ts),
 *               hook handlers (hooks.ts).
 *
 * Invariants:
 *   - This file is a bridge. Enforcement decisions come from auto-plan.ts
 *     and harness.ts.
 *   - Tool execute logic lives in tools.ts; hook logic in hooks.ts.
 *   - State is always detected via repo.ts (detectPlanState / detectRepoRoot).
 *   - /plan is a toggle: ON activates enforcement, OFF deactivates it.
 *   - The input hook never blocks — it only transforms or passes through.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { detectPlanState, detectRepoRoot, CURRENT_PLAN_REL } from "./repo.js";
import { handlePlan, handlePlanDebug, type PlanUI } from "./orchestration.js";
import { loadConfig } from "./config.js";
import {
  handleCodeReview,
  handleAnnotation,
  hasPlanReviewUI,
  hasCodeReviewUI,
} from "./review.js";
import {
  createInitialState,
  computePhase,
  getStatusDisplay,
  getWidgetLines,
  extractStepsFromCurrentPlan,
  serializeState,
  type AutoPlanState,
} from "./auto-plan.js";
import { executeSubmitPlan, executeSubmitSpec } from "./tools.js";
import {
  handleToolCallGate,
  handleInput,
  handleContextFilter,
  handleBeforeAgentStart,
  handleTurnEnd,
  handleAgentEnd,
  handleSessionStart,
} from "./hooks.js";
import { executeFinishing, detectBaseBranch, type FinishContext } from "./finish.js";
import { readWorktreeState } from "./worktree.js";
import { readCurrentPlan } from "./archive.js";

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
  let config: { config: import("./config.js").PiPlanConfig; warnings: string[]; source: string } | null = null;

  // ----- UI helpers -----

  function applyUI(ctx: ExtensionContext | { ui: ExtensionContext["ui"] }): void {
    const status = getStatusDisplay(state.phase, state.todoItems);
    const uiCtx = ctx.ui as ExtensionContext["ui"];
    uiCtx.setStatus(status.key, status.text
      ? (state.phase === "executing"
        ? uiCtx.theme.fg("accent", status.text)
        : uiCtx.theme.fg("warning", status.text))
      : undefined);

    const widgetLines = getWidgetLines(state.phase, state.todoItems);
    if (widgetLines) {
      const themed = widgetLines.map((line) =>
        line.includes("☑")
          ? uiCtx.theme.fg("success", "☑ ") + uiCtx.theme.fg("muted", uiCtx.theme.strikethrough(line.replace(/\s*☑\s*~~(.+)~~/, "$1")))
          : uiCtx.theme.fg("muted", "☐ ") + line.replace(/\s*☐\s*/, ""),
      );
      uiCtx.setWidget("pi-plan", themed);
    } else {
      uiCtx.setWidget("pi-plan", undefined);
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

  function tryTransitionToExecuting(): void {
    if (state.phase === "has-plan" && state.repoRoot) {
      const steps = extractStepsFromCurrentPlan(state.repoRoot);
      if (steps.length > 0) {
        state.todoItems = steps;
        state.phase = "executing";
      }
    }
  }

  // ----- Shared deps for tools and hooks -----

  const toolDeps = {
    get state() { return state; },
    get config() { return config; },
    applyUI,
    persistState,
    exec: (cmd: string, args: string[], opts?: { timeout?: number }) => pi.exec(cmd, args, opts),
  };

  const hookDeps = {
    get state() { return state; },
    get config() { return config; },
    set config(v: typeof config) { config = v; },
    applyUI,
    persistState,
    refreshPhase,
    exec: (cmd: string, args: string[], opts?: { timeout?: number }) => pi.exec(cmd, args, opts),
    sendMessage: (msg: { customType: string; content: string; display: boolean }, opts: { triggerTurn: boolean }) => pi.sendMessage(msg, opts),
    getFlag: (name: string) => pi.getFlag(name),
    detectPlanState: () => detectPlanState(pi),
    detectRepoRoot: () => detectRepoRoot(pi),
  };

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

        if (state.phase === "not-initialized") {
          await handlePlan(planState, args, bridgeUI(ctx));
          await refreshPhase();
        }

        if (state.phase === "needs-plan") {
          config = config ?? (state.repoRoot ? loadConfig(state.repoRoot) : null);
          const currentConfig = config?.config;

          if (currentConfig?.brainstormEnabled && ctx.hasUI) {
            const wantBrainstorm = await ctx.ui.confirm(
              "Brainstorm first?",
              "Would you like to brainstorm/design before creating the plan?",
            );

            if (wantBrainstorm) {
              state.phase = "brainstorming";
              ctx.ui.notify("Brainstorming phase active. Write a spec to .pi/specs/ and use submit_spec when ready.", "info");
              applyUI(ctx);
              persistState();
              return;
            }
          }

          ctx.ui.notify("Plan enforcement ON. No plan exists yet — create one with /plan.", "info");
          const freshState = await detectPlanState(pi);
          await handlePlan(freshState, args, bridgeUI(ctx));
          await refreshPhase();
        }

        tryTransitionToExecuting();
        if (state.phase === "has-plan" || state.phase === "executing") {
          ctx.ui.notify("Plan enforcement ON.", "info");
        }

        applyUI(ctx);
        persistState();
        return;
      }

      // --- Already ON: check for toggle OFF or document workflow ---
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
          tryTransitionToExecuting();
          applyUI(ctx);
          persistState();
          return;
        }

        await handlePlan(planState, "", bridgeUI(ctx));
        await refreshPhase();
        tryTransitionToExecuting();
        applyUI(ctx);
        persistState();
        return;
      }

      await handlePlan(planState, args, bridgeUI(ctx));
      await refreshPhase();
      tryTransitionToExecuting();
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

  pi.registerCommand("tdd", {
    description: "Toggle TDD enforcement or show compliance summary",
    handler: async (_args, ctx) => {
      if (!state.repoRoot) {
        ctx.ui.notify("No repository detected.", "error");
        return;
      }

      const currentConfig = config?.config ?? loadConfig(state.repoRoot).config;
      const newValue = !currentConfig.tddEnforcement;

      if (config) {
        config.config.tddEnforcement = newValue;
      }

      ctx.ui.notify(
        `TDD enforcement ${newValue ? "ON" : "OFF"}.${state.tddStepTestWritten ? " (test written this step)" : ""}`,
        "info",
      );
    },
  });

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

  pi.registerCommand("plan-finish", {
    description: "Manually trigger the branch finishing workflow",
    handler: async (_args, ctx) => {
      if (!state.repoRoot) {
        ctx.ui.notify("No repository detected.", "error");
        return;
      }

      const currentConfig = config?.config ?? loadConfig(state.repoRoot).config;
      const worktreeState = readWorktreeState(state.repoRoot, currentConfig.worktreeStateDir);

      if (!worktreeState || !state.worktreeActive) {
        ctx.ui.notify("No active worktree. /plan-finish requires an active worktree.", "error");
        return;
      }

      const planContent = readCurrentPlan(state.repoRoot);
      if (!planContent) {
        ctx.ui.notify("No current plan found.", "error");
        return;
      }

      // Set finishing phase
      const previousPhase = state.phase;
      state.phase = "finishing";
      applyUI(ctx);
      persistState();

      const baseBranch = await detectBaseBranch(state.repoRoot, hookDeps.exec);
      const finishCtx: FinishContext = {
        repoRoot: state.repoRoot,
        worktreePath: worktreeState.path,
        branch: worktreeState.branch,
        baseBranch,
        stateDir: currentConfig.worktreeStateDir,
      };

      const result = await executeFinishing(
        finishCtx,
        hookDeps.exec,
        bridgeUI(ctx),
        currentConfig,
        planContent,
      );

      if (result) {
        if (result.success) {
          ctx.ui.notify(result.message, "success");
        } else {
          ctx.ui.notify(result.message + (result.error ? `: ${result.error}` : ""), "error");
        }
        state.worktreeActive = false;
        state.worktreePath = null;
      } else {
        // Cancelled — restore previous phase
        state.phase = previousPhase;
      }

      await refreshPhase();
      applyUI(ctx);
      persistState();
    },
  });

  // ----- Tools -----

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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeSubmitPlan(params as Record<string, unknown>, ctx, toolDeps);
    },
  });

  pi.registerTool({
    name: "submit_spec",
    label: "Submit Spec for Review",
    description:
      "Submit a design spec from .pi/specs/ for user review. " +
      "Call this during the brainstorming phase after writing a spec document.",
    parameters: Type.Object({
      specPath: Type.String({ description: "Relative path to the spec file in .pi/specs/" }),
      summary: Type.Optional(
        Type.String({ description: "Brief summary of the spec" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeSubmitSpec(params as Record<string, unknown>, ctx, toolDeps);
    },
  });

  // ----- Lifecycle hooks -----

  pi.on("tool_call", async (event, ctx) => {
    return handleToolCallGate(event, ctx.cwd, hookDeps);
  });

  pi.on("input", async (event) => {
    return handleInput(event.text, event.source, hookDeps);
  });

  pi.on("context", async (event) => {
    const filtered = handleContextFilter(event.messages as AgentMessage[], state.phase);
    if (filtered) return { messages: filtered };
  });

  pi.on("before_agent_start", async () => {
    const msg = await handleBeforeAgentStart(hookDeps);
    if (msg) return { message: msg };
  });

  pi.on("turn_end", async (event, ctx) => {
    handleTurnEnd(event.message as AgentMessage, ctx, hookDeps);
  });

  pi.on("agent_end", async (_event, ctx) => {
    await handleAgentEnd(ctx, hookDeps);
  });

  pi.on("session_start", async (_event, ctx) => {
    await handleSessionStart(ctx, hookDeps);
  });
}
