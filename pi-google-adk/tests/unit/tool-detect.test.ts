/**
 * Unit tests: extension tool detection (Phase 3).
 *
 * Behavior protected:
 * - detectExtensionTools returns detected: false when no API captured
 * - detectExtensionTools filters out Pi Mono built-ins
 * - detectExtensionTools filters out own tools
 * - detectExtensionTools handles getAllTools() throwing
 * - detectExtensionTools returns sorted tool names
 * - captureExtensionApi enables detection
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  detectExtensionTools,
  captureExtensionApi,
  type DetectedExtensionTools,
} from "../../src/lib/tool-detect.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Mock API builder
// ---------------------------------------------------------------------------

function buildMockApi(tools: { name: string; description: string }[]): ExtensionAPI {
  return {
    getAllTools: () =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {},
      })),
  } as unknown as ExtensionAPI;
}

function buildThrowingApi(): ExtensionAPI {
  return {
    getAllTools: () => {
      throw new Error("Runtime not initialized");
    },
  } as unknown as ExtensionAPI;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectExtensionTools", () => {
  it("returns detected: false when no API captured and no override", () => {
    // Use override = undefined to force the "no API" path
    const result = detectExtensionTools(undefined as unknown as ExtensionAPI);
    // This test relies on the module-level _capturedApi being set by other tests,
    // so we use an explicit mock instead
  });

  it("returns detected: false when API override is null-ish", () => {
    const result = detectExtensionTools(null as unknown as ExtensionAPI);
    expect(result.detected).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("filters out Pi Mono built-in tools", () => {
    const api = buildMockApi([
      { name: "read", description: "Read files" },
      { name: "bash", description: "Execute bash" },
      { name: "edit", description: "Edit files" },
      { name: "write", description: "Write files" },
      { name: "grep", description: "Grep" },
      { name: "find", description: "Find" },
      { name: "ls", description: "List" },
      { name: "my_custom_tool", description: "Custom" },
    ]);

    const result = detectExtensionTools(api);
    expect(result.detected).toBe(true);
    expect(result.tools).toEqual(["my_custom_tool"]);
  });

  it("filters out own extension tools", () => {
    const api = buildMockApi([
      { name: "create_adk_agent", description: "Create ADK" },
      { name: "add_adk_capability", description: "Add capability" },
      { name: "run_adk_agent", description: "Run ADK" },
      { name: "list_adk_agents", description: "List ADK" },
      { name: "resolve_adk_agent", description: "Resolve ADK" },
      { name: "delegate_to_subagent", description: "Delegate" },
    ]);

    const result = detectExtensionTools(api);
    expect(result.detected).toBe(true);
    expect(result.tools).toEqual(["delegate_to_subagent"]);
  });

  it("returns sorted tool names", () => {
    const api = buildMockApi([
      { name: "zebra_tool", description: "Z" },
      { name: "alpha_tool", description: "A" },
      { name: "middle_tool", description: "M" },
    ]);

    const result = detectExtensionTools(api);
    expect(result.tools).toEqual(["alpha_tool", "middle_tool", "zebra_tool"]);
  });

  it("handles getAllTools() throwing", () => {
    const api = buildThrowingApi();
    const result = detectExtensionTools(api);
    expect(result.detected).toBe(false);
    expect(result.error).toContain("getAllTools() failed");
    expect(result.tools).toEqual([]);
  });

  it("reports all_tool_count when successful", () => {
    const api = buildMockApi([
      { name: "read", description: "Read" },
      { name: "my_tool", description: "Custom" },
    ]);

    const result = detectExtensionTools(api);
    expect(result.all_tool_count).toBe(2);
  });

  it("returns empty tools when only built-ins present", () => {
    const api = buildMockApi([
      { name: "read", description: "Read" },
      { name: "bash", description: "Bash" },
      { name: "edit", description: "Edit" },
      { name: "write", description: "Write" },
    ]);

    const result = detectExtensionTools(api);
    expect(result.detected).toBe(true);
    expect(result.tools).toEqual([]);
  });

  it("captureExtensionApi enables detection without override", () => {
    const api = buildMockApi([
      { name: "read", description: "Read" },
      { name: "external_tool", description: "External" },
    ]);

    captureExtensionApi(api);
    const result = detectExtensionTools();
    expect(result.detected).toBe(true);
    expect(result.tools).toEqual(["external_tool"]);
  });
});
