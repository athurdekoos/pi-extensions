/**
 * Unit tests: safe custom tool resolution.
 *
 * Behavior protected:
 * - Only explicitly allowlisted tools are returned
 * - delegate_to_subagent is always excluded even if allowlisted
 * - Empty allowlist returns no tools
 * - Unknown tool names are silently ignored
 */

import { describe, it, expect } from "vitest";
import { resolveAllowedCustomTools } from "../../index.js";
import { makeFakeTool } from "../helpers/fake-tool.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

function makeRegistry(...names: string[]): ToolDefinition[] {
  return names.map((n) => makeFakeTool(n));
}

describe("resolveAllowedCustomTools", () => {
  it("returns only tools whose names are in the allowlist", () => {
    const registry = makeRegistry("tool_a", "tool_b", "tool_c");
    const result = resolveAllowedCustomTools([], registry, ["tool_b"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("tool_b");
  });

  it("returns multiple allowlisted tools", () => {
    const registry = makeRegistry("tool_a", "tool_b", "tool_c");
    const result = resolveAllowedCustomTools([], registry, ["tool_a", "tool_c"]);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name).sort()).toEqual(["tool_a", "tool_c"]);
  });

  it("always excludes delegate_to_subagent even if explicitly listed", () => {
    const registry = makeRegistry("delegate_to_subagent", "tool_a");
    const result = resolveAllowedCustomTools(
      [],
      registry,
      ["delegate_to_subagent", "tool_a"]
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("tool_a");
  });

  it("returns empty array when allowlist is empty", () => {
    const registry = makeRegistry("tool_a", "tool_b");
    const result = resolveAllowedCustomTools([], registry, []);
    expect(result).toHaveLength(0);
  });

  it("ignores unknown tool names silently", () => {
    const registry = makeRegistry("tool_a");
    const result = resolveAllowedCustomTools([], registry, ["nonexistent"]);
    expect(result).toHaveLength(0);
  });

  it("handles mixed known and unknown names", () => {
    const registry = makeRegistry("tool_a", "tool_b");
    const result = resolveAllowedCustomTools(
      [],
      registry,
      ["tool_a", "nonexistent", "tool_b"]
    );
    expect(result).toHaveLength(2);
  });

  it("returns empty array when registry is empty", () => {
    const result = resolveAllowedCustomTools([], [], ["tool_a"]);
    expect(result).toHaveLength(0);
  });
});
