/**
 * finishing-phase.test.ts — Tests for the "finishing" phase in auto-plan.ts
 *                           and write-gating in hooks.ts.
 */

import { describe, it, expect } from "vitest";
import {
  getContextMessage,
  getStatusDisplay,
  getWidgetLines,
  serializeState,
  restoreState,
  type AutoPlanState,
} from "../auto-plan.js";
import { handleToolCallGate, type HookDeps, type ToolCallEvent } from "../hooks.js";

// ---------------------------------------------------------------------------
// Finishing phase display functions
// ---------------------------------------------------------------------------

describe("auto-plan.ts — finishing phase", () => {
  it("getContextMessage returns finishing message", () => {
    const message = getContextMessage("finishing", []);
    expect(message).not.toBeNull();
    expect(message).toContain("Finishing");
    expect(message).toContain("Do not make any changes");
  });

  it("getStatusDisplay returns finishing indicator", () => {
    const status = getStatusDisplay("finishing", []);
    expect(status.key).toBe("pi-plan");
    expect(status.text).toBe("🏁 finishing");
  });

  it("getWidgetLines returns finishing widget line", () => {
    const lines = getWidgetLines("finishing", []);
    expect(lines).toBeDefined();
    expect(lines).toHaveLength(1);
    expect(lines![0]).toContain("Finishing workflow");
  });
});

// ---------------------------------------------------------------------------
// Write gate during finishing
// ---------------------------------------------------------------------------

describe("hooks.ts — finishing write gate", () => {
  function makeDeps(phase: string): HookDeps {
    return {
      state: {
        phase: phase as any,
        repoRoot: "/repo",
        todoItems: [],
        enforcementActive: true,
        tddStepTestWritten: false,
        worktreeActive: false,
        worktreePath: null,
        brainstormSpecPath: null,
      },
      config: null,
      applyUI: () => {},
      persistState: () => {},
      refreshPhase: async () => {},
      exec: async () => ({ code: 0, stdout: "" }),
      sendMessage: () => {},
      getFlag: () => undefined,
      detectPlanState: async () => ({ status: "initialized-has-plan" as const, repoRoot: "/repo" }),
      detectRepoRoot: async () => "/repo",
    };
  }

  it("blocks write tool during finishing phase", () => {
    const deps = makeDeps("finishing");
    const event: ToolCallEvent = {
      toolName: "write",
      input: { file_path: "/repo/src/foo.ts" },
    };
    const result = handleToolCallGate(event, "/repo", deps);
    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.reason).toContain("Finishing phase");
  });

  it("blocks edit tool during finishing phase", () => {
    const deps = makeDeps("finishing");
    const event: ToolCallEvent = {
      toolName: "edit",
      input: { file_path: "/repo/src/foo.ts" },
    };
    const result = handleToolCallGate(event, "/repo", deps);
    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
  });

  it("does not block read tool during finishing phase", () => {
    const deps = makeDeps("finishing");
    const event: ToolCallEvent = {
      toolName: "read",
      input: { file_path: "/repo/src/foo.ts" },
    };
    const result = handleToolCallGate(event, "/repo", deps);
    expect(result).toBeUndefined();
  });

  it("does not block writes during executing phase (finishing gate only)", () => {
    const deps = makeDeps("executing");
    deps.state.repoRoot = "/repo";
    const event: ToolCallEvent = {
      toolName: "write",
      input: { file_path: "/repo/src/foo.ts" },
    };
    // May or may not block for other reasons (TDD etc), but not for "finishing"
    const result = handleToolCallGate(event, "/repo", deps);
    // If it blocks, reason should NOT mention finishing
    if (result) {
      expect(result.reason).not.toContain("Finishing phase");
    }
  });
});

// ---------------------------------------------------------------------------
// Serialization roundtrip with finishing phase
// ---------------------------------------------------------------------------

describe("auto-plan.ts — serialization with finishing phase", () => {
  it("serializes finishing state", () => {
    const state: AutoPlanState = {
      phase: "finishing",
      repoRoot: "/repo",
      todoItems: [],
      enforcementActive: true,
      tddStepTestWritten: false,
      worktreeActive: true,
      worktreePath: "/repo/.worktrees/my-feature",
      brainstormSpecPath: null,
    };
    const serialized = serializeState(state);
    expect(serialized.phase).toBe("finishing");
    expect(serialized.enforcementActive).toBe(true);
    expect(serialized.worktreeActive).toBe(true);
  });

  it("restores finishing state", () => {
    const persisted = {
      phase: "finishing" as const,
      todoItems: [],
      enforcementActive: true,
      worktreeActive: true,
      worktreePath: "/repo/.worktrees/my-feature",
    };
    const restored = restoreState(persisted, "/repo");
    expect(restored.phase).toBe("finishing");
    expect(restored.repoRoot).toBe("/repo");
    expect(restored.worktreeActive).toBe(true);
  });

  it("finishing degrades to has-plan on session restore (simulated)", () => {
    const persisted = {
      phase: "finishing" as const,
      todoItems: [],
      enforcementActive: true,
      worktreeActive: true,
      worktreePath: "/repo/.worktrees/my-feature",
    };
    const restored = restoreState(persisted, "/repo");

    // Simulate the session_start degradation logic
    if (restored.phase === "finishing") {
      restored.phase = "has-plan";
    }

    expect(restored.phase).toBe("has-plan");
    expect(restored.worktreeActive).toBe(true);
  });
});
