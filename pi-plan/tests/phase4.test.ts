/**
 * phase4.test.ts — Tests for Phase 4: review-pending phase,
 *                  state machine transitions, session reconstruction.
 */

import { describe, it, expect } from "vitest";
import {
  computePhase,
  getContextMessage,
  getStatusDisplay,
  getWidgetLines,
  serializeState,
  restoreState,
  createInitialState,
  type AutoPlanState,
} from "../auto-plan.js";
import type { PlanState } from "../repo.js";

// ---------------------------------------------------------------------------
// review-pending phase
// ---------------------------------------------------------------------------

describe("auto-plan.ts — review-pending phase", () => {
  it("computePhase returns has-plan when enforcement active and plan exists", () => {
    const planState: PlanState = { status: "initialized-has-plan", repoRoot: "/repo" };
    expect(computePhase(true, planState)).toBe("has-plan");
  });

  it("getContextMessage returns review-pending message", () => {
    const message = getContextMessage("review-pending", []);
    expect(message).not.toBeNull();
    expect(message).toContain("Review Pending");
    expect(message).toContain("Wait for the user");
  });

  it("getContextMessage for review-pending ignores todoItems", () => {
    const items = [{ step: 1, text: "Step 1", completed: false }];
    const message = getContextMessage("review-pending", items);
    expect(message).toContain("Review Pending");
    // Should not include step list
    expect(message).not.toContain("Remaining steps");
  });

  it("getStatusDisplay shows review indicator", () => {
    const status = getStatusDisplay("review-pending", []);
    expect(status.key).toBe("pi-plan");
    expect(status.text).toBe("👁 review");
  });

  it("getWidgetLines shows review-in-progress for review-pending", () => {
    const lines = getWidgetLines("review-pending", []);
    expect(lines).toBeDefined();
    expect(lines).toHaveLength(1);
    expect(lines![0]).toContain("review in progress");
  });

  it("getWidgetLines still works for executing phase", () => {
    const items = [
      { step: 1, text: "First", completed: true },
      { step: 2, text: "Second", completed: false },
    ];
    const lines = getWidgetLines("executing", items);
    expect(lines).toBeDefined();
    expect(lines).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Serialization roundtrip with review-pending
// ---------------------------------------------------------------------------

describe("auto-plan.ts — serialization with review-pending", () => {
  it("serializes review-pending state", () => {
    const state: AutoPlanState = {
      phase: "review-pending",
      repoRoot: "/repo",
      todoItems: [],
      enforcementActive: true,
    };
    const serialized = serializeState(state);
    expect(serialized.phase).toBe("review-pending");
    expect(serialized.enforcementActive).toBe(true);
  });

  it("restores review-pending state", () => {
    const persisted = {
      phase: "review-pending" as const,
      todoItems: [],
      enforcementActive: true,
    };
    const restored = restoreState(persisted, "/repo");
    expect(restored.phase).toBe("review-pending");
    expect(restored.repoRoot).toBe("/repo");
    expect(restored.enforcementActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session reconstruction edge cases
// ---------------------------------------------------------------------------

describe("session reconstruction", () => {
  it("review-pending should degrade to has-plan on session restart", () => {
    // This tests the logic that index.ts applies:
    // if persisted phase is review-pending, reset to has-plan
    const persisted = {
      phase: "review-pending" as const,
      todoItems: [{ step: 1, text: "Step one", completed: false }],
      enforcementActive: true,
    };
    const restored = restoreState(persisted, "/repo");

    // Simulate the session_start logic: review-pending → has-plan
    if (restored.phase === "review-pending") {
      restored.phase = "has-plan";
    }

    expect(restored.phase).toBe("has-plan");
    expect(restored.enforcementActive).toBe(true);
    expect(restored.todoItems).toHaveLength(1);
  });

  it("executing phase survives session restart", () => {
    const persisted = {
      phase: "executing" as const,
      todoItems: [
        { step: 1, text: "Done step", completed: true },
        { step: 2, text: "Pending step", completed: false },
      ],
      enforcementActive: true,
    };
    const restored = restoreState(persisted, "/repo");
    expect(restored.phase).toBe("executing");
    expect(restored.todoItems[0].completed).toBe(true);
    expect(restored.todoItems[1].completed).toBe(false);
  });

  it("inactive phase stays inactive on restore", () => {
    const persisted = {
      phase: "inactive" as const,
      todoItems: [],
      enforcementActive: false,
    };
    const restored = restoreState(persisted, "/repo");
    expect(restored.phase).toBe("inactive");
    expect(restored.enforcementActive).toBe(false);
  });

  it("createInitialState starts inactive", () => {
    const state = createInitialState();
    expect(state.phase).toBe("inactive");
    expect(state.enforcementActive).toBe(false);
    expect(state.todoItems).toHaveLength(0);
    expect(state.repoRoot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase transitions (comprehensive)
// ---------------------------------------------------------------------------

describe("auto-plan.ts — comprehensive phase transitions", () => {
  const scenarios: Array<{ enforcement: boolean; planStatus: PlanState["status"]; expected: string }> = [
    { enforcement: false, planStatus: "no-repo", expected: "inactive" },
    { enforcement: false, planStatus: "not-initialized", expected: "inactive" },
    { enforcement: false, planStatus: "initialized-no-plan", expected: "inactive" },
    { enforcement: false, planStatus: "initialized-has-plan", expected: "inactive" },
    { enforcement: true, planStatus: "no-repo", expected: "no-repo" },
    { enforcement: true, planStatus: "not-initialized", expected: "not-initialized" },
    { enforcement: true, planStatus: "initialized-no-plan", expected: "needs-plan" },
    { enforcement: true, planStatus: "initialized-has-plan", expected: "has-plan" },
  ];

  for (const { enforcement, planStatus, expected } of scenarios) {
    it(`enforcement=${enforcement}, status=${planStatus} → ${expected}`, () => {
      const planState: PlanState = planStatus === "no-repo"
        ? { status: "no-repo" }
        : { status: planStatus as Exclude<PlanState["status"], "no-repo">, repoRoot: "/repo" };
      expect(computePhase(enforcement, planState)).toBe(expected);
    });
  }
});
