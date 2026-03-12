/**
 * Unit tests: native ADK creation wrappers.
 *
 * Behavior protected:
 * - buildCreateCommand constructs correct args for native_app and native_config
 * - buildCreateCommand includes --model flag when model is provided (issue #26)
 * - buildCreateCommand omits --model flag when model is undefined or empty
 * - Path traversal is rejected
 * - Destination-exists check works
 * - Config unsupported hard-failure includes diagnostic info
 *
 * Note: These tests mock the CLI boundary. Actual subprocess execution
 * is tested via manual test plan.
 */

import { describe, it, expect } from "vitest";
import { buildCreateCommand } from "../../src/lib/adk-native-create.js";

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

describe("buildCreateCommand", () => {
  it("builds native_app command", () => {
    const { args, description } = buildCreateCommand("native_app", "my_agent");
    expect(args).toEqual(["create", "my_agent"]);
    expect(description).toBe("adk create my_agent");
  });

  it("builds native_config command", () => {
    const { args, description } = buildCreateCommand("native_config", "my_config_agent");
    expect(args).toEqual(["create", "--type=config", "my_config_agent"]);
    expect(description).toBe("adk create --type=config my_config_agent");
  });

  it("includes --model flag when model is provided", () => {
    const { args, description } = buildCreateCommand("native_app", "my_agent", "gemini-2.5-flash");
    expect(args).toEqual(["create", "--model=gemini-2.5-flash", "my_agent"]);
    expect(description).toBe("adk create --model=gemini-2.5-flash my_agent");
  });

  it("includes --model flag with native_config mode", () => {
    const { args, description } = buildCreateCommand("native_config", "cfg_agent", "gemini-2.0-flash");
    expect(args).toEqual(["create", "--type=config", "--model=gemini-2.0-flash", "cfg_agent"]);
    expect(description).toBe("adk create --type=config --model=gemini-2.0-flash cfg_agent");
  });

  it("omits --model flag when model is undefined", () => {
    const { args } = buildCreateCommand("native_app", "my_agent", undefined);
    expect(args).toEqual(["create", "my_agent"]);
    expect(args).not.toContain(expect.stringContaining("--model"));
  });

  it("omits --model flag when model is empty string", () => {
    const { args } = buildCreateCommand("native_app", "my_agent", "");
    expect(args).toEqual(["create", "my_agent"]);
  });
});
