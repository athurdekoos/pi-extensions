/**
 * brainstorm.ts — Brainstorming/design spec module.
 *
 * Owns: Spec file I/O under .pi/specs/, filename generation, spec reading/listing.
 * Does NOT own: Pi API calls, browser review, plan generation, tool registration.
 *
 * Invariants:
 *   - Spec files are always written under .pi/specs/.
 *   - Filenames follow YYYY-MM-DD-HHMM-slug.md format.
 *   - All functions are pure or perform only local file I/O.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Slug generation (reuses archive pattern)
// ---------------------------------------------------------------------------

/**
 * Derive a short filesystem-safe slug from a title.
 * Lowercase, alphanumeric + hyphens, max 40 chars.
 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

  return slug.length > 0 ? slug : "spec";
}

// ---------------------------------------------------------------------------
// Spec filename generation
// ---------------------------------------------------------------------------

/**
 * Generate a spec filename: YYYY-MM-DD-HHMM-slug.md
 */
export function generateSpecFilename(title: string, date: Date = new Date()): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const slug = slugify(title);
  return `${y}-${mo}-${d}-${h}${mi}-${slug}.md`;
}

// ---------------------------------------------------------------------------
// Spec I/O
// ---------------------------------------------------------------------------

/**
 * Write a spec to .pi/specs/, creating the directory if needed.
 * Returns the relative path of the written spec.
 */
export function writeSpec(
  repoRoot: string,
  content: string,
  title: string,
  specDir: string,
  date: Date = new Date(),
): string {
  const dir = join(repoRoot, specDir);
  mkdirSync(dir, { recursive: true });

  let filename = generateSpecFilename(title, date);
  let abs = join(dir, filename);

  // Handle collisions
  let counter = 1;
  while (existsSync(abs)) {
    const base = filename.replace(/\.md$/, "");
    filename = `${base}-${counter}.md`;
    abs = join(dir, filename);
    counter++;
  }

  writeFileSync(abs, content, "utf-8");
  return `${specDir}/${filename}`;
}

/**
 * Read a spec by relative path. Returns content or null.
 */
export function readSpec(repoRoot: string, specRelPath: string): string | null {
  const abs = join(repoRoot, specRelPath);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}

/**
 * List specs newest-first.
 * Extracts title from the first H1 heading in each spec.
 */
export function listSpecs(
  repoRoot: string,
  specDir: string,
): Array<{ relPath: string; title: string; date: string }> {
  const dir = join(repoRoot, specDir);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse(); // newest first

  return files.map((filename) => {
    const abs = join(dir, filename);
    let title = filename.replace(/\.md$/, "");
    try {
      const content = readFileSync(abs, "utf-8");
      const h1Match = content.match(/^#\s+(?:Spec:\s*)?(.+)/m);
      if (h1Match) title = h1Match[1].trim();
    } catch {
      // Use filename as title
    }

    // Extract date from filename (YYYY-MM-DD-HHMM-...)
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})-\d{4}/);
    const date = dateMatch ? dateMatch[1] : "";

    return { relPath: `${specDir}/${filename}`, title, date };
  });
}
