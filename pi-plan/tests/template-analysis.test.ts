import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeTemplate,
  analyzeTemplateFromDisk,
  detectPlaceholders,
  type TemplateMode,
} from "../template-analysis.js";
import { parseTemplate, readTemplateSections, type TemplateSection } from "../template-core.js";
import { initPlanning, TASK_PLAN_TEMPLATE_REL } from "../repo.js";
import { TASK_PLAN_TEMPLATE } from "../defaults.js";
import { collectDiagnostics } from "../diagnostics.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-tmpl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
// detectPlaceholders
// ---------------------------------------------------------------------------

describe("detectPlaceholders", () => {
  it("finds {{GOAL}} in section body", () => {
    const sections: TemplateSection[] = [{ heading: "Goal", body: ["{{GOAL}}"] }];
    expect(detectPlaceholders(sections)).toContain("{{GOAL}}");
  });

  it("finds multiple placeholders", () => {
    const sections: TemplateSection[] = [
      { heading: "Goal", body: ["{{GOAL}}"] },
      { heading: "State", body: ["{{REPO_ROOT}} and {{CURRENT_STATE}}"] },
    ];
    const found = detectPlaceholders(sections);
    expect(found).toContain("{{GOAL}}");
    expect(found).toContain("{{REPO_ROOT}}");
    expect(found).toContain("{{CURRENT_STATE}}");
  });

  it("returns empty array when no placeholders present", () => {
    const sections: TemplateSection[] = [{ heading: "Goal", body: ["Describe goal."] }];
    expect(detectPlaceholders(sections)).toEqual([]);
  });

  it("ignores unknown {{...}} tokens", () => {
    const sections: TemplateSection[] = [{ heading: "Custom", body: ["{{UNKNOWN}}"] }];
    expect(detectPlaceholders(sections)).toEqual([]);
  });

  it("deduplicates placeholders", () => {
    const sections: TemplateSection[] = [
      { heading: "A", body: ["{{GOAL}}"] },
      { heading: "B", body: ["{{GOAL}}"] },
    ];
    expect(detectPlaceholders(sections).filter((p) => p === "{{GOAL}}")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// analyzeTemplate — explicit-placeholders mode
// ---------------------------------------------------------------------------

describe("analyzeTemplate — explicit-placeholders", () => {
  it("classifies template with placeholders as explicit-placeholders", () => {
    const sections = parseTemplate("## Goal\n\n{{GOAL}}\n\n## Scope\n\nScope.");
    const result = analyzeTemplate(sections, true);
    expect(result.mode).toBe("explicit-placeholders");
    expect(result.usable).toBe(true);
    expect(result.hasExplicitPlaceholders).toBe(true);
    expect(result.usesFallback).toBe(false);
    expect(result.repairRecommended).toBe(false);
    expect(result.sectionCount).toBe(2);
    expect(result.placeholdersFound).toContain("{{GOAL}}");
  });

  it("includes all found placeholders", () => {
    const sections = parseTemplate(
      "## Goal\n\n{{GOAL}}\n\n## State\n\n{{REPO_ROOT}}\n{{CURRENT_STATE}}",
    );
    const result = analyzeTemplate(sections, true);
    expect(result.placeholdersFound).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// analyzeTemplate — legacy-section-fallback mode
// ---------------------------------------------------------------------------

describe("analyzeTemplate — legacy-section-fallback", () => {
  it("classifies template without placeholders as legacy-section-fallback", () => {
    const sections = parseTemplate("## Goal\n\nDescribe objective.\n\n## Scope\n\nScope.");
    const result = analyzeTemplate(sections, true);
    expect(result.mode).toBe("legacy-section-fallback");
    expect(result.usable).toBe(true);
    expect(result.hasExplicitPlaceholders).toBe(false);
    expect(result.usesFallback).toBe(false);
    expect(result.repairRecommended).toBe(false);
    expect(result.sectionCount).toBe(2);
    expect(result.placeholdersFound).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// analyzeTemplate — default-fallback mode
// ---------------------------------------------------------------------------

describe("analyzeTemplate — default-fallback", () => {
  it("classifies missing file as default-fallback", () => {
    const result = analyzeTemplate(null, false);
    expect(result.mode).toBe("default-fallback");
    expect(result.fileExists).toBe(false);
    expect(result.usable).toBe(false);
    expect(result.usesFallback).toBe(true);
    expect(result.repairRecommended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// analyzeTemplate — invalid mode
// ---------------------------------------------------------------------------

describe("analyzeTemplate — invalid", () => {
  it("classifies file with no H2 sections as invalid", () => {
    const sections = parseTemplate("Just text, no headings.");
    // parseTemplate returns null for no H2 sections
    expect(sections).toBeNull();
    const result = analyzeTemplate(sections, true);
    expect(result.mode).toBe("invalid");
    expect(result.fileExists).toBe(true);
    expect(result.usable).toBe(false);
    expect(result.usesFallback).toBe(true);
    expect(result.repairRecommended).toBe(true);
  });

  it("classifies empty sections array as invalid", () => {
    const result = analyzeTemplate([], true);
    expect(result.mode).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// analyzeTemplateFromDisk
// ---------------------------------------------------------------------------

describe("analyzeTemplateFromDisk", () => {
  it("returns default-fallback when template file does not exist", () => {
    const result = analyzeTemplateFromDisk(tmp);
    expect(result.mode).toBe("default-fallback");
    expect(result.fileExists).toBe(false);
  });

  it("returns explicit-placeholders for default template after init", () => {
    initPlanning(tmp);
    const result = analyzeTemplateFromDisk(tmp);
    expect(result.mode).toBe("explicit-placeholders");
    expect(result.usable).toBe(true);
    expect(result.hasExplicitPlaceholders).toBe(true);
  });

  it("returns invalid for template with no H2 sections", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "No headings here at all.");
    const result = analyzeTemplateFromDisk(tmp);
    expect(result.mode).toBe("invalid");
  });

  it("returns legacy-section-fallback for template without placeholders", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObjective.\n\n## Scope\n\nScope.");
    const result = analyzeTemplateFromDisk(tmp);
    expect(result.mode).toBe("legacy-section-fallback");
  });

  it("returns invalid for empty template file", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "");
    const result = analyzeTemplateFromDisk(tmp);
    // Empty file: exists but readTemplateSections returns null
    expect(result.mode).toBe("invalid");
    expect(result.fileExists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics and generation agree on template classification
// ---------------------------------------------------------------------------

describe("diagnostics and generation agree on template mode", () => {
  it("both see explicit-placeholders for default template", () => {
    initPlanning(tmp);
    const analysis = analyzeTemplateFromDisk(tmp);
    const diag = collectDiagnostics(tmp, tmp);

    expect(analysis.mode).toBe("explicit-placeholders");
    expect(diag.template.mode).toBe("explicit-placeholders");
    expect(diag.template.hasExplicitPlaceholders).toBe(true);
    expect(diag.template.usable).toBe(analysis.usable);
    expect(diag.template.sectionCount).toBe(analysis.sectionCount);
  });

  it("both see invalid for malformed template", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "no sections");
    const analysis = analyzeTemplateFromDisk(tmp);
    const diag = collectDiagnostics(tmp, tmp);

    expect(analysis.mode).toBe("invalid");
    expect(diag.template.mode).toBe("invalid");
    expect(diag.template.repairRecommended).toBe(true);
  });

  it("both see legacy-section-fallback for placeholder-free template", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nObjective.\n\n## Design\n\nApproach.");
    const analysis = analyzeTemplateFromDisk(tmp);
    const diag = collectDiagnostics(tmp, tmp);

    expect(analysis.mode).toBe("legacy-section-fallback");
    expect(diag.template.mode).toBe("legacy-section-fallback");
    expect(diag.template.hasExplicitPlaceholders).toBe(false);
  });

  it("both see default-fallback when template file does not exist", () => {
    // Not initialized — no template file
    const analysis = analyzeTemplateFromDisk(tmp);
    const diag = collectDiagnostics(tmp, tmp);

    expect(analysis.mode).toBe("default-fallback");
    expect(diag.template.mode).toBe("default-fallback");
  });
});
