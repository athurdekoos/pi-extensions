/**
 * template-analysis.ts — Centralized template analysis and mode classification.
 *
 * This is the single source of truth for how the extension interprets
 * a repo-local template file. Both plan generation (plangen.ts) and
 * diagnostics (diagnostics.ts) must use this module to classify templates,
 * ensuring they never drift apart.
 *
 * Owns: Template mode classification, placeholder detection, template
 *       usability assessment, repair recommendations.
 *
 * Does NOT own: Template parsing or file I/O (template-core.ts),
 *               plan generation logic, diagnostics collection, file writes.
 *
 * Template modes:
 *   - `explicit-placeholders` — valid template with recognized {{...}} placeholders
 *   - `legacy-section-fallback` — valid template with H2 sections but no recognized placeholders
 *   - `default-fallback` — template is missing, empty, or has no H2 sections; built-in sections used
 *   - `invalid` — template file exists but is unusable (no H2 sections); built-in fallback used
 *
 * Invariants:
 *   - analyzeTemplate() is deterministic: same input → same output.
 *   - Both generation and diagnostics use analyzeTemplate() or analyzeTemplateFromDisk().
 *   - Mode classification is testable without filesystem access via analyzeTemplate().
 *   - No circular imports: depends on template-core.ts (primitives) and repo.ts (path constant).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { TASK_PLAN_TEMPLATE_REL } from "./repo.js";
import { readTemplateSections, TEMPLATE_PLACEHOLDERS, type TemplateSection } from "./template-core.js";

// ---------------------------------------------------------------------------
// Template mode
// ---------------------------------------------------------------------------

/**
 * Explicit classification of how the extension interprets a template.
 *
 * - `explicit-placeholders`: Template has H2 sections and at least one recognized placeholder.
 * - `legacy-section-fallback`: Template has H2 sections but no recognized placeholders.
 *     Section-name fallback handles Goal/Current State injection.
 * - `default-fallback`: No template file present (or empty). Built-in fallback sections used.
 * - `invalid`: Template file exists but is unusable (e.g. no H2 sections). Built-in fallback used.
 */
export type TemplateMode =
  | "explicit-placeholders"
  | "legacy-section-fallback"
  | "default-fallback"
  | "invalid";

// ---------------------------------------------------------------------------
// Template analysis result
// ---------------------------------------------------------------------------

export interface TemplateAnalysis {
  /** Classified template mode */
  mode: TemplateMode;

  /** Whether the template file exists on disk */
  fileExists: boolean;

  /** Whether the template has valid H2 sections */
  usable: boolean;

  /** Number of H2 sections found (0 if not usable) */
  sectionCount: number;

  /** Whether any recognized placeholders were found in section bodies */
  hasExplicitPlaceholders: boolean;

  /** Which recognized placeholders were found */
  placeholdersFound: string[];

  /** Whether the extension will use built-in fallback sections */
  usesFallback: boolean;

  /** Whether a repair/reset to default template is recommended */
  repairRecommended: boolean;

  /** Human-readable summary of the template state */
  summary: string;
}

// ---------------------------------------------------------------------------
// Placeholder scanning
// ---------------------------------------------------------------------------

/**
 * Scan parsed sections for recognized template placeholders.
 * Returns the list of distinct placeholders found in any section body.
 */
export function detectPlaceholders(sections: TemplateSection[]): string[] {
  const found = new Set<string>();
  for (const section of sections) {
    const joined = section.body.join("\n");
    for (const p of TEMPLATE_PLACEHOLDERS) {
      if (joined.includes(p)) found.add(p);
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Analyze template from parsed sections (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Analyze a template given its parsed sections and whether the file exists.
 *
 * This is the core classification function. It is pure and testable without
 * filesystem access.
 *
 * @param sections - Parsed template sections, or null if the template could not be parsed
 * @param fileExists - Whether the template file exists on disk
 */
export function analyzeTemplate(
  sections: TemplateSection[] | null,
  fileExists: boolean,
): TemplateAnalysis {
  // Case 1: No file at all → default-fallback
  if (!fileExists) {
    return {
      mode: "default-fallback",
      fileExists: false,
      usable: false,
      sectionCount: 0,
      hasExplicitPlaceholders: false,
      placeholdersFound: [],
      usesFallback: true,
      repairRecommended: true,
      summary: "Template file missing — using built-in fallback sections.",
    };
  }

  // Case 2: File exists but no valid sections → invalid
  if (!sections || sections.length === 0) {
    return {
      mode: "invalid",
      fileExists: true,
      usable: false,
      sectionCount: 0,
      hasExplicitPlaceholders: false,
      placeholdersFound: [],
      usesFallback: true,
      repairRecommended: true,
      summary: "Template file exists but has no valid H2 sections — using built-in fallback sections.",
    };
  }

  // File exists and has valid sections
  const placeholders = detectPlaceholders(sections);
  const hasPlaceholders = placeholders.length > 0;

  if (hasPlaceholders) {
    // Case 3: Valid template with explicit placeholders
    return {
      mode: "explicit-placeholders",
      fileExists: true,
      usable: true,
      sectionCount: sections.length,
      hasExplicitPlaceholders: true,
      placeholdersFound: placeholders,
      usesFallback: false,
      repairRecommended: false,
      summary: `Template has ${sections.length} section(s) with explicit placeholders — will be used for plan generation.`,
    };
  }

  // Case 4: Valid template but no recognized placeholders → legacy fallback
  return {
    mode: "legacy-section-fallback",
    fileExists: true,
    usable: true,
    sectionCount: sections.length,
    hasExplicitPlaceholders: false,
    placeholdersFound: [],
    usesFallback: false,
    repairRecommended: false,
    summary: `Template has ${sections.length} section(s) without explicit placeholders — section-name fallback will be used for Goal/Current State.`,
  };
}

// ---------------------------------------------------------------------------
// Analyze template from disk (convenience wrapper with I/O)
// ---------------------------------------------------------------------------

/**
 * Analyze the repo-local template file from disk.
 *
 * This is the primary entry point for both plan generation and diagnostics
 * when they need template analysis. It reads the file, parses it, and
 * delegates to analyzeTemplate() for classification.
 */
export function analyzeTemplateFromDisk(repoRoot: string): TemplateAnalysis {
  const fileExists = existsSync(join(repoRoot, TASK_PLAN_TEMPLATE_REL));
  const sections = fileExists ? readTemplateSections(repoRoot) : null;
  return analyzeTemplate(sections, fileExists);
}
