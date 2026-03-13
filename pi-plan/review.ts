/**
 * review.ts — Review orchestration for browser-based plan review,
 *             code review, and markdown annotation.
 *
 * Owns: Coordinating the browser review lifecycle — reading plan content,
 *       finding the previous archive for diff, starting servers, opening
 *       the browser, waiting for decisions, writing review records.
 *
 * Does NOT own: Server implementation (server.ts), browser launching
 *               (browser.ts), plan file I/O (repo.ts / archive.ts),
 *               state machine transitions (auto-plan.ts), Pi API calls
 *               (index.ts).
 *
 * Invariants:
 *   - Review records are append-only under .pi/plans/reviews/.
 *   - Previous plan for diff comes from the archive layer, never from
 *     home-directory state.
 *   - No auto-approve: if browser UI is unavailable, return an error.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PiPlanConfig } from "./config.js";
import { readCurrentPlan, listArchives, readArchive, extractPlanTitle } from "./archive.js";
import { writeReviewRecord } from "./repo.js";
import {
  startPlanReviewServer,
  startReviewServer,
  startAnnotateServer,
  getGitContext,
  runGitDiff,
} from "./server.js";
import { openBrowser } from "./browser.js";

// ---------------------------------------------------------------------------
// HTML asset loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

let planHtmlContent = "";
let reviewHtmlContent = "";

try {
  planHtmlContent = readFileSync(resolve(__dirname, "assets/plan-review.html"), "utf-8");
} catch {
  // Assets not built — browser features will be unavailable
}

try {
  reviewHtmlContent = readFileSync(resolve(__dirname, "assets/review-editor.html"), "utf-8");
} catch {
  // Assets not built — review feature will be unavailable
}

/** Check if plan review HTML is available. */
export function hasPlanReviewUI(): boolean {
  return planHtmlContent.length > 0;
}

/** Check if code review HTML is available. */
export function hasCodeReviewUI(): boolean {
  return reviewHtmlContent.length > 0;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewResult {
  approved: boolean;
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Plan review orchestration
// ---------------------------------------------------------------------------

/**
 * Submit the current plan for browser-based review.
 *
 * Reads current.md, finds the most recent archive for diff display,
 * starts the plan review server, opens the browser, waits for the
 * user's decision, and writes a review record.
 *
 * Returns the user's decision (approved/denied + optional feedback).
 *
 * Throws if HTML assets are unavailable (no auto-approve).
 */
export async function handlePlanSubmission(
  repoRoot: string,
  config: PiPlanConfig,
  _ctx: ExtensionContext,
): Promise<ReviewResult> {
  if (!hasPlanReviewUI()) {
    throw new Error(
      "Plan review UI not available. Ensure assets/plan-review.html exists.",
    );
  }

  // Read current plan
  const planContent = readCurrentPlan(repoRoot);
  if (!planContent || planContent.trim().length === 0) {
    throw new Error("No plan content in current.md. Write a plan first.");
  }

  // Find the most recent archive for diff
  const archives = listArchives(repoRoot, {
    archiveDir: config.archiveDir,
    maxArchiveListEntries: 1,
  });
  const previousPlan = archives.length > 0
    ? readArchive(repoRoot, archives[0].relPath)
    : null;

  // Start the review server
  const server = startPlanReviewServer({
    plan: planContent,
    previousPlan,
    htmlContent: planHtmlContent,
    origin: "pi",
  });

  // Open browser
  openBrowser(server.url);

  // Wait for user decision
  const result = await server.waitForDecision();

  // Brief delay for browser to process, then stop server
  await new Promise((r) => setTimeout(r, 1500));
  server.stop();

  // Write review record
  const planTitle = extractPlanTitle(planContent);
  writeReviewRecord(repoRoot, {
    timestamp: new Date().toISOString(),
    approved: result.approved,
    feedback: result.feedback,
    planTitle,
  }, config.reviewDir);

  return result;
}

// ---------------------------------------------------------------------------
// Code review orchestration
// ---------------------------------------------------------------------------

/**
 * Open the code review UI for current git changes.
 *
 * Gets the git diff, starts the review server, opens the browser,
 * and returns the user's feedback.
 *
 * Throws if HTML assets are unavailable.
 */
export async function handleCodeReview(
  _ctx: ExtensionContext,
): Promise<{ feedback: string }> {
  if (!hasCodeReviewUI()) {
    throw new Error(
      "Code review UI not available. Ensure assets/review-editor.html exists.",
    );
  }

  const gitCtx = getGitContext();
  const { patch: rawPatch, label: gitRef } = runGitDiff("uncommitted", gitCtx.defaultBranch);

  const server = startReviewServer({
    rawPatch,
    gitRef,
    origin: "pi",
    diffType: "uncommitted",
    gitContext: gitCtx,
    htmlContent: reviewHtmlContent,
  });

  openBrowser(server.url);

  const result = await server.waitForDecision();
  await new Promise((r) => setTimeout(r, 1500));
  server.stop();

  return result;
}

// ---------------------------------------------------------------------------
// Markdown annotation orchestration
// ---------------------------------------------------------------------------

/**
 * Open a markdown file in the annotation UI.
 *
 * Reads the file, starts the annotate server, opens the browser,
 * and returns the user's feedback.
 *
 * Throws if HTML assets are unavailable or the file doesn't exist.
 */
export async function handleAnnotation(
  filePath: string,
  _ctx: ExtensionContext,
): Promise<{ feedback: string }> {
  if (!hasPlanReviewUI()) {
    throw new Error(
      "Annotation UI not available. Ensure assets/plan-review.html exists.",
    );
  }

  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const markdown = readFileSync(absolutePath, "utf-8");

  const server = startAnnotateServer({
    markdown,
    filePath: absolutePath,
    origin: "pi",
    htmlContent: planHtmlContent,
  });

  openBrowser(server.url);

  const result = await server.waitForDecision();
  await new Promise((r) => setTimeout(r, 1500));
  server.stop();

  return result;
}
