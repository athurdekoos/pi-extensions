/**
 * summary.ts — Plan summary extraction and archive label formatting.
 *
 * Owns: Extracting concise summaries from plan markdown (Goal section or
 *       fallback), formatting human-readable timestamps from archive filenames,
 *       and building polished archive labels for the browse UI.
 *
 * Does NOT own: File I/O, state detection, archive reads, or config.
 *               All functions here are pure — they take strings and return strings.
 *
 * Invariants:
 *   - extractPlanSummary() never returns empty string — falls back to
 *     "(no summary available)".
 *   - Section extraction stops at the next heading boundary.
 *   - Placeholder italic lines (_text_) are skipped.
 *
 * Extend here: Richer summary extraction, multi-section summaries,
 *              progress indicators, completion percentage.
 * Do NOT extend here: File I/O, archive management, state logic.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Plan summary extraction for resume and archive polish
// ---------------------------------------------------------------------------

/**
 * Extract a concise summary from plan markdown content.
 *
 * Returns up to `maxLines` non-empty, non-heading, non-placeholder lines
 * from the Goal section (or from the top of the file as fallback).
 */
export function extractPlanSummary(content: string, maxLines: number = 3): string {
  const lines = content.split("\n");

  // Try Goal section first
  const goalLines = extractSectionLines(lines, "Goal", maxLines);
  if (goalLines.length > 0) return goalLines.join("\n");

  // Fallback: first non-empty, non-heading lines from anywhere
  const fallback: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("_") && trimmed.endsWith("_")) continue;
    fallback.push(trimmed);
    if (fallback.length >= maxLines) break;
  }

  return fallback.length > 0 ? fallback.join("\n") : "(no summary available)";
}

/**
 * Extract non-empty content lines from a markdown section.
 */
function extractSectionLines(lines: string[], sectionName: string, maxLines: number): string[] {
  let inSection = false;
  const result: string[] = [];

  for (const line of lines) {
    if (inSection) {
      // Stop at next heading
      if (/^##?\s/.test(line)) break;

      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      // Skip placeholder italic lines
      if (trimmed.startsWith("_") && trimmed.endsWith("_")) continue;

      result.push(trimmed);
      if (result.length >= maxLines) break;
    } else if (new RegExp(`^##\\s+${escapeRegExp(sectionName)}`).test(line)) {
      inSection = true;
    }
  }

  return result;
}

/**
 * Format a human-readable timestamp from an archive filename.
 *
 * Input: "2026-03-11-1730-some-slug.md"
 * Output: "2026-03-11 17:30"
 *
 * Returns null if the filename doesn't match the expected pattern.
 */
export function formatArchiveTimestamp(filename: string): string | null {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

/**
 * Build a polished label for an archive entry.
 *
 * Format: "Title  (YYYY-MM-DD HH:MM)"
 * Truncates title to maxTitleLen if needed.
 */
export function formatArchiveLabel(title: string, filename: string, maxTitleLen: number = 50): string {
  const ts = formatArchiveTimestamp(filename);
  const truncatedTitle = title.length > maxTitleLen
    ? title.slice(0, maxTitleLen - 1) + "…"
    : title;

  if (ts) {
    return `${truncatedTitle}  (${ts})`;
  }
  return truncatedTitle;
}
