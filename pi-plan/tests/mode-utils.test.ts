/**
 * Tests for mode-utils.ts — pure functions for plan step tracking.
 *
 * What these tests prove:
 *   - extractStepsFromPlan parses numbered steps from ## Implementation Plan sections
 *   - extractStepsFromPlan skips placeholder/template lines
 *   - extractDoneSteps parses [DONE:n] markers from text
 *   - markCompletedSteps correctly marks items as completed
 *
 * What these tests do NOT prove:
 *   - That the AI produces [DONE:n] markers (AI-dependent behavior)
 *   - That lifecycle hooks fire correctly (integration concern)
 */

import { describe, it, expect } from "vitest";
import {
  extractStepsFromPlan,
  extractDoneSteps,
  markCompletedSteps,
  type TodoItem,
} from "../mode-utils.js";

// ---------------------------------------------------------------------------
// extractStepsFromPlan
// ---------------------------------------------------------------------------

describe("extractStepsFromPlan", () => {
  it("extracts numbered steps from Implementation Plan section", () => {
    const plan = `# Plan: My Task

## Goal

Build a feature.

## Implementation Plan

1. Read the existing code
2. Create the new module
3. Write tests
4. Update documentation

## Acceptance Criteria

- [ ] Tests pass
`;

    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toEqual({ step: 1, text: "Read the existing code", completed: false });
    expect(steps[1]).toEqual({ step: 2, text: "Create the new module", completed: false });
    expect(steps[2]).toEqual({ step: 3, text: "Write tests", completed: false });
    expect(steps[3]).toEqual({ step: 4, text: "Update documentation", completed: false });
  });

  it("skips placeholder lines from template", () => {
    const plan = `## Implementation Plan

1. _First step_
2. _Second step_
3. _Third step_
`;

    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(0);
  });

  it("returns empty array when no Implementation Plan section", () => {
    const plan = `# Plan: My Task

## Goal

Build something.

## Scope

Everything.
`;

    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(0);
  });

  it("stops at next H2 heading", () => {
    const plan = `## Implementation Plan

1. First real step
2. Second real step

## Acceptance Criteria

1. This is not a step
`;

    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(2);
  });

  it("handles parenthesis-style numbering", () => {
    const plan = `## Implementation Plan

1) Read the code
2) Write the module
`;

    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(2);
    expect(steps[0].text).toBe("Read the code");
  });

  it("skips very short lines", () => {
    const plan = `## Implementation Plan

1. Ab
2. Read the code carefully
`;

    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(1);
    expect(steps[0].text).toBe("Read the code carefully");
  });

  it("re-numbers steps sequentially starting from 1", () => {
    const plan = `## Implementation Plan

3. Third step
7. Seventh step
`;

    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(2);
    expect(steps[0].step).toBe(1);
    expect(steps[1].step).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractDoneSteps
// ---------------------------------------------------------------------------

describe("extractDoneSteps", () => {
  it("extracts step numbers from [DONE:n] markers", () => {
    const text = "I completed the first step [DONE:1] and the third [DONE:3].";
    expect(extractDoneSteps(text)).toEqual([1, 3]);
  });

  it("handles case-insensitive markers", () => {
    const text = "[done:2] and [Done:4]";
    expect(extractDoneSteps(text)).toEqual([2, 4]);
  });

  it("returns empty array when no markers", () => {
    expect(extractDoneSteps("No markers here.")).toEqual([]);
  });

  it("handles multiple markers on same line", () => {
    const text = "[DONE:1][DONE:2][DONE:3]";
    expect(extractDoneSteps(text)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// markCompletedSteps
// ---------------------------------------------------------------------------

describe("markCompletedSteps", () => {
  it("marks matching steps as completed", () => {
    const items: TodoItem[] = [
      { step: 1, text: "First", completed: false },
      { step: 2, text: "Second", completed: false },
      { step: 3, text: "Third", completed: false },
    ];

    const count = markCompletedSteps("[DONE:1] and [DONE:3]", items);
    expect(count).toBe(2);
    expect(items[0].completed).toBe(true);
    expect(items[1].completed).toBe(false);
    expect(items[2].completed).toBe(true);
  });

  it("does not double-complete already completed steps", () => {
    const items: TodoItem[] = [
      { step: 1, text: "First", completed: true },
    ];

    const count = markCompletedSteps("[DONE:1]", items);
    expect(count).toBe(0);
  });

  it("ignores markers for non-existent steps", () => {
    const items: TodoItem[] = [
      { step: 1, text: "First", completed: false },
    ];

    const count = markCompletedSteps("[DONE:99]", items);
    expect(count).toBe(0);
    expect(items[0].completed).toBe(false);
  });
});
