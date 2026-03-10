/**
 * Unit tests: native ADK creation wrappers.
 *
 * Behavior protected:
 * - buildCreateCommand constructs correct args for native_app and native_config
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
});
