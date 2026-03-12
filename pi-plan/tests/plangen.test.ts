import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generatePlan,
  generatePlanWithMeta,
  deriveTitle,
  hasAllSections,
  extractSectionHeadings,
  EXPECTED_SECTIONS,
  type PlanInput,
} from "../plangen.js";
import {
  parseTemplate,
  readTemplateSections,
  TEMPLATE_PLACEHOLDERS,
} from "../template-core.js";
import {
  initPlanning,
  hasCurrentPlan,
  writeCurrentPlan,
  isFullyInitialized,
  hasPlanningProtocol,
  CURRENT_PLAN_REL,
  PLANNING_PROTOCOL_REL,
  TASK_PLAN_TEMPLATE_REL,
  PLANS_INDEX_REL,
} from "../repo.js";
import {
  CURRENT_PLAN_PLACEHOLDER,
  CURRENT_PLAN_SENTINEL,
  PLANNING_PROTOCOL,
  TASK_PLAN_TEMPLATE,
} from "../defaults.js";

// ---------------------------------------------------------------------------
// Shared temp directory helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const abs = join(tmp, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

function readFile(rel: string): string {
  return readFileSync(join(tmp, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// deriveTitle
// ---------------------------------------------------------------------------

describe("deriveTitle", () => {
  it("uses the first line of the goal", () => {
    expect(deriveTitle("Add JWT auth\nMore details")).toBe("Add JWT auth");
  });

  it("trims whitespace", () => {
    expect(deriveTitle("  Add JWT auth  ")).toBe("Add JWT auth");
  });

  it("returns 'Untitled' for empty input", () => {
    expect(deriveTitle("")).toBe("Untitled");
    expect(deriveTitle("   ")).toBe("Untitled");
  });

  it("truncates long titles with ellipsis", () => {
    const long = "A".repeat(100);
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("preserves titles at exactly 80 chars", () => {
    const exact = "A".repeat(80);
    expect(deriveTitle(exact)).toBe(exact);
  });
});

// ---------------------------------------------------------------------------
// parseTemplate
// ---------------------------------------------------------------------------

describe("parseTemplate", () => {
  it("extracts H2 sections from template text", () => {
    const template = [
      "# Plan: [TITLE]",
      "",
      "## Goal",
      "",
      "What is the objective?",
      "",
      "## Scope",
      "",
      "What is in scope?",
    ].join("\n");

    const sections = parseTemplate(template);
    expect(sections).not.toBeNull();
    expect(sections!.length).toBe(2);
    expect(sections![0].heading).toBe("Goal");
    expect(sections![1].heading).toBe("Scope");
  });

  it("captures body content under sections", () => {
    const template = [
      "## Goal",
      "",
      "What is the objective of this task?",
      "",
      "## Risks",
      "",
      "- Risk one",
      "- Risk two",
    ].join("\n");

    const sections = parseTemplate(template);
    expect(sections![0].body).toEqual(["What is the objective of this task?"]);
    expect(sections![1].body).toEqual(["- Risk one", "- Risk two"]);
  });

  it("returns null for text with no H2 sections", () => {
    expect(parseTemplate("Just some text without headings")).toBeNull();
    expect(parseTemplate("# Only H1")).toBeNull();
    expect(parseTemplate("")).toBeNull();
  });

  it("skips H1 lines", () => {
    const template = "# Title\n\n## Section\n\nContent";
    const sections = parseTemplate(template);
    expect(sections!.length).toBe(1);
    expect(sections![0].heading).toBe("Section");
  });

  it("trims leading/trailing empty lines from section body", () => {
    const template = "## Section\n\n\n  Content  \n\n\n## Next\n\nMore";
    const sections = parseTemplate(template);
    expect(sections![0].body).toEqual(["  Content  "]);
  });

  it("parses the default template correctly", () => {
    const sections = parseTemplate(TASK_PLAN_TEMPLATE);
    expect(sections).not.toBeNull();
    expect(sections!.length).toBeGreaterThanOrEqual(10);
    expect(sections![0].heading).toBe("Goal");
  });
});

// ---------------------------------------------------------------------------
// readTemplateSections
// ---------------------------------------------------------------------------

describe("readTemplateSections", () => {
  it("returns null when template file does not exist", () => {
    expect(readTemplateSections(tmp)).toBeNull();
  });

  it("returns null when template is empty", () => {
    writeFile(TASK_PLAN_TEMPLATE_REL, "");
    expect(readTemplateSections(tmp)).toBeNull();
  });

  it("returns null when template has no H2 sections", () => {
    writeFile(TASK_PLAN_TEMPLATE_REL, "Just random text\nwithout headings");
    expect(readTemplateSections(tmp)).toBeNull();
  });

  it("returns sections from a valid template file", () => {
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObjective\n\n## Scope\n\nIn scope");
    const sections = readTemplateSections(tmp);
    expect(sections).not.toBeNull();
    expect(sections!.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// generatePlan — fallback (no template file)
// ---------------------------------------------------------------------------

describe("generatePlan — fallback", () => {
  const input: PlanInput = {
    goal: "Add JWT-based authentication to the API",
    repoRoot: "/home/dev/my-project",
  };

  it("includes the user goal in the output", () => {
    const plan = generatePlan(input);
    expect(plan).toContain("Add JWT-based authentication to the API");
  });

  it("includes the repo root in Current State", () => {
    const plan = generatePlan(input);
    expect(plan).toContain("/home/dev/my-project");
  });

  it("includes all expected sections", () => {
    const plan = generatePlan(input);
    expect(hasAllSections(plan)).toBe(true);
  });

  it("starts with a # Plan: title line", () => {
    const plan = generatePlan(input);
    expect(plan.startsWith("# Plan: ")).toBe(true);
  });

  it("does NOT contain the placeholder sentinel", () => {
    const plan = generatePlan(input);
    expect(plan).not.toContain(CURRENT_PLAN_SENTINEL);
  });

  it("is deterministic for the same input", () => {
    const a = generatePlan(input);
    const b = generatePlan(input);
    expect(a).toBe(b);
  });

  it("produces different output for different goals", () => {
    const other = generatePlan({ ...input, goal: "Refactor database layer" });
    expect(other).not.toBe(generatePlan(input));
  });
});

// ---------------------------------------------------------------------------
// generatePlan — template-aware
// ---------------------------------------------------------------------------

describe("generatePlan — template-aware", () => {
  it("uses sections from repo-local template", () => {
    initPlanning(tmp);
    // Write a custom template with different sections
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "# Plan: [TITLE]",
      "",
      "## Goal",
      "",
      "What do you want?",
      "",
      "## Current State",
      "",
      "Where are we?",
      "",
      "## Design",
      "",
      "Describe the design approach.",
      "",
      "## Rollback Plan",
      "",
      "How to revert if things go wrong.",
    ].join("\n"));

    const plan = generatePlan({ goal: "Build a thing", repoRoot: tmp });
    const headings = extractSectionHeadings(plan);

    expect(headings).toContain("Goal");
    expect(headings).toContain("Current State");
    expect(headings).toContain("Design");
    expect(headings).toContain("Rollback Plan");
    // Should NOT have fallback sections that aren't in the custom template
    expect(headings).not.toContain("Non-Goals");
    expect(headings).not.toContain("Acceptance Criteria");
  });

  it("preserves template section body content", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "What do you want?",
      "",
      "## Constraints",
      "",
      "- Must support PostgreSQL",
      "- Must be backward compatible",
    ].join("\n"));

    const plan = generatePlan({ goal: "Migrate DB", repoRoot: tmp });
    expect(plan).toContain("- Must support PostgreSQL");
    expect(plan).toContain("- Must be backward compatible");
  });

  it("fills Goal section with user's goal, not template placeholder", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "What is the objective of this task?",
      "",
      "## Scope",
      "",
      "Define scope here.",
    ].join("\n"));

    const plan = generatePlan({ goal: "Migrate to TypeScript", repoRoot: tmp });
    expect(plan).toContain("Migrate to TypeScript");
    // Goal section should have the user's goal, not the template question
    const goalIdx = plan.indexOf("## Goal");
    const scopeIdx = plan.indexOf("## Scope");
    const goalSection = plan.slice(goalIdx, scopeIdx);
    expect(goalSection).toContain("Migrate to TypeScript");
  });

  it("fills Current State section with repo root", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "Objective",
      "",
      "## Current State",
      "",
      "Describe current state",
    ].join("\n"));

    const plan = generatePlan({ goal: "Do stuff", repoRoot: tmp });
    expect(plan).toContain(`Repository root: \`${tmp}\``);
  });

  it("falls back gracefully when template is malformed", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "This is just random text with no sections at all.");

    const plan = generatePlan({ goal: "Build a widget", repoRoot: tmp });
    // Should use fallback sections
    expect(hasAllSections(plan)).toBe(true);
  });

  it("falls back gracefully when template is empty", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "");

    const plan = generatePlan({ goal: "Build a widget", repoRoot: tmp });
    expect(hasAllSections(plan)).toBe(true);
  });

  it("never contains the sentinel regardless of template content", () => {
    initPlanning(tmp);
    // Template with sentinel-like content
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      CURRENT_PLAN_SENTINEL,
      "",
      "## Scope",
      "",
      "Stuff",
    ].join("\n"));

    const plan = generatePlan({ goal: "Test sentinel safety", repoRoot: tmp });
    expect(plan).not.toContain(CURRENT_PLAN_SENTINEL);
  });

  it("handles template with empty sections gracefully", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "## Empty Section",
      "",
      "## Another",
      "",
      "Has content.",
    ].join("\n"));

    const plan = generatePlan({ goal: "Test empty", repoRoot: tmp });
    expect(plan).toContain("## Empty Section");
    expect(plan).toContain("## Another");
    expect(plan).toContain("Has content.");
  });

  it("is deterministic with same template and input", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObj\n\n## Design\n\nApproach");

    const input: PlanInput = { goal: "Build X", repoRoot: tmp };
    const a = generatePlan(input);
    const b = generatePlan(input);
    expect(a).toBe(b);
  });

  it("produces different output with different templates", () => {
    initPlanning(tmp);

    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObj\n\n## Scope\n\nScope");
    const planA = generatePlan({ goal: "Build X", repoRoot: tmp });

    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObj\n\n## Design\n\nDesign");
    const planB = generatePlan({ goal: "Build X", repoRoot: tmp });

    expect(planA).not.toBe(planB);
  });
});

// ---------------------------------------------------------------------------
// hasAllSections
// ---------------------------------------------------------------------------

describe("hasAllSections", () => {
  it("returns true for generated plans with fallback template", () => {
    const plan = generatePlan({ goal: "test", repoRoot: "/tmp" });
    expect(hasAllSections(plan)).toBe(true);
  });

  it("returns false when a section is missing", () => {
    const partial = "# Plan\n\n## Goal\n\nSomething";
    expect(hasAllSections(partial)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractSectionHeadings
// ---------------------------------------------------------------------------

describe("extractSectionHeadings", () => {
  it("extracts all H2 headings from plan text", () => {
    const plan = "# Title\n\n## Goal\n\nGoal text\n\n## Scope\n\nScope text";
    expect(extractSectionHeadings(plan)).toEqual(["Goal", "Scope"]);
  });

  it("returns empty array for text without H2", () => {
    expect(extractSectionHeadings("# Only H1\n\nSome text")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeCurrentPlan
// ---------------------------------------------------------------------------

describe("writeCurrentPlan", () => {
  it("writes content when current.md is the placeholder", () => {
    initPlanning(tmp);
    const content = "# Plan: Test\n\n## Goal\n\nDo the thing.\n";
    const result = writeCurrentPlan(tmp, content);

    expect(result).toBe(true);
    expect(readFile(CURRENT_PLAN_REL)).toBe(content);
  });

  it("writes content when current.md does not exist", () => {
    writeFile(PLANNING_PROTOCOL_REL, "# protocol");
    writeFile(TASK_PLAN_TEMPLATE_REL, "# template");
    writeFile(PLANS_INDEX_REL, "# index");

    const content = "# Plan: Test\n\n## Goal\n\nDo the thing.\n";
    const result = writeCurrentPlan(tmp, content);

    expect(result).toBe(true);
    expect(readFile(CURRENT_PLAN_REL)).toBe(content);
  });

  it("refuses to overwrite a meaningful current plan", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Existing\n\n## Goal\n\nAlready here.\n");

    const content = "# Plan: New\n\n## Goal\n\nShould not replace.\n";
    const result = writeCurrentPlan(tmp, content);

    expect(result).toBe(false);
    expect(readFile(CURRENT_PLAN_REL)).toContain("Already here");
  });

  it("allows writing when current.md is empty", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "");

    const content = "# Plan: Test\n\n## Goal\n\nNew plan.\n";
    const result = writeCurrentPlan(tmp, content);

    expect(result).toBe(true);
    expect(readFile(CURRENT_PLAN_REL)).toBe(content);
  });

  it("allows writing when current.md is whitespace-only", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "   \n\n  ");

    const content = "# Plan: Test\n\n## Goal\n\nNew plan.\n";
    const result = writeCurrentPlan(tmp, content);

    expect(result).toBe(true);
    expect(readFile(CURRENT_PLAN_REL)).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Integration: generated plan is detected as a real plan
// ---------------------------------------------------------------------------

describe("generated plan integration", () => {
  it("generated plan is detected as a real plan by hasCurrentPlan", () => {
    initPlanning(tmp);
    const plan = generatePlan({ goal: "Add auth", repoRoot: tmp });
    writeCurrentPlan(tmp, plan);

    expect(hasCurrentPlan(tmp)).toBe(true);
  });

  it("placeholder is NOT detected as a real plan", () => {
    initPlanning(tmp);
    expect(hasCurrentPlan(tmp)).toBe(false);
  });

  it("after writing a plan, state transitions from no-plan to has-plan", () => {
    initPlanning(tmp);
    expect(hasCurrentPlan(tmp)).toBe(false);

    const plan = generatePlan({ goal: "Build feature X", repoRoot: tmp });
    writeCurrentPlan(tmp, plan);

    expect(hasCurrentPlan(tmp)).toBe(true);
  });

  it("template-aware plan is detected as a real plan", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObj\n\n## Design\n\nApproach");
    const plan = generatePlan({ goal: "Custom template plan", repoRoot: tmp });
    writeCurrentPlan(tmp, plan);

    expect(hasCurrentPlan(tmp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Explicit placeholder substitution (Phase 6)
// ---------------------------------------------------------------------------

describe("placeholder substitution", () => {
  it("substitutes {{GOAL}} in template body", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "{{GOAL}}",
      "",
      "## Scope",
      "",
      "Define scope.",
    ].join("\n"));

    const plan = generatePlan({ goal: "Add auth layer", repoRoot: tmp });
    expect(plan).toContain("Add auth layer");
    // Should not contain the literal placeholder
    expect(plan).not.toContain("{{GOAL}}");
  });

  it("substitutes {{REPO_ROOT}} in template body", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "{{GOAL}}",
      "",
      "## Current State",
      "",
      "Repository root: `{{REPO_ROOT}}`",
    ].join("\n"));

    const plan = generatePlan({ goal: "Test", repoRoot: "/fake/root" });
    expect(plan).toContain("/fake/root");
    expect(plan).not.toContain("{{REPO_ROOT}}");
  });

  it("substitutes {{CURRENT_STATE}} as a block", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "{{GOAL}}",
      "",
      "## Context",
      "",
      "{{CURRENT_STATE}}",
    ].join("\n"));

    const plan = generatePlan({ goal: "Test", repoRoot: "/my/repo" });
    expect(plan).toContain("Repository root: `/my/repo`");
    expect(plan).not.toContain("{{CURRENT_STATE}}");
  });

  it("handles multiple placeholders on the same line", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Info",
      "",
      "Goal: {{GOAL}} at {{REPO_ROOT}}",
    ].join("\n"));

    const plan = generatePlan({ goal: "Fix bug", repoRoot: tmp });
    expect(plan).toContain(`Goal: Fix bug at ${tmp}`);
  });

  it("leaves unknown {{...}} tokens as-is", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "{{GOAL}}",
      "",
      "## Custom",
      "",
      "{{UNKNOWN_TOKEN}} stays here.",
    ].join("\n"));

    const plan = generatePlan({ goal: "Test", repoRoot: tmp });
    expect(plan).toContain("{{UNKNOWN_TOKEN}} stays here.");
  });

  it("falls back to section-name injection when no placeholders in Goal section", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "Describe the objective.",
      "",
      "## Scope",
      "",
      "In scope.",
    ].join("\n"));

    const plan = generatePlan({ goal: "Add metrics", repoRoot: tmp });
    // Goal should be injected by section-name fallback
    expect(plan).toContain("Add metrics");
  });

  it("falls back to section-name injection for Current State without placeholders", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "{{GOAL}}",
      "",
      "## Current State",
      "",
      "Starting point notes.",
    ].join("\n"));

    const plan = generatePlan({ goal: "Test", repoRoot: tmp });
    // Repo root injected by section-name fallback
    expect(plan).toContain(`Repository root: \`${tmp}\``);
    // Original body preserved
    expect(plan).toContain("Starting point notes.");
  });

  it("does not double-inject goal in body when {{GOAL}} is present", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "{{GOAL}}",
    ].join("\n"));

    const plan = generatePlan({ goal: "Unique goal text", repoRoot: tmp });
    // Goal appears exactly twice: once in title "# Plan: Unique goal text"
    // and once in the Goal section body via {{GOAL}} substitution.
    // It should NOT appear a third time from section-name fallback.
    const count = plan.split("Unique goal text").length - 1;
    expect(count).toBe(2);
  });

  it("uses fallback sections (with placeholders) when template is missing", () => {
    // Don't initialize — no template file
    const plan = generatePlan({ goal: "Build it", repoRoot: "/root" });
    expect(plan).toContain("Build it");
    expect(plan).toContain("/root");
    expect(plan).not.toContain("{{GOAL}}");
    expect(plan).not.toContain("{{REPO_ROOT}}");
    expect(hasAllSections(plan)).toBe(true);
  });

  it("uses fallback sections when template is malformed", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "No headings here at all.");

    const plan = generatePlan({ goal: "Build it", repoRoot: "/root" });
    expect(plan).toContain("Build it");
    expect(plan).not.toContain("{{GOAL}}");
    expect(hasAllSections(plan)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CURRENT_STATE configurability (Phase 7)
// ---------------------------------------------------------------------------

describe("CURRENT_STATE configurability", () => {
  it("uses default current-state block when no override", () => {
    const plan = generatePlan({ goal: "Test", repoRoot: "/repo" });
    expect(plan).toContain("Repository root: `/repo`");
    expect(plan).toContain("_Describe what exists today.");
  });

  it("uses custom currentStateTemplate when provided", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\n{{GOAL}}\n\n## State\n\n{{CURRENT_STATE}}");
    const plan = generatePlan({
      goal: "Test",
      repoRoot: tmp,
      currentStateTemplate: "Project: `{{REPO_ROOT}}`\n\nCustom state description.",
    });
    expect(plan).toContain(`Project: \`${tmp}\``);
    expect(plan).toContain("Custom state description.");
    // Should NOT contain the default text
    expect(plan).not.toContain("_Describe what exists today.");
  });

  it("substitutes {{REPO_ROOT}} inside custom currentStateTemplate", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\n{{GOAL}}\n\n## State\n\n{{CURRENT_STATE}}");
    const plan = generatePlan({
      goal: "Test",
      repoRoot: tmp,
      currentStateTemplate: "Root is {{REPO_ROOT}}. Check it.",
    });
    expect(plan).toContain(`Root is ${tmp}. Check it.`);
  });

  it("uses default when currentStateTemplate is null", () => {
    const plan = generatePlan({ goal: "Test", repoRoot: "/repo", currentStateTemplate: null });
    expect(plan).toContain("Repository root: `/repo`");
  });

  it("uses default when currentStateTemplate is undefined", () => {
    const plan = generatePlan({ goal: "Test", repoRoot: "/repo", currentStateTemplate: undefined });
    expect(plan).toContain("Repository root: `/repo`");
  });
});

// ---------------------------------------------------------------------------
// CURRENT_STATE consistency across paths (Phase 8)
// ---------------------------------------------------------------------------

describe("CURRENT_STATE consistency across all generation paths", () => {
  it("section-name fallback for Current State uses config override", () => {
    initPlanning(tmp);
    // Legacy template with Current State section but NO placeholders
    writeFile(TASK_PLAN_TEMPLATE_REL, [
      "## Goal",
      "",
      "Objective.",
      "",
      "## Current State",
      "",
      "Additional notes here.",
    ].join("\n"));

    const plan = generatePlan({
      goal: "Test",
      repoRoot: tmp,
      currentStateTemplate: "Custom root: `{{REPO_ROOT}}`\n\nCustom state info.",
    });

    // Should use the custom template via section-name fallback
    expect(plan).toContain(`Custom root: \`${tmp}\``);
    expect(plan).toContain("Custom state info.");
    // Additional notes should still be preserved
    expect(plan).toContain("Additional notes here.");
  });

  it("fallback sections use config override for CURRENT_STATE", () => {
    // No template file — uses built-in fallback sections
    const plan = generatePlan({
      goal: "Test",
      repoRoot: "/repo",
      currentStateTemplate: "Custom fallback: `{{REPO_ROOT}}`\n\nDescribe.",
    });

    expect(plan).toContain("Custom fallback: `/repo`");
    expect(plan).toContain("Describe.");
    // Should NOT contain default text
    expect(plan).not.toContain("_Describe what exists today.");
  });

  it("explicit {{CURRENT_STATE}} and section-name fallback produce same content", () => {
    const repoRoot = "/test/repo";
    const customTemplate = "Project: `{{REPO_ROOT}}`\n\nState desc.";

    // Path 1: Template with {{CURRENT_STATE}} placeholder
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\n{{GOAL}}\n\n## State\n\n{{CURRENT_STATE}}");
    const plan1 = generatePlan({ goal: "Test", repoRoot, currentStateTemplate: customTemplate });

    // Path 2: Legacy template with "Current State" section name, no placeholders
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObjective\n\n## Current State\n\nExtra.");
    const plan2 = generatePlan({ goal: "Test", repoRoot, currentStateTemplate: customTemplate });

    // Both should contain the same custom current-state content
    expect(plan1).toContain(`Project: \`${repoRoot}\``);
    expect(plan1).toContain("State desc.");
    expect(plan2).toContain(`Project: \`${repoRoot}\``);
    expect(plan2).toContain("State desc.");
  });

  it("default CURRENT_STATE is consistent across all three paths", () => {
    const repoRoot = "/consistency/test";

    // Path 1: Fallback sections (no template)
    const planFallback = generatePlan({ goal: "Test", repoRoot });

    // Path 2: Template with {{CURRENT_STATE}}
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\n{{GOAL}}\n\n## State\n\n{{CURRENT_STATE}}");
    const planExplicit = generatePlan({ goal: "Test", repoRoot });

    // Path 3: Legacy template with "Current State" heading
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObjective\n\n## Current State\n\nNotes.");
    const planLegacy = generatePlan({ goal: "Test", repoRoot });

    // All should contain the canonical default current-state content
    expect(planFallback).toContain(`Repository root: \`${repoRoot}\``);
    expect(planFallback).toContain("_Describe what exists today.");
    expect(planExplicit).toContain(`Repository root: \`${repoRoot}\``);
    expect(planExplicit).toContain("_Describe what exists today.");
    expect(planLegacy).toContain(`Repository root: \`${repoRoot}\``);
    expect(planLegacy).toContain("_Describe what exists today.");
  });
});

// ---------------------------------------------------------------------------
// generatePlanWithMeta (Phase 6)
// ---------------------------------------------------------------------------

describe("generatePlanWithMeta", () => {
  it("reports usedTemplate=false when no template exists", () => {
    const result = generatePlanWithMeta({ goal: "Test", repoRoot: tmp });
    expect(result.usedTemplate).toBe(false);
    expect(result.text).toContain("Test");
    expect(result.templateMode).toBe("default-fallback");
  });

  it("reports usedTemplate=true when valid template exists", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\n{{GOAL}}\n\n## Scope\n\nScope.");
    const result = generatePlanWithMeta({ goal: "Test", repoRoot: tmp });
    expect(result.usedTemplate).toBe(true);
    expect(result.templateMode).toBe("explicit-placeholders");
  });

  it("reports usedTemplate=false when template is malformed", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "No sections.");
    const result = generatePlanWithMeta({ goal: "Test", repoRoot: tmp });
    expect(result.usedTemplate).toBe(false);
    expect(result.templateMode).toBe("invalid");
  });

  it("reports legacy-section-fallback for template without placeholders", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObjective.\n\n## Scope\n\nScope.");
    const result = generatePlanWithMeta({ goal: "Test", repoRoot: tmp });
    expect(result.usedTemplate).toBe(true);
    expect(result.templateMode).toBe("legacy-section-fallback");
  });
});

// ---------------------------------------------------------------------------
// TEMPLATE_PLACEHOLDERS constant (Phase 6)
// ---------------------------------------------------------------------------

describe("TEMPLATE_PLACEHOLDERS", () => {
  it("contains exactly the documented placeholders", () => {
    expect(TEMPLATE_PLACEHOLDERS).toEqual(["{{GOAL}}", "{{REPO_ROOT}}", "{{CURRENT_STATE}}"]);
  });
});

// ---------------------------------------------------------------------------
// Safety: no side effects on other planning files
// ---------------------------------------------------------------------------

describe("plan creation safety", () => {
  it("does not modify the planning protocol", () => {
    initPlanning(tmp);
    const before = readFile(PLANNING_PROTOCOL_REL);

    const plan = generatePlan({ goal: "test", repoRoot: tmp });
    writeCurrentPlan(tmp, plan);

    expect(readFile(PLANNING_PROTOCOL_REL)).toBe(before);
  });

  it("does not modify the task plan template", () => {
    initPlanning(tmp);
    const before = readFile(TASK_PLAN_TEMPLATE_REL);

    const plan = generatePlan({ goal: "test", repoRoot: tmp });
    writeCurrentPlan(tmp, plan);

    expect(readFile(TASK_PLAN_TEMPLATE_REL)).toBe(before);
  });

  it("does not modify the plans index", () => {
    initPlanning(tmp);
    const before = readFile(PLANS_INDEX_REL);

    const plan = generatePlan({ goal: "test", repoRoot: tmp });
    writeCurrentPlan(tmp, plan);

    expect(readFile(PLANS_INDEX_REL)).toBe(before);
  });

  it("does not create archive files", () => {
    initPlanning(tmp);
    const plan = generatePlan({ goal: "test", repoRoot: tmp });
    writeCurrentPlan(tmp, plan);

    const { readdirSync } = require("node:fs");
    const plansDir = join(tmp, ".pi", "plans");
    const files = readdirSync(plansDir) as string[];
    expect(files.sort()).toEqual(["current.md", "index.md"]);
  });
});
