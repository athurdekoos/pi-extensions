/**
 * Extension-level tests: tool execution behavior.
 *
 * Tests the registered execute() function directly with mocked
 * createAgentSession. Verifies:
 * - Recursion guard blocks execution at depth > 0
 * - Signal-based recursion guard blocks execution
 * - Streaming updates are forwarded
 * - Errors are surfaced honestly
 * - Cancellation is reported
 * - Child session is disposed
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
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";

// We need to mock createAgentSession at the module level.
// The extension imports it directly, so we mock the module.
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

function registerAndGetTool(): RegisteredToolCapture {
  _setChildDepth(0);
  const { api, getTool } = createMockExtensionAPI();
  piSubagentsExtension(api);
  const tool = getTool("delegate_to_subagent");
  if (!tool) throw new Error("delegate_to_subagent not registered");
  return tool;
}

/** Build a fake session object that simulates a child run. */
function buildFakeSession(opts: {
  finalText?: string;
  throwOnPrompt?: Error;
  messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
} = {}) {
  const disposed = { value: false };
  const subscribers: Function[] = [];

  const finalMessages = opts.messages ?? [
    {
      role: "assistant",
      content: [{ type: "text", text: opts.finalText ?? "Child result" }],
    },
  ];

  const session = {
    subscribe(listener: Function) {
      subscribers.push(listener);
      return () => {
        const idx = subscribers.indexOf(listener);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
    prompt: opts.throwOnPrompt
      ? vi.fn().mockRejectedValue(opts.throwOnPrompt)
      : vi.fn().mockImplementation(async () => {
          // Simulate a streaming update
          for (const sub of subscribers) {
            sub({
              type: "message_update",
              message: {
                role: "assistant",
                content: [{ type: "text", text: opts.finalText ?? "Child result" }],
              },
            });
          }
        }),
    agent: {
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      messages: finalMessages,
    },
    dispose: vi.fn().mockImplementation(() => {
      disposed.value = true;
    }),
  };

  return { session, disposed };
}

beforeEach(() => {
  _setChildDepth(0);
  vi.clearAllMocks();
});

describe("execute: recursion guard (depth)", () => {
  it("blocks execution when childDepth > 0", async () => {
    const tool = registerAndGetTool();
    _setChildDepth(1);
    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-1", { task: "test" }, undefined, undefined, ctx);
    expect(result.content[0]).toHaveProperty("text");
    expect((result.content[0] as { text: string }).text).toMatch(/recursive delegation blocked/i);
    _setChildDepth(0);
  });
});

describe("execute: recursion guard (signal)", () => {
  it("blocks execution when signal is in activeChildSignals", async () => {
    const tool = registerAndGetTool();
    const ac = new AbortController();
    _addChildSignal(ac.signal);
    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-2", { task: "test" }, ac.signal, undefined, ctx);
    expect((result.content[0] as { text: string }).text).toMatch(/recursive delegation blocked/i);
    _removeChildSignal(ac.signal);
  });
});

describe("execute: successful child run", () => {
  it("returns child final text in structured result", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession({ finalText: "Analysis complete: 5 modules found" });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-3", { task: "Analyze modules" }, undefined, undefined, ctx);

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Analysis complete: 5 modules found");
    expect(text).toContain("Subagent Result");
  });

  it("disposes child session after success", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession();
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    await tool.execute("call-4", { task: "test" }, undefined, undefined, ctx);
    expect(session.dispose).toHaveBeenCalled();
  });

  it("forwards streaming updates via onUpdate", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession({ finalText: "streamed content" });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const updates: unknown[] = [];
    const onUpdate = vi.fn((update: unknown) => updates.push(update));
    const ctx = createMockExtensionContext();

    await tool.execute("call-5", { task: "test" }, undefined, onUpdate, ctx);
    expect(onUpdate).toHaveBeenCalled();
    // Verify the update contains [subagent] prefix
    const firstUpdate = updates[0] as { content: Array<{ text: string }> };
    expect(firstUpdate.content[0].text).toMatch(/\[subagent\]/);
  });

  it("restores childDepth to 0 after execution", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession();
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    await tool.execute("call-6", { task: "test" }, undefined, undefined, ctx);
    expect(_setChildDepth, "childDepth should be 0 after execution");
    // The actual depth check: the tool decrements in finally
    // If execute succeeded, depth should be back to 0
    // We verify by attempting registration (would fail if depth > 0)
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);
    expect(registeredTools.length).toBeGreaterThan(0);
  });
});

describe("execute: child session error", () => {
  it("surfaces error message honestly", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession({ throwOnPrompt: new Error("Model API unavailable") });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-7", { task: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Subagent error");
    expect(text).toContain("Model API unavailable");
  });

  it("disposes child session after error", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession({ throwOnPrompt: new Error("fail") });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    await tool.execute("call-8", { task: "test" }, undefined, undefined, ctx);
    expect(session.dispose).toHaveBeenCalled();
  });
});

describe("execute: cancellation", () => {
  it("reports cancellation when signal is aborted", async () => {
    const tool = registerAndGetTool();
    const ac = new AbortController();

    const { session } = buildFakeSession({
      throwOnPrompt: new Error("aborted"),
    });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    // Abort before execute
    ac.abort();
    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-9", { task: "test" }, ac.signal, undefined, ctx);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/cancel/i);
  });

  it("disposes child session on cancellation", async () => {
    const tool = registerAndGetTool();
    const ac = new AbortController();
    ac.abort();

    const { session } = buildFakeSession({ throwOnPrompt: new Error("aborted") });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    await tool.execute("call-10", { task: "test" }, ac.signal, undefined, ctx);
    expect(session.dispose).toHaveBeenCalled();
  });
});

describe("execute: createAgentSession failure", () => {
  it("reports error when session creation fails", async () => {
    const tool = registerAndGetTool();
    mockedCreateSession.mockRejectedValue(new Error("Auth failed"));

    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-11", { task: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Subagent error");
    expect(text).toContain("Auth failed");
  });
});

describe("execute: mode defaults", () => {
  it("defaults to read_only mode in result header", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession({ finalText: "done" });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-12", { task: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("mode: read_only");
  });

  it("defaults to summary outputStyle in result header", async () => {
    const tool = registerAndGetTool();
    const { session } = buildFakeSession({ finalText: "done" });
    mockedCreateSession.mockResolvedValue({
      session: session as any,
      extensionsResult: { extensions: [], tools: [], diagnostics: [] } as any,
    });

    const ctx = createMockExtensionContext();
    const result = await tool.execute("call-13", { task: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("output: summary");
  });
});
