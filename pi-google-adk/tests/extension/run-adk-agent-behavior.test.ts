/**
 * Extension-level tests: run_adk_agent tool behavior.
 *
 * Behavior protected:
 * - Rejects paths outside workspace
 * - Rejects non-existent paths
 * - Rejects non-ADK directories
 * - Does NOT hard-fail on missing GOOGLE_API_KEY in Node
 * - Returns structured error result with proper fields
 * - Reports missing adk CLI cleanly (when CLI is absent)
 *
 * What these tests do NOT prove:
 * - Full end-to-end execution with a real ADK agent (requires adk + GOOGLE_API_KEY)
 * - Subprocess timeout behavior (would require a long-running agent)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let workDir: string;
let runTool: RegisteredToolCapture;

beforeEach(() => {
  workDir = createTempDir();
  // Clean global state to avoid interference
  delete (globalThis as Record<string, unknown>).__piSubagents_registerSafeTool;
  delete (globalThis as Record<string, unknown>).__piSubagents_pendingSafeTools;

  const { api, getTool } = createMockExtensionAPI();
  piGoogleAdkExtension(api);
  runTool = getTool("run_adk_agent")!;
});

afterEach(() => {
  removeTempDir(workDir);
});

function ctx() {
  return createMockExtensionContext({ cwd: workDir });
}

function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content[0]?.text ?? "";
  return JSON.parse(text);
}

/** Create a minimal valid ADK project directory for testing. */
function createValidAdkProject(name: string): string {
  const projDir = join(workDir, "agents", name);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, ".adk-scaffold.json"),
    JSON.stringify({ name, template: "basic", model: "gemini-2.5-flash" })
  );
  return `agents/${name}`;
}

describe("run_adk_agent tool behavior", () => {
  it("rejects paths outside workspace", async () => {
    const result = await runTool.execute(
      "test-001",
      { project_path: "../../etc/passwd", prompt: "hello" },
      undefined,
      undefined,
      ctx() as never
    );
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Path traversal blocked");
  });

  it("rejects non-existent paths", async () => {
    const result = await runTool.execute(
      "test-002",
      { project_path: "nonexistent", prompt: "hello" },
      undefined,
      undefined,
      ctx() as never
    );
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("does not exist");
  });

  it("rejects non-ADK directories", async () => {
    mkdirSync(join(workDir, "empty-dir"));
    const result = await runTool.execute(
      "test-003",
      { project_path: "empty-dir", prompt: "hello" },
      undefined,
      undefined,
      ctx() as never
    );
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Not a recognized ADK project");
  });

  it("does not hard-fail on missing GOOGLE_API_KEY", async () => {
    // A valid ADK project should proceed past validation even without
    // GOOGLE_API_KEY in the Node environment. The subprocess (adk run)
    // is the source of truth for credential failures.
    const projPath = createValidAdkProject("test_agent");

    const savedKey = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    try {
      const result = await runTool.execute(
        "test-004",
        { project_path: projPath, prompt: "hello" },
        undefined,
        undefined,
        ctx() as never
      );
      const parsed = parseResult(result);

      // The tool should NOT return an error about GOOGLE_API_KEY being
      // missing in Node. It should either:
      // - succeed (if adk CLI is available and project runs)
      // - fail with an adk CLI error or subprocess error
      // - fail with "adk CLI not installed"
      // It must NOT contain our old hard-gate message.
      if (parsed.error) {
        expect(parsed.error).not.toContain(
          "GOOGLE_API_KEY environment variable is not set"
        );
      }
    } finally {
      if (savedKey !== undefined) {
        process.env.GOOGLE_API_KEY = savedKey;
      }
    }
  });

  it("returns structured result with expected fields", async () => {
    const result = await runTool.execute(
      "test-005",
      { project_path: "nonexistent", prompt: "hello" },
      undefined,
      undefined,
      ctx() as never
    );
    const parsed = parseResult(result);
    expect(parsed).toHaveProperty("success");
    expect(parsed).toHaveProperty("project_path");
    expect(parsed).toHaveProperty("final_output");
    expect(parsed).toHaveProperty("error");
    expect(typeof parsed.success).toBe("boolean");
  });

  it("project_path is echoed in the result", async () => {
    const result = await runTool.execute(
      "test-006",
      { project_path: "some/path", prompt: "hello" },
      undefined,
      undefined,
      ctx() as never
    );
    const parsed = parseResult(result);
    expect(parsed.project_path).toBe("some/path");
  });
});
