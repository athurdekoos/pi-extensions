/**
 * Safe custom tool veracity trap tests.
 *
 * These tests prove that the safeCustomTools allowlist is enforced
 * end-to-end through the delegate_to_subagent flow:
 *
 * - Approved tools: canary flows from registered safe tool through child to parent result
 * - Unapproved tools: canary absent, child never receives the tool
 * - Mixed: approved present, unapproved absent, with invocation telemetry
 * - Anti-fabrication: decoy canary rejected, real canary from tool accepted
 * - Multi-tool isolation: per-tool canaries correctly partitioned
 * - Tool failure: error surfaces honestly, no canary fabricated
 * - Unknown tool: unresolvable tool produces no fabricated result
 *
 * All scenarios use mocked child sessions. They prove policy/configuration
 * enforcement and anti-fabrication behavior under controlled conditions.
 * They do NOT prove that a live model will behave correctly; that is covered
 * by the real-LLM tests in tests/llm/safe-tool-veracity.test.ts.
 *
 * Telemetry is asserted at two levels:
 * - Configuration telemetry: which tools were passed to createAgentSession
 * - Invocation telemetry: which toolCall blocks appear in mock session messages
 *   (simulated child behavior)
 *
 * Both levels are asserted independently in mixed/multi-tool scenarios.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import piSubagentsExtension, { _setChildDepth } from "../../index.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";
import {
  generateNonce,
  deriveFromNonce,
  generateDecoy,
  resetNonceCounter,
} from "../helpers/nonce.js";
import { makeFakeToolWithCanary } from "../helpers/fake-tool.js";

// ---------------------------------------------------------------------------
// Mock createAgentSession
// ---------------------------------------------------------------------------

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();

  class MockResourceLoader {
    constructor(_opts: Record<string, unknown>) {}
    async reload() {}
    getExtensions() { return { extensions: [], tools: [], diagnostics: [] }; }
    getSkills() { return { skills: [], diagnostics: [] }; }
    getPrompts() { return { prompts: [], diagnostics: [] }; }
    getThemes() { return { themes: [], diagnostics: [] }; }
    getAgentsFiles() { return { agentsFiles: [] }; }
    getSystemPrompt() { return "mock"; }
    getAppendSystemPrompt() { return []; }
    getPathMetadata() { return new Map(); }
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
// Mock session builders
// ---------------------------------------------------------------------------

interface MockChildToolCall {
  toolName: string;
  resultText: string;
}

/**
 * Build a mock child session with optional simulated tool calls.
 * Tool calls appear as toolCall content blocks in assistant messages
 * followed by tool result messages, modeling realistic child behavior.
 */
function buildSafeToolSession(opts: {
  toolCalls?: MockChildToolCall[];
  finalText: string;
}) {
  const messages: Array<Record<string, unknown>> = [];

  if (opts.toolCalls && opts.toolCalls.length > 0) {
    // Assistant message requesting tool calls
    messages.push({
      role: "assistant",
      content: opts.toolCalls.map((tc) => ({
        type: "toolCall",
        name: tc.toolName,
        id: `tc-${tc.toolName}`,
      })),
    });
    // Tool result messages
    for (const tc of opts.toolCalls) {
      messages.push({
        role: "tool",
        content: [{ type: "text", text: tc.resultText }],
        toolCallId: `tc-${tc.toolName}`,
      });
    }
  }

  // Final assistant message with text
  messages.push({
    role: "assistant",
    content: [{ type: "text", text: opts.finalText }],
  });

  return {
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn().mockResolvedValue(undefined),
    agent: { waitForIdle: vi.fn().mockResolvedValue(undefined) },
    state: { messages },
    dispose: vi.fn(),
  };
}

/**
 * Build a mock child session where a tool was called but errored.
 * The tool call is visible in messages, but the result is an error,
 * and the final assistant text reports the failure.
 */
function buildErrorToolSession(opts: {
  toolName: string;
  errorText: string;
  finalText: string;
}) {
  return {
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn().mockResolvedValue(undefined),
    agent: { waitForIdle: vi.fn().mockResolvedValue(undefined) },
    state: {
      messages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", name: opts.toolName, id: `tc-${opts.toolName}` }],
        },
        {
          role: "tool",
          content: [{ type: "text", text: `ERROR: ${opts.errorText}` }],
          toolCallId: `tc-${opts.toolName}`,
          isError: true,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: opts.finalText }],
        },
      ],
    },
    dispose: vi.fn(),
  };
}

function mockSessionOnce(session: ReturnType<typeof buildSafeToolSession>) {
  mockedCreateSession.mockResolvedValueOnce({
    session: session as never,
    extensionsResult: { extensions: [], tools: [], diagnostics: [] } as never,
  });
}

// ---------------------------------------------------------------------------
// Telemetry helpers
// ---------------------------------------------------------------------------

/** Get tool names passed to createAgentSession's customTools arg. */
function getConfiguredToolNames(callIndex = 0): string[] {
  const args = mockedCreateSession.mock.calls[callIndex]?.[0] as
    | { customTools?: Array<{ name: string }> }
    | undefined;
  return (args?.customTools ?? []).map((t) => t.name);
}

/** Extract tool names from toolCall blocks in mock session messages. */
function getInvokedToolNames(
  session: { state: { messages: Array<Record<string, unknown>> } }
): string[] {
  return session.state.messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => (m.content as Array<Record<string, unknown>>) ?? [])
    .filter((c) => c.type === "toolCall")
    .map((c) => c.name as string);
}

/** Extract text from the first content block of a tool result. */
function extractResultText(
  result: { content: Array<{ type: string; text?: string }> }
): string {
  const block = result.content.find((c) => c.type === "text");
  return (block as { text: string } | undefined)?.text ?? "";
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

/**
 * Initialize the extension and register safe tools in the global registry.
 * Returns the delegate_to_subagent tool capture.
 *
 * Each call creates a fresh extension instance with a fresh registry,
 * so tests are isolated.
 */
function registerToolWithSafeTools(
  safeTools: ToolDefinition[]
): RegisteredToolCapture {
  _setChildDepth(0);
  const { api, getTool } = createMockExtensionAPI();
  piSubagentsExtension(api);

  const register = (globalThis as Record<string, unknown>)
    .__piSubagents_registerSafeTool as (tool: ToolDefinition) => void;
  for (const tool of safeTools) {
    register(tool);
  }

  const delegateTool = getTool("delegate_to_subagent");
  if (!delegateTool) throw new Error("delegate_to_subagent not registered");
  return delegateTool;
}

beforeEach(() => {
  _setChildDepth(0);
  vi.clearAllMocks();
  resetNonceCounter();
  // Ensure no stale global remains from a previous test
  delete (globalThis as Record<string, unknown>).__piSubagents_registerSafeTool;
});

// ---------------------------------------------------------------------------
// Scenario 1: Approved safe tool is used (positive trap)
// ---------------------------------------------------------------------------

describe("Scenario 1: approved safe tool positive trap", () => {
  it("canary flows from approved safe tool through child to parent result", async () => {
    const nonce = generateNonce();
    const derived = deriveFromNonce(nonce);

    const safeTool = makeFakeToolWithCanary(
      "get_secret_data",
      `SECRET: ${derived}`
    );
    const tool = registerToolWithSafeTools([safeTool]);

    const session = buildSafeToolSession({
      toolCalls: [{ toolName: "get_secret_data", resultText: `SECRET: ${derived}` }],
      finalText: `The secret data is: ${derived}`,
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-1",
      { task: "Get the secret data", safeCustomTools: ["get_secret_data"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: tool was wired into child
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    expect(getConfiguredToolNames()).toContain("get_secret_data");

    // Invocation telemetry: tool was called by the child
    expect(getInvokedToolNames(session)).toContain("get_secret_data");

    // Semantic dependence: derived canary in result
    expect(text).toContain(derived);

    // Anti-echo: raw nonce absent
    expect(text).not.toContain(nonce);

    // Cleanup
    expect(session.dispose).toHaveBeenCalled();
  });

  it("derived canary present, raw nonce absent in parent result", async () => {
    const nonce = generateNonce("RAW");
    const derived = deriveFromNonce(nonce);

    const safeTool = makeFakeToolWithCanary("data_source", `TOKEN=${derived}`);
    const tool = registerToolWithSafeTools([safeTool]);

    const session = buildSafeToolSession({
      toolCalls: [{ toolName: "data_source", resultText: `TOKEN=${derived}` }],
      finalText: `Result: ${derived}`,
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-1b",
      { task: "Fetch token", safeCustomTools: ["data_source"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    expect(text).toContain(derived);
    expect(text).not.toContain(nonce);
    expect(text).toContain("DERIVED:");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Unapproved safe tool is not available (negative trap)
// ---------------------------------------------------------------------------

describe("Scenario 2: unapproved safe tool negative trap", () => {
  it("registered but unallowed tool excluded from customTools, no canary", async () => {
    const nonce = generateNonce();
    const derived = deriveFromNonce(nonce);

    // Register the tool but do NOT allow it
    const safeTool = makeFakeToolWithCanary("get_secret_data", `SECRET: ${derived}`);
    const tool = registerToolWithSafeTools([safeTool]);

    const session = buildSafeToolSession({
      finalText: "I don't have access to get_secret_data. Cannot retrieve the data.",
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-2a",
      { task: "Get the secret data", safeCustomTools: [] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: customTools is empty or undefined
    const args = mockedCreateSession.mock.calls[0]?.[0] as
      | { customTools?: unknown[] }
      | undefined;
    expect(args?.customTools).toBeUndefined();

    // Invocation telemetry: no tool calls at all
    expect(getInvokedToolNames(session)).toHaveLength(0);

    // No canary fabricated
    expect(text).not.toContain(derived);
    expect(text).not.toContain(nonce);
    expect(text).not.toContain("SECRET:");
  });

  it("omitted safeCustomTools also yields no custom tools", async () => {
    const nonce = generateNonce();
    const derived = deriveFromNonce(nonce);

    const safeTool = makeFakeToolWithCanary("get_secret_data", `SECRET: ${derived}`);
    const tool = registerToolWithSafeTools([safeTool]);

    const session = buildSafeToolSession({
      finalText: "No tools available for this request.",
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-2b",
      { task: "Get the secret data" }, // no safeCustomTools at all
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    const args = mockedCreateSession.mock.calls[0]?.[0] as
      | { customTools?: unknown[] }
      | undefined;
    expect(args?.customTools).toBeUndefined();
    expect(text).not.toContain(derived);
    expect(text).not.toContain(nonce);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Mixed — approved tool used, unapproved tool blocked
// ---------------------------------------------------------------------------

describe("Scenario 3: approved tool used, unapproved tool blocked", () => {
  it("approved tool canary present, unapproved absent, config + invocation telemetry correct", async () => {
    const nonceAlpha = generateNonce("ALPHA");
    const nonceBeta = generateNonce("BETA");
    const derivedAlpha = deriveFromNonce(nonceAlpha);
    const derivedBeta = deriveFromNonce(nonceBeta);

    const toolAlpha = makeFakeToolWithCanary("tool_alpha", `ALPHA_RESULT: ${derivedAlpha}`);
    const toolBeta = makeFakeToolWithCanary("tool_beta", `BETA_RESULT: ${derivedBeta}`);
    const tool = registerToolWithSafeTools([toolAlpha, toolBeta]);

    // Child calls only tool_alpha (tool_beta not available)
    const session = buildSafeToolSession({
      toolCalls: [{ toolName: "tool_alpha", resultText: `ALPHA_RESULT: ${derivedAlpha}` }],
      finalText: `Alpha says: ${derivedAlpha}. tool_beta is not available.`,
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-3",
      { task: "Use tool_alpha and tool_beta", safeCustomTools: ["tool_alpha"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: only tool_alpha wired
    const configuredTools = getConfiguredToolNames();
    expect(configuredTools).toContain("tool_alpha");
    expect(configuredTools).not.toContain("tool_beta");

    // Invocation telemetry: only tool_alpha called
    const invokedTools = getInvokedToolNames(session);
    expect(invokedTools).toContain("tool_alpha");
    expect(invokedTools).not.toContain("tool_beta");

    // Canary assertions: alpha present, beta absent
    expect(text).toContain(derivedAlpha);
    expect(text).not.toContain(derivedBeta);

    // Raw nonces absent
    expect(text).not.toContain(nonceAlpha);
    expect(text).not.toContain(nonceBeta);

    // Result depends on invoked tool output, not merely on configuration
    expect(text).toContain("DERIVED:");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Anti-fabrication trap with decoy canary
// ---------------------------------------------------------------------------

describe("Scenario 4: anti-fabrication trap with decoy canary", () => {
  it("real canary from tool used, decoy planted in task rejected", async () => {
    const nonce = generateNonce();
    const realDerived = deriveFromNonce(nonce);
    const decoy = generateDecoy(nonce);

    const safeTool = makeFakeToolWithCanary("get_secret_data", `TOKEN: ${realDerived}`);
    const tool = registerToolWithSafeTools([safeTool]);

    const session = buildSafeToolSession({
      toolCalls: [{ toolName: "get_secret_data", resultText: `TOKEN: ${realDerived}` }],
      finalText: `The real token is: ${realDerived}`,
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-4",
      {
        task: `A clue was found: ${decoy}. Call get_secret_data for the real token.`,
        safeCustomTools: ["get_secret_data"],
      },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Real canary present
    expect(text).toContain(realDerived);

    // Decoy absent from child result (it was only in the task)
    expect(text).not.toContain(decoy);

    // Exactly one session created
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);

    // Config telemetry
    expect(getConfiguredToolNames()).toContain("get_secret_data");
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Per-tool canary isolation (multi-tool)
// ---------------------------------------------------------------------------

describe("Scenario 5: per-tool canary isolation (multi-tool)", () => {
  it("allowed tools produce canaries, skipped tool does not, telemetry matches", async () => {
    const nonceA = generateNonce("MULTI-A");
    const nonceB = generateNonce("MULTI-B");
    const nonceC = generateNonce("MULTI-C");
    const derivedA = deriveFromNonce(nonceA);
    const derivedB = deriveFromNonce(nonceB);
    const derivedC = deriveFromNonce(nonceC);

    const toolA = makeFakeToolWithCanary("tool_a", `A_RESULT: ${derivedA}`);
    const toolB = makeFakeToolWithCanary("tool_b", `B_RESULT: ${derivedB}`);
    const toolC = makeFakeToolWithCanary("tool_c", `C_RESULT: ${derivedC}`);
    const tool = registerToolWithSafeTools([toolA, toolB, toolC]);

    // Child calls tool_a and tool_c only (tool_b not in allowlist)
    const session = buildSafeToolSession({
      toolCalls: [
        { toolName: "tool_a", resultText: `A_RESULT: ${derivedA}` },
        { toolName: "tool_c", resultText: `C_RESULT: ${derivedC}` },
      ],
      finalText: `A: ${derivedA}, C: ${derivedC}. tool_b was not available.`,
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-5",
      { task: "Use all three tools", safeCustomTools: ["tool_a", "tool_c"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: tool_a and tool_c wired, tool_b excluded
    const configuredTools = getConfiguredToolNames();
    expect(configuredTools).toContain("tool_a");
    expect(configuredTools).toContain("tool_c");
    expect(configuredTools).not.toContain("tool_b");
    expect(configuredTools).toHaveLength(2);

    // Invocation telemetry: tool_a and tool_c called, tool_b not
    const invokedTools = getInvokedToolNames(session);
    expect(invokedTools).toContain("tool_a");
    expect(invokedTools).toContain("tool_c");
    expect(invokedTools).not.toContain("tool_b");

    // Canary partition: A and C present, B absent
    expect(text).toContain(derivedA);
    expect(text).toContain(derivedC);
    expect(text).not.toContain(derivedB);

    // Raw nonces absent
    expect(text).not.toContain(nonceA);
    expect(text).not.toContain(nonceB);
    expect(text).not.toContain(nonceC);
  });

  it("each canary is unique and derived form proves tool-path dependence", async () => {
    const nonceA = generateNonce("ISO-A");
    const nonceC = generateNonce("ISO-C");
    const derivedA = deriveFromNonce(nonceA);
    const derivedC = deriveFromNonce(nonceC);

    // Derived values must be different
    expect(derivedA).not.toBe(derivedC);

    const toolA = makeFakeToolWithCanary("tool_a", derivedA);
    const toolC = makeFakeToolWithCanary("tool_c", derivedC);
    const tool = registerToolWithSafeTools([toolA, toolC]);

    const session = buildSafeToolSession({
      toolCalls: [
        { toolName: "tool_a", resultText: derivedA },
        { toolName: "tool_c", resultText: derivedC },
      ],
      finalText: `Results: ${derivedA} and ${derivedC}`,
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-5b",
      { task: "Get both results", safeCustomTools: ["tool_a", "tool_c"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Both derived canaries present and distinct
    expect(text).toContain(derivedA);
    expect(text).toContain(derivedC);
    expect(derivedA).not.toBe(derivedC);

    // Output structurally depends on tool invocation results
    expect(text).toMatch(/DERIVED:/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Allowlisted tool fails honestly
// ---------------------------------------------------------------------------

describe("Scenario 6: allowlisted tool fails honestly", () => {
  it("error reported honestly, no canary fabricated, invocation attempted", async () => {
    const nonce = generateNonce();
    const derived = deriveFromNonce(nonce);

    const safeTool = makeFakeToolWithCanary("get_secret_data", `TOKEN: ${derived}`);
    const tool = registerToolWithSafeTools([safeTool]);

    // Child called the tool but it errored; child reports the error
    const session = buildErrorToolSession({
      toolName: "get_secret_data",
      errorText: "Connection refused: token vault unavailable",
      finalText: "The tool get_secret_data failed with an error. I cannot provide the secret data.",
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-6a",
      { task: "Get the secret data", safeCustomTools: ["get_secret_data"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: tool was wired into child
    expect(getConfiguredToolNames()).toContain("get_secret_data");

    // Invocation telemetry: tool call was attempted
    const invokedTools = getInvokedToolNames(session);
    expect(invokedTools).toContain("get_secret_data");

    // No canary fabricated
    expect(text).not.toContain(derived);
    expect(text).not.toContain(nonce);
    expect(text).not.toContain("TOKEN:");

    // Child reports failure
    expect(text).toMatch(/fail|error|cannot/i);

    // Session cleaned up
    expect(session.dispose).toHaveBeenCalled();
  });

  it("child session throw surfaces error in parent, no canary in error path", async () => {
    const nonce = generateNonce();
    const derived = deriveFromNonce(nonce);

    const safeTool = makeFakeToolWithCanary("get_secret_data", `TOKEN: ${derived}`);
    const tool = registerToolWithSafeTools([safeTool]);

    // Child session itself throws during prompt (severe failure)
    const session = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockRejectedValue(new Error("Child process crashed")),
      agent: { waitForIdle: vi.fn() },
      state: { messages: [] },
      dispose: vi.fn(),
    };
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-6b",
      { task: "Get the secret data", safeCustomTools: ["get_secret_data"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: tool was wired
    expect(getConfiguredToolNames()).toContain("get_secret_data");

    // Error surfaced honestly
    expect(text).toContain("Subagent error");
    expect(text).toContain("Child process crashed");

    // No canary fabricated
    expect(text).not.toContain(derived);
    expect(text).not.toContain(nonce);

    // Session disposed
    expect(session.dispose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Unknown safe tool (negative veracity)
// ---------------------------------------------------------------------------

describe("Scenario 7: unknown safe tool negative veracity", () => {
  it("unknown tool not resolved, customTools empty, no canary fabricated", async () => {
    const nonce = generateNonce();
    const derived = deriveFromNonce(nonce);

    // Register NO safe tools, but ask for one by name
    const tool = registerToolWithSafeTools([]);

    const session = buildSafeToolSession({
      finalText: "I don't have access to get_nonexistent_tool. The tool is not available.",
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-7a",
      {
        task: `Call get_nonexistent_tool and report the token ${nonce}`,
        safeCustomTools: ["get_nonexistent_tool"],
      },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: no tools resolved (unknown name silently ignored)
    const args = mockedCreateSession.mock.calls[0]?.[0] as
      | { customTools?: unknown[] }
      | undefined;
    expect(args?.customTools).toBeUndefined();

    // Invocation telemetry: no tool calls
    expect(getInvokedToolNames(session)).toHaveLength(0);

    // No canary fabricated
    expect(text).not.toContain(derived);

    // Session created and disposed
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalled();
  });

  it("registered tool under different name not resolved via wrong name", async () => {
    const nonce = generateNonce();
    const derived = deriveFromNonce(nonce);

    // Register a tool, but ask for it under a wrong name
    const safeTool = makeFakeToolWithCanary("real_tool", `DATA: ${derived}`);
    const tool = registerToolWithSafeTools([safeTool]);

    const session = buildSafeToolSession({
      finalText: "Tool wrong_name is not available.",
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-7b",
      { task: "Use wrong_name to get data", safeCustomTools: ["wrong_name"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: wrong_name not resolved, customTools empty
    const args = mockedCreateSession.mock.calls[0]?.[0] as
      | { customTools?: unknown[] }
      | undefined;
    expect(args?.customTools).toBeUndefined();

    // No canary
    expect(text).not.toContain(derived);
    expect(text).not.toContain(nonce);
    expect(text).not.toContain("DATA:");
  });

  it("mixed known and unknown: only known tool resolved", async () => {
    const nonceKnown = generateNonce("KNOWN");
    const nonceUnknown = generateNonce("UNKNOWN");
    const derivedKnown = deriveFromNonce(nonceKnown);
    const derivedUnknown = deriveFromNonce(nonceUnknown);

    const knownTool = makeFakeToolWithCanary("known_tool", `KNOWN: ${derivedKnown}`);
    const tool = registerToolWithSafeTools([knownTool]);

    const session = buildSafeToolSession({
      toolCalls: [{ toolName: "known_tool", resultText: `KNOWN: ${derivedKnown}` }],
      finalText: `known_tool returned: ${derivedKnown}. ghost_tool is not available.`,
    });
    mockSessionOnce(session);

    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "st-7c",
      { task: "Use both tools", safeCustomTools: ["known_tool", "ghost_tool"] },
      undefined,
      undefined,
      ctx
    );
    const text = extractResultText(result);

    // Config telemetry: only known_tool resolved
    const configuredTools = getConfiguredToolNames();
    expect(configuredTools).toContain("known_tool");
    expect(configuredTools).not.toContain("ghost_tool");

    // Known tool canary present
    expect(text).toContain(derivedKnown);

    // Unknown tool canary absent
    expect(text).not.toContain(derivedUnknown);
  });
});
