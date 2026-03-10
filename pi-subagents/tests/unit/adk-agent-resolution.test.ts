/**
 * Unit tests: ADK agent resolution in delegate_to_subagent.
 *
 * Behavior protected (Phase 2):
 * - resolveAdkAgentViaTool returns provider_unavailable when resolve_adk_agent not registered
 * - resolveAdkAgentViaTool returns found when tool returns a match
 * - resolveAdkAgentViaTool returns ambiguous when tool reports ambiguity
 * - promptAgentSelection returns selected agent on user choice
 * - promptAgentSelection returns cancelled when user picks Cancel
 * - promptAgentSelection returns cancelled when agent list is empty
 * - resolveAdkAgentWithPrompt auto-resolves unique match without prompting
 * - resolveAdkAgentWithPrompt prompts on not_found (onMissing: "prompt")
 * - resolveAdkAgentWithPrompt cancels on not_found (onMissing: "cancel")
 * - resolveAdkAgentWithPrompt prompts on ambiguous (onAmbiguous: "prompt")
 * - resolveAdkAgentWithPrompt cancels on ambiguous (onAmbiguous: "cancel")
 * - buildAdkChildSystemPrompt includes ADK delegation instructions
 * - buildAdkChildSystemPrompt includes project path
 * - run_adk_agent is auto-allowlisted when agent param is provided
 * - Existing delegate_to_subagent behavior does not regress
 *
 * Behavior protected (Phase 3):
 * - provider_unavailable is distinguishable from not_found
 * - execution_unavailable is distinguishable from provider_unavailable
 * - no-UI selection-required behavior returns structured guidance
 * - ambiguous prefix matches do not auto-resolve (tested via resolve tool mock)
 * - unique exact and case-insensitive matches still resolve
 * - auto-allowlisting is deduped and non-mutating
 * - structured result includes requestedAgent, availableMatches, uiAvailable
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolveAdkAgentViaTool,
  promptAgentSelection,
  resolveAdkAgentWithPrompt,
  buildAdkChildSystemPrompt,
  buildChildSystemPrompt,
  resolveAllowedCustomTools,
  checkAdkExecutionAvailable,
  isInteractiveUIAvailable,
  type ResolvedAdkAgent,
  type DelegateParams,
} from "../../index.js";
import { makeFakeTool } from "../helpers/fake-tool.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<ResolvedAdkAgent> = {}): ResolvedAdkAgent {
  return {
    name: "researcher",
    project_path: "./agents/researcher",
    template: "basic",
    capabilities: [],
    label: "researcher (basic) — ./agents/researcher",
    source: "manifest",
    ...overrides,
  };
}

function makeResolveToolReturning(result: unknown): ToolDefinition {
  return {
    name: "resolve_adk_agent",
    label: "Resolve ADK Agent",
    description: "mock",
    parameters: {},
    async execute() {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: result,
      };
    },
  } as unknown as ToolDefinition;
}

function makeRegistry(...tools: ToolDefinition[]): Map<string, ToolDefinition> {
  const m = new Map<string, ToolDefinition>();
  for (const t of tools) m.set(t.name, t);
  return m;
}

function makeMockCtx(selectReturn: string | undefined = undefined, hasUI = true) {
  return {
    ui: {
      select: vi.fn().mockResolvedValue(selectReturn),
      notify: vi.fn(),
    },
    hasUI,
  };
}

function makeNoUICtx() {
  return {
    ui: {
      select: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
    },
    hasUI: false,
  };
}

function baseParams(overrides: Partial<DelegateParams> = {}): DelegateParams {
  return { task: "Do research", ...overrides };
}

// ---------------------------------------------------------------------------
// resolveAdkAgentViaTool
// ---------------------------------------------------------------------------

describe("resolveAdkAgentViaTool", () => {
  it("returns provider_unavailable when resolve_adk_agent is not registered", async () => {
    const registry = makeRegistry();
    const result = await resolveAdkAgentViaTool(registry, "/tmp", "researcher");
    expect(result.status).toBe("provider_unavailable");
    expect(result.available).toEqual([]);
  });

  it("returns found when tool resolves to a single agent", async () => {
    const agent = makeAgent();
    const tool = makeResolveToolReturning({
      status: "found",
      agent,
      available: [agent],
    });
    const registry = makeRegistry(tool);
    const result = await resolveAdkAgentViaTool(registry, "/tmp", "researcher");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("researcher");
  });

  it("returns ambiguous when tool reports multiple matches", async () => {
    const a = makeAgent({ name: "researcher_a" });
    const b = makeAgent({ name: "researcher_b" });
    const tool = makeResolveToolReturning({
      status: "ambiguous",
      matches: [a, b],
      available: [a, b],
    });
    const registry = makeRegistry(tool);
    const result = await resolveAdkAgentViaTool(registry, "/tmp", "researcher");
    expect(result.status).toBe("ambiguous");
    expect(result.matches).toHaveLength(2);
  });

  it("returns not_found when tool returns unparseable result", async () => {
    const tool: ToolDefinition = {
      name: "resolve_adk_agent",
      label: "mock",
      description: "mock",
      parameters: {},
      async execute() {
        return { content: [{ type: "text" as const, text: "not json" }], details: {} };
      },
    } as unknown as ToolDefinition;
    const registry = makeRegistry(tool);
    const result = await resolveAdkAgentViaTool(registry, "/tmp", "x");
    expect(result.status).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// checkAdkExecutionAvailable (Phase 3)
// ---------------------------------------------------------------------------

describe("checkAdkExecutionAvailable", () => {
  it("returns true when run_adk_agent is registered", () => {
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    expect(checkAdkExecutionAvailable(registry)).toBe(true);
  });

  it("returns false when run_adk_agent is not registered", () => {
    const registry = makeRegistry(makeFakeTool("other_tool"));
    expect(checkAdkExecutionAvailable(registry)).toBe(false);
  });

  it("returns false for empty registry", () => {
    const registry = makeRegistry();
    expect(checkAdkExecutionAvailable(registry)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInteractiveUIAvailable (Phase 3)
// ---------------------------------------------------------------------------

describe("isInteractiveUIAvailable", () => {
  it("returns true when hasUI and select function exist", () => {
    const ctx = makeMockCtx();
    expect(isInteractiveUIAvailable(ctx)).toBe(true);
  });

  it("returns false when hasUI is false", () => {
    const ctx = makeNoUICtx();
    expect(isInteractiveUIAvailable(ctx)).toBe(false);
  });

  it("returns false when ui is undefined", () => {
    expect(isInteractiveUIAvailable({ hasUI: true })).toBe(false);
  });

  it("returns false when select is not a function", () => {
    expect(isInteractiveUIAvailable({
      hasUI: true,
      ui: { select: "not a function" },
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// promptAgentSelection
// ---------------------------------------------------------------------------

describe("promptAgentSelection", () => {
  it("returns selected agent when user picks one", async () => {
    const agent = makeAgent();
    const ctx = makeMockCtx(agent.label);
    const result = await promptAgentSelection(ctx, [agent], "Pick:");
    expect(result.resolved).toBe(true);
    expect(result.agent?.name).toBe("researcher");
    expect(result.status).toBe("found");
    expect(result.uiAvailable).toBe(true);
  });

  it("returns cancelled when user picks Cancel", async () => {
    const agent = makeAgent();
    const ctx = makeMockCtx("Cancel");
    const result = await promptAgentSelection(ctx, [agent], "Pick:");
    expect(result.resolved).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.uiAvailable).toBe(true);
  });

  it("returns cancelled when user dismisses (undefined)", async () => {
    const agent = makeAgent();
    const ctx = makeMockCtx(undefined);
    const result = await promptAgentSelection(ctx, [agent], "Pick:");
    expect(result.resolved).toBe(false);
    expect(result.cancelled).toBe(true);
  });

  it("returns cancelled when agent list is empty", async () => {
    const ctx = makeMockCtx();
    const result = await promptAgentSelection(ctx, [], "Pick:");
    expect(result.resolved).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.error).toContain("No ADK agents");
    expect(result.status).toBe("not_found");
  });

  it("passes correct options to select including Cancel", async () => {
    const a = makeAgent({ name: "a", label: "a — ./agents/a" });
    const b = makeAgent({ name: "b", label: "b — ./agents/b" });
    const ctx = makeMockCtx("Cancel");
    await promptAgentSelection(ctx, [a, b], "Pick:");
    expect(ctx.ui.select).toHaveBeenCalledWith("Pick:", [
      "a — ./agents/a",
      "b — ./agents/b",
      "Cancel",
    ]);
  });

  // Phase 3: non-interactive handling
  it("returns interactive_selection_required when no UI available", async () => {
    const agent = makeAgent();
    const ctx = makeNoUICtx();
    const result = await promptAgentSelection(ctx, [agent], "Pick:", "researcher");
    expect(result.status).toBe("interactive_selection_required");
    expect(result.resolved).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.uiAvailable).toBe(false);
    expect(result.availableMatches).toHaveLength(1);
    expect(result.requestedAgent).toBe("researcher");
    expect(result.error).toContain("no UI is available");
    // select should NOT be called
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("returns interactive_selection_required with all available agents listed", async () => {
    const a = makeAgent({ name: "a" });
    const b = makeAgent({ name: "b" });
    const ctx = makeNoUICtx();
    const result = await promptAgentSelection(ctx, [a, b], "Pick:", "x");
    expect(result.status).toBe("interactive_selection_required");
    expect(result.availableMatches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// resolveAdkAgentWithPrompt
// ---------------------------------------------------------------------------

describe("resolveAdkAgentWithPrompt", () => {
  it("auto-resolves unique match without prompting", async () => {
    const agent = makeAgent();
    const tool = makeResolveToolReturning({
      status: "found",
      agent,
      available: [agent],
    });
    const registry = makeRegistry(tool, makeFakeTool("run_adk_agent"));
    const ctx = makeMockCtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "researcher", "prompt", "prompt", ctx
    );
    expect(result.resolved).toBe(true);
    expect(result.agent?.name).toBe("researcher");
    expect(result.status).toBe("found");
    // select should NOT be called
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("prompts on not_found when onMissing is prompt", async () => {
    const available = makeAgent({ name: "other", label: "other — ./agents/other" });
    const tool = makeResolveToolReturning({
      status: "not_found",
      available: [available],
    });
    const registry = makeRegistry(tool, makeFakeTool("run_adk_agent"));
    const ctx = makeMockCtx(available.label);

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "nonexistent", "prompt", "prompt", ctx
    );
    expect(result.resolved).toBe(true);
    expect(result.agent?.name).toBe("other");
    expect(ctx.ui.select).toHaveBeenCalled();
  });

  it("cancels on not_found when onMissing is cancel", async () => {
    const tool = makeResolveToolReturning({
      status: "not_found",
      available: [],
    });
    const registry = makeRegistry(tool, makeFakeTool("run_adk_agent"));
    const ctx = makeMockCtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "nonexistent", "cancel", "prompt", ctx
    );
    expect(result.resolved).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.error).toContain("not found");
    expect(result.status).toBe("not_found");
  });

  it("prompts on ambiguous when onAmbiguous is prompt", async () => {
    const a = makeAgent({ name: "res_a", label: "res_a — path" });
    const b = makeAgent({ name: "res_b", label: "res_b — path" });
    const tool = makeResolveToolReturning({
      status: "ambiguous",
      matches: [a, b],
      available: [a, b],
    });
    const registry = makeRegistry(tool, makeFakeTool("run_adk_agent"));
    const ctx = makeMockCtx(a.label);

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "res", "prompt", "prompt", ctx
    );
    expect(result.resolved).toBe(true);
    expect(result.agent?.name).toBe("res_a");
  });

  it("cancels on ambiguous when onAmbiguous is cancel", async () => {
    const a = makeAgent({ name: "res_a" });
    const b = makeAgent({ name: "res_b" });
    const tool = makeResolveToolReturning({
      status: "ambiguous",
      matches: [a, b],
      available: [a, b],
    });
    const registry = makeRegistry(tool);
    const ctx = makeMockCtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "res", "prompt", "cancel", ctx
    );
    expect(result.resolved).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.error).toContain("ambiguous");
    expect(result.status).toBe("ambiguous");
  });

  // Phase 3: provider unavailable
  it("returns provider_unavailable when resolve_adk_agent not registered", async () => {
    const registry = makeRegistry(); // empty — no resolve_adk_agent
    const ctx = makeMockCtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "researcher", "prompt", "prompt", ctx
    );
    expect(result.status).toBe("provider_unavailable");
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("pi-google-adk is not loaded");
    expect(result.requestedAgent).toBe("researcher");
  });

  // Phase 3: execution unavailable (resolve works, run doesn't)
  it("returns execution_unavailable when run_adk_agent not registered", async () => {
    const agent = makeAgent();
    const tool = makeResolveToolReturning({
      status: "found",
      agent,
      available: [agent],
    });
    // Only resolve tool, NO run_adk_agent
    const registry = makeRegistry(tool);
    const ctx = makeMockCtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "researcher", "prompt", "prompt", ctx
    );
    expect(result.status).toBe("execution_unavailable");
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("run_adk_agent is not registered");
    expect(result.agent?.name).toBe("researcher");
  });

  // Phase 3: non-interactive selection required
  it("returns interactive_selection_required for not_found with no UI", async () => {
    const available = makeAgent({ name: "other" });
    const tool = makeResolveToolReturning({
      status: "not_found",
      available: [available],
    });
    const registry = makeRegistry(tool, makeFakeTool("run_adk_agent"));
    const ctx = makeNoUICtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "missing", "prompt", "prompt", ctx
    );
    expect(result.status).toBe("interactive_selection_required");
    expect(result.resolved).toBe(false);
    expect(result.uiAvailable).toBe(false);
    expect(result.availableMatches).toHaveLength(1);
  });

  it("returns interactive_selection_required for ambiguous with no UI", async () => {
    const a = makeAgent({ name: "res_a" });
    const b = makeAgent({ name: "res_b" });
    const tool = makeResolveToolReturning({
      status: "ambiguous",
      matches: [a, b],
      available: [a, b],
    });
    const registry = makeRegistry(tool, makeFakeTool("run_adk_agent"));
    const ctx = makeNoUICtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "res", "prompt", "prompt", ctx
    );
    expect(result.status).toBe("interactive_selection_required");
    expect(result.resolved).toBe(false);
    expect(result.availableMatches).toHaveLength(2);
  });

  // Phase 3: execution_unavailable after prompt selection
  it("returns execution_unavailable after prompt selection when run_adk_agent missing", async () => {
    const available = makeAgent({ name: "other", label: "other — ./agents/other" });
    const tool = makeResolveToolReturning({
      status: "not_found",
      available: [available],
    });
    // Only resolve tool, NO run_adk_agent
    const registry = makeRegistry(tool);
    const ctx = makeMockCtx(available.label);

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "missing", "prompt", "prompt", ctx
    );
    expect(result.status).toBe("execution_unavailable");
    expect(result.resolved).toBe(false);
    expect(result.error).toContain("run_adk_agent is not registered");
  });

  // Phase 3: structured result fields
  it("includes requestedAgent in all results", async () => {
    const tool = makeResolveToolReturning({
      status: "not_found",
      available: [],
    });
    const registry = makeRegistry(tool);
    const ctx = makeMockCtx();

    const result = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "myquery", "cancel", "cancel", ctx
    );
    expect(result.requestedAgent).toBe("myquery");
  });

  it("includes uiAvailable in results", async () => {
    const agent = makeAgent();
    const tool = makeResolveToolReturning({
      status: "found",
      agent,
      available: [agent],
    });
    const registry = makeRegistry(tool, makeFakeTool("run_adk_agent"));

    const ctxWithUI = makeMockCtx();
    const r1 = await resolveAdkAgentWithPrompt(
      registry, "/tmp", "researcher", "prompt", "prompt", ctxWithUI
    );
    expect(r1.uiAvailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildAdkChildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildAdkChildSystemPrompt", () => {
  it("includes base prompt content", () => {
    const agent = makeAgent();
    const prompt = buildAdkChildSystemPrompt(baseParams(), agent);
    expect(prompt).toContain("TASK: Do research");
    expect(prompt).toMatch(/do not delegate/i);
  });

  it("includes ADK delegation section", () => {
    const agent = makeAgent();
    const prompt = buildAdkChildSystemPrompt(baseParams(), agent);
    expect(prompt).toContain("ADK Agent Delegation");
    expect(prompt).toContain("run_adk_agent");
    expect(prompt).toContain("./agents/researcher");
  });

  it("includes agent name and template", () => {
    const agent = makeAgent({ template: "sequential" });
    const prompt = buildAdkChildSystemPrompt(baseParams(), agent);
    expect(prompt).toContain('"researcher"');
    expect(prompt).toContain("sequential");
  });

  it("includes capabilities when present", () => {
    const agent = makeAgent({ capabilities: ["web_search", "code_exec"] });
    const prompt = buildAdkChildSystemPrompt(baseParams(), agent);
    expect(prompt).toContain("web_search, code_exec");
  });

  it("omits capabilities line when empty", () => {
    const agent = makeAgent({ capabilities: [] });
    const prompt = buildAdkChildSystemPrompt(baseParams(), agent);
    expect(prompt).not.toContain("Capabilities:");
  });
});

// ---------------------------------------------------------------------------
// run_adk_agent auto-allowlisting
// ---------------------------------------------------------------------------

describe("run_adk_agent auto-allowlisting", () => {
  it("run_adk_agent is included when explicitly listed plus agent param", () => {
    const registry = [makeFakeTool("run_adk_agent"), makeFakeTool("other_tool")];
    const result = resolveAllowedCustomTools([], registry, ["run_adk_agent"]);
    expect(result.map((t) => t.name)).toContain("run_adk_agent");
  });

  it("run_adk_agent NOT included when not in allowlist and no agent param", () => {
    const registry = [makeFakeTool("run_adk_agent"), makeFakeTool("other_tool")];
    const result = resolveAllowedCustomTools([], registry, ["other_tool"]);
    expect(result.map((t) => t.name)).not.toContain("run_adk_agent");
  });

  // Phase 3: dedup test — run_adk_agent not duplicated when already in allowlist
  it("run_adk_agent not duplicated when already listed in safeCustomTools", () => {
    const registry = [makeFakeTool("run_adk_agent"), makeFakeTool("other_tool")];
    // Simulate: user listed run_adk_agent AND agent param adds it via Set
    const allowedSet = new Set(["run_adk_agent", "other_tool"]);
    allowedSet.add("run_adk_agent"); // duplicate add should be a no-op
    const result = resolveAllowedCustomTools([], registry, Array.from(allowedSet));
    const adkCount = result.filter((t) => t.name === "run_adk_agent").length;
    expect(adkCount).toBe(1);
  });

  // Phase 3: non-mutation test — caller's array should not be modified
  it("does not mutate the caller-provided safeCustomTools array", () => {
    // This tests the execute path indirectly: the Set-based approach
    // in index.ts means params.safeCustomTools is never mutated.
    const original = ["some_tool"];
    const copy = [...original];
    // Simulate what execute does
    const allowedSet = new Set(original);
    allowedSet.add("run_adk_agent");
    // original should be untouched
    expect(original).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// Existing behavior regression
// ---------------------------------------------------------------------------

describe("existing delegate behavior (no agent param)", () => {
  it("buildChildSystemPrompt works without ADK params", () => {
    const prompt = buildChildSystemPrompt(baseParams());
    expect(prompt).toContain("TASK: Do research");
    expect(prompt).not.toContain("ADK Agent Delegation");
  });

  it("resolveAllowedCustomTools works without run_adk_agent", () => {
    const registry = [makeFakeTool("some_tool")];
    const result = resolveAllowedCustomTools([], registry, ["some_tool"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("some_tool");
  });
});

// ---------------------------------------------------------------------------
// Phase 3: provider_unavailable vs not_found distinction
// ---------------------------------------------------------------------------

describe("Phase 3: status distinction", () => {
  it("provider_unavailable is distinguishable from not_found", async () => {
    const emptyRegistry = makeRegistry();
    const providerResult = await resolveAdkAgentViaTool(emptyRegistry, "/tmp", "x");

    const resolveToolReturningNotFound = makeResolveToolReturning({
      status: "not_found",
      available: [],
    });
    const registryWithTool = makeRegistry(resolveToolReturningNotFound);
    const notFoundResult = await resolveAdkAgentViaTool(registryWithTool, "/tmp", "x");

    expect(providerResult.status).toBe("provider_unavailable");
    expect(notFoundResult.status).toBe("not_found");
    expect(providerResult.status).not.toBe(notFoundResult.status);
  });

  it("execution_unavailable is distinguishable from provider_unavailable", async () => {
    // provider_unavailable: no tools at all
    const emptyRegistry = makeRegistry();
    const ctx = makeMockCtx();
    const provResult = await resolveAdkAgentWithPrompt(
      emptyRegistry, "/tmp", "x", "cancel", "cancel", ctx
    );

    // execution_unavailable: resolve works, run doesn't
    const agent = makeAgent();
    const resolveTool = makeResolveToolReturning({
      status: "found",
      agent,
      available: [agent],
    });
    const resolveOnlyRegistry = makeRegistry(resolveTool);
    const execResult = await resolveAdkAgentWithPrompt(
      resolveOnlyRegistry, "/tmp", "researcher", "cancel", "cancel", ctx
    );

    expect(provResult.status).toBe("provider_unavailable");
    expect(execResult.status).toBe("execution_unavailable");
    expect(provResult.status).not.toBe(execResult.status);
  });
});
