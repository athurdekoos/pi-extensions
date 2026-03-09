/**
 * Veracity trap tests: negative traps.
 *
 * These tests verify that when the subagent tool is absent, disabled,
 * or fails, the agent fails honestly and does NOT fabricate a canary/token.
 *
 * Strategy:
 * - Generate a canary nonce that would be the "correct" answer if the tool worked.
 * - Make the tool unavailable or broken.
 * - Assert:
 *   1. The tool was not successfully called (or failed as intended)
 *   2. The result does NOT contain the canary or any derived value
 *   3. The result reports failure/inability honestly
 *
 * Negative scenarios:
 * - Tool absent (childDepth > 0, so not registered)
 * - Tool present but execute blocked by recursion guard
 * - Tool present but createAgentSession fails
 * - Tool present but child session throws during prompt
 * - Decoy canary in task text, tool fails, decoy must not appear as answer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import piSubagentsExtension, {
  _setChildDepth,
  _addChildSignal,
  _removeChildSignal,
} from "../../index.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
} from "../helpers/mock-extension-api.js";
import {
  generateNonce,
  deriveFromNonce,
  generateDecoy,
  resetNonceCounter,
} from "../helpers/nonce.js";

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

beforeEach(() => {
  _setChildDepth(0);
  vi.clearAllMocks();
  resetNonceCounter();
});

describe("negative trap: tool absent (child context)", () => {
  it("no tool is registered, no canary appears", () => {
    const canary = generateNonce();
    _setChildDepth(1);
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);

    // Tool was not registered
    expect(registeredTools).toHaveLength(0);

    // No execute path exists, so no canary can be produced.
    // The agent would have to fabricate one -- this structural test
    // proves the tool surface is empty.
    const toolNames = registeredTools.map((t) => t.name);
    expect(toolNames).not.toContain("delegate_to_subagent");

    // The canary is unreachable
    const canaryInToolNames = toolNames.some((n) => n.includes(canary));
    expect(canaryInToolNames).toBe(false);
  });
});

describe("negative trap: recursion guard blocks execution", () => {
  it("returns error, not canary, when depth guard fires", async () => {
    const canary = generateNonce();
    const derived = deriveFromNonce(canary);

    // Register at depth 0, then set depth to 1 before executing
    _setChildDepth(0);
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent")!;

    _setChildDepth(1);
    const ctx = createMockExtensionContext();
    const result = await tool.execute(
      "neg-1",
      { task: `Find token ${canary}` },
      undefined,
      undefined,
      ctx
    );

    const text = (result.content[0] as { text: string }).text;

    // Tool was called but blocked
    expect(text).toMatch(/recursive delegation blocked/i);
    // No canary or derived value in result
    expect(text).not.toContain(canary);
    expect(text).not.toContain(derived);
    // createAgentSession was never called
    expect(mockedCreateSession).not.toHaveBeenCalled();

    _setChildDepth(0);
  });
});

describe("negative trap: signal guard blocks execution", () => {
  it("returns error, not canary, when signal guard fires", async () => {
    const canary = generateNonce();

    _setChildDepth(0);
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent")!;

    const ac = new AbortController();
    _addChildSignal(ac.signal);
    const ctx = createMockExtensionContext();

    const result = await tool.execute(
      "neg-2",
      { task: `Find ${canary}` },
      ac.signal,
      undefined,
      ctx
    );

    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/recursive delegation blocked/i);
    expect(text).not.toContain(canary);
    expect(mockedCreateSession).not.toHaveBeenCalled();

    _removeChildSignal(ac.signal);
  });
});

describe("negative trap: createAgentSession fails", () => {
  it("reports error honestly, does not fabricate canary", async () => {
    const canary = generateNonce();
    const derived = deriveFromNonce(canary);

    mockedCreateSession.mockRejectedValue(new Error("No API key configured"));

    _setChildDepth(0);
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent")!;
    const ctx = createMockExtensionContext();

    const result = await tool.execute(
      "neg-3",
      { task: `Retrieve token ${canary}` },
      undefined,
      undefined,
      ctx
    );

    const text = (result.content[0] as { text: string }).text;
    // Error is reported
    expect(text).toContain("Subagent error");
    expect(text).toContain("No API key configured");
    // No canary in result
    expect(text).not.toContain(canary);
    expect(text).not.toContain(derived);
    // Session was attempted
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
  });
});

describe("negative trap: child session prompt throws", () => {
  it("reports error honestly, does not fabricate canary", async () => {
    const canary = generateNonce();

    const session = {
      subscribe: () => () => {},
      prompt: vi.fn().mockRejectedValue(new Error("Rate limit exceeded")),
      agent: { waitForIdle: vi.fn() },
      state: { messages: [] },
      dispose: vi.fn(),
    };

    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    _setChildDepth(0);
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent")!;
    const ctx = createMockExtensionContext();

    const result = await tool.execute(
      "neg-4",
      { task: `Find ${canary}` },
      undefined,
      undefined,
      ctx
    );

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Subagent error");
    expect(text).toContain("Rate limit exceeded");
    expect(text).not.toContain(canary);
    expect(session.dispose).toHaveBeenCalled();
  });
});

describe("negative trap: decoy in task, tool fails", () => {
  it("decoy canary from task does not appear in error result", async () => {
    const realCanary = generateNonce();
    const decoy = generateDecoy(realCanary);

    mockedCreateSession.mockRejectedValue(new Error("Service unavailable"));

    _setChildDepth(0);
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent")!;
    const ctx = createMockExtensionContext();

    const result = await tool.execute(
      "neg-5",
      { task: `The hint is ${decoy}. Find the real token.` },
      undefined,
      undefined,
      ctx
    );

    const text = (result.content[0] as { text: string }).text;
    // Error is reported
    expect(text).toContain("Subagent error");
    // Neither real canary nor decoy appears in the tool result text
    // (decoy was in the task params, not in the error message)
    expect(text).not.toContain(realCanary);
    expect(text).not.toContain(decoy);
  });
});

describe("negative trap: fresh nonces across multiple failed runs", () => {
  it("no fabricated canary across 3 failed runs", async () => {
    for (let i = 0; i < 3; i++) {
      const canary = generateNonce(`NEGRUN${i}`);
      const derived = deriveFromNonce(canary);

      mockedCreateSession.mockRejectedValue(new Error(`Failure ${i}`));

      _setChildDepth(0);
      const { api, getTool } = createMockExtensionAPI();
      piSubagentsExtension(api);
      const tool = getTool("delegate_to_subagent")!;
      const ctx = createMockExtensionContext();

      const result = await tool.execute(
        `neg-multi-${i}`,
        { task: `Get ${canary}` },
        undefined,
        undefined,
        ctx
      );

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("Subagent error");
      expect(text).not.toContain(canary);
      expect(text).not.toContain(derived);
    }
  });
});

describe("negative trap: child returns empty output on failure path", () => {
  it("reports no output, does not fabricate content", async () => {
    const canary = generateNonce();

    const session = {
      subscribe: () => () => {},
      prompt: vi.fn().mockResolvedValue(undefined),
      agent: { waitForIdle: vi.fn().mockResolvedValue(undefined) },
      state: { messages: [] }, // No assistant messages at all
      dispose: vi.fn(),
    };

    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    _setChildDepth(0);
    const { api, getTool } = createMockExtensionAPI();
    piSubagentsExtension(api);
    const tool = getTool("delegate_to_subagent")!;
    const ctx = createMockExtensionContext();

    const result = await tool.execute(
      "neg-empty",
      { task: `Retrieve ${canary}` },
      undefined,
      undefined,
      ctx
    );

    const text = (result.content[0] as { text: string }).text;
    // Result honestly reports no output
    expect(text).toContain("No output from subagent");
    // No canary fabricated
    expect(text).not.toContain(canary);
  });
});
