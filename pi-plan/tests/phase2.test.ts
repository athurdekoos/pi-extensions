/**
 * phase2.test.ts — Tests for Phase 2: config extensions, review records,
 *                  step format merging, and legacy migration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../config.js";
import {
  writeReviewRecord,
  listReviewRecords,
  hasLegacyPlanFile,
  migrateLegacyPlan,
  CURRENT_PLAN_REL,
  REVIEWS_DIR_REL,
  initPlanning,
  hasCurrentPlan,
  type ReviewRecord,
} from "../repo.js";
import { extractStepsFromPlan } from "../mode-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_ROOT = join(process.cwd(), ".test-phase2-" + process.pid);

function setup(): void {
  mkdirSync(TEST_ROOT, { recursive: true });
}

function cleanup(): void {
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Config extensions
// ---------------------------------------------------------------------------

describe("config.ts — new fields (Phase 2)", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("returns default reviewDir and stepFormat when no config file", () => {
    const result = loadConfig(TEST_ROOT);
    expect(result.config.reviewDir).toBe(".pi/plans/reviews");
    expect(result.config.stepFormat).toBe("both");
    expect(result.warnings).toHaveLength(0);
  });

  it("accepts valid reviewDir override", () => {
    mkdirSync(join(TEST_ROOT, ".pi"), { recursive: true });
    writeFileSync(join(TEST_ROOT, ".pi/pi-plan.json"), JSON.stringify({ reviewDir: ".pi/reviews" }));
    const result = loadConfig(TEST_ROOT);
    expect(result.config.reviewDir).toBe(".pi/reviews");
    expect(result.warnings).toHaveLength(0);
  });

  it("rejects reviewDir with path traversal", () => {
    mkdirSync(join(TEST_ROOT, ".pi"), { recursive: true });
    writeFileSync(join(TEST_ROOT, ".pi/pi-plan.json"), JSON.stringify({ reviewDir: "../escape" }));
    const result = loadConfig(TEST_ROOT);
    expect(result.config.reviewDir).toBe(DEFAULT_CONFIG.reviewDir);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("..");
  });

  it("rejects invalid reviewDir type", () => {
    mkdirSync(join(TEST_ROOT, ".pi"), { recursive: true });
    writeFileSync(join(TEST_ROOT, ".pi/pi-plan.json"), JSON.stringify({ reviewDir: 42 }));
    const result = loadConfig(TEST_ROOT);
    expect(result.config.reviewDir).toBe(DEFAULT_CONFIG.reviewDir);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("accepts valid stepFormat values", () => {
    mkdirSync(join(TEST_ROOT, ".pi"), { recursive: true });
    for (const fmt of ["numbered", "checkbox", "both"] as const) {
      writeFileSync(join(TEST_ROOT, ".pi/pi-plan.json"), JSON.stringify({ stepFormat: fmt }));
      const result = loadConfig(TEST_ROOT);
      expect(result.config.stepFormat).toBe(fmt);
    }
  });

  it("rejects invalid stepFormat", () => {
    mkdirSync(join(TEST_ROOT, ".pi"), { recursive: true });
    writeFileSync(join(TEST_ROOT, ".pi/pi-plan.json"), JSON.stringify({ stepFormat: "invalid" }));
    const result = loadConfig(TEST_ROOT);
    expect(result.config.stepFormat).toBe(DEFAULT_CONFIG.stepFormat);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Review records
// ---------------------------------------------------------------------------

describe("repo.ts — review records (Phase 2)", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("writes a review record and reads it back", () => {
    const record: ReviewRecord = {
      timestamp: "2026-03-12T19:00:00.000Z",
      approved: true,
      feedback: "Looks good",
      planTitle: "Auth refactor",
    };

    const relPath = writeReviewRecord(TEST_ROOT, record);
    expect(relPath).toContain(REVIEWS_DIR_REL);
    expect(relPath).toContain(".json");

    const records = listReviewRecords(TEST_ROOT);
    expect(records).toHaveLength(1);
    expect(records[0].approved).toBe(true);
    expect(records[0].feedback).toBe("Looks good");
    expect(records[0].planTitle).toBe("Auth refactor");
  });

  it("handles collision by appending counter", () => {
    const record: ReviewRecord = {
      timestamp: "2026-03-12T19:00:00.000Z",
      approved: true,
    };

    writeReviewRecord(TEST_ROOT, record);
    const relPath2 = writeReviewRecord(TEST_ROOT, { ...record, approved: false });

    // Second write should have a counter suffix
    expect(relPath2).toContain("-1.json");

    const records = listReviewRecords(TEST_ROOT);
    expect(records).toHaveLength(2);
  });

  it("returns empty array for missing review directory", () => {
    const records = listReviewRecords(TEST_ROOT);
    expect(records).toEqual([]);
  });

  it("writes denied review record", () => {
    const record: ReviewRecord = {
      timestamp: "2026-03-12T20:00:00.000Z",
      approved: false,
      feedback: "Missing error handling in step 3",
    };

    writeReviewRecord(TEST_ROOT, record);
    const records = listReviewRecords(TEST_ROOT);
    expect(records).toHaveLength(1);
    expect(records[0].approved).toBe(false);
    expect(records[0].feedback).toContain("error handling");
  });

  it("supports custom reviewDir", () => {
    const customDir = ".pi/custom-reviews";
    const record: ReviewRecord = {
      timestamp: "2026-03-12T21:00:00.000Z",
      approved: true,
    };

    const relPath = writeReviewRecord(TEST_ROOT, record, customDir);
    expect(relPath).toContain(customDir);

    const records = listReviewRecords(TEST_ROOT, customDir);
    expect(records).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Step format merging (numbered + checkbox)
// ---------------------------------------------------------------------------

describe("mode-utils.ts — merged step formats (Phase 2)", () => {
  it("extracts numbered steps from ## Implementation Plan", () => {
    const plan = `# Plan
## Implementation Plan
1. First step
2. Second step
3. Third step
## Verification
- test it`;
    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(3);
    expect(steps[0].text).toBe("First step");
    expect(steps[2].text).toBe("Third step");
    expect(steps.every((s) => !s.completed)).toBe(true);
  });

  it("extracts checkbox steps from ## Implementation Plan", () => {
    const plan = `# Plan
## Implementation Plan
- [ ] First checkbox step
- [x] Completed checkbox step
- [ ] Third checkbox step
## Verification`;
    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(3);
    expect(steps[0].text).toBe("First checkbox step");
    expect(steps[0].completed).toBe(false);
    expect(steps[1].text).toBe("Completed checkbox step");
    expect(steps[1].completed).toBe(true);
  });

  it("extracts steps from ## Steps section", () => {
    const plan = `# Plan
## Steps
- [ ] Step A
- [ ] Step B
## Notes`;
    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(2);
    expect(steps[0].text).toBe("Step A");
    expect(steps[1].text).toBe("Step B");
  });

  it("prefers checkbox when both formats are present equally", () => {
    const plan = `# Plan
## Implementation Plan
1. Numbered one
- [ ] Checkbox one
## End`;
    const steps = extractStepsFromPlan(plan);
    // Equal count → checkbox preferred
    expect(steps).toHaveLength(1);
    expect(steps[0].text).toBe("Checkbox one");
  });

  it("prefers whichever format has more matches", () => {
    const plan = `# Plan
## Implementation Plan
1. First numbered
2. Second numbered
3. Third numbered
- [ ] Only checkbox
## End`;
    const steps = extractStepsFromPlan(plan);
    // 3 numbered > 1 checkbox → use numbered
    expect(steps).toHaveLength(3);
    expect(steps[0].text).toBe("First numbered");
  });

  it("handles asterisk bullet checkboxes", () => {
    const plan = `# Plan
## Steps
* [ ] Star bullet step
* [X] Star completed
## End`;
    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(2);
    expect(steps[0].completed).toBe(false);
    expect(steps[1].completed).toBe(true);
  });

  it("returns empty for no matching section", () => {
    const plan = `# Plan
## Random Section
1. This should not match
## End`;
    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(0);
  });

  it("skips short step text", () => {
    const plan = `# Plan
## Steps
- [ ] OK
- [ ] This is a valid step
## End`;
    const steps = extractStepsFromPlan(plan);
    expect(steps).toHaveLength(1);
    expect(steps[0].text).toBe("This is a valid step");
  });
});

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

describe("repo.ts — legacy PLAN.md migration (Phase 2)", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("detects legacy PLAN.md", () => {
    expect(hasLegacyPlanFile(TEST_ROOT)).toBe(false);
    writeFileSync(join(TEST_ROOT, "PLAN.md"), "# My Plan\n\nDo stuff");
    expect(hasLegacyPlanFile(TEST_ROOT)).toBe(true);
  });

  it("migrates PLAN.md to current.md", () => {
    writeFileSync(join(TEST_ROOT, "PLAN.md"), "# My Legacy Plan\n\nSteps here");
    // Ensure .pi/ structure exists for current.md
    mkdirSync(join(TEST_ROOT, ".pi/plans"), { recursive: true });

    const result = migrateLegacyPlan(TEST_ROOT);
    expect(result).not.toBeNull();
    expect(result).toContain("My Legacy Plan");

    // Verify current.md was written
    const current = readFileSync(join(TEST_ROOT, CURRENT_PLAN_REL), "utf-8");
    expect(current).toContain("My Legacy Plan");
  });

  it("skips migration if PLAN.md is empty", () => {
    writeFileSync(join(TEST_ROOT, "PLAN.md"), "   ");
    const result = migrateLegacyPlan(TEST_ROOT);
    expect(result).toBeNull();
  });

  it("skips migration if current.md already has a real plan", () => {
    // Set up initialized repo with real plan
    initPlanning(TEST_ROOT);
    const abs = join(TEST_ROOT, CURRENT_PLAN_REL);
    writeFileSync(abs, "# Real Plan\n\nAlready here");

    writeFileSync(join(TEST_ROOT, "PLAN.md"), "# Legacy Plan");

    const result = migrateLegacyPlan(TEST_ROOT);
    expect(result).toBeNull();

    // Verify current.md was not overwritten
    const current = readFileSync(abs, "utf-8");
    expect(current).toContain("Real Plan");
  });

  it("skips migration if no PLAN.md exists", () => {
    const result = migrateLegacyPlan(TEST_ROOT);
    expect(result).toBeNull();
  });

  it("does not delete PLAN.md after migration", () => {
    writeFileSync(join(TEST_ROOT, "PLAN.md"), "# Legacy");
    mkdirSync(join(TEST_ROOT, ".pi/plans"), { recursive: true });
    migrateLegacyPlan(TEST_ROOT);
    expect(existsSync(join(TEST_ROOT, "PLAN.md"))).toBe(true);
  });
});
