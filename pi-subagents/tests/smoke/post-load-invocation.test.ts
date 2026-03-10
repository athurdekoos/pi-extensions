/**
 * Post-load invocation smoke test.
 *
 * Proves the full chain: discover → load → register → expose → invoke.
 *
 * This test does NOT directly import the extension source module.
 * The extension is discovered and loaded exclusively through the real pi
 * extension loader APIs (discoverAndLoadExtensions). After loading, the
 * registered tool's execute() is invoked to prove the runtime surface is
 * functional, not merely discoverable.
 *
 * Forbidden in this file:
 *   - import ... from "../../index.js"
 *   - import ... from "../../index"
 *   - import ... from "../.."
 *   - import ... from "../../src"
 *   - any helper that secretly imports the extension and bypasses discovery
 *
 * The extension identifier appears only as a filesystem path target for
 * the loader, never as a TypeScript import.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  discoverAndLoadExtensions,
  type Extension,
} from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Direct-import guard
// ---------------------------------------------------------------------------

/**
 * Verify that this test file does not import the extension source directly.
 * Structural safeguard against accidental bypass.
 */
function assertNoDirectImportInThisFile() {
  const thisFile = fs.readFileSync(
    path.resolve(import.meta.dirname, "post-load-invocation.test.ts"),
    "utf-8"
  );
  const lines = thisFile.split("\n");
  const codeLines = lines.filter(
    (line) =>
      !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")
  );
  const codeOnly = codeLines.join("\n");

  const directImportPatterns = [
    /^\s*import\b.*from\s+["']\.\.\/\.\.\/index/m,
    /^\s*import\b.*from\s+["']\.\.\/\.\.['"]/m,
    /^\s*import\b.*from\s+["']\.\.\/\.\.\/src/m,
    /import\s*\(["']\.\.\/\.\.\/index/,
    /require\s*\(["']\.\.\/\.\.\/index/,
  ];
  for (const pattern of directImportPatterns) {
    if (pattern.test(codeOnly)) {
      throw new Error(
        `Post-load invocation test contains a direct import of the extension source. ` +
          `This defeats the purpose of post-load testing. Pattern: ${pattern}`
      );
    }
  }
}

assertNoDirectImportInThisFile();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Package root -- used as a discovery target, NOT as a TS import. */
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");

const TOOL_NAME = "delegate_to_subagent";

// ---------------------------------------------------------------------------
// Shared loader result (cached across tests in this suite)
// ---------------------------------------------------------------------------

/** Load once and reuse across all tests in this describe block. */
let cachedLoadResult: Awaited<ReturnType<typeof discoverAndLoadExtensions>> | undefined;

async function getLoadResult() {
  if (!cachedLoadResult) {
    cachedLoadResult = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );
  }
  return cachedLoadResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findExtensionWithTool(
  result: Awaited<ReturnType<typeof discoverAndLoadExtensions>>,
  toolName: string
): Extension | undefined {
  return result.extensions.find((ext) => ext.tools.has(toolName));
}

/**
 * Build a minimal ExtensionContext stub inline.
 *
 * Constructed here (not imported from a shared helper that might pull in the
 * extension source). Provides just enough surface for the tool's execute()
 * to reach its real implementation body.
 */
function buildMinimalContext(): Record<string, unknown> {
  return {
    ui: {
      confirm: async () => true,
      notify: () => {},
      setStatus: () => {},
    },
    hasUI: false,
    cwd: PACKAGE_ROOT,
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [],
      getLeafId: () => undefined,
      getSessionFile: () => undefined,
    },
    modelRegistry: {
      find: () => undefined,
    },
    model: undefined,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  };
}

/**
 * Extract the text from the first content block of a tool result.
 */
function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0];
  if (block && block.type === "text" && typeof block.text === "string") {
    return block.text;
  }
  throw new Error("Result has no text content block");
}

// ---------------------------------------------------------------------------
// Post-load invocation tests
// ---------------------------------------------------------------------------

describe("Scenario 5: post-load invocation", () => {
  it("invokes delegate_to_subagent through the real-loaded tool surface", async () => {
    // Step 1: discover and load through the real loader
    const loadResult = await getLoadResult();
    expect(loadResult.errors).toHaveLength(0);

    // Step 2: obtain the tool from the loaded extension
    const ext = findExtensionWithTool(loadResult, TOOL_NAME);
    expect(ext).toBeDefined();

    const registeredTool = ext!.tools.get(TOOL_NAME);
    expect(registeredTool).toBeDefined();

    const toolDef = registeredTool!.definition;
    expect(typeof toolDef.execute).toBe("function");

    // Step 3: invoke the tool with minimal valid params.
    // The tool creates a real child session. Depending on model availability
    // it either succeeds (returns a Subagent Result) or fails with a runtime
    // error (Subagent error). Both outcomes prove the invocation path is real.
    const ctx = buildMinimalContext();
    const result = await toolDef.execute(
      "smoke-invoke-001",
      { task: "Return the string SMOKE_OK" },
      undefined, // signal
      undefined, // onUpdate
      ctx as never
    );

    // Step 4: assert the result is a structured tool response
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(1);
    expect(result.content[0].type).toBe("text");

    const text = resultText(result);

    // The result must come from the real tool body: either a success
    // envelope or a runtime error from session creation. Both prove the
    // invocation path is genuine and not a stub.
    const isSuccess = text.includes("--- Subagent Result");
    const isRuntimeError = text.startsWith("Subagent error: ");
    expect(isSuccess || isRuntimeError).toBe(true);

    // Must NOT be a recursion-guard rejection (that would mean the
    // invocation didn't reach the real body).
    expect(text).not.toContain("Recursive delegation blocked");

    // Confirm details shape from the real tool implementation.
    expect(result.details).toBeDefined();
    const details = result.details as { childMessages: number };
    expect(typeof details.childMessages).toBe("number");

    if (isSuccess) {
      expect(details.childMessages).toBeGreaterThanOrEqual(1);
    } else {
      expect(details.childMessages).toBe(0);
    }
  }, 20_000);

  it("coding mode reaches a different branch in the real tool body", async () => {
    const loadResult = await getLoadResult();
    const ext = findExtensionWithTool(loadResult, TOOL_NAME);
    expect(ext).toBeDefined();

    const toolDef = ext!.tools.get(TOOL_NAME)!.definition;
    const ctx = buildMinimalContext();

    const result = await toolDef.execute(
      "smoke-invoke-002",
      { task: "noop", mode: "coding" },
      undefined,
      undefined,
      ctx as never
    );

    const text = resultText(result);

    // Must be a real response, not a stub or guard rejection.
    const isSuccess = text.includes("--- Subagent Result");
    const isRuntimeError = text.startsWith("Subagent error: ");
    expect(isSuccess || isRuntimeError).toBe(true);
    expect(text).not.toContain("Recursive delegation blocked");

    // If successful, the mode is reflected in the result envelope.
    if (isSuccess) {
      expect(text).toContain("mode: coding");
    }
  }, 20_000);

  it("loaded tool is distinct from a trivially fabricated stub", async () => {
    // Verify structural properties that a no-op stub would not have.
    const loadResult = await getLoadResult();
    const ext = findExtensionWithTool(loadResult, TOOL_NAME);
    const toolDef = ext!.tools.get(TOOL_NAME)!.definition;

    // Non-trivial description mentioning subagent
    expect(toolDef.description.length).toBeGreaterThan(30);
    expect(toolDef.description.toLowerCase()).toContain("subagent");

    // Schema has required task field
    expect(toolDef.parameters.properties.task).toBeDefined();
    expect(toolDef.parameters.required).toContain("task");

    // Schema has optional mode and safeCustomTools
    expect(toolDef.parameters.properties.mode).toBeDefined();
    expect(toolDef.parameters.properties.safeCustomTools).toBeDefined();

    // promptSnippet is set (real extension, not a skeleton)
    expect(typeof toolDef.promptSnippet).toBe("string");
    expect(toolDef.promptSnippet!.length).toBeGreaterThan(0);

    // promptGuidelines are set
    expect(Array.isArray(toolDef.promptGuidelines)).toBe(true);
    expect(toolDef.promptGuidelines!.length).toBeGreaterThan(0);
  });

  it("separate loads produce independently invocable tools", async () => {
    const load1 = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );
    const load2 = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );

    const tool1 = findExtensionWithTool(load1, TOOL_NAME)!.tools.get(
      TOOL_NAME
    )!.definition;
    const tool2 = findExtensionWithTool(load2, TOOL_NAME)!.tools.get(
      TOOL_NAME
    )!.definition;

    const ctx = buildMinimalContext();

    const [r1, r2] = await Promise.all([
      tool1.execute("smoke-load1", { task: "a" }, undefined, undefined, ctx as never),
      tool2.execute("smoke-load2", { task: "b" }, undefined, undefined, ctx as never),
    ]);

    // Both must produce real tool responses (success or runtime error).
    for (const r of [r1, r2]) {
      const text = resultText(r);
      const isReal =
        text.includes("--- Subagent Result") ||
        text.startsWith("Subagent error: ");
      expect(isReal).toBe(true);
      expect(text).not.toContain("Recursive delegation blocked");
    }
  }, 30_000);
});
