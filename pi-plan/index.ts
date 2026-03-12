/**
 * index.ts — Command registration and Pi API bridge.
 *
 * Owns: /plan and /plan-debug command registration. Bridges Pi's ExtensionAPI
 *       to the orchestration layer's PlanUI interface.
 *
 * Does NOT own: Business logic, state detection, file I/O, plan generation,
 *               archive logic, config loading, or summary extraction.
 *               Those live in their respective modules (orchestration.ts and below).
 *
 * Invariants:
 *   - This file should stay thin. All command logic is in orchestration.ts.
 *   - State is always detected via repo.ts (detectPlanState / detectRepoRoot).
 *
 * Extend here: New commands, new UI flow wiring.
 * Do NOT extend here: Business logic, state reasoning, file manipulation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { detectPlanState, detectRepoRoot } from "./repo.js";
import { handlePlan, handlePlanDebug, type PlanUI } from "./orchestration.js";

// ---------------------------------------------------------------------------
// Bridge Pi's ctx.ui to PlanUI
// ---------------------------------------------------------------------------

function bridgeUI(ctx: { ui: { notify: Function; confirm: Function; select: Function; input: Function } }): PlanUI {
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
  pi.registerCommand("plan", {
    description: "Repo-local planning — detect state, initialize, create, or manage current plan",
    handler: async (args, ctx) => {
      const state = await detectPlanState(pi);
      await handlePlan(state, args, bridgeUI(ctx));
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
}
