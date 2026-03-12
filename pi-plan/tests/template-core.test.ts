import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseTemplate,
  readTemplateSections,
  TEMPLATE_PLACEHOLDERS,
  buildCurrentStateValue,
  type TemplateSection,
} from "../template-core.js";
import { TASK_PLAN_TEMPLATE_REL } from "../repo.js";
import { TASK_PLAN_TEMPLATE, DEFAULT_CURRENT_STATE_TEMPLATE } from "../defaults.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-core-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

// ---------------------------------------------------------------------------
// TEMPLATE_PLACEHOLDERS
// ---------------------------------------------------------------------------

describe("TEMPLATE_PLACEHOLDERS", () => {
  it("contains exactly the documented placeholders", () => {
    expect(TEMPLATE_PLACEHOLDERS).toEqual(["{{GOAL}}", "{{REPO_ROOT}}", "{{CURRENT_STATE}}"]);
  });

  it("is readonly", () => {
    // TypeScript enforces this, but verify the runtime array is correct
    expect(TEMPLATE_PLACEHOLDERS.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseTemplate
// ---------------------------------------------------------------------------

describe("parseTemplate", () => {
  it("extracts H2 sections from template text", () => {
    const template = "# Title\n\n## Goal\n\nObjective\n\n## Scope\n\nIn scope";
    const sections = parseTemplate(template);
    expect(sections).not.toBeNull();
    expect(sections!.length).toBe(2);
    expect(sections![0].heading).toBe("Goal");
    expect(sections![1].heading).toBe("Scope");
  });

  it("captures body content under sections", () => {
    const template = "## Goal\n\nObjective text\n\n## Risks\n\n- Risk one\n- Risk two";
    const sections = parseTemplate(template);
    expect(sections![0].body).toEqual(["Objective text"]);
    expect(sections![1].body).toEqual(["- Risk one", "- Risk two"]);
  });

  it("returns null for text with no H2 sections", () => {
    expect(parseTemplate("Just some text")).toBeNull();
    expect(parseTemplate("# Only H1")).toBeNull();
    expect(parseTemplate("")).toBeNull();
  });

  it("skips H1 lines", () => {
    const sections = parseTemplate("# Title\n\n## Section\n\nContent");
    expect(sections!.length).toBe(1);
    expect(sections![0].heading).toBe("Section");
  });

  it("trims leading/trailing empty lines from body", () => {
    const sections = parseTemplate("## Section\n\n\n  Content  \n\n\n## Next\n\nMore");
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
    writeFile(TASK_PLAN_TEMPLATE_REL, "Random text without headings");
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
// buildCurrentStateValue
// ---------------------------------------------------------------------------

describe("buildCurrentStateValue", () => {
  it("uses DEFAULT_CURRENT_STATE_TEMPLATE when no override provided", () => {
    const result = buildCurrentStateValue("/repo");
    expect(result).toContain("Repository root: `/repo`");
    expect(result).toContain("_Describe what exists today.");
  });

  it("uses DEFAULT_CURRENT_STATE_TEMPLATE when override is null", () => {
    const result = buildCurrentStateValue("/repo", null);
    expect(result).toContain("Repository root: `/repo`");
  });

  it("uses DEFAULT_CURRENT_STATE_TEMPLATE when override is undefined", () => {
    const result = buildCurrentStateValue("/repo", undefined);
    expect(result).toContain("Repository root: `/repo`");
  });

  it("uses custom template when provided", () => {
    const result = buildCurrentStateValue("/repo", "Project at `{{REPO_ROOT}}`. Custom.");
    expect(result).toBe("Project at `/repo`. Custom.");
  });

  it("substitutes {{REPO_ROOT}} in custom template", () => {
    const result = buildCurrentStateValue("/my/path", "Root: {{REPO_ROOT}}");
    expect(result).toBe("Root: /my/path");
  });

  it("handles custom template without {{REPO_ROOT}}", () => {
    const result = buildCurrentStateValue("/repo", "Static current state text.");
    expect(result).toBe("Static current state text.");
  });

  it("handles multi-line custom template", () => {
    const result = buildCurrentStateValue("/repo", "Line 1: `{{REPO_ROOT}}`\n\nLine 2: custom");
    expect(result).toBe("Line 1: `/repo`\n\nLine 2: custom");
  });

  it("produces same result as DEFAULT_CURRENT_STATE_TEMPLATE with manual substitution", () => {
    const repoRoot = "/test/path";
    const expected = DEFAULT_CURRENT_STATE_TEMPLATE.replaceAll("{{REPO_ROOT}}", repoRoot);
    expect(buildCurrentStateValue(repoRoot)).toBe(expected);
  });
});
