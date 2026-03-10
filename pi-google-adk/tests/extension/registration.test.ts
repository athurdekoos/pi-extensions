/**
 * Extension-level tests: tool registration.
 *
 * Behavior protected:
 * - Extension registers exactly three tools
 * - Tool names, labels, and descriptions are correct
 * - Parameter schemas include required fields
 * - run_adk_agent is registered as a safe tool for subagents
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

// Save/restore global state for safe-tool registration tests
const g = globalThis as Record<string, unknown>;
const REGISTER_FN_KEY = "__piSubagents_registerSafeTool";
const PENDING_KEY = "__piSubagents_pendingSafeTools";
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

describe("extension registration", () => {
  it("registers exactly five tools", () => {
    const { api, registeredTools } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    expect(registeredTools).toHaveLength(5);
  });

  it("registers create_adk_agent tool", () => {
    const { api, getTool } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    const tool = getTool("create_adk_agent");
    expect(tool).toBeDefined();
    expect(tool!.label).toBeTruthy();
    expect(tool!.description.length).toBeGreaterThan(10);
  });

  it("registers add_adk_capability tool", () => {
    const { api, getTool } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    const tool = getTool("add_adk_capability");
    expect(tool).toBeDefined();
    expect(tool!.label).toBeTruthy();
    expect(tool!.description.length).toBeGreaterThan(10);
  });

  it("registers run_adk_agent tool", () => {
    const { api, getTool } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    const tool = getTool("run_adk_agent");
    expect(tool).toBeDefined();
    expect(tool!.label).toBeTruthy();
    expect(tool!.description).toContain("ADK");
  });

  it("run_adk_agent has required project_path and prompt parameters", () => {
    const { api, getTool } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    const tool = getTool("run_adk_agent");
    const schema = tool!.parameters as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toContain("project_path");
    expect(schema.required).toContain("prompt");
    expect(schema.properties).toHaveProperty("timeout_seconds");
  });

  it("run_adk_agent and resolve_adk_agent are queued as pending safe tools when pi-subagents not loaded", () => {
    const { api } = createMockExtensionAPI();
    piGoogleAdkExtension(api);

    const pending = g[PENDING_KEY] as Array<{ name: string }>;
    expect(Array.isArray(pending)).toBe(true);
    const names = pending.map((t) => t.name);
    expect(names).toContain("run_adk_agent");
    expect(names).toContain("resolve_adk_agent");
  });

  it("run_adk_agent and resolve_adk_agent register immediately when pi-subagents register function exists", () => {
    const registered: string[] = [];
    g[REGISTER_FN_KEY] = (tool: { name: string }) => {
      registered.push(tool.name);
    };

    const { api } = createMockExtensionAPI();
    piGoogleAdkExtension(api);

    expect(registered).toContain("run_adk_agent");
    expect(registered).toContain("resolve_adk_agent");
  });

  it("create_adk_agent has required 'name' parameter in schema", () => {
    const { api, getTool } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    const tool = getTool("create_adk_agent");
    const schema = tool!.parameters as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toContain("name");
    expect(schema.properties).toHaveProperty("name");
  });

  it("add_adk_capability has required parameters in schema", () => {
    const { api, getTool } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    const tool = getTool("add_adk_capability");
    const schema = tool!.parameters as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toContain("project_path");
    expect(schema.required).toContain("capability");
  });

  it("tool names are stable across registrations", () => {
    const result1 = createMockExtensionAPI();
    piGoogleAdkExtension(result1.api);
    const result2 = createMockExtensionAPI();
    piGoogleAdkExtension(result2.api);

    const names1 = result1.registeredTools.map((t) => t.name).sort();
    const names2 = result2.registeredTools.map((t) => t.name).sort();
    expect(names1).toEqual(names2);
  });
});
