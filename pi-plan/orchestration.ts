/**
 * orchestration.ts — Extracted command handler logic for /plan and /plan-debug.
 *
 * Owns: The business logic for each command branch, expressed as pure-ish
 *       functions that take a minimal UI interface and state/config params.
 *       This separation makes the important command branches testable without
 *       requiring a full Pi runtime. Also owns the template repair/reset UX
 *       flow via ensureTemplateUsable().
 *
 * Does NOT own: Command registration (index.ts), state detection (repo.ts),
 *               plan generation (plangen.ts), archive lifecycle (archive.ts),
 *               config loading (config.ts), template mode classification
 *               (template-analysis.ts), template parsing (template-core.ts).
 *
 * Invariants:
 *   - All destructive actions go through ui.confirm before writing.
 *   - Cancellation at any point must leave files unchanged.
 *   - State logic is always delegated to repo.ts helpers.
 *   - index.md is reconciled before key flows.
 */

import type { PlanState } from "./repo.js";
import {
  initPlanning,
  hasCurrentPlan,
  writeCurrentPlan,
  CURRENT_PLAN_REL,
  TASK_PLAN_TEMPLATE_REL,
} from "./repo.js";
import { generatePlan, type PlanInput } from "./plangen.js";
import { analyzeTemplateFromDisk } from "./template-analysis.js";
import { TASK_PLAN_TEMPLATE } from "./defaults.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type PiPlanConfig, type ConfigLoadResult } from "./config.js";
import { extractPlanSummary, formatArchiveLabel } from "./summary.js";
import {
  readCurrentPlan,
  forceWriteCurrentPlan,
  archivePlan,
  listArchives,
  countArchives,
  readArchive,
  extractPlanTitle,
  updateIndex,
  reconcileIndex,
} from "./archive.js";
import { collectDiagnostics, writeDiagnosticLog } from "./diagnostics.js";

// ---------------------------------------------------------------------------
// Minimal UI interface (testable seam)
// ---------------------------------------------------------------------------

export interface PlanUI {
  notify(message: string, level: "info" | "warning" | "error" | "success"): void;
  confirm(title: string, message: string): Promise<boolean>;
  select(title: string, options: string[]): Promise<string | null>;
  input(title: string, placeholder: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// /plan handler
// ---------------------------------------------------------------------------

export async function handlePlan(state: PlanState, args: string, ui: PlanUI): Promise<void> {
  switch (state.status) {
    case "no-repo": {
      ui.notify(
        "No repository detected. /plan only works inside a git repository.",
        "error",
      );
      return;
    }

    case "not-initialized": {
      ui.notify(
        `Repository detected at ${state.repoRoot}, but planning is not initialized.`,
        "warning",
      );

      const init = await ui.confirm(
        "Initialize planning?",
        "Create the full .pi/ planning structure?\n" +
          "  .pi/PLANNING_PROTOCOL.md\n" +
          "  .pi/templates/task-plan.md\n" +
          "  .pi/plans/current.md\n" +
          "  .pi/plans/index.md",
      );
      if (!init) return;

      const created = initPlanning(state.repoRoot);

      if (created.length === 0) {
        ui.notify("All planning files already exist.", "info");
      } else {
        ui.notify(
          `Planning initialized. Created:\n${created.map((f) => `  ${f}`).join("\n")}`,
          "success",
        );
      }
      return;
    }

    case "initialized-no-plan": {
      const { config, warnings } = loadConfig(state.repoRoot);
      for (const w of warnings) ui.notify(`Config: ${w}`, "warning");

      // Reconcile index before proceeding
      reconcileIndex(state.repoRoot, { archiveDir: config.archiveDir });

      // Check template state and offer repair if needed
      await ensureTemplateUsable(state.repoRoot, ui);

      const goal = await resolveGoal(config, args, ui);
      if (!goal) {
        ui.notify("No goal provided. Plan creation cancelled.", "info");
        return;
      }

      const planText = generatePlan(buildPlanInput(goal, state.repoRoot, config));

      const confirmed = await ui.confirm(
        "Create plan?",
        `Write plan to ${CURRENT_PLAN_REL}?\n\n` +
          `Goal: ${goal.split("\n")[0]}`,
      );

      if (!confirmed) {
        ui.notify("Plan creation cancelled. current.md unchanged.", "info");
        return;
      }

      const written = writeCurrentPlan(state.repoRoot, planText);

      if (written) {
        ui.notify(
          `Plan created and saved to ${CURRENT_PLAN_REL}.\n` +
            `Edit the plan to fill in details, then start implementation.`,
          "success",
        );
      } else {
        ui.notify(
          "A meaningful current plan already exists. Write was not performed.",
          "warning",
        );
      }
      return;
    }

    case "initialized-has-plan": {
      const { config, warnings } = loadConfig(state.repoRoot);
      for (const w of warnings) ui.notify(`Config: ${w}`, "warning");

      // Reconcile index before proceeding
      reconcileIndex(state.repoRoot, { archiveDir: config.archiveDir });

      const action = await ui.select(
        "Active plan exists — what would you like to do?",
        [
          "Resume current plan",
          "Replace current plan",
          "Revisit archived plans",
          "Cancel",
        ],
      );

      if (!action || action === "Cancel") {
        ui.notify("Cancelled.", "info");
        return;
      }

      if (action === "Resume current plan") {
        return handleResume(state.repoRoot, config, ui);
      }

      if (action === "Replace current plan") {
        return handleReplace(state.repoRoot, args, config, ui);
      }

      if (action === "Revisit archived plans") {
        return handleRevisit(state.repoRoot, config, ui);
      }

      return;
    }
  }
}

// ---------------------------------------------------------------------------
// /plan-debug handler
// ---------------------------------------------------------------------------

export async function handlePlanDebug(
  repoRoot: string | null,
  cwd: string,
  ui: PlanUI,
): Promise<void> {
  if (!repoRoot) {
    ui.notify(
      "No repository detected. /plan-debug only works inside a git repository.",
      "error",
    );
    return;
  }

  const configResult = loadConfig(repoRoot);
  for (const w of configResult.warnings) ui.notify(`Config: ${w}`, "warning");

  // Reconcile index before collecting diagnostics
  reconcileIndex(repoRoot, { archiveDir: configResult.config.archiveDir });

  const snapshot = collectDiagnostics(repoRoot, cwd, configResult);
  const { relPath } = writeDiagnosticLog(repoRoot, snapshot, {
    debugLogDir: configResult.config.debugLogDir,
  });

  const summaries: Record<string, string> = {
    "not-initialized": "Repository detected, planning not initialized.",
    "initialized-no-plan": "Repository detected, planning initialized, no active plan.",
    "initialized-has-plan": "Repository detected, planning initialized, active plan present.",
  };
  const summary = summaries[snapshot.state] ?? snapshot.state;

  let message = `${summary}\nPlan debug log written to ${relPath}`;
  if (configResult.source === "file") {
    message += `\nConfig loaded from ${configResult.config.archiveDir !== ".pi/plans/archive" || configResult.config.debugLogDir !== ".pi/logs" ? "custom " : ""}${configResult.source}`;
  }

  ui.notify(message, "info");
}

// ---------------------------------------------------------------------------
// Template check & repair flow
// ---------------------------------------------------------------------------

/**
 * Ensure the template is usable before plan generation.
 *
 * - For `invalid` or `default-fallback` (missing file): offer to reset/restore
 *   the default template. Requires confirmation. Returns true if generation
 *   should proceed, false if the user cancelled.
 * - For `legacy-section-fallback`: show a brief notice (non-blocking).
 * - For `explicit-placeholders`: no action needed.
 */
async function ensureTemplateUsable(
  repoRoot: string,
  ui: PlanUI,
): Promise<boolean> {
  const analysis = analyzeTemplateFromDisk(repoRoot);

  if (analysis.mode === "explicit-placeholders") {
    // Healthy template — nothing to do
    return true;
  }

  if (analysis.mode === "legacy-section-fallback") {
    // Usable but without explicit placeholders — brief notice
    ui.notify(
      `Template uses legacy format (no {{GOAL}}/{{REPO_ROOT}} placeholders). ` +
        `Section-name fallback will handle Goal and Current State injection.`,
      "info",
    );
    return true;
  }

  // invalid or default-fallback — offer repair/reset
  const description = analysis.mode === "invalid"
    ? "Template file exists but has no valid sections."
    : "Template file is missing.";

  const shouldReset = await ui.confirm(
    "Restore default template?",
    `${description}\n` +
      `Built-in fallback sections will be used for plan generation.\n\n` +
      `Restore the default template to ${TASK_PLAN_TEMPLATE_REL}?`,
  );

  if (shouldReset) {
    const abs = join(repoRoot, TASK_PLAN_TEMPLATE_REL);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, TASK_PLAN_TEMPLATE, "utf-8");
    ui.notify(`Default template restored to ${TASK_PLAN_TEMPLATE_REL}.`, "success");
  }

  // Either way, proceed with generation (restored template or fallback)
  return true;
}

/**
 * Build PlanInput from goal, repoRoot, and config.
 * Passes through currentStateTemplate from config if set.
 */
function buildPlanInput(goal: string, repoRoot: string, config: PiPlanConfig, specPath?: string | null): PlanInput {
  return {
    goal,
    repoRoot,
    currentStateTemplate: config.currentStateTemplate ?? undefined,
    specPath: specPath ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Sub-flows
// ---------------------------------------------------------------------------

export async function resolveGoal(
  config: PiPlanConfig,
  args: string,
  ui: PlanUI,
): Promise<string | null> {
  if (config.allowInlineGoalArgs && args.trim().length > 0) {
    return args.trim();
  }

  const goal = await ui.input(
    "What do you want to build?",
    "Describe the task or goal for this plan",
  );

  if (!goal || goal.trim().length === 0) return null;
  return goal.trim();
}

async function handleResume(
  repoRoot: string,
  config: PiPlanConfig,
  ui: PlanUI,
): Promise<void> {
  const content = readCurrentPlan(repoRoot);
  const title = content ? extractPlanTitle(content) : "(unknown)";

  let message = `Current plan: ${title}\nPath: ${CURRENT_PLAN_REL}`;

  if (config.resumeShowSummary && content) {
    const summary = extractPlanSummary(content);
    message += `\n\n${summary}`;
  }

  const archiveCount = countArchives(repoRoot, { archiveDir: config.archiveDir });
  if (archiveCount > 0) {
    message += `\n\n${archiveCount} archived plan${archiveCount === 1 ? "" : "s"}.`;
  }

  message += "\n\nResuming — read the plan and continue implementation.";

  ui.notify(message, "info");
}

async function handleReplace(
  repoRoot: string,
  args: string,
  config: PiPlanConfig,
  ui: PlanUI,
): Promise<void> {
  // Check template state and offer repair if needed
  await ensureTemplateUsable(repoRoot, ui);

  let goal: string | null = null;

  if (config.allowInlineGoalArgs && args.trim().length > 0) {
    goal = args.trim();
  } else {
    goal = await ui.input(
      "What do you want to build?",
      "Describe the task or goal for the new plan",
    );
  }

  if (!goal || goal.trim().length === 0) {
    ui.notify("No goal provided. Cancelled.", "info");
    return;
  }

  const newPlanText = generatePlan(buildPlanInput(goal.trim(), repoRoot, config));

  const oldContent = readCurrentPlan(repoRoot);
  const oldTitle = oldContent ? extractPlanTitle(oldContent) : "(unknown)";

  const confirmed = await ui.confirm(
    "Replace current plan?",
    `Old plan "${oldTitle}" will be archived.\n` +
      `New plan: ${goal.trim().split("\n")[0]}\n\n` +
      `Write to ${CURRENT_PLAN_REL}?`,
  );

  if (!confirmed) {
    ui.notify("Cancelled. Current plan unchanged.", "info");
    return;
  }

  if (oldContent) {
    const archive = archivePlan(repoRoot, oldContent, new Date(), {
      archiveDir: config.archiveDir,
      archiveFilenameStyle: config.archiveFilenameStyle,
    });
    forceWriteCurrentPlan(repoRoot, newPlanText);
    updateIndex(repoRoot, { archiveDir: config.archiveDir });
    ui.notify(
      `Old plan archived to ${archive.relPath}\n` +
        `New plan written to ${CURRENT_PLAN_REL}`,
      "success",
    );
  } else {
    forceWriteCurrentPlan(repoRoot, newPlanText);
    updateIndex(repoRoot, { archiveDir: config.archiveDir });
    ui.notify(
      `New plan written to ${CURRENT_PLAN_REL}`,
      "success",
    );
  }
}

async function handleRevisit(
  repoRoot: string,
  config: PiPlanConfig,
  ui: PlanUI,
): Promise<void> {
  const archives = listArchives(repoRoot, {
    archiveDir: config.archiveDir,
    maxArchiveListEntries: config.maxArchiveListEntries,
  });

  if (archives.length === 0) {
    ui.notify("No archived plans found.", "info");
    return;
  }

  const totalCount = countArchives(repoRoot, { archiveDir: config.archiveDir });
  const options = archives.map((a) => formatArchiveLabel(a.label, a.filename));

  if (totalCount > archives.length) {
    options.push(`(${totalCount - archives.length} more not shown)`);
  }
  options.push("Cancel");

  const archiveChoice = await ui.select(
    `Archived plans (${totalCount} total) — select one to restore`,
    options,
  );

  if (!archiveChoice || archiveChoice === "Cancel" || archiveChoice.startsWith("(")) {
    ui.notify("Cancelled.", "info");
    return;
  }

  const selectedIdx = options.indexOf(archiveChoice);
  const selected = archives[selectedIdx];
  if (!selected) {
    ui.notify("Invalid selection.", "error");
    return;
  }

  const archiveContent = readArchive(repoRoot, selected.relPath);
  if (!archiveContent) {
    ui.notify(`Could not read archive: ${selected.relPath}`, "error");
    return;
  }

  const currentContent = readCurrentPlan(repoRoot);
  const currentTitle = currentContent ? extractPlanTitle(currentContent) : "(unknown)";

  const confirmRestore = await ui.confirm(
    "Restore archived plan?",
    `Restore: ${selected.label}\n` +
      `Current plan "${currentTitle}" will be archived first.\n\n` +
      `Write restored plan to ${CURRENT_PLAN_REL}?`,
  );

  if (!confirmRestore) {
    ui.notify("Cancelled. Current plan unchanged.", "info");
    return;
  }

  if (currentContent && hasCurrentPlan(repoRoot)) {
    archivePlan(repoRoot, currentContent, new Date(), {
      archiveDir: config.archiveDir,
      archiveFilenameStyle: config.archiveFilenameStyle,
    });
  }

  forceWriteCurrentPlan(repoRoot, archiveContent);
  updateIndex(repoRoot, { archiveDir: config.archiveDir });

  ui.notify(
    `Restored "${selected.label}" as current plan.\nPath: ${CURRENT_PLAN_REL}`,
    "success",
  );
}
