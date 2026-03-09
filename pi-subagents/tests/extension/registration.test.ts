/**
 * Extension-level tests: tool registration behavior.
 *
 * Behavior protected:
 * - Parent mode registers exactly delegate_to_subagent
 * - Child mode (childDepth > 0) registers nothing
 * - Tool metadata is correct
 */

import { describe, it, expect, beforeEach } from "vitest";
import piSubagentsExtension, { _setChildDepth } from "../../index.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

beforeEach(() => {
  _setChildDepth(0);
});

describe("parent-mode registration", () => {
  it("registers exactly one tool named delegate_to_subagent", () => {
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0].name).toBe("delegate_to_subagent");
  });

  it("tool has a non-empty description", () => {
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent");
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeGreaterThan(10);
  });

  it("tool has a human-readable label", () => {
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent");
    expect(tool!.label).toBeTruthy();
  });
});

describe("child-mode registration", () => {
  it("registers no tools when childDepth is 1", () => {
    _setChildDepth(1);
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);
    expect(registeredTools).toHaveLength(0);
  });

  it("registers no tools when childDepth is > 1", () => {
    _setChildDepth(3);
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);
    expect(registeredTools).toHaveLength(0);
  });
});
