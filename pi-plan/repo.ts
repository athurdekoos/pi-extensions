/**
 * repo.ts — Repo detection, planning state model, initialization, and safe writes.
 *
 * Owns: Git repo root detection, the canonical planning state model (PlanState),
 *       file-existence checks, planning structure initialization, and the
 *       safe-write path for current.md (refuses to overwrite real plans).
 *
 * Does NOT own: Archive lifecycle, config loading, diagnostics collection,
 *               plan generation, or force-writes (those are in archive.ts).
 *
 * Invariants:
 *   - State detection (isFullyInitialized, hasCurrentPlan) is the single
 *     source of truth. Both /plan and /plan-debug must use these functions.
 *   - Placeholder detection uses CURRENT_PLAN_SENTINEL from defaults.ts.
 *   - initPlanning() never overwrites existing files.
 *   - writeCurrentPlan() refuses to write if a meaningful plan exists.
 *
 * Extend here: New state dimensions, new initialization files, new detection logic.
 * Do NOT extend here: Archive writes, config parsing, plan generation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  PLANNING_PROTOCOL,
  TASK_PLAN_TEMPLATE,
  CURRENT_PLAN_PLACEHOLDER,
  CURRENT_PLAN_SENTINEL,
  PLANS_INDEX,
} from "./defaults.js";

// ---------------------------------------------------------------------------
// Relative paths (exported for tests and display)
// ---------------------------------------------------------------------------

export const PLANNING_PROTOCOL_REL = ".pi/PLANNING_PROTOCOL.md";
export const TASK_PLAN_TEMPLATE_REL = ".pi/templates/task-plan.md";
export const CURRENT_PLAN_REL = ".pi/plans/current.md";
export const PLANS_INDEX_REL = ".pi/plans/index.md";
export const SPECS_DIR_REL = ".pi/specs";
export const TDD_DIR_REL = ".pi/tdd";
export const WORKTREE_STATE_DIR_REL = ".pi/worktrees";

// ---------------------------------------------------------------------------
// Command runner seam (for testability)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for executing a shell command.
 * Used by detectRepoRootWith / detectPlanStateWith so that tests can inject
 * a mock without requiring a full Pi runtime.
 */
export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{ code: number; stdout: string }>;

// ---------------------------------------------------------------------------
// Repo detection
// ---------------------------------------------------------------------------

/**
 * Detect the git repository root using an injected command runner.
 * Testable without Pi runtime.
 */
export async function detectRepoRootWith(exec: ExecFn): Promise<string | null> {
  const result = await exec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000 });
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

/**
 * Detect the git repository root from cwd.
 * Returns the absolute path, or null if not inside a repo.
 */
export async function detectRepoRoot(pi: ExtensionAPI): Promise<string | null> {
  return detectRepoRootWith((cmd, args, opts) => pi.exec(cmd, args, opts));
}

// ---------------------------------------------------------------------------
// File-level detection helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the planning protocol file exists at the repo root.
 */
export function hasPlanningProtocol(repoRoot: string): boolean {
  return existsSync(join(repoRoot, PLANNING_PROTOCOL_REL));
}

/**
 * Check whether the full planning structure is initialized.
 * Requires all four files to exist.
 */
export function isFullyInitialized(repoRoot: string): boolean {
  return (
    existsSync(join(repoRoot, PLANNING_PROTOCOL_REL)) &&
    existsSync(join(repoRoot, TASK_PLAN_TEMPLATE_REL)) &&
    existsSync(join(repoRoot, CURRENT_PLAN_REL)) &&
    existsSync(join(repoRoot, PLANS_INDEX_REL))
  );
}

/**
 * Determine whether current.md contains a real plan (not just the placeholder).
 *
 * Detection logic:
 * - If the file does not exist → false
 * - If the file content includes the sentinel string → false (placeholder)
 * - If the file is empty or whitespace-only → false
 * - Otherwise → true (real plan content)
 */
export function hasCurrentPlan(repoRoot: string): boolean {
  const filePath = join(repoRoot, CURRENT_PLAN_REL);
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, "utf-8");
  const trimmed = content.trim();

  if (trimmed.length === 0) return false;
  if (trimmed.includes(CURRENT_PLAN_SENTINEL)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Composite state
// ---------------------------------------------------------------------------

export type PlanState =
  | { status: "no-repo" }
  | { status: "not-initialized"; repoRoot: string }
  | { status: "initialized-no-plan"; repoRoot: string }
  | { status: "initialized-has-plan"; repoRoot: string };

/**
 * Detect the composite plan state using an injected command runner.
 * Testable without Pi runtime.
 */
export async function detectPlanStateWith(exec: ExecFn): Promise<PlanState> {
  const repoRoot = await detectRepoRootWith(exec);
  if (!repoRoot) return { status: "no-repo" };
  if (!isFullyInitialized(repoRoot)) return { status: "not-initialized", repoRoot };
  if (!hasCurrentPlan(repoRoot)) return { status: "initialized-no-plan", repoRoot };
  return { status: "initialized-has-plan", repoRoot };
}

export async function detectPlanState(pi: ExtensionAPI): Promise<PlanState> {
  return detectPlanStateWith((cmd, args, opts) => pi.exec(cmd, args, opts));
}

// ---------------------------------------------------------------------------
// Initialization — writes the full planning structure
// ---------------------------------------------------------------------------

interface FileSpec {
  rel: string;
  content: string;
}

const INIT_FILES: FileSpec[] = [
  { rel: PLANNING_PROTOCOL_REL, content: PLANNING_PROTOCOL },
  { rel: TASK_PLAN_TEMPLATE_REL, content: TASK_PLAN_TEMPLATE },
  { rel: CURRENT_PLAN_REL, content: CURRENT_PLAN_PLACEHOLDER },
  { rel: PLANS_INDEX_REL, content: PLANS_INDEX },
];

// ---------------------------------------------------------------------------
// Current plan writing
// ---------------------------------------------------------------------------

/**
 * Write content to current.md, but only if there is no meaningful current plan.
 *
 * Returns true if the write succeeded, false if a meaningful plan already exists.
 * This is the safe write path for Phase 2 — it refuses to overwrite real plans.
 */
export function writeCurrentPlan(repoRoot: string, content: string): boolean {
  if (hasCurrentPlan(repoRoot)) return false;

  const abs = join(repoRoot, CURRENT_PLAN_REL);
  const dir = dirname(abs);
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Review records — append-only under .pi/plans/reviews/
// ---------------------------------------------------------------------------

export const REVIEWS_DIR_REL = ".pi/plans/reviews";

export interface ReviewRecord {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Whether the plan was approved */
  approved: boolean;
  /** Optional reviewer feedback */
  feedback?: string;
  /** Plan title at time of review */
  planTitle?: string;
}

/**
 * Write a review record to .pi/plans/reviews/.
 *
 * Review records are append-only JSON files named by timestamp.
 * Returns the relative path of the written record.
 */
export function writeReviewRecord(
  repoRoot: string,
  record: ReviewRecord,
  reviewDirRel: string = REVIEWS_DIR_REL,
): string {
  const reviewDir = join(repoRoot, reviewDirRel);
  mkdirSync(reviewDir, { recursive: true });

  const ts = record.timestamp.replace(/[:.]/g, "-");
  let filename = `review-${ts}.json`;
  let abs = join(reviewDir, filename);

  // Handle collisions
  let counter = 1;
  while (existsSync(abs)) {
    filename = `review-${ts}-${counter}.json`;
    abs = join(reviewDir, filename);
    counter++;
  }

  writeFileSync(abs, JSON.stringify(record, null, 2), "utf-8");
  return `${reviewDirRel}/${filename}`;
}

/**
 * List all review records, sorted newest-first.
 */
export function listReviewRecords(
  repoRoot: string,
  reviewDirRel: string = REVIEWS_DIR_REL,
): ReviewRecord[] {
  const reviewDir = join(repoRoot, reviewDirRel);
  if (!existsSync(reviewDir)) return [];

  const files = readdirSync(reviewDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const records: ReviewRecord[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(reviewDir, file), "utf-8");
      records.push(JSON.parse(content) as ReviewRecord);
    } catch {
      // Skip malformed records
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Migration — legacy plannotator PLAN.md at repo root
// ---------------------------------------------------------------------------

/**
 * Check if a legacy PLAN.md exists at the repo root (plannotator's old layout).
 */
export function hasLegacyPlanFile(repoRoot: string): boolean {
  return existsSync(join(repoRoot, "PLAN.md"));
}

/**
 * Migrate a legacy PLAN.md to .pi/plans/current.md.
 *
 * Reads PLAN.md from the repo root, writes its content to current.md
 * (only if current.md does not already contain a real plan), and returns
 * the content. Does NOT delete PLAN.md — the caller decides cleanup.
 *
 * Returns the migrated content, or null if migration was skipped
 * (no PLAN.md, empty PLAN.md, or current.md already has a real plan).
 */
export function migrateLegacyPlan(repoRoot: string): string | null {
  const legacyPath = join(repoRoot, "PLAN.md");
  if (!existsSync(legacyPath)) return null;

  const content = readFileSync(legacyPath, "utf-8").trim();
  if (content.length === 0) return null;

  // Don't overwrite a real current plan
  if (hasCurrentPlan(repoRoot)) return null;

  const abs = join(repoRoot, CURRENT_PLAN_REL);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf-8");
  return content;
}

// ---------------------------------------------------------------------------
// Initialization — writes the full planning structure
// ---------------------------------------------------------------------------

/**
 * Create the full planning structure under the given repo root.
 * Skips files that already exist (does not overwrite).
 * Returns the list of files that were actually created.
 */
export function initPlanning(repoRoot: string): string[] {
  const created: string[] = [];

  for (const file of INIT_FILES) {
    const abs = join(repoRoot, file.rel);
    if (existsSync(abs)) continue;

    // Ensure parent directory exists
    const dir = dirname(abs);
    mkdirSync(dir, { recursive: true });

    writeFileSync(abs, file.content, "utf-8");
    created.push(file.rel);
  }

  return created;
}
