/**
 * Unit tests: tool-plan model (Phase 3).
 *
 * Behavior protected:
 * - emptyToolPlan returns valid default structure
 * - buildToolPlan resolves profile tools
 * - buildToolPlan includes run_adk_agent and resolve_adk_agent in required safe tools
 * - buildToolPlan adds standard caveats
 * - buildToolPlanFromParams validates categories and profile
 * - profileTools maps correctly for all profiles
 * - PI_MONO_PROFILE_TOOLS is correct
 */

import { describe, it, expect } from "vitest";
import {
  emptyToolPlan,
  buildToolPlan,
  buildToolPlanFromParams,
  profileTools,
  PI_MONO_PROFILE_TOOLS,
  ADK_NATIVE_TOOL_CATEGORIES,
  type ToolPlan,
} from "../../src/lib/tool-plan.js";

describe("PI_MONO_PROFILE_TOOLS", () => {
  it("read_only maps to read, grep, find, ls", () => {
    expect(PI_MONO_PROFILE_TOOLS.read_only).toEqual(["read", "grep", "find", "ls"]);
  });

  it("coding maps to read, bash, edit, write", () => {
    expect(PI_MONO_PROFILE_TOOLS.coding).toEqual(["read", "bash", "edit", "write"]);
  });

  it("unknown maps to empty array", () => {
    expect(PI_MONO_PROFILE_TOOLS.unknown).toEqual([]);
  });
});

describe("profileTools", () => {
  it("returns correct tools for read_only", () => {
    expect(profileTools("read_only")).toEqual(["read", "grep", "find", "ls"]);
  });

  it("returns correct tools for coding", () => {
    expect(profileTools("coding")).toEqual(["read", "bash", "edit", "write"]);
  });

  it("returns empty for unknown profile", () => {
    expect(profileTools("unknown")).toEqual([]);
  });

  it("returns empty for unrecognized string", () => {
    expect(profileTools("nonexistent")).toEqual([]);
  });
});

describe("emptyToolPlan", () => {
  it("returns a valid default plan", () => {
    const plan = emptyToolPlan();
    expect(plan.adk_native_tools).toEqual([]);
    expect(plan.pi_mono_profile).toBe("unknown");
    expect(plan.pi_mono_builtin_tools).toEqual([]);
    expect(plan.installed_extension_tools_detected).toEqual([]);
    expect(plan.installed_extension_tools_selected).toEqual([]);
    expect(plan.required_safe_custom_tools).toEqual([]);
    expect(plan.notes).toContain("Tool planning was skipped.");
    expect(plan.caveats).toEqual([]);
  });

  it("is serializable", () => {
    const plan = emptyToolPlan();
    const json = JSON.stringify(plan);
    const parsed = JSON.parse(json);
    expect(parsed.pi_mono_profile).toBe("unknown");
  });
});

describe("buildToolPlan", () => {
  it("resolves profile tools for read_only", () => {
    const plan = buildToolPlan({ piMonoProfile: "read_only" });
    expect(plan.pi_mono_profile).toBe("read_only");
    expect(plan.pi_mono_builtin_tools).toEqual(["read", "grep", "find", "ls"]);
  });

  it("resolves profile tools for coding", () => {
    const plan = buildToolPlan({ piMonoProfile: "coding" });
    expect(plan.pi_mono_profile).toBe("coding");
    expect(plan.pi_mono_builtin_tools).toEqual(["read", "bash", "edit", "write"]);
  });

  it("includes run_adk_agent in required safe tools by default", () => {
    const plan = buildToolPlan({});
    expect(plan.required_safe_custom_tools).toContain("run_adk_agent");
  });

  it("includes resolve_adk_agent in required safe tools by default", () => {
    const plan = buildToolPlan({});
    expect(plan.required_safe_custom_tools).toContain("resolve_adk_agent");
  });

  it("does not duplicate run_adk_agent if already provided", () => {
    const plan = buildToolPlan({
      requiredSafeCustomTools: ["run_adk_agent"],
    });
    const count = plan.required_safe_custom_tools.filter((t) => t === "run_adk_agent").length;
    expect(count).toBe(1);
  });

  it("adds selected extension tools to required safe tools", () => {
    const plan = buildToolPlan({
      extensionToolsSelected: ["my_custom_tool"],
    });
    expect(plan.required_safe_custom_tools).toContain("my_custom_tool");
  });

  it("adds standard caveat", () => {
    const plan = buildToolPlan({});
    expect(plan.caveats.length).toBeGreaterThan(0);
    expect(plan.caveats.some((c) => c.includes("advisory"))).toBe(true);
  });

  it("preserves ADK-native tool categories", () => {
    const plan = buildToolPlan({
      adkNativeTools: ["mcp_toolset", "custom_function_tools"],
    });
    expect(plan.adk_native_tools).toEqual(["mcp_toolset", "custom_function_tools"]);
  });

  it("preserves adk native notes", () => {
    const plan = buildToolPlan({
      adkNativeNotes: "Uses weather MCP server",
    });
    expect(plan.adk_native_notes).toBe("Uses weather MCP server");
  });

  it("preserves extension tools detected vs selected", () => {
    const plan = buildToolPlan({
      extensionToolsDetected: ["tool_a", "tool_b", "tool_c"],
      extensionToolsSelected: ["tool_a"],
    });
    expect(plan.installed_extension_tools_detected).toEqual(["tool_a", "tool_b", "tool_c"]);
    expect(plan.installed_extension_tools_selected).toEqual(["tool_a"]);
  });

  it("is serializable as JSON", () => {
    const plan = buildToolPlan({
      adkNativeTools: ["mcp_toolset"],
      piMonoProfile: "coding",
      extensionToolsDetected: ["delegate_to_subagent"],
      extensionToolsSelected: ["delegate_to_subagent"],
      notes: ["Test plan"],
    });
    const json = JSON.stringify(plan, null, 2);
    const parsed = JSON.parse(json) as ToolPlan;
    expect(parsed.adk_native_tools).toEqual(["mcp_toolset"]);
    expect(parsed.pi_mono_profile).toBe("coding");
    expect(parsed.pi_mono_builtin_tools).toEqual(["read", "bash", "edit", "write"]);
  });
});

describe("buildToolPlanFromParams", () => {
  it("validates adk_native_tools categories", () => {
    const plan = buildToolPlanFromParams({
      adk_native_tools: ["mcp_toolset", "invalid_category", "openapi_toolset"],
    });
    expect(plan.adk_native_tools).toEqual(["mcp_toolset", "openapi_toolset"]);
  });

  it("validates pi_mono_profile", () => {
    const plan = buildToolPlanFromParams({ pi_mono_profile: "coding" });
    expect(plan.pi_mono_profile).toBe("coding");
  });

  it("defaults to unknown for invalid profile", () => {
    const plan = buildToolPlanFromParams({ pi_mono_profile: "invalid" });
    expect(plan.pi_mono_profile).toBe("unknown");
  });

  it("passes through extension_tools", () => {
    const plan = buildToolPlanFromParams({ extension_tools: ["my_tool"] });
    expect(plan.installed_extension_tools_selected).toEqual(["my_tool"]);
  });

  it("passes through detected extension tools", () => {
    const plan = buildToolPlanFromParams({
      detectedExtensionTools: ["ext_a", "ext_b"],
    });
    expect(plan.installed_extension_tools_detected).toEqual(["ext_a", "ext_b"]);
  });

  it("includes tool_notes in notes", () => {
    const plan = buildToolPlanFromParams({ tool_notes: "For research workflow" });
    expect(plan.notes).toContain("For research workflow");
  });

  it("handles completely empty params", () => {
    const plan = buildToolPlanFromParams({});
    expect(plan.pi_mono_profile).toBe("unknown");
    expect(plan.adk_native_tools).toEqual([]);
    expect(plan.required_safe_custom_tools).toContain("run_adk_agent");
  });
});

describe("ADK_NATIVE_TOOL_CATEGORIES", () => {
  it("contains expected categories", () => {
    expect(ADK_NATIVE_TOOL_CATEGORIES).toContain("none");
    expect(ADK_NATIVE_TOOL_CATEGORIES).toContain("mcp_toolset");
    expect(ADK_NATIVE_TOOL_CATEGORIES).toContain("openapi_toolset");
    expect(ADK_NATIVE_TOOL_CATEGORIES).toContain("custom_function_tools");
    expect(ADK_NATIVE_TOOL_CATEGORIES).toContain("other");
  });
});
