/**
 * archive.ts — Archive lifecycle, title extraction, index regeneration.
 *
 * Owns: Writing archives, listing/counting/reading archives, extracting
 *       plan titles, generating slugs, archive filename logic, collision
 *       handling, forceWriteCurrentPlan(), and updateIndex().
 *
 * Does NOT own: State detection (repo.ts), placeholder logic (defaults.ts),
 *               plan generation (plangen.ts), config loading (config.ts),
 *               or summary extraction for UX (summary.ts).
 *
 * Invariants:
 *   - Archives are immutable once written. This module never modifies or
 *     deletes existing archive files.
 *   - Archive filenames are sortable by string comparison (date prefix).
 *   - updateIndex() fully regenerates index.md — never patches it.
 *   - forceWriteCurrentPlan() writes unconditionally. Callers are responsible
 *     for archiving the old plan first.
 *
 * Extend here: Archive search/filtering, richer metadata, archive pruning
 *              (if ever needed — would require relaxing the immutability invariant).
 * Do NOT extend here: State detection, placeholder logic, plan generation.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { CURRENT_PLAN_REL, PLANS_INDEX_REL, isFullyInitialized } from "./repo.js";

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Check that `abs` is contained within `repoRoot`.
 * Prevents path traversal via `..` segments in relative paths.
 */
function isContainedIn(abs: string, repoRoot: string): boolean {
  const resolvedRoot = resolve(repoRoot);
  const resolvedAbs = resolve(abs);
  return resolvedAbs === resolvedRoot || resolvedAbs.startsWith(resolvedRoot + "/");
}
import type { PiPlanConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";

// ---------------------------------------------------------------------------
// Constants (default, kept for backward compatibility)
// ---------------------------------------------------------------------------

export const ARCHIVE_DIR_REL = ".pi/plans/archive";

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

/**
 * Extract a display title from plan markdown content.
 *
 * Priority:
 * 1. First `# Plan: <title>` or `# <title>` heading
 * 2. First line of ## Goal section
 * 3. Fallback to "(untitled)"
 */
export function extractPlanTitle(content: string): string {
  const lines = content.split("\n");

  // Try first H1
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(?:Plan:\s*)?(.+)/);
    if (h1Match) {
      const title = h1Match[1].trim();
      if (title.length > 0) return title;
    }
  }

  // Try first line after ## Goal
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Goal/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("_")) {
          return trimmed.length > 80 ? trimmed.slice(0, 79) + "…" : trimmed;
        }
      }
    }
  }

  return "(untitled)";
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

/**
 * Derive a short filesystem-safe slug from a plan title.
 * Lowercase, alphanumeric + hyphens, max 40 chars.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

  return slug.length > 0 ? slug : "plan";
}

// ---------------------------------------------------------------------------
// Archive filename generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic, sortable archive filename.
 *
 * Styles:
 * - "date-slug": YYYY-MM-DD-HHMM-<slug>.md (default)
 * - "date-only": YYYY-MM-DD-HHMM.md
 */
export function archiveFilename(
  date: Date,
  title: string,
  style: "date-slug" | "date-only" = "date-slug",
): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const prefix = `${y}-${mo}-${d}-${h}${mi}`;

  if (style === "date-only") {
    return `${prefix}.md`;
  }

  const slug = slugify(title);
  return `${prefix}-${slug}.md`;
}

// ---------------------------------------------------------------------------
// Archive entry type
// ---------------------------------------------------------------------------

export interface ArchiveEntry {
  /** Relative path from repo root, e.g. ".pi/plans/archive/2026-03-11-1730-auth.md" */
  relPath: string;
  /** Just the filename */
  filename: string;
  /** Display label extracted from content or filename fallback */
  label: string;
}

// ---------------------------------------------------------------------------
// Read current plan
// ---------------------------------------------------------------------------

/**
 * Read the current plan content. Returns null if file doesn't exist.
 */
export function readCurrentPlan(repoRoot: string): string | null {
  const abs = join(repoRoot, CURRENT_PLAN_REL);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf-8");
}

// ---------------------------------------------------------------------------
// Force-write current plan (for replace / restore)
// ---------------------------------------------------------------------------

/**
 * Write content to current.md unconditionally (no placeholder check).
 * Used by replace and restore flows after the caller has already archived.
 */
export function forceWriteCurrentPlan(repoRoot: string, content: string): void {
  const abs = join(repoRoot, CURRENT_PLAN_REL);
  if (!isContainedIn(abs, repoRoot)) {
    throw new Error(`Path escapes repository root: ${CURRENT_PLAN_REL}`);
  }
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Archive a plan
// ---------------------------------------------------------------------------

export interface ArchiveResult {
  relPath: string;
  filename: string;
}

/**
 * Write plan content to the archive directory.
 *
 * - Creates the archive directory if it does not exist
 * - Uses a deterministic timestamped filename
 * - Handles collisions by appending a counter
 * - Returns the relative path and filename of the written archive
 * - Respects config for archive dir and filename style
 */
export function archivePlan(
  repoRoot: string,
  content: string,
  date: Date = new Date(),
  config?: Partial<Pick<PiPlanConfig, "archiveDir" | "archiveFilenameStyle">>,
): ArchiveResult {
  const archiveDirRel = config?.archiveDir ?? ARCHIVE_DIR_REL;
  const filenameStyle = config?.archiveFilenameStyle ?? "date-slug";
  const archiveDir = join(repoRoot, archiveDirRel);
  if (!isContainedIn(archiveDir, repoRoot)) {
    throw new Error(`Archive directory escapes repository root: ${archiveDirRel}`);
  }
  mkdirSync(archiveDir, { recursive: true });

  const title = extractPlanTitle(content);
  let filename = archiveFilename(date, title, filenameStyle);
  let abs = join(archiveDir, filename);

  // Handle collisions
  if (existsSync(abs)) {
    let counter = 1;
    const base = filename.replace(/\.md$/, "");
    while (existsSync(abs)) {
      filename = `${base}-${counter}.md`;
      abs = join(archiveDir, filename);
      counter++;
    }
  }

  writeFileSync(abs, content, "utf-8");

  return {
    relPath: `${archiveDirRel}/${filename}`,
    filename,
  };
}

// ---------------------------------------------------------------------------
// List archives
// ---------------------------------------------------------------------------

/**
 * List all archived plans, sorted newest-first.
 *
 * For each archive, extracts a display label from the file content:
 * - first markdown heading, or
 * - Goal section first line, or
 * - filename fallback
 *
 * Respects config for archive dir and max entries.
 */
export function listArchives(
  repoRoot: string,
  config?: Partial<Pick<PiPlanConfig, "archiveDir" | "maxArchiveListEntries">>,
): ArchiveEntry[] {
  const archiveDirRel = config?.archiveDir ?? ARCHIVE_DIR_REL;
  const maxEntries = config?.maxArchiveListEntries ?? DEFAULT_CONFIG.maxArchiveListEntries;
  const archiveDir = join(repoRoot, archiveDirRel);
  if (!existsSync(archiveDir)) return [];

  const files = readdirSync(archiveDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse(); // newest first (filenames are sortable by date prefix)

  const capped = files.slice(0, maxEntries);

  return capped.map((filename) => {
    const abs = join(archiveDir, filename);
    let label: string;
    try {
      const content = readFileSync(abs, "utf-8");
      label = extractPlanTitle(content);
    } catch {
      label = filename.replace(/\.md$/, "");
    }

    return {
      relPath: `${archiveDirRel}/${filename}`,
      filename,
      label,
    };
  });
}

/**
 * Count total archives (not limited by maxArchiveListEntries).
 */
export function countArchives(
  repoRoot: string,
  config?: Partial<Pick<PiPlanConfig, "archiveDir">>,
): number {
  const archiveDirRel = config?.archiveDir ?? ARCHIVE_DIR_REL;
  const archiveDir = join(repoRoot, archiveDirRel);
  if (!existsSync(archiveDir)) return 0;
  return readdirSync(archiveDir).filter((f) => f.endsWith(".md")).length;
}

// ---------------------------------------------------------------------------
// Read an archived plan
// ---------------------------------------------------------------------------

/**
 * Read the content of an archived plan by its relative path.
 * Returns null if the file does not exist.
 */
export function readArchive(repoRoot: string, relPath: string): string | null {
  const abs = join(repoRoot, relPath);
  if (!isContainedIn(abs, repoRoot)) return null;
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf-8");
}

// ---------------------------------------------------------------------------
// Update index.md
// ---------------------------------------------------------------------------

/**
 * Regenerate `.pi/plans/index.md` to reflect the current plan and archives.
 *
 * The index is always fully regenerated (not patched) to stay deterministic.
 * Respects config for archive dir (uses all archives, not capped).
 */
export function updateIndex(
  repoRoot: string,
  config?: Partial<Pick<PiPlanConfig, "archiveDir">>,
): void {
  const currentContent = readCurrentPlan(repoRoot);
  const currentTitle = currentContent ? extractPlanTitle(currentContent) : "(no active plan)";

  // Index should show all archives, not be limited by maxArchiveListEntries
  const archives = listArchives(repoRoot, { archiveDir: config?.archiveDir, maxArchiveListEntries: 9999 });

  const lines: string[] = [
    "# Plan Index",
    "",
    "## Current",
    "",
    `- [${currentTitle}](current.md)`,
    "",
    "## Archived",
    "",
  ];

  if (archives.length === 0) {
    lines.push("_None yet._");
  } else {
    for (const a of archives) {
      // Use relative path from .pi/plans/ to the archive
      const linkPath = a.relPath.replace(/^\.pi\/plans\//, "");
      lines.push(`- [${a.label}](${linkPath}) — \`${a.filename}\``);
    }
  }

  lines.push("");

  const abs = join(repoRoot, PLANS_INDEX_REL);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// Index reconciliation
// ---------------------------------------------------------------------------

/**
 * Deterministic index reconciliation.
 *
 * Checks whether the repo is fully initialized, then regenerates index.md
 * from the actual current plan and archive files on disk. This is safe to
 * call opportunistically — it is idempotent, does not corrupt state, and
 * only writes when the repo is in an initialized state.
 *
 * Use this before key flows in /plan and /plan-debug to ensure index.md
 * stays consistent even if files were manually moved or edited outside the
 * extension.
 *
 * Returns true if reconciliation was performed, false if skipped (not initialized).
 */
export function reconcileIndex(
  repoRoot: string,
  config?: Partial<Pick<PiPlanConfig, "archiveDir">>,
): boolean {
  if (!isFullyInitialized(repoRoot)) return false;
  updateIndex(repoRoot, config);
  return true;
}
