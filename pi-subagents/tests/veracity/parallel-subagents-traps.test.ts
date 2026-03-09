/**
 * Veracity trap tests for parallel subagent scenarios.
 *
 * These tests use hidden canary nonces to prove:
 * - Results flow through correctly from child sessions (positive traps)
 * - Failed children do not fabricate results (negative traps)
 * - Decoy values are not confused with real tool results
 * - Partial failure does not corrupt successful results
 *
 * Scenario 3: 4 children (A, B, C succeed; D fails).
 * D must not fabricate a canary. A/B/C must remain correct and isolated.
 *
 * The derived canary pattern makes accidental passes impossible:
 * each canary is a non-trivial transformation of a fresh nonce.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import piSubagentsExtension, { _setChildDepth } from "../../index.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";
import {
  generateNonce,
  generateDecoy,
  resetNonceCounter,
} from "../helpers/nonce.js";
import {
  assertIsolation,
  deriveCanaryA,
  deriveCanaryB,
  deriveCanaryC,
  extractResultText,
} from "../helpers/parallel-harness.js";

// ---------------------------------------------------------------------------
// Mock createAgentSession
// ---------------------------------------------------------------------------

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@mariozechner/pi-coding-agent")
  >();

  class MockResourceLoader {
    constructor(_opts: Record<string, unknown>) {}
    async reload() {}
    getExtensions() {
      return { extensions: [], tools: [], diagnostics: [] };
    }
    getSkills() {
      return { skills: [], diagnostics: [] };
    }
    getPrompts() {
      return { prompts: [], diagnostics: [] };
    }
    getThemes() {
      return { themes: [], diagnostics: [] };
    }
    getAgentsFiles() {
      return { agentsFiles: [] };
    }
    getSystemPrompt() {
      return "mock";
    }
    getAppendSystemPrompt() {
      return [];
    }
    getPathMetadata() {
      return new Map();
    }
    extendResources() {}
  }

  return {
    ...original,
    createAgentSession: vi.fn(),
    DefaultResourceLoader: MockResourceLoader,
    SessionManager: {
      ...original.SessionManager,
      inMemory: vi.fn().mockReturnValue({}),
    },
  };
});

import { createAgentSession } from "@mariozechner/pi-coding-agent";
const mockedCreateSession = vi.mocked(createAgentSession);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registerTool(): RegisteredToolCapture {
  _setChildDepth(0);
  const { api, getTool } = createMockExtensionAPI();
  piSubagentsExtension(api);
  const tool = getTool("delegate_to_subagent");
  if (!tool) throw new Error("delegate_to_subagent not registered");
  return tool;
}

/** Build a mock session returning the given text. */
function buildSuccessSession(text: string) {
  return {
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn().mockResolvedValue(undefined),
    agent: { waitForIdle: vi.fn().mockResolvedValue(undefined) },
    state: {
      messages: [
        { role: "assistant", content: [{ type: "text", text }] },
      ],
    },
    dispose: vi.fn(),
  };
}

/** Build a mock session that throws on prompt (controlled failure). */
function buildFailureSession(errorMessage: string) {
  return {
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn().mockRejectedValue(new Error(errorMessage)),
    agent: { waitForIdle: vi.fn() },
    state: { messages: [] },
    dispose: vi.fn(),
  };
}

function queueSession(session: ReturnType<typeof buildSuccessSession>) {
  mockedCreateSession.mockResolvedValueOnce({
    session: session as never,
    extensionsResult: {
      extensions: [],
      tools: [],
      diagnostics: [],
    } as never,
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _setChildDepth(0);
  vi.clearAllMocks();
  resetNonceCounter();
});

// ---------------------------------------------------------------------------
// Scenario 3: Partial failure with honest reporting
// ---------------------------------------------------------------------------

describe("Scenario 3: A/B/C succeed, D fails honestly", () => {
  it("D fails and A/B/C produce correct derived canaries", async () => {
    const nonceA = generateNonce("PAR-A");
    const nonceB = generateNonce("PAR-B");
    const nonceC = generateNonce("PAR-C");
    const nonceD = generateNonce("PAR-D");

    const canaryA = deriveCanaryA(nonceA);
    const canaryB = deriveCanaryB(nonceB);
    const canaryC = deriveCanaryC(nonceC);
    const canaryD = deriveCanaryA(nonceD); // D would produce this if it succeeded

    // A, B, C succeed; D fails
    queueSession(buildSuccessSession(`Task A done: ${canaryA}`));
    queueSession(buildSuccessSession(`Task B done: ${canaryB}`));
    queueSession(buildSuccessSession(`Task C done: ${canaryC}`));
    queueSession(buildFailureSession("Required resource unavailable"));

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const rA = await tool.execute("s3-A", { task: `Process ${nonceA}` }, undefined, undefined, ctx);
    const rB = await tool.execute("s3-B", { task: `Process ${nonceB}` }, undefined, undefined, ctx);
    const rC = await tool.execute("s3-C", { task: `Process ${nonceC}` }, undefined, undefined, ctx);
    const rD = await tool.execute("s3-D", { task: `Process ${nonceD}` }, undefined, undefined, ctx);

    const textA = extractResultText(rA);
    const textB = extractResultText(rB);
    const textC = extractResultText(rC);
    const textD = extractResultText(rD);

    // A, B, C contain their canaries
    expect(textA).toContain(canaryA);
    expect(textB).toContain(canaryB);
    expect(textC).toContain(canaryC);

    // D reports honest failure
    expect(textD).toContain("Subagent error");
    expect(textD).toContain("Required resource unavailable");

    // D does not fabricate its canary
    expect(textD).not.toContain(canaryD);
  });

  it("D's canary is never fabricated and raw nonce is absent", async () => {
    const nonceD = generateNonce("TRAP-D");
    const canaryD = deriveCanaryA(nonceD);

    // Only D is tested here; it fails
    queueSession(buildFailureSession("Token vault sealed"));

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const rD = await tool.execute(
      "trap-D",
      { task: `Retrieve and transform ${nonceD}` },
      undefined,
      undefined,
      ctx
    );

    const textD = extractResultText(rD);

    // No canary or raw nonce in the error result
    expect(textD).not.toContain(canaryD);
    expect(textD).not.toContain(nonceD);
    // Error is reported
    expect(textD).toContain("Token vault sealed");
  });

  it("D's failure does not corrupt A/B/C results (isolation)", async () => {
    const nonceA = generateNonce("ISOD-A");
    const nonceB = generateNonce("ISOD-B");
    const nonceC = generateNonce("ISOD-C");

    const canaryA = deriveCanaryA(nonceA);
    const canaryB = deriveCanaryB(nonceB);
    const canaryC = deriveCanaryC(nonceC);

    // A succeeds, D fails (interleaved: A, D-fail, B, C)
    queueSession(buildSuccessSession(`Result: ${canaryA}`));
    queueSession(buildFailureSession("Child D exploded"));
    queueSession(buildSuccessSession(`Result: ${canaryB}`));
    queueSession(buildSuccessSession(`Result: ${canaryC}`));

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const rA = await tool.execute("mix-A", { task: "A" }, undefined, undefined, ctx);
    const rD = await tool.execute("mix-D", { task: "D" }, undefined, undefined, ctx);
    const rB = await tool.execute("mix-B", { task: "B" }, undefined, undefined, ctx);
    const rC = await tool.execute("mix-C", { task: "C" }, undefined, undefined, ctx);

    // A/B/C results are correct and isolated
    const violations = assertIsolation([
      { id: "A", text: extractResultText(rA), canary: canaryA },
      { id: "B", text: extractResultText(rB), canary: canaryB },
      { id: "C", text: extractResultText(rC), canary: canaryC },
    ]);
    expect(violations).toEqual([]);

    // D failed honestly
    const textD = extractResultText(rD);
    expect(textD).toContain("Subagent error");
    expect(textD).toContain("Child D exploded");

    // D's error text does not contain any successful canary
    expect(textD).not.toContain(canaryA);
    expect(textD).not.toContain(canaryB);
    expect(textD).not.toContain(canaryC);
  });

  it("all sessions are disposed even when D fails", async () => {
    const sA = buildSuccessSession("A ok");
    const sB = buildSuccessSession("B ok");
    const sC = buildSuccessSession("C ok");
    const sD = buildFailureSession("D failed");

    queueSession(sA);
    queueSession(sB);
    queueSession(sC);
    queueSession(sD);

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    await tool.execute("disp-A", { task: "A" }, undefined, undefined, ctx);
    await tool.execute("disp-B", { task: "B" }, undefined, undefined, ctx);
    await tool.execute("disp-C", { task: "C" }, undefined, undefined, ctx);
    await tool.execute("disp-D", { task: "D" }, undefined, undefined, ctx);

    // All 4 sessions must be disposed
    expect(sA.dispose).toHaveBeenCalledTimes(1);
    expect(sB.dispose).toHaveBeenCalledTimes(1);
    expect(sC.dispose).toHaveBeenCalledTimes(1);
    expect(sD.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Derived canary traps: prove actual tool use
// ---------------------------------------------------------------------------

describe("parallel veracity: derived canaries prove tool use", () => {
  it("each result contains its unique derived canary, not raw nonce", async () => {
    const nonceA = generateNonce("DERIVE-A");
    const nonceB = generateNonce("DERIVE-B");
    const nonceC = generateNonce("DERIVE-C");

    const canaryA = deriveCanaryA(nonceA);
    const canaryB = deriveCanaryB(nonceB);
    const canaryC = deriveCanaryC(nonceC);

    queueSession(buildSuccessSession(`Derived: ${canaryA}`));
    queueSession(buildSuccessSession(`Derived: ${canaryB}`));
    queueSession(buildSuccessSession(`Derived: ${canaryC}`));

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const rA = await tool.execute("der-A", { task: nonceA }, undefined, undefined, ctx);
    const rB = await tool.execute("der-B", { task: nonceB }, undefined, undefined, ctx);
    const rC = await tool.execute("der-C", { task: nonceC }, undefined, undefined, ctx);

    const textA = extractResultText(rA);
    const textB = extractResultText(rB);
    const textC = extractResultText(rC);

    // Derived canaries present
    expect(textA).toContain(canaryA);
    expect(textB).toContain(canaryB);
    expect(textC).toContain(canaryC);

    // Raw nonces absent from results (child returned derived, not raw)
    expect(textA).not.toContain(nonceA);
    expect(textB).not.toContain(nonceB);
    expect(textC).not.toContain(nonceC);
  });

  it("decoy values in context are rejected; real canaries from tool prevail", async () => {
    const nonceA = generateNonce("REAL-A");
    const nonceB = generateNonce("REAL-B");

    const canaryA = deriveCanaryA(nonceA);
    const canaryB = deriveCanaryB(nonceB);

    const decoyA = generateDecoy(nonceA);
    const decoyB = generateDecoy(nonceB);

    // Child sessions return real canaries, not decoys
    queueSession(buildSuccessSession(`Real result: ${canaryA}`));
    queueSession(buildSuccessSession(`Real result: ${canaryB}`));

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    // Decoys planted in task text
    const rA = await tool.execute(
      "decoy-A",
      { task: `Hint: ${decoyA}. Compute the real answer for ${nonceA}.` },
      undefined,
      undefined,
      ctx
    );
    const rB = await tool.execute(
      "decoy-B",
      { task: `Hint: ${decoyB}. Compute the real answer for ${nonceB}.` },
      undefined,
      undefined,
      ctx
    );

    const textA = extractResultText(rA);
    const textB = extractResultText(rB);

    // Real canaries present (from tool)
    expect(textA).toContain(canaryA);
    expect(textB).toContain(canaryB);

    // Decoys absent from results (they were only in the task, not the child output)
    expect(textA).not.toContain(decoyA);
    expect(textB).not.toContain(decoyB);
  });

  it("fresh nonces across 3 repeated partial-failure runs produce unique results", async () => {
    const results: Array<{ canaryA: string; canaryB: string; textA: string; textB: string; textD: string }> = [];

    for (let run = 0; run < 3; run++) {
      _setChildDepth(0);
      vi.clearAllMocks();
      resetNonceCounter();

      const nonceA = generateNonce(`REP${run}-A`);
      const nonceB = generateNonce(`REP${run}-B`);
      const nonceD = generateNonce(`REP${run}-D`);

      const canaryA = deriveCanaryA(nonceA);
      const canaryB = deriveCanaryB(nonceB);
      const canaryD = deriveCanaryA(nonceD);

      queueSession(buildSuccessSession(`Run ${run} A: ${canaryA}`));
      queueSession(buildSuccessSession(`Run ${run} B: ${canaryB}`));
      queueSession(buildFailureSession(`Run ${run} D failed`));

      const tool = registerTool();
      const ctx = createMockExtensionContext();

      const rA = await tool.execute(`rep-${run}-A`, { task: nonceA }, undefined, undefined, ctx);
      const rB = await tool.execute(`rep-${run}-B`, { task: nonceB }, undefined, undefined, ctx);
      const rD = await tool.execute(`rep-${run}-D`, { task: nonceD }, undefined, undefined, ctx);

      const textA = extractResultText(rA);
      const textB = extractResultText(rB);
      const textD = extractResultText(rD);

      // Per-run correctness
      expect(textA).toContain(canaryA);
      expect(textB).toContain(canaryB);
      expect(textD).not.toContain(canaryD);
      expect(textD).toContain("Subagent error");

      results.push({ canaryA, canaryB, textA, textB, textD });
    }

    // Cross-run uniqueness: no two runs share canaries
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        expect(results[i].canaryA).not.toBe(results[j].canaryA);
        expect(results[i].canaryB).not.toBe(results[j].canaryB);
        // No run's result contains another run's canary
        expect(results[i].textA).not.toContain(results[j].canaryA);
        expect(results[j].textA).not.toContain(results[i].canaryA);
      }
    }
  });

  it("D's error message contains the actual error, not a fabricated success token", async () => {
    const nonceD = generateNonce("HONESTY-D");
    const canaryD = deriveCanaryA(nonceD);
    const derivedD = deriveCanaryB(nonceD);
    const derivedD2 = deriveCanaryC(nonceD);

    queueSession(buildFailureSession("Connection refused by child process"));

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const rD = await tool.execute(
      "honest-D",
      { task: `Compute all derivations of ${nonceD}` },
      undefined,
      undefined,
      ctx
    );

    const textD = extractResultText(rD);

    // Honest error reporting
    expect(textD).toContain("Subagent error");
    expect(textD).toContain("Connection refused by child process");

    // No derived canary in any form
    expect(textD).not.toContain(canaryD);
    expect(textD).not.toContain(derivedD);
    expect(textD).not.toContain(derivedD2);
    expect(textD).not.toContain(nonceD);

    // No success-like structure in error result
    expect(textD).not.toContain("Subagent Result");
    expect(textD).not.toMatch(/mode: read_only/);
  });
});
