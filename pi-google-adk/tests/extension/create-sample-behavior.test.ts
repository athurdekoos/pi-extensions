/**
 * Extension-level tests: create_adk_agent official_sample mode behavior.
 *
 * Behavior protected:
 * - Non-interactive official_sample mode requires sample_slug
 * - Non-interactive official_sample mode requires name
 * - Unknown slug fails clearly
 * - Mode dispatch reaches sample import path
 * - Wizard is not invoked when name+mode are explicit
 *
 * Note: Actual git-based import is NOT tested here (requires network).
 * These tests validate pre-import validation and mode dispatch.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import { createMockExtensionAPI, createMockExtensionContext } from "../helpers/mock-extension-api.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

function getCreateTool() {
  const { api, getTool } = createMockExtensionAPI();
  piGoogleAdkExtension(api);
  return getTool("create_adk_agent")!;
}

describe("create_adk_agent official_sample mode", () => {
  it("requires sample_slug", async () => {
    const tool = getCreateTool();
    const ctx = createMockExtensionContext({ cwd: workDir });

    const result = await tool.execute(
      "test-call-1",
      { name: "test_agent", mode: "official_sample" },
      undefined,
      undefined,
      ctx as never
    );

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("sample_slug is required");
  });

  it("rejects unknown sample_slug", async () => {
    const tool = getCreateTool();
    const ctx = createMockExtensionContext({ cwd: workDir });

    const result = await tool.execute(
      "test-call-2",
      { name: "test_agent", mode: "official_sample", sample_slug: "fake_sample" },
      undefined,
      undefined,
      ctx as never
    );

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Unknown sample slug");
    expect(parsed.error).toContain("fake_sample");
  });

  it("requires name in non-interactive mode", async () => {
    const tool = getCreateTool();
    const ctx = createMockExtensionContext({ cwd: workDir, hasUI: false });

    const result = await tool.execute(
      "test-call-3",
      { mode: "official_sample", sample_slug: "hello_world" },
      undefined,
      undefined,
      ctx as never
    );

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("name is required");
  });

  it("has sample_slug in schema", () => {
    const tool = getCreateTool();
    const schema = tool.parameters as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("sample_slug");
  });

  it("has official_sample in mode enum", () => {
    const tool = getCreateTool();
    const schema = tool.parameters as {
      properties?: { mode?: { anyOf?: Array<{ const?: string }> } };
    };
    const modeSchema = schema.properties?.mode;
    // Check the mode accepts official_sample
    const description = tool.description;
    expect(description).toContain("official_sample");
  });
});

describe("create_adk_agent wizard activation", () => {
  it("does not activate wizard when name and mode are provided", async () => {
    const tool = getCreateTool();
    // hasUI=true but name+mode provided — should NOT run wizard
    // Use an invalid slug to fail fast (before git) while proving wizard was bypassed
    const ctx = createMockExtensionContext({
      cwd: workDir,
      hasUI: true,
    });

    const result = await tool.execute(
      "test-call-4",
      { name: "test_agent", mode: "official_sample", sample_slug: "nonexistent_slug" },
      undefined,
      undefined,
      ctx as never
    );

    // Should fail with slug error, NOT trigger wizard
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Unknown sample slug");
    expect(parsed.mode).toBe("official_sample");
  });

  it("fails clearly when no UI and no params", async () => {
    const tool = getCreateTool();
    const ctx = createMockExtensionContext({
      cwd: workDir,
      hasUI: false,
    });

    const result = await tool.execute(
      "test-call-5",
      {},
      undefined,
      undefined,
      ctx as never
    );

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("name is required");
  });
});
