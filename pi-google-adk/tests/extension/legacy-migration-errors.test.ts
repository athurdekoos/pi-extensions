/**
 * Extension-level tests: legacy mode / template migration errors.
 *
 * Behavior protected:
 * - All three legacy modes (legacy_basic, legacy_mcp, legacy_sequential) are
 *   rejected with clear migration guidance
 * - All three deprecated template values (basic, mcp, sequential) are
 *   rejected with clear migration guidance
 * - Migration errors mention supported modes (native_app, native_config,
 *   official_sample)
 * - Migration errors are specific to the input provided
 * - Supported modes still work (regression guard)
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

// ---------------------------------------------------------------------------
// Legacy mode rejection
// ---------------------------------------------------------------------------

describe("legacy mode rejection", () => {
  it.each([
    ["legacy_basic", "native_app"],
    ["legacy_mcp", "native_app"],
    ["legacy_sequential", "native_app"],
  ])("mode=%s is rejected with migration guidance mentioning %s", async (mode, suggestion) => {
    const result = await createTool.execute(
      `test-${mode}`,
      { name: "test_agent", mode, path: "./test_proj" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(`mode=${mode}`);
    expect(parsed.error).toContain("no longer supported");
    expect(parsed.error).toContain(suggestion);
    expect(parsed.error).toContain("native_app");
    expect(parsed.error).toContain("native_config");
    expect(parsed.error).toContain("official_sample");
  });
});

// ---------------------------------------------------------------------------
// Deprecated template rejection
// ---------------------------------------------------------------------------

describe("deprecated template rejection", () => {
  it.each([
    ["basic", "native_app"],
    ["mcp", "native_app"],
    ["sequential", "native_app"],
  ])("template=%s is rejected with migration guidance mentioning %s", async (template, suggestion) => {
    const result = await createTool.execute(
      `test-tmpl-${template}`,
      { name: "test_agent", template, path: "./test_proj" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(`template=${template}`);
    expect(parsed.error).toContain("no longer supported");
    expect(parsed.error).toContain(suggestion);
  });
});

// ---------------------------------------------------------------------------
// Error quality
// ---------------------------------------------------------------------------

describe("migration error quality", () => {
  it("legacy mode error mentions all three supported modes", async () => {
    const result = await createTool.execute(
      "test-quality",
      { name: "test_agent", mode: "legacy_basic" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    const error = parsed.error as string;
    expect(error).toContain("native_app");
    expect(error).toContain("native_config");
    expect(error).toContain("official_sample");
  });

  it("template error mentions the removed scaffolding path", async () => {
    const result = await createTool.execute(
      "test-quality-tmpl",
      { name: "test_agent", template: "basic" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    const error = parsed.error as string;
    expect(error).toContain("Pi-owned scaffolding");
    expect(error).toContain("removed from the public API");
  });

  it("legacy mode error is not generic — it mentions the specific mode", async () => {
    const result = await createTool.execute(
      "test-specific",
      { name: "test_agent", mode: "legacy_sequential" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.error).toContain("legacy_sequential");
  });
});

// ---------------------------------------------------------------------------
// Regression: supported modes still accepted
// ---------------------------------------------------------------------------

describe("supported modes still accepted", () => {
  it("native_app is accepted (fails on missing adk, not migration error)", async () => {
    const result = await createTool.execute(
      "test-native-app",
      { name: "test_agent", mode: "native_app" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    // Will fail because adk is not on PATH — but mode is accepted
    expect(parsed.mode).toBe("native_app");
    // Should NOT be a migration error
    if (!parsed.ok) {
      expect(parsed.error).not.toContain("no longer supported");
    }
  });

  it("native_config is accepted (fails on missing adk, not migration error)", async () => {
    const result = await createTool.execute(
      "test-native-config",
      { name: "test_agent", mode: "native_config" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.mode).toBe("native_config");
    if (!parsed.ok) {
      expect(parsed.error).not.toContain("no longer supported");
    }
  });

  it("official_sample is accepted (fails on missing slug, not migration error)", async () => {
    const result = await createTool.execute(
      "test-official-sample",
      { name: "test_agent", mode: "official_sample" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.mode).toBe("official_sample");
    expect(parsed.error).toContain("sample_slug");
    expect(parsed.error).not.toContain("no longer supported");
  });

  it("default mode (no mode param) is native_app", async () => {
    const result = await createTool.execute(
      "test-default",
      { name: "test_agent" },
      undefined,
      undefined,
      ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.mode).toBe("native_app");
  });
});

// ---------------------------------------------------------------------------
// Schema validation: legacy params not in public schema
// ---------------------------------------------------------------------------

describe("schema contract", () => {
  it("mode enum in schema contains only supported modes", () => {
    const schema = createTool.parameters as {
      properties?: Record<string, { enum?: string[] }>;
    };
    const modeEnum = schema.properties?.mode?.enum;
    expect(modeEnum).toBeDefined();
    expect(modeEnum).toContain("native_app");
    expect(modeEnum).toContain("native_config");
    expect(modeEnum).toContain("official_sample");
    expect(modeEnum).not.toContain("legacy_basic");
    expect(modeEnum).not.toContain("legacy_mcp");
    expect(modeEnum).not.toContain("legacy_sequential");
  });

  it("template param is not in the public schema", () => {
    const schema = createTool.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).not.toHaveProperty("template");
  });

  it("install_adk_skills is not in the public schema", () => {
    const schema = createTool.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).not.toHaveProperty("install_adk_skills");
  });

  it("add_adk_docs_mcp is not in the public schema", () => {
    const schema = createTool.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).not.toHaveProperty("add_adk_docs_mcp");
  });
});
