/**
 * finish.ts — Deterministic branch finishing workflow.
 *
 * Owns: All finishing logic as pure functions with ExecFn seam.
 *       Finish actions: merge locally, create PR, keep branch, discard.
 *       PR body generation from plan content.
 *
 * Does NOT own: Pi API calls, state machine, plan archival (delegates to caller),
 *               config loading, UI rendering.
 *
 * Invariants:
 *   - All functions take ExecFn — testable without Pi runtime.
 *   - No Pi API calls. No file writes except state cleanup.
 *   - executeFinishing returns null if user cancels.
 */

import type { ExecFn } from "./repo.js";
import { readCurrentPlan, archivePlan, forceWriteCurrentPlan, updateIndex } from "./archive.js";
import { loadConfig, type PiPlanConfig } from "./config.js";
import { CURRENT_PLAN_PLACEHOLDER } from "./defaults.js";
import { cleanupWorktree } from "./worktree.js";
import { extractPlanTitle } from "./archive.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FinishAction = "merge" | "pr" | "keep" | "discard";

export interface FinishResult {
  success: boolean;
  action: FinishAction;
  message: string;
  prUrl?: string;
  error?: string;
}

export interface FinishContext {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  stateDir: string;
}

export interface FinishUI {
  notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
  confirm: (title: string, message: string) => Promise<boolean>;
  select: (title: string, options: string[]) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Detect the base branch (e.g. "main" or "master") from the remote HEAD.
 * Falls back to "main" if detection fails.
 */
export async function detectBaseBranch(
  repoRoot: string,
  exec: ExecFn,
): Promise<string> {
  const result = await exec(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    { timeout: 5000 },
  );
  if (result.code === 0) {
    // Output like "refs/remotes/origin/main"
    const ref = result.stdout.trim();
    const parts = ref.split("/");
    return parts[parts.length - 1] || "main";
  }
  return "main";
}

/**
 * Check whether the `gh` CLI is available.
 */
export async function isGhAvailable(exec: ExecFn): Promise<boolean> {
  const result = await exec("gh", ["--version"], { timeout: 5000 });
  return result.code === 0;
}

// ---------------------------------------------------------------------------
// Menu building
// ---------------------------------------------------------------------------

const LABEL_MERGE = "Merge into base branch locally";
const LABEL_PR = "Create pull request";
const LABEL_KEEP = "Keep branch (remove worktree only)";
const LABEL_DISCARD = "Discard branch and worktree";
const LABEL_CANCEL = "Cancel";

/**
 * Build the select menu options. Omits PR option if gh is unavailable.
 */
export function buildFinishOptions(ghAvailable: boolean): string[] {
  const options = [LABEL_MERGE];
  if (ghAvailable) {
    options.push(LABEL_PR);
  }
  options.push(LABEL_KEEP, LABEL_DISCARD, LABEL_CANCEL);
  return options;
}

/**
 * Map a menu label string to a FinishAction, or null for Cancel/unknown.
 */
export function mapSelectionToAction(choice: string | null): FinishAction | null {
  switch (choice) {
    case LABEL_MERGE:
      return "merge";
    case LABEL_PR:
      return "pr";
    case LABEL_KEEP:
      return "keep";
    case LABEL_DISCARD:
      return "discard";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

/**
 * Merge the plan branch into the base branch locally using --no-ff.
 * On conflict: aborts merge, returns error.
 */
export async function mergeLocally(
  ctx: FinishContext,
  exec: ExecFn,
): Promise<FinishResult> {
  // Checkout base branch
  const checkout = await exec("git", ["checkout", ctx.baseBranch], { timeout: 15000 });
  if (checkout.code !== 0) {
    return {
      success: false,
      action: "merge",
      message: `Failed to checkout ${ctx.baseBranch}`,
      error: checkout.stdout,
    };
  }

  // Merge with --no-ff
  const merge = await exec(
    "git",
    ["merge", ctx.branch, "--no-ff", "-m", `Merge ${ctx.branch} (pi-plan)`],
    { timeout: 30000 },
  );

  if (merge.code !== 0) {
    // Abort the failed merge
    await exec("git", ["merge", "--abort"], { timeout: 5000 });
    return {
      success: false,
      action: "merge",
      message: "Merge conflict — merge aborted. Resolve manually or choose a different option.",
      error: merge.stdout,
    };
  }

  // Cleanup worktree and branch
  const cleanup = await cleanupWorktree(ctx.repoRoot, ctx.stateDir, exec);
  if (!cleanup.success) {
    return {
      success: true,
      action: "merge",
      message: `Merged successfully, but worktree cleanup failed: ${cleanup.error}`,
    };
  }

  return {
    success: true,
    action: "merge",
    message: `Merged ${ctx.branch} into ${ctx.baseBranch}.`,
  };
}

/**
 * Generate PR title and body from plan content.
 * Supports template substitution with {{BRANCH}} and {{PLAN_TITLE}}.
 */
export function generatePrBody(
  planContent: string,
  branch: string,
  prTemplate?: string | null,
): { title: string; body: string } {
  const planTitle = extractPlanTitle(planContent);
  const title = planTitle === "(untitled)" ? `Plan: ${branch}` : planTitle;

  if (prTemplate) {
    const body = prTemplate
      .replace(/\{\{BRANCH\}\}/g, branch)
      .replace(/\{\{PLAN_TITLE\}\}/g, planTitle);
    return { title, body };
  }

  // Build default body from plan content
  const lines = planContent.split("\n");
  const bodyParts: string[] = [];

  // Extract goal section
  let inGoal = false;
  for (const line of lines) {
    if (/^##\s+Goal/.test(line)) {
      inGoal = true;
      continue;
    }
    if (inGoal && /^##\s/.test(line)) break;
    if (inGoal) {
      const trimmed = line.trim();
      if (trimmed.length > 0) bodyParts.push(trimmed);
    }
  }

  // Extract completed steps
  const stepLines: string[] = [];
  let inSteps = false;
  for (const line of lines) {
    if (/^##\s+Implementation\s+Plan/.test(line)) {
      inSteps = true;
      continue;
    }
    if (inSteps && /^##\s/.test(line)) break;
    if (inSteps) {
      const match = line.match(/^\d+\.\s+(.+)/);
      if (match) stepLines.push(`- [x] ${match[1]}`);
    }
  }

  let body = `## Summary\n\n`;
  if (bodyParts.length > 0) {
    body += bodyParts.join("\n") + "\n\n";
  }
  if (stepLines.length > 0) {
    body += `## Completed Steps\n\n${stepLines.join("\n")}\n\n`;
  }
  body += `---\nBranch: \`${branch}\``;

  return { title, body };
}

/**
 * Push branch and create a PR via `gh pr create`.
 * Returns the PR URL on success.
 */
export async function createPullRequest(
  ctx: FinishContext,
  prTitle: string,
  prBody: string,
  exec: ExecFn,
): Promise<FinishResult> {
  // Push the branch
  const push = await exec(
    "git",
    ["push", "-u", "origin", ctx.branch],
    { timeout: 30000 },
  );
  if (push.code !== 0) {
    return {
      success: false,
      action: "pr",
      message: "Failed to push branch to remote.",
      error: push.stdout,
    };
  }

  // Create PR
  const pr = await exec(
    "gh",
    [
      "pr", "create",
      "--base", ctx.baseBranch,
      "--head", ctx.branch,
      "--title", prTitle,
      "--body", prBody,
    ],
    { timeout: 30000 },
  );

  if (pr.code !== 0) {
    return {
      success: false,
      action: "pr",
      message: "Failed to create pull request.",
      error: pr.stdout,
    };
  }

  const prUrl = pr.stdout.trim();

  // Cleanup worktree only (keep branch since PR is open)
  await cleanupWorktree(ctx.repoRoot, ctx.stateDir, exec, { deleteBranch: false });

  return {
    success: true,
    action: "pr",
    message: `Pull request created: ${prUrl}`,
    prUrl,
  };
}

/**
 * Remove the worktree but keep the branch.
 */
export async function keepBranch(
  ctx: FinishContext,
  exec: ExecFn,
): Promise<FinishResult> {
  const cleanup = await cleanupWorktree(ctx.repoRoot, ctx.stateDir, exec, { deleteBranch: false });
  if (!cleanup.success) {
    return {
      success: false,
      action: "keep",
      message: "Failed to remove worktree.",
      error: cleanup.error,
    };
  }

  return {
    success: true,
    action: "keep",
    message: `Worktree removed. Branch ${ctx.branch} kept.`,
  };
}

/**
 * Discard both worktree and branch.
 */
export async function discardBranch(
  ctx: FinishContext,
  exec: ExecFn,
): Promise<FinishResult> {
  const cleanup = await cleanupWorktree(ctx.repoRoot, ctx.stateDir, exec, { deleteBranch: true });
  if (!cleanup.success) {
    return {
      success: false,
      action: "discard",
      message: "Failed to discard branch.",
      error: cleanup.error,
    };
  }

  return {
    success: true,
    action: "discard",
    message: `Branch ${ctx.branch} and worktree discarded.`,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full finishing workflow.
 *
 * 1. Detect gh availability
 * 2. Build menu options
 * 3. Show select (or use defaultFinishAction)
 * 4. Auto-archive the plan before any action
 * 5. Dispatch to the selected action
 *
 * Returns the FinishResult, or null if user cancels.
 */
export async function executeFinishing(
  ctx: FinishContext,
  exec: ExecFn,
  ui: FinishUI,
  config: PiPlanConfig,
  planContent: string,
): Promise<FinishResult | null> {
  let action: FinishAction | null = null;

  if (config.defaultFinishAction) {
    // Use configured default, but confirm first
    const confirmed = await ui.confirm(
      "Finish plan",
      `Default action: ${config.defaultFinishAction}. Proceed?`,
    );
    if (confirmed) {
      action = config.defaultFinishAction;
    }
  }

  if (!action) {
    const ghAvailable = await isGhAvailable(exec);
    const options = buildFinishOptions(ghAvailable);
    const choice = await ui.select("Plan complete — what would you like to do with the branch?", options);
    action = mapSelectionToAction(choice);
  }

  if (!action) return null;

  // Auto-archive the plan before any finishing action
  const loadedConfig = loadConfig(ctx.repoRoot);
  archivePlan(ctx.repoRoot, planContent, new Date(), {
    archiveDir: loadedConfig.config.archiveDir,
    archiveFilenameStyle: loadedConfig.config.archiveFilenameStyle,
  });
  forceWriteCurrentPlan(ctx.repoRoot, CURRENT_PLAN_PLACEHOLDER);
  updateIndex(ctx.repoRoot, { archiveDir: loadedConfig.config.archiveDir });

  // For PR action, generate title+body and confirm
  if (action === "pr") {
    const { title: prTitle, body: prBody } = generatePrBody(
      planContent,
      ctx.branch,
      config.prTemplate,
    );
    const confirmed = await ui.confirm(
      `Create PR: "${prTitle}"?`,
      "Push branch and create a pull request?",
    );
    if (!confirmed) return null;
    return createPullRequest(ctx, prTitle, prBody, exec);
  }

  switch (action) {
    case "merge":
      return mergeLocally(ctx, exec);
    case "keep":
      return keepBranch(ctx, exec);
    case "discard":
      return discardBranch(ctx, exec);
  }
}
