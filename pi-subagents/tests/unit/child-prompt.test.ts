/**
 * Unit tests: child system prompt construction.
 *
 * Behavior protected:
 * - Child prompt always contains the task
 * - Child prompt always forbids delegation
 * - Output style instructions are correct
 * - Files and success criteria are included when provided
 */

import { describe, it, expect } from "vitest";
import { buildChildSystemPrompt, type DelegateParams } from "../../index.js";

function baseParams(overrides: Partial<DelegateParams> = {}): DelegateParams {
  return { task: "Summarize the README", ...overrides };
}

describe("buildChildSystemPrompt", () => {
  it("always includes the task text", () => {
    const prompt = buildChildSystemPrompt(baseParams({ task: "Read src/index.ts" }));
    expect(prompt).toContain("TASK: Read src/index.ts");
  });

  it("always forbids delegation", () => {
    const prompt = buildChildSystemPrompt(baseParams());
    expect(prompt).toMatch(/do not delegate/i);
    expect(prompt).toMatch(/subagent/i);
  });

  it("instructs summary output by default", () => {
    const prompt = buildChildSystemPrompt(baseParams());
    expect(prompt).toMatch(/concise summary/i);
  });

  it("instructs patch_plan output when requested", () => {
    const prompt = buildChildSystemPrompt(baseParams({ outputStyle: "patch_plan" }));
    expect(prompt).toMatch(/patch plan/i);
  });

  it("instructs full_report output when requested", () => {
    const prompt = buildChildSystemPrompt(baseParams({ outputStyle: "full_report" }));
    expect(prompt).toMatch(/full detailed report/i);
  });

  it("includes success criteria when provided", () => {
    const prompt = buildChildSystemPrompt(
      baseParams({ successCriteria: "All exported functions have JSDoc" })
    );
    expect(prompt).toContain("Success criteria: All exported functions have JSDoc");
  });

  it("omits success criteria when not provided", () => {
    const prompt = buildChildSystemPrompt(baseParams());
    expect(prompt).not.toContain("Success criteria:");
  });

  it("lists focused files when provided", () => {
    const prompt = buildChildSystemPrompt(
      baseParams({ files: ["src/a.ts", "src/b.ts"] })
    );
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("src/b.ts");
  });

  it("omits file section when no files provided", () => {
    const prompt = buildChildSystemPrompt(baseParams());
    expect(prompt).not.toContain("Focus on these files");
  });

  it("instructs the child to use only available tools", () => {
    const prompt = buildChildSystemPrompt(baseParams());
    expect(prompt).toMatch(/use only the tools available/i);
  });

  it("instructs the child to state when a tool is unavailable", () => {
    const prompt = buildChildSystemPrompt(baseParams());
    expect(prompt).toMatch(/unavailable.*state.*clearly/i);
  });
});
