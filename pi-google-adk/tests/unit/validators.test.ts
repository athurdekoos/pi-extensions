/**
 * Unit tests: validators.
 *
 * Behavior protected:
 * - Agent name validation (lowercase, no leading digit, length, special chars)
 * - Tool name validation (same rules as agent name)
 * - Template and capability type guards
 */

import { describe, it, expect } from "vitest";
import {
  validateAgentName,
  validateToolName,
  isValidTemplate,
  isValidCapability,
} from "../../src/lib/validators.js";

describe("validateAgentName", () => {
  it("accepts valid lowercase names", () => {
    expect(validateAgentName("my_agent")).toBeNull();
    expect(validateAgentName("a")).toBeNull();
    expect(validateAgentName("agent123")).toBeNull();
    expect(validateAgentName("x_y_z")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateAgentName("")).not.toBeNull();
  });

  it("rejects whitespace-only string", () => {
    expect(validateAgentName("   ")).not.toBeNull();
  });

  it("rejects leading digit", () => {
    expect(validateAgentName("123bad")).not.toBeNull();
  });

  it("rejects uppercase letters", () => {
    expect(validateAgentName("BAD")).not.toBeNull();
    expect(validateAgentName("camelCase")).not.toBeNull();
  });

  it("rejects dashes", () => {
    expect(validateAgentName("has-dash")).not.toBeNull();
  });

  it("rejects spaces", () => {
    expect(validateAgentName("has space")).not.toBeNull();
  });

  it("rejects names longer than 64 characters", () => {
    expect(validateAgentName("a".repeat(65))).not.toBeNull();
  });

  it("accepts name at exactly 64 characters", () => {
    expect(validateAgentName("a".repeat(64))).toBeNull();
  });
});

describe("validateToolName", () => {
  it("accepts valid tool names", () => {
    expect(validateToolName("my_tool")).toBeNull();
    expect(validateToolName("fetch_data")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateToolName("")).not.toBeNull();
  });

  it("rejects uppercase", () => {
    expect(validateToolName("BAD")).not.toBeNull();
  });

  it("rejects names longer than 64 characters", () => {
    expect(validateToolName("a".repeat(65))).not.toBeNull();
  });
});

describe("isValidTemplate", () => {
  it("accepts known templates", () => {
    expect(isValidTemplate("basic")).toBe(true);
    expect(isValidTemplate("mcp")).toBe(true);
    expect(isValidTemplate("sequential")).toBe(true);
  });

  it("rejects unknown templates", () => {
    expect(isValidTemplate("advanced")).toBe(false);
    expect(isValidTemplate("")).toBe(false);
  });
});

describe("isValidCapability", () => {
  it("accepts known capabilities", () => {
    expect(isValidCapability("custom_tool")).toBe(true);
    expect(isValidCapability("mcp_toolset")).toBe(true);
    expect(isValidCapability("sequential_workflow")).toBe(true);
    expect(isValidCapability("eval_stub")).toBe(true);
    expect(isValidCapability("deploy_stub")).toBe(true);
    expect(isValidCapability("observability_notes")).toBe(true);
  });

  it("rejects unknown capabilities", () => {
    expect(isValidCapability("magic")).toBe(false);
    expect(isValidCapability("")).toBe(false);
  });
});
