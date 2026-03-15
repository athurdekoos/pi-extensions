/**
 * Tests for auto-plan.ts — the enforcement state machine.
 *
 * What these tests prove:
 *   - computePhase correctly maps enforcement toggle + PlanState to AutoPlanPhase
 *   - computePhase returns "inactive" when enforcement is off regardless of plan state
 *   - getContextMessage returns appropriate messages per phase and null when inactive
 *   - getStatusDisplay shows yellow "⏸ plan" for enforced phases and clears for inactive
 *   - getWidgetLines produces step checklist for executing phase
 *   - serializeState/restoreState round-trip correctly
 *
 * What these tests do NOT prove:
 *   - That Pi's input hook fires correctly (Pi runtime concern)
 *   - That lifecycle hooks fire in the correct order (integration concern)
 *   - That file I/O works correctly (extractStepsFromCurrentPlan reads disk)
 */

import { describe, it, expect } from "vitest";
import type { PlanState } from "../repo.js";
import {
  computePhase,
  getContextMessage,
  getStatusDisplay,
  getWidgetLines,
  createInitialState,
  serializeState,
  restoreState,
} from "../auto-plan.js";
import type { TodoItem } from "../mode-utils.js";

// ---------------------------------------------------------------------------
// computePhase
// ---------------------------------------------------------------------------

describe("computePhase", () => {
  it("returns inactive when enforcement is off regardless of plan state", () => {
    expect(computePhase(false, { status: "no-repo" })).toBe("inactive");
    expect(computePhase(false, { status: "not-initialized", repoRoot: "/repo" })).toBe("inactive");
    expect(computePhase(false, { status: "initialized-no-plan", repoRoot: "/repo" })).toBe("inactive");
    expect(computePhase(false, { status: "initialized-has-plan", repoRoot: "/repo" })).toBe("inactive");
  });

  it("maps no-repo when enforcement is on", () => {
    expect(computePhase(true, { status: "no-repo" })).toBe("no-repo");
  });

  it("maps not-initialized when enforcement is on", () => {
    expect(computePhase(true, { status: "not-initialized", repoRoot: "/repo" })).toBe("not-initialized");
  });

  it("maps initialized-no-plan to needs-plan when enforcement is on", () => {
    expect(computePhase(true, { status: "initialized-no-plan", repoRoot: "/repo" })).toBe("needs-plan");
  });

  it("maps initialized-has-plan to has-plan when enforcement is on", () => {
    expect(computePhase(true, { status: "initialized-has-plan", repoRoot: "/repo" })).toBe("has-plan");
  });
});

// ---------------------------------------------------------------------------
// getContextMessage
// ---------------------------------------------------------------------------

describe("getContextMessage", () => {
  it("returns null for inactive phase", () => {
    expect(getContextMessage("inactive", [])).toBeNull();
  });

  it("returns null for no-repo phase", () => {
    expect(getContextMessage("no-repo", [])).toBeNull();
  });

  it("returns null for not-initialized phase", () => {
    expect(getContextMessage("not-initialized", [])).toBeNull();
  });

  it("returns enforcement message for needs-plan phase", () => {
    const msg = getContextMessage("needs-plan", []);
    expect(msg).toContain("PLAN ENFORCEMENT ACTIVE");
    expect(msg).toContain("No plan exists");
    expect(msg).toContain("/plan");
  });

  it("returns plan-active message for has-plan phase", () => {
    const msg = getContextMessage("has-plan", []);
    expect(msg).toContain("PLAN ENFORCEMENT ACTIVE");
    expect(msg).toContain("current.md");
  });

  it("returns executing message with remaining steps", () => {
    const todos: TodoItem[] = [
      { step: 1, text: "First", completed: true },
      { step: 2, text: "Second", completed: false },
      { step: 3, text: "Third", completed: false },
    ];
    const msg = getContextMessage("executing", todos);
    expect(msg).toContain("PLAN ENFORCEMENT ACTIVE");
    expect(msg).toContain("Executing");
    expect(msg).toContain("2. Second");
    expect(msg).toContain("3. Third");
    expect(msg).not.toContain("1. First");
    expect(msg).toContain("[DONE:n]");
  });

  it("returns null for executing with all steps completed", () => {
    const todos: TodoItem[] = [
      { step: 1, text: "First", completed: true },
    ];
    expect(getContextMessage("executing", todos)).toBeNull();
  });

  it("returns null for executing with no steps", () => {
    expect(getContextMessage("executing", [])).toBeNull();
  });

  it("returns brainstorming message for brainstorming phase", () => {
    const msg = getContextMessage("brainstorming", []);
    expect(msg).toContain("Brainstorming");
    expect(msg).toContain("submit_spec");
  });
});

// ---------------------------------------------------------------------------
// getStatusDisplay
// ---------------------------------------------------------------------------

describe("getStatusDisplay", () => {
  it("clears status for inactive phase", () => {
    const status = getStatusDisplay("inactive", []);
    expect(status.text).toBeUndefined();
  });

  it("clears status for no-repo phase", () => {
    const status = getStatusDisplay("no-repo", []);
    expect(status.text).toBeUndefined();
  });

  it("shows yellow plan for needs-plan phase", () => {
    const status = getStatusDisplay("needs-plan", []);
    expect(status.key).toBe("pi-plan");
    expect(status.text).toBe("⏸ plan");
  });

  it("shows yellow plan for has-plan phase", () => {
    const status = getStatusDisplay("has-plan", []);
    expect(status.text).toBe("⏸ plan");
  });

  it("shows yellow plan for not-initialized phase", () => {
    const status = getStatusDisplay("not-initialized", []);
    expect(status.text).toBe("⏸ plan");
  });

  it("shows progress for executing phase with steps", () => {
    const todos: TodoItem[] = [
      { step: 1, text: "First", completed: true },
      { step: 2, text: "Second", completed: false },
      { step: 3, text: "Third", completed: false },
    ];
    const status = getStatusDisplay("executing", todos);
    expect(status.text).toBe("📋 1/3");
  });

  it("shows yellow plan for executing phase with no steps", () => {
    const status = getStatusDisplay("executing", []);
    expect(status.text).toBe("⏸ plan");
  });

  it("shows brainstorm status for brainstorming phase", () => {
    const status = getStatusDisplay("brainstorming", []);
    expect(status.key).toBe("pi-plan");
    expect(status.text).toBe("💡 brainstorm");
  });
});

// ---------------------------------------------------------------------------
// getWidgetLines
// ---------------------------------------------------------------------------

describe("getWidgetLines", () => {
  it("returns step checklist for executing phase", () => {
    const todos: TodoItem[] = [
      { step: 1, text: "First", completed: true },
      { step: 2, text: "Second", completed: false },
    ];
    const lines = getWidgetLines("executing", todos);
    expect(lines).toHaveLength(2);
    expect(lines![0]).toContain("☑");
    expect(lines![0]).toContain("First");
    expect(lines![1]).toContain("☐");
    expect(lines![1]).toContain("Second");
  });

  it("returns undefined for non-executing phases", () => {
    expect(getWidgetLines("inactive", [])).toBeUndefined();
    expect(getWidgetLines("has-plan", [])).toBeUndefined();
    expect(getWidgetLines("needs-plan", [])).toBeUndefined();
  });

  it("returns undefined for executing with no items", () => {
    expect(getWidgetLines("executing", [])).toBeUndefined();
  });

  it("returns brainstorming widget for brainstorming phase", () => {
    const lines = getWidgetLines("brainstorming", []);
    expect(lines).toHaveLength(1);
    expect(lines![0]).toContain("Brainstorming");
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("serialization", () => {
  it("round-trips state through serialize/restore", () => {
    const original = createInitialState();
    original.phase = "executing";
    original.repoRoot = "/repo";
    original.enforcementActive = true;
    original.todoItems = [
      { step: 1, text: "First", completed: true },
      { step: 2, text: "Second", completed: false },
    ];

    const persisted = serializeState(original);
    const restored = restoreState(persisted, "/repo");

    expect(restored.phase).toBe("executing");
    expect(restored.repoRoot).toBe("/repo");
    expect(restored.enforcementActive).toBe(true);
    expect(restored.todoItems).toEqual(original.todoItems);
  });

  it("restores with new repoRoot", () => {
    const original = createInitialState();
    original.phase = "has-plan";
    original.repoRoot = "/old-repo";
    original.enforcementActive = true;

    const persisted = serializeState(original);
    const restored = restoreState(persisted, "/new-repo");

    expect(restored.repoRoot).toBe("/new-repo");
    expect(restored.phase).toBe("has-plan");
  });

  it("preserves enforcementActive through round-trip", () => {
    const original = createInitialState();
    original.enforcementActive = true;

    const persisted = serializeState(original);
    const restored = restoreState(persisted, null);
    expect(restored.enforcementActive).toBe(true);
  });

  it("initial state has enforcement off and inactive phase", () => {
    const initial = createInitialState();
    expect(initial.enforcementActive).toBe(false);
    expect(initial.phase).toBe("inactive");
    expect(initial.todoItems).toEqual([]);
    expect(initial.repoRoot).toBeNull();
    expect(initial.tddStepTestWritten).toBe(false);
    expect(initial.worktreeActive).toBe(false);
    expect(initial.worktreePath).toBeNull();
    expect(initial.brainstormSpecPath).toBeNull();
  });

  it("round-trips new fields through serialize/restore", () => {
    const original = createInitialState();
    original.phase = "executing";
    original.repoRoot = "/repo";
    original.enforcementActive = true;
    original.tddStepTestWritten = true;
    original.worktreeActive = true;
    original.worktreePath = "/repo/.worktrees/auth";
    original.brainstormSpecPath = ".pi/specs/auth-spec.md";

    const persisted = serializeState(original);
    const restored = restoreState(persisted, "/repo");

    expect(restored.tddStepTestWritten).toBe(true);
    expect(restored.worktreeActive).toBe(true);
    expect(restored.worktreePath).toBe("/repo/.worktrees/auth");
    expect(restored.brainstormSpecPath).toBe(".pi/specs/auth-spec.md");
  });

  it("restores new fields with defaults when missing from persisted state", () => {
    // Simulate old persisted state without new fields
    const oldPersisted = {
      phase: "executing" as const,
      todoItems: [],
      enforcementActive: true,
    };

    const restored = restoreState(oldPersisted, "/repo");
    expect(restored.tddStepTestWritten).toBe(false);
    expect(restored.worktreeActive).toBe(false);
    expect(restored.worktreePath).toBeNull();
    expect(restored.brainstormSpecPath).toBeNull();
  });
});
