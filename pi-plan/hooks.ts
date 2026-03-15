/**
 * hooks.ts — Lifecycle hook implementations for pi-plan enforcement.
 *
 * Owns: The logic for tool_call gating (brainstorming, finishing, planning,
 *       TDD, worktree phases), input interception, context filtering,
 *       before_agent_start injection, turn_end tracking, agent_end completion
 *       (including finishing workflow orchestration via finish.ts),
 *       and session_start restoration — extracted from index.ts for testability.
 *
 * Does NOT own: Hook registration (index.ts), state machine (auto-plan.ts),
 *               harness evaluation (harness.ts), config loading (config.ts),
 *               finishing logic (finish.ts).
 *
 * Invariants:
 *   - Hook handlers receive shared state by reference and may mutate it.
 *   - All Pi API calls go through the injected deps interface.
 *   - Pure decision logic is delegated to auto-plan.ts, harness.ts, tdd.ts.
 *   - Finishing phase blocks all file writes.
 */

import { resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { AutoPlanState, AutoPlanPhase, PersistedAutoState } from "./auto-plan.js";
import {
  computePhase,
  getContextMessage,
  extractStepsFromCurrentPlan,
  restoreState,
} from "./auto-plan.js";
import { loadConfig, type PiPlanConfig } from "./config.js";
import { CURRENT_PLAN_REL, SPECS_DIR_REL } from "./repo.js";
import { detectPlanState, detectRepoRoot } from "./repo.js";
import { evaluateInput, evaluateHarnessCommand, type InputResult } from "./harness.js";
import { evaluateTddGate, logTddCompliance, validateStepCompletion } from "./tdd.js";
import { markCompletedSteps, extractDoneSteps } from "./mode-utils.js";
import { readCurrentPlan, archivePlan, forceWriteCurrentPlan, updateIndex } from "./archive.js";
import { CURRENT_PLAN_PLACEHOLDER } from "./defaults.js";
import { cleanupWorktree, readWorktreeState } from "./worktree.js";
import { executeFinishing, detectBaseBranch, type FinishContext } from "./finish.js";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Shared dependencies interface
// ---------------------------------------------------------------------------

export interface HookDeps {
  state: AutoPlanState;
  config: { config: PiPlanConfig; warnings: string[]; source: string } | null;
  applyUI: (ctx: HookContext) => void;
  persistState: () => void;
  refreshPhase: () => Promise<void>;
  exec: (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<{ code: number; stdout: string }>;
  sendMessage: (msg: { customType: string; content: string; display: boolean }, opts: { triggerTurn: boolean }) => void;
  getFlag: (name: string) => unknown;
  detectPlanState: () => Promise<import("./repo.js").PlanState>;
  detectRepoRoot: () => Promise<string | null>;
}

export interface HookContext {
  hasUI: boolean;
  cwd: string;
  ui: {
    notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
    confirm: (title: string, message: string) => Promise<boolean>;
    select: (title: string, options: string[]) => Promise<string | null>;
    input: (title: string, placeholder: string) => Promise<string | null>;
  };
  sessionManager: {
    getEntries: () => Array<Record<string, unknown>>;
  };
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

export function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray(m.content);
}

export function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// tool_call hook: write-gating for brainstorming, planning, TDD, worktree
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
}

export function handleToolCallGate(
  event: ToolCallEvent,
  cwd: string,
  deps: HookDeps,
): { block: true; reason: string } | undefined {
  const { state, config } = deps;
  const toolName = event.toolName;
  if (toolName !== "write" && toolName !== "edit") return;

  const rawPath = event.input.path ?? event.input.file_path;
  if (typeof rawPath !== "string") return;

  const targetPath = resolve(cwd, rawPath);

  // Finishing phase: no writes allowed
  if (state.phase === "finishing") {
    return { block: true, reason: "Finishing phase: no writes allowed while branch finishing workflow is in progress." };
  }

  // Brainstorming phase: block writes outside .pi/specs/ and .pi/plans/current.md
  if (state.phase === "brainstorming" && state.repoRoot) {
    const specsDir = resolve(state.repoRoot, config?.config.specDir ?? SPECS_DIR_REL);
    const allowedPlanPath = resolve(state.repoRoot, CURRENT_PLAN_REL);
    const piDir = resolve(state.repoRoot, ".pi");

    if (
      targetPath !== allowedPlanPath &&
      !targetPath.startsWith(specsDir + "/") &&
      !targetPath.startsWith(piDir + "/")
    ) {
      return {
        block: true,
        reason: `Brainstorming phase: writes are restricted to .pi/specs/. Blocked: ${rawPath}`,
      };
    }
    return;
  }

  // Needs-plan phase: only allow writes to current.md
  if (state.phase === "needs-plan" && state.repoRoot) {
    const allowedPath = resolve(state.repoRoot, CURRENT_PLAN_REL);
    if (targetPath !== allowedPath) {
      return {
        block: true,
        reason: `Plan enforcement: writes are restricted to .pi/plans/current.md during planning. Blocked: ${rawPath}`,
      };
    }
    return;
  }

  // Has-plan phase: no additional gating
  if (state.phase === "has-plan") return;

  // Executing phase: TDD enforcement + worktree isolation
  if (state.phase === "executing" && state.repoRoot) {
    const currentConfig = config?.config ?? loadConfig(state.repoRoot).config;

    // Worktree isolation
    if (state.worktreeActive && state.worktreePath) {
      const mainRepoDir = resolve(state.repoRoot);
      const worktreeDir = resolve(state.worktreePath);
      const piDir = resolve(state.repoRoot, ".pi");

      if (targetPath.startsWith(piDir + "/") || targetPath === piDir) {
        // fall through to TDD check
      } else if (targetPath.startsWith(worktreeDir + "/") || targetPath === worktreeDir) {
        // Writing to worktree — allowed, fall through
      } else if (targetPath.startsWith(mainRepoDir + "/") || targetPath === mainRepoDir) {
        return {
          block: true,
          reason: `Worktree active. Write to ${state.worktreePath} instead of the main repo. Your worktree is at: ${state.worktreePath}`,
        };
      }
    }

    // TDD enforcement
    if (currentConfig.tddEnforcement) {
      const effectiveRoot = state.worktreeActive && state.worktreePath
        ? state.worktreePath
        : state.repoRoot;

      const decision = evaluateTddGate(
        targetPath,
        state.tddStepTestWritten,
        currentConfig.testFilePatterns,
        effectiveRoot,
      );

      if (decision.action === "allow-test") {
        state.tddStepTestWritten = true;
        deps.persistState();
        return;
      }

      if (decision.action === "block") {
        return { block: true, reason: decision.reason! };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// input hook: harness-level input interception
// ---------------------------------------------------------------------------

export function handleInput(
  text: string,
  source: string,
  deps: HookDeps,
): InputResult {
  if (source === "extension") return { action: "continue" };

  const cmdResult = evaluateHarnessCommand(text, deps.state.phase, deps.state.repoRoot);
  if (cmdResult.matched) return cmdResult.result;

  return evaluateInput(deps.state.phase, text);
}

// ---------------------------------------------------------------------------
// context hook: filter stale enforcement messages when inactive
// ---------------------------------------------------------------------------

export function handleContextFilter(
  messages: AgentMessage[],
  phase: AutoPlanPhase,
): AgentMessage[] | null {
  if (phase !== "inactive") return null;

  return messages.filter((m) => {
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
  });
}

// ---------------------------------------------------------------------------
// before_agent_start hook: inject context message
// ---------------------------------------------------------------------------

export async function handleBeforeAgentStart(
  deps: HookDeps,
): Promise<{ customType: string; content: string; display: boolean } | null> {
  const { state } = deps;
  if (state.phase === "inactive") return null;

  await deps.refreshPhase();

  const config = state.repoRoot ? loadConfig(state.repoRoot) : null;
  const injectContext = config?.config.injectPlanContext ?? true;
  if (!injectContext) return null;

  let message = getContextMessage(state.phase, state.todoItems);
  if (!message) return null;

  if (state.phase === "executing" && state.worktreeActive && state.worktreePath) {
    message += `\n\nWorking directory: ${state.worktreePath}. Run commands from this directory.`;
  }

  return {
    customType: "pi-plan-context",
    content: message,
    display: false,
  };
}

// ---------------------------------------------------------------------------
// turn_end hook: track [DONE:n] markers with TDD validation
// ---------------------------------------------------------------------------

export function handleTurnEnd(
  message: AgentMessage,
  ctx: HookContext,
  deps: HookDeps,
): void {
  const { state, config } = deps;
  if (state.phase !== "executing" || state.todoItems.length === 0) return;
  if (!isAssistantMessage(message)) return;

  const text = getTextContent(message);
  const currentConfig = config?.config ?? (state.repoRoot ? loadConfig(state.repoRoot).config : null);

  // TDD step completion validation
  if (currentConfig?.tddEnforcement) {
    const doneSteps = extractDoneSteps(text);
    if (doneSteps.length > 0 && !validateStepCompletion(state.tddStepTestWritten)) {
      deps.sendMessage(
        {
          customType: "pi-plan-tdd-block",
          content: `Step ${doneSteps[0]} cannot be marked complete — no test was written. Write a test first.`,
          display: true,
        },
        { triggerTurn: false },
      );
      return;
    }
  }

  const completed = markCompletedSteps(text, state.todoItems);
  if (completed > 0) {
    if (currentConfig?.tddEnforcement && state.repoRoot) {
      const doneSteps = extractDoneSteps(text);
      for (const step of doneSteps) {
        logTddCompliance(
          state.repoRoot,
          step,
          state.tddStepTestWritten,
          currentConfig.tddLogDir,
        );
      }
      state.tddStepTestWritten = false;
    }

    deps.applyUI(ctx);
    deps.persistState();
  }
}

// ---------------------------------------------------------------------------
// agent_end hook: check for plan completion
// ---------------------------------------------------------------------------

export async function handleAgentEnd(
  ctx: HookContext,
  deps: HookDeps,
): Promise<void> {
  const { state, config } = deps;
  if (state.phase !== "executing" || state.todoItems.length === 0) return;

  if (!state.todoItems.every((t) => t.completed)) return;

  const completedList = state.todoItems.map((t) => `~~${t.text}~~`).join("\n");
  deps.sendMessage(
    { customType: "pi-plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
    { triggerTurn: false },
  );

  // Set finishing phase
  state.phase = "finishing";
  deps.persistState();
  deps.applyUI(ctx);

  if (state.worktreeActive && ctx.hasUI && state.repoRoot) {
    // Worktree active — run full finishing workflow
    const currentConfig = config?.config ?? loadConfig(state.repoRoot).config;
    const worktreeState = readWorktreeState(state.repoRoot, currentConfig.worktreeStateDir);
    const planContent = readCurrentPlan(state.repoRoot);

    if (worktreeState && planContent) {
      const baseBranch = await detectBaseBranch(state.repoRoot, deps.exec);
      const finishCtx: FinishContext = {
        repoRoot: state.repoRoot,
        worktreePath: worktreeState.path,
        branch: worktreeState.branch,
        baseBranch,
        stateDir: currentConfig.worktreeStateDir,
      };

      const result = await executeFinishing(finishCtx, deps.exec, ctx.ui, currentConfig, planContent);

      if (result) {
        if (result.success) {
          ctx.ui.notify(result.message, "success");
        } else {
          ctx.ui.notify(result.message + (result.error ? `: ${result.error}` : ""), "error");
        }
      }

      state.worktreeActive = false;
      state.worktreePath = null;
    }
  } else if (ctx.hasUI && state.repoRoot) {
    // No worktree — just archive the plan
    const loadedConfig = loadConfig(state.repoRoot);
    const content = readCurrentPlan(state.repoRoot);
    if (content) {
      archivePlan(state.repoRoot, content, new Date(), {
        archiveDir: loadedConfig.config.archiveDir,
        archiveFilenameStyle: loadedConfig.config.archiveFilenameStyle,
      });
      forceWriteCurrentPlan(state.repoRoot, CURRENT_PLAN_PLACEHOLDER);
      updateIndex(state.repoRoot, { archiveDir: loadedConfig.config.archiveDir });
      ctx.ui.notify("Plan archived.", "success");
    }
  }

  // Reset execution state
  state.todoItems = [];
  state.tddStepTestWritten = false;
  await deps.refreshPhase();
  deps.applyUI(ctx);
  deps.persistState();
}

// ---------------------------------------------------------------------------
// session_start hook: restore persisted state and apply UI
// ---------------------------------------------------------------------------

export async function handleSessionStart(
  ctx: HookContext,
  deps: HookDeps,
): Promise<void> {
  const { state } = deps;
  const repoRoot = await deps.detectRepoRoot();

  // Restore persisted state if available
  const entries = ctx.sessionManager.getEntries();
  const persistedEntry = entries
    .filter((e) => e.type === "custom" && e.customType === "pi-plan-auto")
    .pop() as { data?: PersistedAutoState } | undefined;

  if (persistedEntry?.data) {
    const restored = restoreState(persistedEntry.data, repoRoot);
    Object.assign(state, restored);
  } else {
    state.repoRoot = repoRoot;
  }

  // Check --plan flag for fresh sessions
  if (!persistedEntry?.data && deps.getFlag("plan") === true) {
    state.enforcementActive = true;
  }

  // Load config if we have a repo root
  if (state.repoRoot) {
    deps.config = loadConfig(state.repoRoot);
  }

  // Re-detect from filesystem (persisted state may be stale)
  if (state.enforcementActive) {
    if (state.phase === "review-pending") {
      state.phase = "has-plan";
    }
    if (state.phase === "brainstorming") {
      state.phase = "needs-plan";
    }
    if (state.phase === "finishing") {
      state.phase = "has-plan";
    }

    if (state.worktreeActive && state.worktreePath) {
      if (!existsSync(state.worktreePath)) {
        state.worktreeActive = false;
        state.worktreePath = null;
      }
    }

    await deps.refreshPhase();

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

  deps.applyUI(ctx);
}
