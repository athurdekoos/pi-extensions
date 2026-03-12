/**
 * template-core.ts — Shared template primitives: types, constants, parsing, file I/O.
 *
 * This module exists to break the circular dependency between plangen.ts and
 * template-analysis.ts. It owns the low-level building blocks that both modules
 * need:
 *
 * Owns:
 *   - TemplateSection type
 *   - TEMPLATE_PLACEHOLDERS constant and TemplatePlaceholder type
 *   - parseTemplate() — pure template string → sections parser
 *   - readTemplateSections() — disk I/O wrapper for parseTemplate
 *   - buildCurrentStateValue() — canonical builder for CURRENT_STATE content
 *
 * Does NOT own:
 *   - Template mode classification (template-analysis.ts)
 *   - Plan generation or placeholder substitution (plangen.ts)
 *   - Default file contents or sentinel (defaults.ts)
 *   - File writes, state detection, config
 *
 * Invariants:
 *   - parseTemplate() is pure: same input → same output
 *   - readTemplateSections() returns null for missing/empty/malformed files
 *   - buildCurrentStateValue() is the single canonical path for CURRENT_STATE content
 *   - No circular imports: this module depends only on repo.ts (for path) and defaults.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TASK_PLAN_TEMPLATE_REL } from "./repo.js";
import { DEFAULT_CURRENT_STATE_TEMPLATE } from "./defaults.js";

// ---------------------------------------------------------------------------
// Template section model
// ---------------------------------------------------------------------------

export interface TemplateSection {
  /** Section heading (without the ## prefix) */
  heading: string;
  /** Body lines under the heading (may be empty) */
  body: string[];
}

// ---------------------------------------------------------------------------
// Placeholder contract
// ---------------------------------------------------------------------------

/**
 * Recognized template placeholders and their semantics.
 *
 * - {{GOAL}}          — the user's goal text
 * - {{REPO_ROOT}}     — the absolute repo root path
 * - {{CURRENT_STATE}} — a default current-state description line
 *
 * Unknown {{...}} tokens are left as-is.
 */
export const TEMPLATE_PLACEHOLDERS = ["{{GOAL}}", "{{REPO_ROOT}}", "{{CURRENT_STATE}}"] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

// ---------------------------------------------------------------------------
// Template parsing
// ---------------------------------------------------------------------------

/**
 * Parse a task-plan template string into an ordered list of sections.
 *
 * Sections are identified by `## <heading>` lines. Content between headings
 * is captured as the section body. The H1 line (if any) is skipped — the
 * generated plan supplies its own title.
 *
 * Returns null if no H2 sections are found (template is malformed/useless).
 */
export function parseTemplate(templateText: string): TemplateSection[] | null {
  const lines = templateText.split("\n");
  const sections: TemplateSection[] = [];
  let current: TemplateSection | null = null;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      if (current) sections.push(current);
      current = { heading: h2Match[1].trim(), body: [] };
      continue;
    }
    // Skip H1 lines (template title)
    if (/^#\s+/.test(line)) continue;

    if (current) {
      current.body.push(line);
    }
  }

  if (current) sections.push(current);

  // Trim trailing empty lines from each section body
  for (const section of sections) {
    while (section.body.length > 0 && section.body[section.body.length - 1].trim() === "") {
      section.body.pop();
    }
    // Also trim leading empty lines
    while (section.body.length > 0 && section.body[0].trim() === "") {
      section.body.shift();
    }
  }

  return sections.length > 0 ? sections : null;
}

/**
 * Read and parse the repo-local template file.
 * Returns the parsed sections, or null if the file is missing/unreadable/malformed.
 */
export function readTemplateSections(repoRoot: string): TemplateSection[] | null {
  const abs = join(repoRoot, TASK_PLAN_TEMPLATE_REL);
  if (!existsSync(abs)) return null;

  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return null;
  }

  if (content.trim().length === 0) return null;

  return parseTemplate(content);
}

// ---------------------------------------------------------------------------
// Canonical CURRENT_STATE builder
// ---------------------------------------------------------------------------

/**
 * Build the expanded value for {{CURRENT_STATE}} or for the section-name
 * fallback "Current State" content.
 *
 * This is the single canonical function that produces current-state text
 * regardless of whether the plan is generated via:
 *   - explicit template placeholders ({{CURRENT_STATE}})
 *   - section-name fallback (legacy templates without placeholders)
 *   - built-in fallback sections
 *
 * @param repoRoot - Absolute repo root path
 * @param currentStateTemplate - Optional custom template (from config), may contain {{REPO_ROOT}}
 * @returns The fully expanded current-state text (may be multi-line)
 */
export function buildCurrentStateValue(
  repoRoot: string,
  currentStateTemplate?: string | null,
): string {
  const csTemplate = currentStateTemplate ?? DEFAULT_CURRENT_STATE_TEMPLATE;
  return csTemplate.replaceAll("{{REPO_ROOT}}", repoRoot);
}
