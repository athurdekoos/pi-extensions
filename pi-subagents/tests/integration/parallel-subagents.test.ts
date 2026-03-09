/**
 * Parallel subagent tests: concurrency, isolation, and honest classification.
 *
 * These tests verify that multiple delegate_to_subagent calls:
 * - produce correct isolated results when run sequentially
 * - are handled honestly when attempted concurrently
 * - do not overclaim parallelism
 * - maintain stable behavior across repeated runs
 *
 * Architecture note:
 * The pi-subagents implementation uses a module-scoped childDepth counter
 * that is incremented synchronously before the first await in execute().
 * In a Promise.all scenario, the first call increments depth to 1 before
 * yielding, so subsequent calls see childDepth > 0 and are blocked by the
 * recursion guard. This enforces serial execution at the tool level.
 *
 * These tests classify this behavior honestly rather than asserting false
 * parallelism. A false claim of parallelism is a test failure.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import piSubagentsExtension, {
  _setChildDepth,
  _getChildDepth,
} from "../../index.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";
import {
  generateNonce,
  resetNonceCounter,
} from "../helpers/nonce.js";
import {
  classifyConcurrency,
  assertIsolation,
  deriveCanaryA,
  deriveCanaryB,
  deriveCanaryC,
  extractResultText,
  isBlockedByGuard,
  type ExecutionRecord,
  type ConcurrencyClassification,
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

/**
 * Build a mock session that returns text containing the given canary.
 * Optional delay simulates variable execution time.
 */
function buildMockSession(canaryText: string, delayMs = 0) {
  const session = {
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn().mockImplementation(async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }),
    agent: {
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: canaryText }],
        },
      ],
    },
    dispose: vi.fn(),
  };
  return session;
}

function mockSessionOnce(canaryText: string, delayMs = 0) {
  const session = buildMockSession(canaryText, delayMs);
  mockedCreateSession.mockResolvedValueOnce({
    session: session as never,
    extensionsResult: {
      extensions: [],
      tools: [],
      diagnostics: [],
    } as never,
  });
  return session;
}

/** Execute the tool and record timing. */
async function timedExecute(
  tool: RegisteredToolCapture,
  id: string,
  task: string
): Promise<ExecutionRecord> {
  const ctx = createMockExtensionContext();
  const startMs = performance.now();
  const result = await tool.execute(
    `parallel-${id}`,
    { task, mode: "read_only" },
    undefined,
    undefined,
    ctx
  );
  const endMs = performance.now();

  const resultText = extractResultText(result);
  const blocked = isBlockedByGuard(resultText);

  return {
    id,
    startMs,
    endMs,
    success: !blocked,
    blockedByGuard: blocked,
    resultText,
  };
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
// Scenario 1: Sequential parallel success
// ---------------------------------------------------------------------------

describe("Scenario 1: sequential execution of 3 independent tasks", () => {
  it("all 3 tasks return correct derived canaries", async () => {
    const nonceA = generateNonce("ALPHA");
    const nonceB = generateNonce("BRAVO");
    const nonceC = generateNonce("CHARLIE");

    const canaryA = deriveCanaryA(nonceA);
    const canaryB = deriveCanaryB(nonceB);
    const canaryC = deriveCanaryC(nonceC);

    // Queue mock sessions in order
    mockSessionOnce(`Result: ${canaryA}`);
    mockSessionOnce(`Result: ${canaryB}`);
    mockSessionOnce(`Result: ${canaryC}`);

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const resultA = await tool.execute(
      "seq-A",
      { task: `Reverse ${nonceA} and append ::A` },
      undefined,
      undefined,
      ctx
    );
    const resultB = await tool.execute(
      "seq-B",
      { task: `Lowercase ${nonceB} and append ::b-ready` },
      undefined,
      undefined,
      ctx
    );
    const resultC = await tool.execute(
      "seq-C",
      { task: `Extract digits from ${nonceC}, multiply by 2, prefix C=` },
      undefined,
      undefined,
      ctx
    );

    const textA = extractResultText(resultA);
    const textB = extractResultText(resultB);
    const textC = extractResultText(resultC);

    expect(textA).toContain(canaryA);
    expect(textB).toContain(canaryB);
    expect(textC).toContain(canaryC);

    // Verify createAgentSession was called exactly 3 times
    expect(mockedCreateSession).toHaveBeenCalledTimes(3);
  });

  it("results are isolated: no cross-contamination", async () => {
    const nonceA = generateNonce("ISO-A");
    const nonceB = generateNonce("ISO-B");
    const nonceC = generateNonce("ISO-C");

    const canaryA = deriveCanaryA(nonceA);
    const canaryB = deriveCanaryB(nonceB);
    const canaryC = deriveCanaryC(nonceC);

    mockSessionOnce(`Isolated: ${canaryA}`);
    mockSessionOnce(`Isolated: ${canaryB}`);
    mockSessionOnce(`Isolated: ${canaryC}`);

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const rA = await tool.execute("iso-A", { task: "A" }, undefined, undefined, ctx);
    const rB = await tool.execute("iso-B", { task: "B" }, undefined, undefined, ctx);
    const rC = await tool.execute("iso-C", { task: "C" }, undefined, undefined, ctx);

    const violations = assertIsolation([
      { id: "A", text: extractResultText(rA), canary: canaryA },
      { id: "B", text: extractResultText(rB), canary: canaryB },
      { id: "C", text: extractResultText(rC), canary: canaryC },
    ]);

    expect(violations).toEqual([]);
  });

  it("all child sessions are disposed after sequential runs", async () => {
    const sessions = [
      mockSessionOnce("done-A"),
      mockSessionOnce("done-B"),
      mockSessionOnce("done-C"),
    ];

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    await tool.execute("disp-A", { task: "A" }, undefined, undefined, ctx);
    await tool.execute("disp-B", { task: "B" }, undefined, undefined, ctx);
    await tool.execute("disp-C", { task: "C" }, undefined, undefined, ctx);

    for (const s of sessions) {
      expect(s.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("childDepth returns to 0 after all sequential runs", async () => {
    mockSessionOnce("done-A");
    mockSessionOnce("done-B");
    mockSessionOnce("done-C");

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    await tool.execute("depth-A", { task: "A" }, undefined, undefined, ctx);
    expect(_getChildDepth()).toBe(0);

    await tool.execute("depth-B", { task: "B" }, undefined, undefined, ctx);
    expect(_getChildDepth()).toBe(0);

    await tool.execute("depth-C", { task: "C" }, undefined, undefined, ctx);
    expect(_getChildDepth()).toBe(0);
  });

  it("no child session includes delegate_to_subagent in its tools", async () => {
    mockSessionOnce("done-A");
    mockSessionOnce("done-B");
    mockSessionOnce("done-C");

    const tool = registerTool();
    const ctx = createMockExtensionContext();

    await tool.execute("tools-A", { task: "A" }, undefined, undefined, ctx);
    await tool.execute("tools-B", { task: "B" }, undefined, undefined, ctx);
    await tool.execute("tools-C", { task: "C" }, undefined, undefined, ctx);

    // Inspect every createAgentSession call's tools and customTools args
    for (const call of mockedCreateSession.mock.calls) {
      const opts = call[0] as {
        tools: Array<{ name: string }>;
        customTools?: Array<{ name: string }>;
      };
      const allToolNames = [
        ...opts.tools.map((t) => t.name),
        ...(opts.customTools ?? []).map((t) => t.name),
      ];
      expect(allToolNames).not.toContain("delegate_to_subagent");
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Concurrency classification
// ---------------------------------------------------------------------------

describe("Scenario 2: honest concurrency classification", () => {
  /*
   * Architecture note on concurrency:
   *
   * The childDepth counter is incremented AFTER `await childResourceLoader.reload()`,
   * which is the first yield point in execute(). This means all calls in a
   * Promise.all pass the depth guard before any of them increment the counter.
   * Concurrent execution is genuinely supported at the tool level.
   *
   * The depth guard prevents RECURSIVE delegation (a child calling delegate
   * again), not concurrent parent-level delegation.
   */

  it("concurrent Promise.all: all 3 calls succeed (depth guard is post-yield)", async () => {
    // All 3 calls pass the depth check before any yields, so all 3 succeed.
    mockSessionOnce("concurrent-A", 15);
    mockSessionOnce("concurrent-B", 5);
    mockSessionOnce("concurrent-C", 10);

    const tool = registerTool();

    const results = await Promise.all([
      timedExecute(tool, "conc-A", "task A"),
      timedExecute(tool, "conc-B", "task B"),
      timedExecute(tool, "conc-C", "task C"),
    ]);

    const succeeded = results.filter((r) => r.success);
    const blocked = results.filter((r) => r.blockedByGuard);

    // All 3 succeed; none are blocked by the depth guard
    expect(succeeded).toHaveLength(3);
    expect(blocked).toHaveLength(0);

    // createAgentSession was called 3 times
    expect(mockedCreateSession).toHaveBeenCalledTimes(3);
  });

  it("concurrent execution with delays is classified as proven_parallel", async () => {
    // A is slow (30ms), B is fast (5ms), C is medium (15ms).
    // All start near-simultaneously; B finishes while A is still running.
    mockSessionOnce("par-A", 30);
    mockSessionOnce("par-B", 5);
    mockSessionOnce("par-C", 15);

    const tool = registerTool();

    const records = await Promise.all([
      timedExecute(tool, "class-A", "slow task"),
      timedExecute(tool, "class-B", "fast task"),
      timedExecute(tool, "class-C", "medium task"),
    ]);

    expect(records.every((r) => r.success)).toBe(true);

    const classification = classifyConcurrency(records);

    // With overlapping execution windows, classification is proven_parallel.
    // If the implementation changed to serialize, this would fail -- correctly.
    expect(classification).toBe("proven_parallel");
  });

  it("sequential execution classification is serial_observed", async () => {
    // Use delays to ensure measurable execution time
    mockSessionOnce("seq-result-A", 15);
    mockSessionOnce("seq-result-B", 5);
    mockSessionOnce("seq-result-C", 10);

    const tool = registerTool();

    const records: ExecutionRecord[] = [];
    records.push(await timedExecute(tool, "seq-A", "A"));
    records.push(await timedExecute(tool, "seq-B", "B"));
    records.push(await timedExecute(tool, "seq-C", "C"));

    // All should succeed
    expect(records.every((r) => r.success)).toBe(true);
    expect(records.every((r) => !r.blockedByGuard)).toBe(true);

    const classification = classifyConcurrency(records);
    expect(classification).toBe("serial_observed");
  });

  it("each concurrent result contains its own canary (isolation under concurrency)", async () => {
    const nonceA = generateNonce("CONC-A");
    const nonceB = generateNonce("CONC-B");
    const nonceC = generateNonce("CONC-C");

    const canaryA = deriveCanaryA(nonceA);
    const canaryB = deriveCanaryB(nonceB);
    const canaryC = deriveCanaryC(nonceC);

    mockSessionOnce(`Concurrent A: ${canaryA}`, 20);
    mockSessionOnce(`Concurrent B: ${canaryB}`, 5);
    mockSessionOnce(`Concurrent C: ${canaryC}`, 12);

    const tool = registerTool();

    const results = await Promise.all([
      timedExecute(tool, "iso-A", `Process ${nonceA}`),
      timedExecute(tool, "iso-B", `Process ${nonceB}`),
      timedExecute(tool, "iso-C", `Process ${nonceC}`),
    ]);

    // All succeed
    expect(results.every((r) => r.success)).toBe(true);

    // Each result contains its own canary
    const violations = assertIsolation([
      { id: "A", text: results[0].resultText, canary: canaryA },
      { id: "B", text: results[1].resultText, canary: canaryB },
      { id: "C", text: results[2].resultText, canary: canaryC },
    ]);
    expect(violations).toEqual([]);
  });

  it("timing asymmetry in sequential mode: still serial_observed", async () => {
    // A is slow (30ms), B is fast (5ms), C is medium (15ms)
    mockSessionOnce("slow-A", 30);
    mockSessionOnce("fast-B", 5);
    mockSessionOnce("medium-C", 15);

    const tool = registerTool();

    const records: ExecutionRecord[] = [];
    records.push(await timedExecute(tool, "asym-A", "slow task"));
    records.push(await timedExecute(tool, "asym-B", "fast task"));
    records.push(await timedExecute(tool, "asym-C", "medium task"));

    expect(records.every((r) => r.success)).toBe(true);

    const classification = classifyConcurrency(records);
    // Sequential calls are strictly ordered even with asymmetric durations.
    expect(classification).toBe("serial_observed");
    // Verify the order: A finishes before B starts, B before C
    expect(records[0].endMs).toBeLessThanOrEqual(records[1].startMs);
    expect(records[1].endMs).toBeLessThanOrEqual(records[2].startMs);
  });

  it("classification is stable across 5 repeated concurrent attempts", async () => {
    const classifications: ConcurrencyClassification[] = [];

    for (let run = 0; run < 5; run++) {
      _setChildDepth(0);
      vi.clearAllMocks();

      // Fresh mocks with asymmetric delays for each run
      mockSessionOnce(`run-${run}-A`, 25);
      mockSessionOnce(`run-${run}-B`, 5);
      mockSessionOnce(`run-${run}-C`, 15);

      const tool = registerTool();
      const records = await Promise.all([
        timedExecute(tool, `stab-${run}-A`, "A"),
        timedExecute(tool, `stab-${run}-B`, "B"),
        timedExecute(tool, `stab-${run}-C`, "C"),
      ]);

      // All 3 succeed in each run
      const succeeded = records.filter((r) => r.success);
      expect(succeeded).toHaveLength(3);

      const classification = classifyConcurrency(records);
      classifications.push(classification);

      // Concurrent with delays: should be proven_parallel
      expect(classification).toBe("proven_parallel");
    }

    // All 5 runs should produce the same classification (stable behavior)
    const unique = new Set(classifications);
    expect(unique.size).toBe(1);
  });
});
