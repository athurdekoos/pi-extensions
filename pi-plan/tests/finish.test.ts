/**
 * finish.test.ts — Tests for the deterministic branch finishing workflow.
 */

import { describe, it, expect, vi } from "vitest";

// Mock archive functions to avoid filesystem writes in executeFinishing tests
vi.mock("../archive.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../archive.js")>();
  return {
    ...actual,
    archivePlan: vi.fn().mockReturnValue({ relPath: ".pi/plans/archive/mock.md", filename: "mock.md" }),
    forceWriteCurrentPlan: vi.fn(),
    updateIndex: vi.fn(),
  };
});

// Mock config loading to avoid filesystem reads
vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      config: { ...actual.DEFAULT_CONFIG },
      warnings: [],
      source: "default",
    }),
  };
});

import type { ExecFn } from "../repo.js";
import {
  detectBaseBranch,
  isGhAvailable,
  buildFinishOptions,
  mapSelectionToAction,
  mergeLocally,
  generatePrBody,
  createPullRequest,
  keepBranch,
  discardBranch,
  executeFinishing,
  type FinishContext,
  type FinishUI,
} from "../finish.js";
import { DEFAULT_CONFIG, type PiPlanConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExec(responses: Array<{ code: number; stdout: string }>): ExecFn {
  let callIndex = 0;
  return async (_cmd: string, _args: string[], _opts?: { timeout?: number }) => {
    const resp = responses[callIndex] ?? { code: 1, stdout: "no mock response" };
    callIndex++;
    return resp;
  };
}

function makeTrackingExec(responses: Array<{ code: number; stdout: string }>): {
  exec: ExecFn;
  calls: Array<{ cmd: string; args: string[] }>;
} {
  let callIndex = 0;
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const exec: ExecFn = async (cmd, args, _opts) => {
    calls.push({ cmd, args });
    const resp = responses[callIndex] ?? { code: 1, stdout: "no mock response" };
    callIndex++;
    return resp;
  };
  return { exec, calls };
}

const defaultCtx: FinishContext = {
  repoRoot: "/repo",
  worktreePath: "/repo/.worktrees/my-feature",
  branch: "plan/my-feature",
  baseBranch: "main",
  stateDir: ".pi/worktrees",
};

// ---------------------------------------------------------------------------
// detectBaseBranch
// ---------------------------------------------------------------------------

describe("detectBaseBranch", () => {
  it("parses branch from symbolic-ref output", async () => {
    const exec = makeExec([{ code: 0, stdout: "refs/remotes/origin/main\n" }]);
    expect(await detectBaseBranch("/repo", exec)).toBe("main");
  });

  it("returns master when remote HEAD points to master", async () => {
    const exec = makeExec([{ code: 0, stdout: "refs/remotes/origin/master\n" }]);
    expect(await detectBaseBranch("/repo", exec)).toBe("master");
  });

  it("falls back to main on failure", async () => {
    const exec = makeExec([{ code: 1, stdout: "" }]);
    expect(await detectBaseBranch("/repo", exec)).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// isGhAvailable
// ---------------------------------------------------------------------------

describe("isGhAvailable", () => {
  it("returns true when gh exits 0", async () => {
    const exec = makeExec([{ code: 0, stdout: "gh version 2.0.0" }]);
    expect(await isGhAvailable(exec)).toBe(true);
  });

  it("returns false when gh exits non-zero", async () => {
    const exec = makeExec([{ code: 1, stdout: "" }]);
    expect(await isGhAvailable(exec)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildFinishOptions
// ---------------------------------------------------------------------------

describe("buildFinishOptions", () => {
  it("includes PR option when gh is available", () => {
    const options = buildFinishOptions(true);
    expect(options).toHaveLength(5);
    expect(options).toContain("Create pull request");
    expect(options[options.length - 1]).toBe("Cancel");
  });

  it("omits PR option when gh is unavailable", () => {
    const options = buildFinishOptions(false);
    expect(options).toHaveLength(4);
    expect(options).not.toContain("Create pull request");
    expect(options[options.length - 1]).toBe("Cancel");
  });
});

// ---------------------------------------------------------------------------
// mapSelectionToAction
// ---------------------------------------------------------------------------

describe("mapSelectionToAction", () => {
  it("maps merge label", () => {
    expect(mapSelectionToAction("Merge into base branch locally")).toBe("merge");
  });

  it("maps PR label", () => {
    expect(mapSelectionToAction("Create pull request")).toBe("pr");
  });

  it("maps keep label", () => {
    expect(mapSelectionToAction("Keep branch (remove worktree only)")).toBe("keep");
  });

  it("maps discard label", () => {
    expect(mapSelectionToAction("Discard branch and worktree")).toBe("discard");
  });

  it("returns null for Cancel", () => {
    expect(mapSelectionToAction("Cancel")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(mapSelectionToAction(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeLocally
// ---------------------------------------------------------------------------

describe("mergeLocally", () => {
  it("executes checkout, merge, and cleanup sequence", async () => {
    const { exec, calls } = makeTrackingExec([
      { code: 0, stdout: "" },  // git checkout main
      { code: 0, stdout: "" },  // git merge
      // cleanupWorktree: readWorktreeState returns null (no state file)
      // so cleanup is a no-op success
    ]);

    const result = await mergeLocally(defaultCtx, exec);

    expect(result.success).toBe(true);
    expect(result.action).toBe("merge");
    expect(calls[0]).toEqual({ cmd: "git", args: ["checkout", "main"] });
    expect(calls[1].args).toContain("--no-ff");
  });

  it("aborts on merge conflict", async () => {
    const { exec, calls } = makeTrackingExec([
      { code: 0, stdout: "" },  // git checkout main
      { code: 1, stdout: "CONFLICT" },  // git merge failed
      { code: 0, stdout: "" },  // git merge --abort
    ]);

    const result = await mergeLocally(defaultCtx, exec);

    expect(result.success).toBe(false);
    expect(result.action).toBe("merge");
    expect(result.message).toContain("conflict");
    expect(calls[2]).toEqual({ cmd: "git", args: ["merge", "--abort"] });
  });

  it("returns error when checkout fails", async () => {
    const exec = makeExec([{ code: 1, stdout: "error: pathspec" }]);
    const result = await mergeLocally(defaultCtx, exec);
    expect(result.success).toBe(false);
    expect(result.error).toContain("pathspec");
  });
});

// ---------------------------------------------------------------------------
// generatePrBody
// ---------------------------------------------------------------------------

describe("generatePrBody", () => {
  const planContent = `# Plan: Add Auth Flow

## Goal

Implement authentication using JWT tokens.

## Implementation Plan

1. Create auth middleware
2. Add login endpoint
3. Write integration tests
`;

  it("extracts title from plan content", () => {
    const { title } = generatePrBody(planContent, "plan/add-auth-flow");
    expect(title).toBe("Add Auth Flow");
  });

  it("builds default body with goal and steps", () => {
    const { body } = generatePrBody(planContent, "plan/add-auth-flow");
    expect(body).toContain("Summary");
    expect(body).toContain("JWT tokens");
    expect(body).toContain("Completed Steps");
    expect(body).toContain("[x] Create auth middleware");
  });

  it("uses template when provided", () => {
    const template = "PR for {{BRANCH}}\n\nPlan: {{PLAN_TITLE}}";
    const { body } = generatePrBody(planContent, "plan/add-auth-flow", template);
    expect(body).toBe("PR for plan/add-auth-flow\n\nPlan: Add Auth Flow");
  });

  it("falls back to branch-based title for untitled plans", () => {
    const { title } = generatePrBody("No headings here", "plan/my-work");
    expect(title).toBe("Plan: plan/my-work");
  });
});

// ---------------------------------------------------------------------------
// createPullRequest
// ---------------------------------------------------------------------------

describe("createPullRequest", () => {
  it("pushes branch and creates PR, returns URL", async () => {
    const { exec, calls } = makeTrackingExec([
      { code: 0, stdout: "" },  // git push
      { code: 0, stdout: "https://github.com/org/repo/pull/42\n" },  // gh pr create
      // cleanupWorktree (no state file → no-op)
    ]);

    const result = await createPullRequest(defaultCtx, "My PR", "Body text", exec);

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(calls[0].args).toContain("push");
    expect(calls[1].cmd).toBe("gh");
  });

  it("returns error when push fails", async () => {
    const exec = makeExec([{ code: 1, stdout: "permission denied" }]);
    const result = await createPullRequest(defaultCtx, "My PR", "Body", exec);
    expect(result.success).toBe(false);
    expect(result.action).toBe("pr");
  });

  it("returns error when gh pr create fails", async () => {
    const exec = makeExec([
      { code: 0, stdout: "" },  // push succeeds
      { code: 1, stdout: "already exists" },  // gh fails
    ]);
    const result = await createPullRequest(defaultCtx, "My PR", "Body", exec);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// keepBranch
// ---------------------------------------------------------------------------

describe("keepBranch", () => {
  it("removes worktree but not branch", async () => {
    // cleanupWorktree with deleteBranch: false
    // readWorktreeState returns null → success
    const exec = makeExec([]);
    const result = await keepBranch(defaultCtx, exec);
    expect(result.success).toBe(true);
    expect(result.action).toBe("keep");
    expect(result.message).toContain("kept");
  });
});

// ---------------------------------------------------------------------------
// discardBranch
// ---------------------------------------------------------------------------

describe("discardBranch", () => {
  it("removes worktree and branch", async () => {
    const exec = makeExec([]);
    const result = await discardBranch(defaultCtx, exec);
    expect(result.success).toBe(true);
    expect(result.action).toBe("discard");
    expect(result.message).toContain("discarded");
  });
});

// ---------------------------------------------------------------------------
// executeFinishing — integration-level tests with mocked UI and exec
// ---------------------------------------------------------------------------

describe("executeFinishing", () => {
  const planContent = `# Plan: Test Plan\n\n## Goal\n\nDo stuff.\n\n## Implementation Plan\n\n1. Step one\n`;

  function makeUI(overrides?: Partial<FinishUI>): FinishUI {
    return {
      notify: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      select: vi.fn().mockResolvedValue("Keep branch (remove worktree only)"),
      ...overrides,
    };
  }

  it("returns null when user cancels", async () => {
    const exec = makeExec([{ code: 0, stdout: "gh 2.0" }]); // isGhAvailable
    const ui = makeUI({ select: vi.fn().mockResolvedValue("Cancel") });
    const config = { ...DEFAULT_CONFIG };

    const result = await executeFinishing(defaultCtx, exec, ui, config, planContent);
    expect(result).toBeNull();
  });

  it("uses defaultFinishAction when configured and confirmed", async () => {
    const exec = makeExec([]); // keepBranch → cleanup (no state file)
    const ui = makeUI({ confirm: vi.fn().mockResolvedValue(true) });
    const config: PiPlanConfig = { ...DEFAULT_CONFIG, defaultFinishAction: "keep" };

    const result = await executeFinishing(defaultCtx, exec, ui, config, planContent);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("keep");
  });

  it("falls back to select menu when defaultFinishAction confirm is denied", async () => {
    const confirmCalls: string[] = [];
    const ui = makeUI({
      confirm: vi.fn().mockImplementation(async (title: string) => {
        confirmCalls.push(title);
        // Deny the default action confirm, approve PR confirm
        return title !== "Finish plan";
      }),
      select: vi.fn().mockResolvedValue("Keep branch (remove worktree only)"),
    });
    const exec = makeExec([
      { code: 1, stdout: "" }, // isGhAvailable → false
      // keepBranch → cleanupWorktree (no state file)
    ]);
    const config: PiPlanConfig = { ...DEFAULT_CONFIG, defaultFinishAction: "merge" };

    const result = await executeFinishing(defaultCtx, exec, ui, config, planContent);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("keep");
  });
});
