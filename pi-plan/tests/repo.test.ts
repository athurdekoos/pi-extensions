import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hasPlanningProtocol,
  isFullyInitialized,
  hasCurrentPlan,
  initPlanning,
  detectRepoRootWith,
  detectPlanStateWith,
  PLANNING_PROTOCOL_REL,
  TASK_PLAN_TEMPLATE_REL,
  CURRENT_PLAN_REL,
  PLANS_INDEX_REL,
  type ExecFn,
  type PlanState,
} from "../repo.js";
import { CURRENT_PLAN_PLACEHOLDER, CURRENT_PLAN_SENTINEL } from "../defaults.js";

// ---------------------------------------------------------------------------
// Shared temp directory helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper to write a file inside tmp
// ---------------------------------------------------------------------------

function writeFile(rel: string, content: string): void {
  const abs = join(tmp, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Mock ExecFn helpers
// ---------------------------------------------------------------------------

function mockExec(repoRoot: string | null): ExecFn {
  return async (_cmd, _args, _opts) => {
    if (repoRoot === null) {
      return { code: 128, stdout: "" };
    }
    return { code: 0, stdout: repoRoot + "\n" };
  };
}

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

describe("path constants", () => {
  it("PLANNING_PROTOCOL_REL", () => {
    expect(PLANNING_PROTOCOL_REL).toBe(".pi/PLANNING_PROTOCOL.md");
  });

  it("TASK_PLAN_TEMPLATE_REL", () => {
    expect(TASK_PLAN_TEMPLATE_REL).toBe(".pi/templates/task-plan.md");
  });

  it("CURRENT_PLAN_REL", () => {
    expect(CURRENT_PLAN_REL).toBe(".pi/plans/current.md");
  });

  it("PLANS_INDEX_REL", () => {
    expect(PLANS_INDEX_REL).toBe(".pi/plans/index.md");
  });
});

// ---------------------------------------------------------------------------
// hasPlanningProtocol
// ---------------------------------------------------------------------------

describe("hasPlanningProtocol", () => {
  it("returns false when .pi/ does not exist", () => {
    expect(hasPlanningProtocol(tmp)).toBe(false);
  });

  it("returns false when .pi/ exists but protocol is missing", () => {
    mkdirSync(join(tmp, ".pi"), { recursive: true });
    expect(hasPlanningProtocol(tmp)).toBe(false);
  });

  it("returns true when protocol exists", () => {
    writeFile(PLANNING_PROTOCOL_REL, "# test");
    expect(hasPlanningProtocol(tmp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isFullyInitialized
// ---------------------------------------------------------------------------

describe("isFullyInitialized", () => {
  it("returns false when nothing exists", () => {
    expect(isFullyInitialized(tmp)).toBe(false);
  });

  it("returns false when only protocol exists", () => {
    writeFile(PLANNING_PROTOCOL_REL, "# protocol");
    expect(isFullyInitialized(tmp)).toBe(false);
  });

  it("returns false when one file is missing", () => {
    writeFile(PLANNING_PROTOCOL_REL, "# protocol");
    writeFile(TASK_PLAN_TEMPLATE_REL, "# template");
    writeFile(CURRENT_PLAN_REL, "# current");
    // index.md missing
    expect(isFullyInitialized(tmp)).toBe(false);
  });

  it("returns true when all four files exist", () => {
    writeFile(PLANNING_PROTOCOL_REL, "# protocol");
    writeFile(TASK_PLAN_TEMPLATE_REL, "# template");
    writeFile(CURRENT_PLAN_REL, "# current");
    writeFile(PLANS_INDEX_REL, "# index");
    expect(isFullyInitialized(tmp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasCurrentPlan
// ---------------------------------------------------------------------------

describe("hasCurrentPlan", () => {
  it("returns false when current.md does not exist", () => {
    expect(hasCurrentPlan(tmp)).toBe(false);
  });

  it("returns false when current.md is empty", () => {
    writeFile(CURRENT_PLAN_REL, "");
    expect(hasCurrentPlan(tmp)).toBe(false);
  });

  it("returns false when current.md is whitespace only", () => {
    writeFile(CURRENT_PLAN_REL, "   \n\n  \n");
    expect(hasCurrentPlan(tmp)).toBe(false);
  });

  it("returns false when current.md is the exact placeholder", () => {
    writeFile(CURRENT_PLAN_REL, CURRENT_PLAN_PLACEHOLDER);
    expect(hasCurrentPlan(tmp)).toBe(false);
  });

  it("returns false when current.md contains the sentinel string", () => {
    writeFile(CURRENT_PLAN_REL, `# Current Plan\n\n${CURRENT_PLAN_SENTINEL}\n\nSome extra text.`);
    expect(hasCurrentPlan(tmp)).toBe(false);
  });

  it("returns true when current.md has real plan content", () => {
    writeFile(CURRENT_PLAN_REL, "# Plan: Refactor auth module\n\n## Goal\n\nRefactor auth.");
    expect(hasCurrentPlan(tmp)).toBe(true);
  });

  it("returns true when current.md has minimal non-placeholder content", () => {
    writeFile(CURRENT_PLAN_REL, "# My plan");
    expect(hasCurrentPlan(tmp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// initPlanning
// ---------------------------------------------------------------------------

describe("initPlanning", () => {
  it("creates all four files in an empty directory", () => {
    const created = initPlanning(tmp);

    expect(created).toHaveLength(4);
    expect(created).toContain(PLANNING_PROTOCOL_REL);
    expect(created).toContain(TASK_PLAN_TEMPLATE_REL);
    expect(created).toContain(CURRENT_PLAN_REL);
    expect(created).toContain(PLANS_INDEX_REL);

    // All files exist
    expect(existsSync(join(tmp, PLANNING_PROTOCOL_REL))).toBe(true);
    expect(existsSync(join(tmp, TASK_PLAN_TEMPLATE_REL))).toBe(true);
    expect(existsSync(join(tmp, CURRENT_PLAN_REL))).toBe(true);
    expect(existsSync(join(tmp, PLANS_INDEX_REL))).toBe(true);
  });

  it("does not overwrite existing files", () => {
    const customContent = "# Custom protocol — do not overwrite";
    writeFile(PLANNING_PROTOCOL_REL, customContent);

    const created = initPlanning(tmp);

    // Only 3 files created (protocol already existed)
    expect(created).toHaveLength(3);
    expect(created).not.toContain(PLANNING_PROTOCOL_REL);

    // Custom content preserved
    expect(readFileSync(join(tmp, PLANNING_PROTOCOL_REL), "utf-8")).toBe(customContent);
  });

  it("returns empty array when all files already exist", () => {
    writeFile(PLANNING_PROTOCOL_REL, "# existing");
    writeFile(TASK_PLAN_TEMPLATE_REL, "# existing");
    writeFile(CURRENT_PLAN_REL, "# existing");
    writeFile(PLANS_INDEX_REL, "# existing");

    const created = initPlanning(tmp);
    expect(created).toHaveLength(0);
  });

  it("creates parent directories as needed", () => {
    initPlanning(tmp);

    expect(existsSync(join(tmp, ".pi"))).toBe(true);
    expect(existsSync(join(tmp, ".pi", "templates"))).toBe(true);
    expect(existsSync(join(tmp, ".pi", "plans"))).toBe(true);
  });

  it("current.md placeholder is detected as no-plan by hasCurrentPlan", () => {
    initPlanning(tmp);
    expect(hasCurrentPlan(tmp)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectRepoRootWith — testable seam
// ---------------------------------------------------------------------------

describe("detectRepoRootWith", () => {
  it("returns repo root when git succeeds", async () => {
    const exec = mockExec("/home/user/repo");
    const root = await detectRepoRootWith(exec);
    expect(root).toBe("/home/user/repo");
  });

  it("returns null when git fails (not a repo)", async () => {
    const exec = mockExec(null);
    const root = await detectRepoRootWith(exec);
    expect(root).toBeNull();
  });

  it("trims whitespace from stdout", async () => {
    const exec: ExecFn = async () => ({ code: 0, stdout: "  /home/user/repo  \n" });
    const root = await detectRepoRootWith(exec);
    expect(root).toBe("/home/user/repo");
  });

  it("returns null for empty stdout even with code 0", async () => {
    const exec: ExecFn = async () => ({ code: 0, stdout: "" });
    const root = await detectRepoRootWith(exec);
    expect(root).toBeNull();
  });

  it("returns null for whitespace-only stdout", async () => {
    const exec: ExecFn = async () => ({ code: 0, stdout: "   \n  " });
    const root = await detectRepoRootWith(exec);
    expect(root).toBeNull();
  });

  it("passes correct args to exec", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    const exec: ExecFn = async (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { code: 0, stdout: "/repo\n" };
    };
    await detectRepoRootWith(exec);
    expect(capturedCmd).toBe("git");
    expect(capturedArgs).toEqual(["rev-parse", "--show-toplevel"]);
  });
});

// ---------------------------------------------------------------------------
// detectPlanStateWith — testable seam
// ---------------------------------------------------------------------------

describe("detectPlanStateWith", () => {
  it("returns no-repo when exec fails", async () => {
    const exec = mockExec(null);
    const state = await detectPlanStateWith(exec);
    expect(state.status).toBe("no-repo");
  });

  it("returns not-initialized when repo exists but no .pi/ files", async () => {
    const exec = mockExec(tmp);
    const state = await detectPlanStateWith(exec);
    expect(state.status).toBe("not-initialized");
    expect((state as { repoRoot: string }).repoRoot).toBe(tmp);
  });

  it("returns initialized-no-plan when all files exist but current.md is placeholder", async () => {
    initPlanning(tmp);
    const exec = mockExec(tmp);
    const state = await detectPlanStateWith(exec);
    expect(state.status).toBe("initialized-no-plan");
  });

  it("returns initialized-has-plan when current.md has real content", async () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Real\n\n## Goal\n\nDo things.");
    const exec = mockExec(tmp);
    const state = await detectPlanStateWith(exec);
    expect(state.status).toBe("initialized-has-plan");
  });

  it("returns not-initialized when only some files exist", async () => {
    writeFile(PLANNING_PROTOCOL_REL, "# protocol");
    writeFile(TASK_PLAN_TEMPLATE_REL, "# template");
    const exec = mockExec(tmp);
    const state = await detectPlanStateWith(exec);
    expect(state.status).toBe("not-initialized");
  });
});
