/**
 * Veracity trap tests: positive traps.
 *
 * These tests prove that the delegate_to_subagent tool is actually called
 * and that the final result structurally depends on tool-only information.
 *
 * Strategy:
 * - Inject a hidden canary nonce into the mock child session's response.
 * - The canary is generated fresh per test and is not present in the
 *   task description, system prompt, or any other context.
 * - Assert that:
 *   1. createAgentSession was called (tool invocation telemetry)
 *   2. The tool result contains the exact canary or its derivation
 *   3. The canary could not have been produced without the tool
 *
 * Includes stronger variants:
 * - Decoy nonce in context vs real nonce from tool
 * - Derived/transformed canary that requires computation on tool output
 * - Multiple runs with fresh nonces
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
  deriveFromNonce,
  generateDecoy,
  resetNonceCounter,
} from "../helpers/nonce.js";

// Mock createAgentSession for controlled canary injection
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

function registerTool(): RegisteredToolCapture {
  _setChildDepth(0);
  const { api, getTool } = createMockExtensionAPI();
  piSubagentsExtension(api);
  return getTool("delegate_to_subagent")!;
}

/** Create a mock session that returns text containing the canary. */
function buildCanarySession(canaryText: string) {
  const session = {
    subscribe(listener: Function) {
      return () => {};
    },
    prompt: vi.fn().mockResolvedValue(undefined),
    agent: { waitForIdle: vi.fn().mockResolvedValue(undefined) },
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

function mockSessionWith(canaryText: string) {
  const session = buildCanarySession(canaryText);
  mockedCreateSession.mockResolvedValue({
    session: session as any,
    extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
  });
  return session;
}

beforeEach(() => {
  _setChildDepth(0);
  vi.clearAllMocks();
  resetNonceCounter();
});

describe("positive trap: raw canary", () => {
  it("tool result contains the exact canary nonce from the child", async () => {
    const canary = generateNonce();
    const session = mockSessionWith(`The hidden token is ${canary}`);
    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const result = await tool.execute("trap-1", { task: "Find the token" }, undefined, undefined, ctx);

    // Telemetry: createAgentSession was called
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    // Content: result contains the exact canary
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain(canary);
    // Cleanup
    expect(session.dispose).toHaveBeenCalled();
  });

  it("result does NOT contain canary when child returns different text", async () => {
    const canary = generateNonce();
    mockSessionWith("No special tokens here");
    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const result = await tool.execute("trap-2", { task: "Find the token" }, undefined, undefined, ctx);
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain(canary);
  });
});

describe("positive trap: derived canary", () => {
  it("result contains the derived value computed from the canary", async () => {
    const canary = generateNonce();
    const derived = deriveFromNonce(canary);
    // Child returns the derived form
    mockSessionWith(`Transformed result: ${derived}`);
    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const result = await tool.execute("trap-3", { task: "Transform the token" }, undefined, undefined, ctx);

    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain(derived);
    // The raw canary should NOT be in the result (child returned derived form)
    expect(text).not.toContain(canary);
  });
});

describe("positive trap: decoy vs real canary", () => {
  it("result contains real canary, not decoy", async () => {
    const realCanary = generateNonce();
    const decoy = generateDecoy(realCanary);

    // Decoy might appear in task/context, but child returns real canary
    mockSessionWith(`Real answer: ${realCanary}`);
    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const result = await tool.execute(
      "trap-4",
      { task: `A clue was found: ${decoy}. Find the real token.` },
      undefined,
      undefined,
      ctx
    );

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain(realCanary);
    // Decoy is only in the task, not in the child result
    expect(text).not.toContain(decoy);
  });
});

describe("positive trap: multiple runs with fresh nonces", () => {
  it("each run produces a unique canary in the result", async () => {
    const results: string[] = [];
    const canaries: string[] = [];

    for (let i = 0; i < 3; i++) {
      resetNonceCounter();
      // Use index to make each canary unique
      const canary = generateNonce(`RUN${i}`);
      canaries.push(canary);
      mockSessionWith(`Token for run ${i}: ${canary}`);
      const tool = registerTool();
      const ctx = createMockExtensionContext();

      const result = await tool.execute(`trap-multi-${i}`, { task: "Get token" }, undefined, undefined, ctx);
      const text = (result.content[0] as { text: string }).text;
      results.push(text);
    }

    // Each result contains its own canary
    for (let i = 0; i < 3; i++) {
      expect(results[i]).toContain(canaries[i]);
    }

    // No result contains another run's canary
    expect(results[0]).not.toContain(canaries[1]);
    expect(results[1]).not.toContain(canaries[2]);
    expect(results[2]).not.toContain(canaries[0]);
  });
});

describe("positive trap: tool invocation count", () => {
  it("records exactly one createAgentSession call per execute", async () => {
    const canary = generateNonce();
    mockSessionWith(`Token: ${canary}`);
    const tool = registerTool();
    const ctx = createMockExtensionContext();

    await tool.execute("trap-count-1", { task: "a" }, undefined, undefined, ctx);
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);

    mockSessionWith(`Token: ${generateNonce()}`);
    await tool.execute("trap-count-2", { task: "b" }, undefined, undefined, ctx);
    expect(mockedCreateSession).toHaveBeenCalledTimes(2);
  });
});

describe("positive trap: canary transformation instruction", () => {
  it("child returns token with transformation; result carries transformed form", async () => {
    const canary = generateNonce();
    // Simulate: child was told to reverse the token and prefix with DERIVED:
    const transformed = deriveFromNonce(canary);
    mockSessionWith(`After applying transformation: ${transformed}`);
    const tool = registerTool();
    const ctx = createMockExtensionContext();

    const result = await tool.execute("trap-transform", { task: "Transform token" }, undefined, undefined, ctx);

    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain(transformed);
    expect(text).toContain("DERIVED:");
  });
});
