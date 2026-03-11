/**
 * Extension-level tests: native creation tool behavior.
 *
 * Behavior protected:
 * - create_adk_agent with mode=native_app attempts native creation
 * - create_adk_agent with mode=native_config runs capability detection
 * - Invalid names are rejected before any CLI call
 * - Path traversal is rejected
 * - Legacy modes are rejected with migration guidance
 * - Deprecated template param is rejected with migration guidance
 * - Default mode is native_app when no mode or template specified
 *
 * Note: These tests run without `adk` on PATH so native creation
 * will fail with "adk not found" — which is the expected behavior.
 * We verify the failure is clear and structured.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";

let workDir: string;
let createTool: RegisteredToolCapture;
let origCwd: string;

beforeEach(() => {
  workDir = createTempDir();
  origCwd = process.cwd();
  process.chdir(workDir);
  const { api, getTool } = createMockExtensionAPI();
  piGoogleAdkExtension(api);
  createTool = getTool("create_adk_agent")!;
});

afterEach(() => {
  process.chdir(origCwd);
  removeTempDir(workDir);
});

const ctx = () => createMockExtensionContext({ cwd: workDir });

function parseResult(
  result: { content: Array<{ type: string; text?: string }> }
): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("create_adk_agent mode parameter", () => {
  it("rejects invalid name before trying native creation", async () => {
    const result = await createTool.execute(
      "test-bad-name",
      { name: "BAD-NAME", mode: "native_app" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Agent name must be");
  });

  it("rejects path traversal for native mode", async () => {
    const result = await createTool.execute(
      "test-escape",
      { name: "my_agent", mode: "native_app", path: "../../escape" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    // The error comes from adk-native-create's path validation
    expect(parsed.error).toContain("outside the workspace root");
  });

  it("defaults to native_app when no mode or template given", async () => {
    const result = await createTool.execute(
      "test-default",
      { name: "default_agent" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    // Will fail because adk is not on PATH, but mode should be native_app
    expect(parsed.mode).toBe("native_app");
  });

  it("native_app mode fails clearly when adk not on PATH", async () => {
    const result = await createTool.execute(
      "test-no-adk",
      { name: "hello_agent", mode: "native_app" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
    expect((parsed.error as string).toLowerCase()).toMatch(/adk|not installed|not on.*path|not found|not available/i);
  });

  it("native_config mode fails clearly when adk not on PATH", async () => {
    const result = await createTool.execute(
      "test-no-adk-config",
      { name: "config_agent", mode: "native_config" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
    expect((parsed.error as string).toLowerCase()).toMatch(/adk|not installed|not on.*path|not found|not available/i);
  });

  it("legacy_basic mode is rejected with migration guidance", async () => {
    const result = await createTool.execute(
      "test-legacy",
      { name: "legacy_agent", mode: "legacy_basic", path: "./legacy_proj" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("no longer supported");
    expect(parsed.error).toContain("native_app");
  });

  it("template param is rejected with migration guidance", async () => {
    const result = await createTool.execute(
      "test-template-compat",
      { name: "compat_agent", template: "mcp", path: "./compat_proj" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("no longer supported");
    expect(parsed.error).toContain("native_app");
  });

  it("legacy mode is rejected even when template is also set", async () => {
    const result = await createTool.execute(
      "test-mode-wins",
      { name: "mode_agent", mode: "legacy_sequential", template: "basic", path: "./mode_proj" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("no longer supported");
  });
});

describe("create_adk_agent schema", () => {
  it("has mode in parameters", () => {
    const schema = createTool.parameters as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("mode");
  });

  it("has name in schema (optional for wizard mode)", () => {
    const schema = createTool.parameters as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("name");
  });
});
