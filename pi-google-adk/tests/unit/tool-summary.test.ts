/**
 * Unit tests: tool access summary (Phase 3).
 *
 * Behavior protected:
 * - Summary includes ADK project tools section
 * - Summary includes Pi subagent/session tools section
 * - Summary includes required safe custom tools section
 * - Summary includes caveats
 * - Summary handles empty plan
 * - toolPlanStatusLabel produces short labels
 */

import { describe, it, expect } from "vitest";
import {
  buildToolAccessSummary,
  toolPlanStatusLabel,
} from "../../src/lib/tool-summary.js";
import { buildToolPlan, emptyToolPlan, type ToolPlan } from "../../src/lib/tool-plan.js";

describe("buildToolAccessSummary", () => {
  it("includes ADK project tools section", () => {
    const plan = buildToolPlan({
      adkNativeTools: ["mcp_toolset"],
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("ADK Project Tools");
    expect(summary).toContain("MCP toolset");
  });

  it("includes Pi subagent/session tools section", () => {
    const plan = buildToolPlan({
      piMonoProfile: "coding",
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Pi Subagent/Session Tools");
    expect(summary).toContain("Coding");
    expect(summary).toContain("read, bash, edit, write");
  });

  it("includes read_only profile", () => {
    const plan = buildToolPlan({
      piMonoProfile: "read_only",
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Read-only");
    expect(summary).toContain("read, grep, find, ls");
  });

  it("includes required safe custom tools section", () => {
    const plan = buildToolPlan({});
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Required Safe Custom Tools");
    expect(summary).toContain("run_adk_agent");
    expect(summary).toContain("resolve_adk_agent");
  });

  it("includes caveats section", () => {
    const plan = buildToolPlan({});
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("advisory");
  });

  it("shows selected extension tools with detection status", () => {
    const plan = buildToolPlan({
      extensionToolsDetected: ["tool_a", "tool_b"],
      extensionToolsSelected: ["tool_a", "tool_c"],
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("tool_a (detected)");
    expect(summary).toContain("tool_c (requested but not currently detected)");
  });

  it("shows count of detected but unselected tools", () => {
    const plan = buildToolPlan({
      extensionToolsDetected: ["tool_a", "tool_b"],
      extensionToolsSelected: [],
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("2 extension tool(s) detected but none selected");
  });

  it("handles empty plan from emptyToolPlan", () => {
    const plan = emptyToolPlan();
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("ADK Project Tools");
    expect(summary).toContain("(none configured)");
    expect(summary).toContain("No preference");
  });

  it("includes ADK native notes", () => {
    const plan = buildToolPlan({
      adkNativeTools: ["mcp_toolset"],
      adkNativeNotes: "Weather API via MCP",
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Weather API via MCP");
  });

  it("shows notes in caveats section", () => {
    const plan = buildToolPlan({
      notes: ["Custom setup required"],
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Custom setup required");
  });
});

describe("toolPlanStatusLabel", () => {
  it("returns empty for undefined plan", () => {
    expect(toolPlanStatusLabel(undefined)).toBe("");
  });

  it("returns [no tool plan] for empty/unknown plan", () => {
    const plan = emptyToolPlan();
    expect(toolPlanStatusLabel(plan)).toBe("[no tool plan]");
  });

  it("includes profile when set", () => {
    const plan = buildToolPlan({ piMonoProfile: "coding" });
    const label = toolPlanStatusLabel(plan);
    expect(label).toContain("coding");
  });

  it("includes adk native tools when set", () => {
    const plan = buildToolPlan({ adkNativeTools: ["mcp_toolset"] });
    const label = toolPlanStatusLabel(plan);
    expect(label).toContain("mcp_toolset");
  });

  it("includes both profile and adk tools", () => {
    const plan = buildToolPlan({
      piMonoProfile: "read_only",
      adkNativeTools: ["openapi_toolset"],
    });
    const label = toolPlanStatusLabel(plan);
    expect(label).toContain("read_only");
    expect(label).toContain("openapi_toolset");
  });
});
