/**
 * smoke.test.ts — Smoke test for the extension entrypoint.
 *
 * Proves that loading index.ts registers the expected commands, tools,
 * flags, and event hooks without requiring a running Pi instance.
 *
 * Regressions caught:
 * - Extension entrypoint fails to load (import error, missing module)
 * - Expected commands not registered (name drift, removed registration)
 * - Expected tools not registered
 * - Expected flags not registered
 * - Expected event hooks not wired
 * - Registration calls use wrong argument shapes
 * - Factory function throws during setup
 */

import { describe, it, expect } from "vitest";
import initExtension from "../index.js";

// ---------------------------------------------------------------------------
// Minimal ExtensionAPI mock
// ---------------------------------------------------------------------------

interface Registration {
  commands: string[];
  tools: string[];
  flags: string[];
  events: string[];
}

function createMockExtensionAPI(): { api: Parameters<typeof initExtension>[0]; reg: Registration } {
  const reg: Registration = {
    commands: [],
    tools: [],
    flags: [],
    events: [],
  };

  const api = {
    registerCommand(name: string, _opts: unknown) {
      reg.commands.push(name);
    },
    registerTool(def: { name: string }) {
      reg.tools.push(def.name);
    },
    registerFlag(name: string, _opts: unknown) {
      reg.flags.push(name);
    },
    on(event: string, _handler: unknown) {
      reg.events.push(event);
    },
    appendEntry(_type: string, _data?: unknown) {},
    exec(_cmd: string, _args: string[], _opts?: unknown) {
      return Promise.resolve({ code: 1, stdout: "", stderr: "", killed: false });
    },
    getFlag(_name: string) {
      return undefined;
    },
    sendMessage(_msg: unknown, _opts?: unknown) {},
    sendUserMessage(_content: unknown, _opts?: unknown) {},
    events: {
      on(_event: string, _handler: unknown) {},
      emit(_event: string, _data?: unknown) {},
    },
    setSessionName(_name: string) {},
    getSessionName() { return undefined; },
    setLabel(_id: string, _label: string | undefined) {},
    getActiveTools() { return []; },
    getAllTools() { return []; },
    setActiveTools(_names: string[]) {},
    registerShortcut(_shortcut: string, _opts: unknown) {},
    registerMessageRenderer(_type: string, _renderer: unknown) {},
    registerProvider(_name: string, _config: unknown) {},
    unregisterProvider(_name: string) {},
    setModel(_model: unknown) { return Promise.resolve(false); },
    getThinkingLevel() { return "off" as const; },
    setThinkingLevel(_level: string) {},
    getCommands() { return []; },
  } as unknown as Parameters<typeof initExtension>[0];

  return { api, reg };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extension entrypoint smoke test", () => {
  it("loads without throwing", () => {
    const { api } = createMockExtensionAPI();
    expect(() => initExtension(api)).not.toThrow();
  });

  it("registers all expected commands", () => {
    const { api, reg } = createMockExtensionAPI();
    initExtension(api);

    expect(reg.commands).toContain("plan");
    expect(reg.commands).toContain("plan-debug");
    expect(reg.commands).toContain("todos");
    expect(reg.commands).toContain("plan-review");
    expect(reg.commands).toContain("plan-annotate");
    expect(reg.commands).toHaveLength(5);
  });

  it("registers the submit_plan tool", () => {
    const { api, reg } = createMockExtensionAPI();
    initExtension(api);

    expect(reg.tools).toContain("submit_plan");
    expect(reg.tools).toHaveLength(1);
  });

  it("registers the --plan flag", () => {
    const { api, reg } = createMockExtensionAPI();
    initExtension(api);

    expect(reg.flags).toContain("plan");
    expect(reg.flags).toHaveLength(1);
  });

  it("wires all expected lifecycle hooks", () => {
    const { api, reg } = createMockExtensionAPI();
    initExtension(api);

    expect(reg.events).toContain("tool_call");
    expect(reg.events).toContain("input");
    expect(reg.events).toContain("context");
    expect(reg.events).toContain("before_agent_start");
    expect(reg.events).toContain("turn_end");
    expect(reg.events).toContain("agent_end");
    expect(reg.events).toContain("session_start");
    expect(reg.events).toHaveLength(7);
  });

  it("registers no unexpected commands, tools, or flags", () => {
    const { api, reg } = createMockExtensionAPI();
    initExtension(api);

    // Exact surface area — if a new command/tool/flag is added,
    // this test must be updated intentionally.
    expect(reg.commands.sort()).toEqual([
      "plan",
      "plan-annotate",
      "plan-debug",
      "plan-review",
      "todos",
    ]);
    expect(reg.tools).toEqual(["submit_plan"]);
    expect(reg.flags).toEqual(["plan"]);
    expect(reg.events.sort()).toEqual([
      "agent_end",
      "before_agent_start",
      "context",
      "input",
      "session_start",
      "tool_call",
      "turn_end",
    ]);
  });
});
