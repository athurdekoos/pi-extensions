/**
 * plangen.ts — Pure deterministic plan generation with explicit template placeholders.
 *
 * Owns: Generating a plan scaffold from a goal string, repo root, and
 *       (optionally) the repo-local task-plan template. Title derivation,
 *       section structure, placeholder substitution.
 *
 * Does NOT own: Template parsing or section types (template-core.ts),
 *               template mode classification (template-analysis.ts),
 *               file writes, state detection, archive logic, or config.
 *
 * Template contract (Phase 6):
 *   Templates may contain the following placeholders anywhere in their body:
 *     - {{GOAL}}          — replaced with the user's goal text
 *     - {{REPO_ROOT}}     — replaced with the absolute repo root path
 *     - {{CURRENT_STATE}} — replaced with a default "Current State" block
 *   Placeholders are substituted literally. Unknown {{...}} tokens are left
 *   as-is (no error, no removal). Missing placeholders degrade gracefully:
 *   if {{GOAL}} is absent, the goal still appears in the Goal section via
 *   section-name fallback. If the template is missing or malformed, the
 *   built-in fallback sections are used.
 *
 * Phase 8 changes:
 *   - Template parsing primitives moved to template-core.ts (breaks circular import)
 *   - CURRENT_STATE expansion uses buildCurrentStateValue() from template-core.ts
 *     for both placeholder and section-name fallback paths (consistent behavior)
 *
 * Phase 9 changes:
 *   - Removed backward-compatibility re-exports (parseTemplate, readTemplateSections,
 *     TEMPLATE_PLACEHOLDERS, TemplateSection, TemplatePlaceholder). Import these
 *     from template-core.ts directly.
 *
 * Invariants:
 *   - generatePlan() is deterministic: same input → same output.
 *   - Generated plans must NEVER contain CURRENT_PLAN_SENTINEL from defaults.ts.
 *   - When a valid template is available, its section structure is used and
 *     placeholders are substituted.
 *   - When no template is available or it is malformed, the built-in fallback
 *     section list is used. Generation never fails due to template issues.
 *   - CURRENT_STATE content is always produced by buildCurrentStateValue(),
 *     whether via {{CURRENT_STATE}} placeholder or section-name fallback.
 *
 * Extend here: New placeholders, LLM-assisted plan filling,
 *              custom section structures.
 * Do NOT extend here: File I/O, state detection, archive operations.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { TASK_PLAN_TEMPLATE_REL } from "./repo.js";
import { CURRENT_PLAN_SENTINEL } from "./defaults.js";
import type { TemplateMode } from "./template-analysis.js";
import { analyzeTemplate } from "./template-analysis.js";
import {
  readTemplateSections,
  TEMPLATE_PLACEHOLDERS,
  buildCurrentStateValue,
  type TemplateSection,
  type TemplatePlaceholder,
} from "./template-core.js";

// ---------------------------------------------------------------------------
// Plan generation input
// ---------------------------------------------------------------------------

export interface PlanInput {
  /** Short task description / goal from the user */
  goal: string;
  /** Absolute path to the repository root */
  repoRoot: string;
  /** Optional custom template for {{CURRENT_STATE}} expansion. May contain {{REPO_ROOT}}. */
  currentStateTemplate?: string | null;
}

// ---------------------------------------------------------------------------
// Generation result metadata
// ---------------------------------------------------------------------------

export interface PlanGenResult {
  /** The generated plan text */
  text: string;
  /** Whether a repo-local template was used (true) or fallback (false) */
  usedTemplate: boolean;
  /** Template mode classification from shared analysis */
  templateMode: TemplateMode;
}

// ---------------------------------------------------------------------------
// Default fallback sections (used when template is missing/malformed)
// ---------------------------------------------------------------------------

const FALLBACK_SECTIONS: TemplateSection[] = [
  { heading: "Goal", body: ["{{GOAL}}"] },
  { heading: "Current State", body: ["{{CURRENT_STATE}}"] },
  { heading: "Locked Decisions", body: ["- _List constraints and non-negotiable choices._"] },
  { heading: "Scope", body: ["- _What is in scope for this task?_"] },
  { heading: "Non-Goals", body: ["- _What is explicitly out of scope?_"] },
  { heading: "Files to Inspect", body: ["- _Which files should be read before implementation?_"] },
  {
    heading: "Implementation Plan",
    body: ["1. _First step_", "2. _Second step_", "3. _Third step_"],
  },
  { heading: "Acceptance Criteria", body: ["- [ ] _How do we know this task is done?_"] },
  { heading: "Tests", body: ["- _What tests should be added or updated?_"] },
  { heading: "Manual Verification", body: ["- _How to verify the result manually?_"] },
  { heading: "Risks / Notes", body: ["- _Any risks, open questions, or notes?_"] },
];

// ---------------------------------------------------------------------------
// Placeholder substitution
// ---------------------------------------------------------------------------

/**
 * Build the substitution map for a given plan input.
 *
 * The {{CURRENT_STATE}} value is built by buildCurrentStateValue() from
 * template-core.ts — the single canonical builder for current-state content.
 * This ensures consistent behavior across placeholder and fallback paths.
 */
function buildSubstitutions(input: PlanInput): Record<string, string> {
  return {
    "{{GOAL}}": input.goal,
    "{{REPO_ROOT}}": input.repoRoot,
    "{{CURRENT_STATE}}": buildCurrentStateValue(input.repoRoot, input.currentStateTemplate),
  };
}

/**
 * Apply placeholder substitution to a single line of text.
 *
 * Each recognized placeholder is replaced with its value.
 * Unknown {{...}} tokens are left as-is.
 */
function substituteLine(line: string, subs: Record<string, string>): string {
  let result = line;
  for (const [placeholder, value] of Object.entries(subs)) {
    result = result.replaceAll(placeholder, value);
  }
  return result;
}

/**
 * Check whether a section body contains any recognized placeholders.
 */
function bodyHasPlaceholders(body: string[]): boolean {
  const joined = body.join("\n");
  return TEMPLATE_PLACEHOLDERS.some((p) => joined.includes(p));
}

// ---------------------------------------------------------------------------
// Generate a plan scaffold
// ---------------------------------------------------------------------------

/**
 * Generate a filled-in plan scaffold.
 *
 * The generation is template-aware with explicit placeholder substitution:
 *
 * 1. If the repo-local template (.pi/templates/task-plan.md) exists and
 *    contains valid H2 sections, those sections define the plan structure.
 *    Placeholders ({{GOAL}}, {{REPO_ROOT}}, {{CURRENT_STATE}}) in section
 *    bodies are substituted with actual values.
 *
 * 2. If the template is missing/malformed, the built-in fallback sections
 *    are used (which also contain placeholders, substituted identically).
 *
 * 3. Section-name fallback: If a "Goal" section has no {{GOAL}} placeholder,
 *    the goal is still injected. If a "Current State" section has no
 *    {{CURRENT_STATE}} or {{REPO_ROOT}} placeholder, the canonical
 *    current-state content (from buildCurrentStateValue()) is injected.
 *    This ensures basic plan quality even with placeholder-free legacy templates.
 *
 * The generated plan:
 * - Is deterministic for the same input + template
 * - Does NOT contain the placeholder sentinel string
 */
export function generatePlan(input: PlanInput): string {
  const result = generatePlanWithMeta(input);
  return result.text;
}

/**
 * Generate a plan scaffold and return metadata about the generation.
 * Used by diagnostics to report whether template was used.
 */
export function generatePlanWithMeta(input: PlanInput): PlanGenResult {
  const { goal, repoRoot } = input;
  const title = deriveTitle(goal);
  const subs = buildSubstitutions(input);

  // Try to read the repo-local template — use shared analysis
  const templateSections = readTemplateSections(repoRoot);
  const fileExists = existsSync(join(repoRoot, TASK_PLAN_TEMPLATE_REL));
  const analysis = analyzeTemplate(templateSections, fileExists);
  const usedTemplate = templateSections !== null;
  const sections = templateSections ?? FALLBACK_SECTIONS;

  const lines: string[] = [`# Plan: ${title}`, ""];

  for (const section of sections) {
    lines.push(`## ${section.heading}`, "");

    const hasPlaceholders = bodyHasPlaceholders(section.body);

    if (hasPlaceholders) {
      // Placeholder path: substitute all recognized placeholders in body lines
      for (const bodyLine of section.body) {
        const substituted = substituteLine(bodyLine, subs);
        // A substituted placeholder may produce multi-line output (e.g. {{CURRENT_STATE}})
        const subLines = substituted.split("\n");
        for (const sl of subLines) {
          lines.push(sl);
        }
      }
      lines.push("");
    } else {
      // Section-name fallback: for well-known sections without placeholders,
      // inject essential content to keep plans useful.
      if (section.heading === "Goal") {
        lines.push(goal, "");
      } else if (section.heading === "Current State") {
        // Use the canonical current-state builder — same as {{CURRENT_STATE}}
        const currentStateText = buildCurrentStateValue(repoRoot, input.currentStateTemplate);
        const csLines = currentStateText.split("\n");
        for (const csl of csLines) {
          lines.push(csl);
        }
        lines.push("");
        // Preserve any additional body content from the template below the injected block
        if (section.body.length > 0) {
          for (const bodyLine of section.body) {
            lines.push(bodyLine);
          }
          lines.push("");
        }
      } else if (section.body.length > 0) {
        for (const bodyLine of section.body) {
          lines.push(bodyLine);
        }
        lines.push("");
      } else {
        // Empty section from template — add a minimal placeholder
        lines.push(`_Fill in ${section.heading.toLowerCase()}._`, "");
      }
    }
  }

  let text = lines.join("\n");

  // Safety: ensure sentinel never appears in generated plans
  if (text.includes(CURRENT_PLAN_SENTINEL)) {
    text = text.replace(new RegExp(CURRENT_PLAN_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
  }

  return { text, usedTemplate, templateMode: analysis.mode };
}

// ---------------------------------------------------------------------------
// Title derivation
// ---------------------------------------------------------------------------

const MAX_TITLE_LENGTH = 80;

/**
 * Derive a concise plan title from the user goal.
 * Takes the first line, trims, and caps length.
 */
export function deriveTitle(goal: string): string {
  const firstLine = goal.split("\n")[0].trim();
  if (firstLine.length === 0) return "Untitled";
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine;
  return firstLine.slice(0, MAX_TITLE_LENGTH - 1) + "…";
}

// ---------------------------------------------------------------------------
// Section validation
// ---------------------------------------------------------------------------

/**
 * Expected sections for fallback validation.
 * When a custom template is used, these may not all be present.
 */
export const EXPECTED_SECTIONS = [
  "Goal",
  "Current State",
  "Locked Decisions",
  "Scope",
  "Non-Goals",
  "Files to Inspect",
  "Implementation Plan",
  "Acceptance Criteria",
  "Tests",
  "Manual Verification",
  "Risks / Notes",
] as const;

/**
 * Check whether a generated plan includes all expected (fallback) sections.
 * Useful for testing fallback behavior.
 */
export function hasAllSections(planText: string): boolean {
  return EXPECTED_SECTIONS.every((section) => planText.includes(`## ${section}`));
}

/**
 * Extract all H2 section headings from plan text.
 * Useful for testing template-aware generation.
 */
export function extractSectionHeadings(planText: string): string[] {
  return planText
    .split("\n")
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim());
}
