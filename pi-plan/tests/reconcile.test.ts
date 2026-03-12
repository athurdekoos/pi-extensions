import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  reconcileIndex,
  updateIndex,
  archivePlan,
  readCurrentPlan,
  forceWriteCurrentPlan,
} from "../archive.js";
import { initPlanning, CURRENT_PLAN_REL, PLANS_INDEX_REL, hasCurrentPlan } from "../repo.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-reconcile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const abs = join(tmp, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

function readFile(rel: string): string {
  return readFileSync(join(tmp, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// reconcileIndex — basic behavior
// ---------------------------------------------------------------------------

describe("reconcileIndex", () => {
  it("returns false when repo is not initialized", () => {
    const result = reconcileIndex(tmp);
    expect(result).toBe(false);
  });

  it("returns true and regenerates index when repo is initialized", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Active\n\n## Goal\n\nDo stuff.");

    const result = reconcileIndex(tmp);
    expect(result).toBe(true);

    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("Active");
    expect(index).toContain("current.md");
  });

  it("regenerates missing index.md", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Test\n\n## Goal\n\nGoal.");

    // Deliberately delete index.md then re-create it empty to keep init state
    // (isFullyInitialized needs it to exist)
    writeFile(PLANS_INDEX_REL, "");

    reconcileIndex(tmp);
    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("# Plan Index");
    expect(index).toContain("Test");
  });

  it("corrects stale index.md after manual archive addition", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Current\n\n## Goal\n\nCurrent goal.");
    updateIndex(tmp);

    const indexBefore = readFile(PLANS_INDEX_REL);
    expect(indexBefore).toContain("_None yet._");

    // Manually add an archive file outside the extension
    writeFile(".pi/plans/archive/2026-01-01-1000-manual.md", "# Plan: Manual\n\n## Goal\n\nManual.");

    // Reconcile should pick up the new archive
    reconcileIndex(tmp);
    const indexAfter = readFile(PLANS_INDEX_REL);
    expect(indexAfter).toContain("Manual");
    expect(indexAfter).not.toContain("_None yet._");
  });

  it("corrects stale index.md after manual archive removal", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Current\n\n## Goal\n\nGoal.");

    // Create an archive
    archivePlan(tmp, "# Plan: Old\n\n## Goal\n\nOld.", new Date(2026, 0, 1, 10, 0));
    updateIndex(tmp);

    const indexBefore = readFile(PLANS_INDEX_REL);
    expect(indexBefore).toContain("Old");

    // Manually remove the archive
    const archiveDir = join(tmp, ".pi/plans/archive");
    rmSync(archiveDir, { recursive: true, force: true });

    // Reconcile should reflect the removal
    reconcileIndex(tmp);
    const indexAfter = readFile(PLANS_INDEX_REL);
    expect(indexAfter).toContain("_None yet._");
    expect(indexAfter).not.toContain("Old");
  });

  it("is idempotent", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Idempotent\n\n## Goal\n\nGoal.");
    archivePlan(tmp, "# Plan: Archived\n\n## Goal\n\nOld.", new Date(2026, 0, 1, 10, 0));

    reconcileIndex(tmp);
    const first = readFile(PLANS_INDEX_REL);

    reconcileIndex(tmp);
    const second = readFile(PLANS_INDEX_REL);

    expect(first).toBe(second);
  });

  it("does not corrupt current plan", () => {
    initPlanning(tmp);
    const currentContent = "# Plan: Keep Me\n\n## Goal\n\nImportant goal.";
    writeFile(CURRENT_PLAN_REL, currentContent);

    reconcileIndex(tmp);

    expect(readFile(CURRENT_PLAN_REL)).toBe(currentContent);
    expect(hasCurrentPlan(tmp)).toBe(true);
  });

  it("does not corrupt archive files", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Current\n\n## Goal\n\nGoal.");

    const archiveContent = "# Plan: Archived\n\n## Goal\n\nArchived goal.";
    const archive = archivePlan(tmp, archiveContent, new Date(2026, 0, 1, 10, 0));

    reconcileIndex(tmp);

    // Archive content unchanged
    expect(readFileSync(join(tmp, archive.relPath), "utf-8")).toBe(archiveContent);
  });

  it("respects custom archive dir config", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Custom\n\n## Goal\n\nGoal.");

    // Archive to custom dir
    const archiveContent = "# Plan: Custom Archive\n\n## Goal\n\nGoal.";
    archivePlan(tmp, archiveContent, new Date(2026, 0, 1, 10, 0), {
      archiveDir: ".pi/custom-archive",
    });

    reconcileIndex(tmp, { archiveDir: ".pi/custom-archive" });
    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("Custom Archive");
  });
});

// ---------------------------------------------------------------------------
// reconcileIndex — edge cases
// ---------------------------------------------------------------------------

describe("reconcileIndex — edge cases", () => {
  it("handles initialized repo with placeholder current.md", () => {
    initPlanning(tmp);
    // current.md is placeholder (from init)

    reconcileIndex(tmp);
    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("# Plan Index");
    expect(index).toContain("current.md");
  });

  it("handles repo with many archives", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Current\n\n## Goal\n\nGoal.");

    for (let i = 0; i < 20; i++) {
      archivePlan(
        tmp,
        `# Plan: Archive ${i}\n\n## Goal\n\nGoal ${i}.`,
        new Date(2026, 0, 1 + i, 10, 0),
      );
    }

    reconcileIndex(tmp);
    const index = readFile(PLANS_INDEX_REL);
    // All 20 archives should appear in index (not capped)
    expect((index.match(/Archive \d+/g) || []).length).toBe(20);
  });
});
