/**
 * Extension-level tests: tool execution behavior.
 *
 * Behavior protected:
 * - create_adk_agent succeeds with valid input and creates files
 * - create_adk_agent rejects invalid names
 * - create_adk_agent rejects path traversal
 * - create_adk_agent respects overwrite=false
 * - add_adk_capability rejects invalid project paths
 * - add_adk_capability rejects non-ADK directories
 * - Error responses have ok=false and error message
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import { createMockExtensionAPI, createMockExtensionContext, type RegisteredToolCapture } from "../helpers/mock-extension-api.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

let workDir: string;
let createTool: RegisteredToolCapture;
let capabilityTool: RegisteredToolCapture;

beforeEach(() => {
  workDir = createTempDir();
  const { api, getTool } = createMockExtensionAPI();
  piGoogleAdkExtension(api);
  createTool = getTool("create_adk_agent")!;
  capabilityTool = getTool("add_adk_capability")!;
});

afterEach(() => {
  removeTempDir(workDir);
});

function parseResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = result.content[0];
  return JSON.parse((first as { text: string }).text);
}

describe("create_adk_agent execution", () => {
  it("creates a basic project successfully", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      const result = await createTool.execute(
        "test-1",
        { name: "my_agent", template: "basic", path: "./my_agent" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.template).toBe("basic");
      expect((parsed.files_created as string[]).length).toBeGreaterThan(0);
      // Verify files actually exist
      expect(existsSync(join(workDir, "my_agent", "my_agent", "agent.py"))).toBe(true);
      expect(existsSync(join(workDir, "my_agent", ".gitignore"))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("creates mcp project successfully", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      const result = await createTool.execute(
        "test-mcp",
        { name: "mcp_agent", template: "mcp", path: "./mcp_proj" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.template).toBe("mcp");
      expect(existsSync(join(workDir, "mcp_proj", "mcp_agent", "mcp_config.py"))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("creates sequential project successfully", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      const result = await createTool.execute(
        "test-seq",
        { name: "seq_agent", template: "sequential", path: "./seq_proj" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
      expect(existsSync(join(workDir, "seq_proj", "seq_agent", "steps.py"))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("rejects invalid agent name with ok=false", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      const result = await createTool.execute(
        "test-bad",
        { name: "BAD-NAME", path: "./bad" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBeTruthy();
    } finally {
      process.chdir(origCwd);
    }
  });

  it("rejects path traversal with ok=false", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      const result = await createTool.execute(
        "test-escape",
        { name: "my_agent", path: "../../escape" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("outside the workspace root");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("does not overwrite existing project when overwrite=false", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      // First create
      await createTool.execute(
        "test-ow-1",
        { name: "ow_agent", path: "./ow_proj" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      // Second create without overwrite
      const result = await createTool.execute(
        "test-ow-2",
        { name: "ow_agent", path: "./ow_proj" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("already contains");
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe("add_adk_capability execution", () => {
  it("rejects path traversal", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      const result = await capabilityTool.execute(
        "test-cap-escape",
        { project_path: "../../escape", capability: "eval_stub" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("outside the workspace root");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("rejects non-ADK directory", async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(workDir);
      const result = await capabilityTool.execute(
        "test-cap-noproject",
        { project_path: ".", capability: "eval_stub" },
        undefined, undefined,
        createMockExtensionContext({ cwd: workDir })
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
    } finally {
      process.chdir(origCwd);
    }
  });
});
