/**
 * Tests for harness.ts — harness-level command interception and input evaluation.
 *
 * What these tests prove:
 *   - evaluateInput never returns "handled" — only "continue" or "transform"
 *   - evaluateInput returns "continue" for inactive phase
 *   - evaluateInput transforms input for needs-plan phase with context prefix
 *   - evaluateInput passes through for has-plan and executing phases
 *   - evaluateHarnessCommand returns { matched: false } for all input (empty registry)
 *   - getHarnessCommands returns an empty array (placeholder registry)
 *
 * What these tests do NOT prove:
 *   - That Pi's input event fires correctly (Pi runtime concern)
 *   - That future harness commands work (they don't exist yet)
 */

import { describe, it, expect } from "vitest";
import {
  evaluateInput,
  evaluateHarnessCommand,
  getHarnessCommands,
} from "../harness.js";

// ---------------------------------------------------------------------------
// evaluateInput
// ---------------------------------------------------------------------------

describe("evaluateInput", () => {
  it("returns continue for inactive phase", () => {
    const result = evaluateInput("inactive", "write some code");
    expect(result.action).toBe("continue");
  });

  it("returns continue for no-repo phase", () => {
    const result = evaluateInput("no-repo", "write some code");
    expect(result.action).toBe("continue");
  });

  it("returns continue for not-initialized phase", () => {
    const result = evaluateInput("not-initialized", "write some code");
    expect(result.action).toBe("continue");
  });

  it("transforms input for needs-plan phase", () => {
    const result = evaluateInput("needs-plan", "refactor the auth module");
    expect(result.action).toBe("transform");
    if (result.action === "transform") {
      expect(result.text).toContain("Plan enforcement is active");
      expect(result.text).toContain("no plan exists");
      expect(result.text).toContain("refactor the auth module");
    }
  });

  it("preserves original message text in transform", () => {
    const original = "implement the new API endpoint for users";
    const result = evaluateInput("needs-plan", original);
    expect(result.action).toBe("transform");
    if (result.action === "transform") {
      expect(result.text).toContain(original);
    }
  });

  it("returns continue for has-plan phase", () => {
    const result = evaluateInput("has-plan", "implement step 1");
    expect(result.action).toBe("continue");
  });

  it("returns continue for executing phase", () => {
    const result = evaluateInput("executing", "continue with the next step");
    expect(result.action).toBe("continue");
  });

  it("returns continue for brainstorming phase", () => {
    const result = evaluateInput("brainstorming", "design the auth flow");
    expect(result.action).toBe("continue");
  });

  it("never returns handled for any phase", () => {
    const phases = ["inactive", "no-repo", "not-initialized", "needs-plan", "brainstorming", "has-plan", "executing"] as const;
    for (const phase of phases) {
      const result = evaluateInput(phase, "any input");
      expect(result.action).not.toBe("handled");
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateHarnessCommand — empty registry
// ---------------------------------------------------------------------------

describe("evaluateHarnessCommand", () => {
  it("returns matched: false for any input (empty registry)", () => {
    expect(evaluateHarnessCommand("plan:status", "has-plan", "/repo").matched).toBe(false);
    expect(evaluateHarnessCommand("plan:gate", "needs-plan", "/repo").matched).toBe(false);
    expect(evaluateHarnessCommand("plan:step", "executing", "/repo").matched).toBe(false);
    expect(evaluateHarnessCommand("hello world", "inactive", null).matched).toBe(false);
  });

  it("returns matched: false for empty input", () => {
    expect(evaluateHarnessCommand("", "inactive", null).matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getHarnessCommands — placeholder registry
// ---------------------------------------------------------------------------

describe("getHarnessCommands", () => {
  it("returns empty array (placeholder registry)", () => {
    expect(getHarnessCommands()).toEqual([]);
  });
});
