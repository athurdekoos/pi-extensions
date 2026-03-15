/**
 * worktree.ts — Git worktree isolation module.
 *
 * Owns: Worktree creation/cleanup, gitignore verification, setup auto-detection,
 *       state file I/O, branch derivation.
 * Does NOT own: Pi API calls, state machine, plan archival.
 *
 * Uses ExecFn seam from repo.ts for testability.
 *
 * Invariants:
 *   - Worktrees are created under .worktrees/ at the repo root.
 *   - Branch names follow the pattern plan/<slug>.
 *   - State is persisted as JSON under .pi/worktrees/active.json.
 *   - Cleanup removes the worktree and optionally deletes the branch (default: delete).
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecFn } from "./repo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name, e.g. "plan/auth-flow" */
  branch: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Plan title that triggered worktree creation */
  planTitle: string;
}

// ---------------------------------------------------------------------------
// Branch derivation
// ---------------------------------------------------------------------------

/**
 * Derive a worktree branch name from a plan title.
 * Format: plan/<slug> where slug is lowercase alphanumeric + hyphens, max 40 chars.
 */
export function deriveWorktreeBranch(planTitle: string): string {
  const slug = planTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

  return `plan/${slug.length > 0 ? slug : "work"}`;
}

// ---------------------------------------------------------------------------
// Gitignore check
// ---------------------------------------------------------------------------

/**
 * Check whether .worktrees/ is ignored by git.
 */
export async function isWorktreeDirIgnored(
  repoRoot: string,
  exec: ExecFn,
): Promise<boolean> {
  const result = await exec("git", ["check-ignore", "-q", ".worktrees"], {
    timeout: 5000,
  });
  return result.code === 0;
}

/**
 * Add .worktrees/ to .gitignore if not already present.
 */
export function addWorktreeDirToGitignore(repoRoot: string): void {
  const gitignorePath = join(repoRoot, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (content.includes(".worktrees")) return;
    appendFileSync(gitignorePath, "\n# Git worktrees for pi-plan\n.worktrees/\n", "utf-8");
  } else {
    writeFileSync(gitignorePath, "# Git worktrees for pi-plan\n.worktrees/\n", "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Setup auto-detection
// ---------------------------------------------------------------------------

/**
 * Detect setup commands needed for a worktree based on files present.
 * Returns an array of commands to run (e.g., ["npm install"]).
 */
export function detectSetupCommands(worktreePath: string): string[] {
  const commands: string[] = [];

  if (existsSync(join(worktreePath, "package-lock.json"))) {
    commands.push("npm ci");
  } else if (existsSync(join(worktreePath, "package.json"))) {
    commands.push("npm install");
  }

  if (existsSync(join(worktreePath, "yarn.lock"))) {
    commands.push("yarn install");
  }

  if (existsSync(join(worktreePath, "pnpm-lock.yaml"))) {
    commands.push("pnpm install");
  }

  if (existsSync(join(worktreePath, "Gemfile"))) {
    commands.push("bundle install");
  }

  if (existsSync(join(worktreePath, "requirements.txt"))) {
    commands.push("pip install -r requirements.txt");
  }

  if (existsSync(join(worktreePath, "go.mod"))) {
    commands.push("go mod download");
  }

  return commands;
}

// ---------------------------------------------------------------------------
// State file I/O
// ---------------------------------------------------------------------------

/**
 * Write worktree state to .pi/worktrees/active.json.
 */
export function writeWorktreeState(
  repoRoot: string,
  info: WorktreeInfo,
  stateDir: string,
): void {
  const dir = join(repoRoot, stateDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "active.json"), JSON.stringify(info, null, 2), "utf-8");
}

/**
 * Read worktree state from .pi/worktrees/active.json.
 * Returns null if no state file exists or it's malformed.
 */
export function readWorktreeState(
  repoRoot: string,
  stateDir: string,
): WorktreeInfo | null {
  const abs = join(repoRoot, stateDir, "active.json");
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, "utf-8")) as WorktreeInfo;
  } catch {
    return null;
  }
}

/**
 * Remove the worktree state file.
 */
function clearWorktreeState(repoRoot: string, stateDir: string): void {
  const abs = join(repoRoot, stateDir, "active.json");
  if (existsSync(abs)) {
    rmSync(abs);
  }
}

// ---------------------------------------------------------------------------
// Worktree creation
// ---------------------------------------------------------------------------

/**
 * Create a git worktree for plan execution.
 *
 * Steps:
 *   1. Create .worktrees/ directory at repo root
 *   2. Check/add .worktrees/ to .gitignore
 *   3. Derive branch name from plan title
 *   4. Run `git worktree add .worktrees/<slug> -b plan/<slug>`
 *   5. Write state to .pi/worktrees/active.json
 */
export async function createWorktreeForPlan(
  repoRoot: string,
  planTitle: string,
  exec: ExecFn,
): Promise<{ success: boolean; info?: WorktreeInfo; error?: string }> {
  const branch = deriveWorktreeBranch(planTitle);
  const slug = branch.replace("plan/", "");
  const worktreesDir = join(repoRoot, ".worktrees");
  const worktreePath = join(worktreesDir, slug);

  // Create .worktrees/ directory
  mkdirSync(worktreesDir, { recursive: true });

  // Ensure .worktrees/ is gitignored
  const ignored = await isWorktreeDirIgnored(repoRoot, exec);
  if (!ignored) {
    addWorktreeDirToGitignore(repoRoot);
  }

  // Check if worktree path already exists
  if (existsSync(worktreePath)) {
    return {
      success: false,
      error: `Worktree directory already exists: ${worktreePath}`,
    };
  }

  // Create the worktree
  const result = await exec(
    "git",
    ["worktree", "add", worktreePath, "-b", branch],
    { timeout: 30000 },
  );

  if (result.code !== 0) {
    // Branch may already exist, try without -b
    const retryResult = await exec(
      "git",
      ["worktree", "add", worktreePath, branch],
      { timeout: 30000 },
    );

    if (retryResult.code !== 0) {
      return {
        success: false,
        error: `Failed to create worktree: ${retryResult.stdout}`,
      };
    }
  }

  const info: WorktreeInfo = {
    path: worktreePath,
    branch,
    createdAt: new Date().toISOString(),
    planTitle,
  };

  return { success: true, info };
}

// ---------------------------------------------------------------------------
// Worktree cleanup
// ---------------------------------------------------------------------------

/**
 * Remove the active worktree and clean up state.
 *
 * Steps:
 *   1. Read state to find worktree path
 *   2. Run `git worktree remove <path>`
 *   3. Optionally delete the branch
 *   4. Clear state file
 */
export async function cleanupWorktree(
  repoRoot: string,
  stateDir: string,
  exec: ExecFn,
  opts?: { deleteBranch?: boolean },
): Promise<{ success: boolean; error?: string }> {
  const state = readWorktreeState(repoRoot, stateDir);
  if (!state) {
    return { success: true }; // Nothing to clean up
  }

  // Remove the worktree
  if (existsSync(state.path)) {
    const result = await exec(
      "git",
      ["worktree", "remove", state.path, "--force"],
      { timeout: 15000 },
    );

    if (result.code !== 0) {
      return {
        success: false,
        error: `Failed to remove worktree: ${result.stdout}`,
      };
    }
  }

  // Delete the branch (best-effort, unless opted out)
  if (opts?.deleteBranch !== false) {
    await exec("git", ["branch", "-D", state.branch], { timeout: 5000 });
  }

  // Clear state
  clearWorktreeState(repoRoot, stateDir);

  return { success: true };
}
