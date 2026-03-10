/**
 * Unit tests: safe-tool-registration.
 *
 * Behavior protected:
 * - Registers immediately if __piSubagents_registerSafeTool exists
 * - Queues to __piSubagents_pendingSafeTools if register function not available
 * - Multiple registrations accumulate in pending array
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerSafeToolForSubagents } from "../../src/lib/safe-tool-registration.js";
import { makeFakeTool } from "./helpers/fake-tool-local.js";

const g = globalThis as Record<string, unknown>;
const REGISTER_FN_KEY = "__piSubagents_registerSafeTool";
const PENDING_KEY = "__piSubagents_pendingSafeTools";

// Save and restore global state
let savedRegisterFn: unknown;
let savedPending: unknown;

beforeEach(() => {
  savedRegisterFn = g[REGISTER_FN_KEY];
  savedPending = g[PENDING_KEY];
  delete g[REGISTER_FN_KEY];
  delete g[PENDING_KEY];
});

afterEach(() => {
  if (savedRegisterFn !== undefined) {
    g[REGISTER_FN_KEY] = savedRegisterFn;
  } else {
    delete g[REGISTER_FN_KEY];
  }
  if (savedPending !== undefined) {
    g[PENDING_KEY] = savedPending;
  } else {
    delete g[PENDING_KEY];
  }
});

describe("registerSafeToolForSubagents", () => {
  it("registers immediately when __piSubagents_registerSafeTool exists", () => {
    const registered: string[] = [];
    g[REGISTER_FN_KEY] = (tool: { name: string }) => {
      registered.push(tool.name);
    };

    const tool = makeFakeTool("test_tool");
    registerSafeToolForSubagents(tool);

    expect(registered).toEqual(["test_tool"]);
    // Should not create pending array
    expect(g[PENDING_KEY]).toBeUndefined();
  });

  it("queues to pending array when register function not available", () => {
    const tool = makeFakeTool("queued_tool");
    registerSafeToolForSubagents(tool);

    expect(Array.isArray(g[PENDING_KEY])).toBe(true);
    const pending = g[PENDING_KEY] as Array<{ name: string }>;
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe("queued_tool");
  });

  it("accumulates multiple tools in pending array", () => {
    registerSafeToolForSubagents(makeFakeTool("tool_a"));
    registerSafeToolForSubagents(makeFakeTool("tool_b"));

    const pending = g[PENDING_KEY] as Array<{ name: string }>;
    expect(pending).toHaveLength(2);
    expect(pending.map((t) => t.name)).toEqual(["tool_a", "tool_b"]);
  });
});
