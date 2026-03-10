/**
 * Extension-level tests: tool registration.
 *
 * Behavior protected:
 * - Extension registers exactly two tools
 * - Tool names, labels, and descriptions are correct
 * - Parameter schemas include required fields
 */

import { describe, it, expect } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

describe("extension registration", () => {
  it("registers exactly two tools", () => {
    const { api, registeredTools } = createMockExtensionAPI();
    piGoogleAdkExtension(api);
    expect(registeredTools).toHaveLength(2);
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
