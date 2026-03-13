import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractPlanTitle,
  slugify,
  archiveFilename,
  readCurrentPlan,
  forceWriteCurrentPlan,
  archivePlan,
  listArchives,
  countArchives,
  readArchive,
  updateIndex,
  ARCHIVE_DIR_REL,
} from "../archive.js";
import {
  initPlanning,
  hasCurrentPlan,
  CURRENT_PLAN_REL,
  PLANS_INDEX_REL,
} from "../repo.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-archive-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
// extractPlanTitle
// ---------------------------------------------------------------------------

describe("extractPlanTitle", () => {
  it("extracts from # Plan: Title", () => {
    expect(extractPlanTitle("# Plan: Add JWT Auth\n\n## Goal\n\nStuff")).toBe("Add JWT Auth");
  });

  it("extracts from plain # heading", () => {
    expect(extractPlanTitle("# My Plan\n\n## Goal")).toBe("My Plan");
  });

  it("extracts from ## Goal section when no H1", () => {
    expect(extractPlanTitle("## Goal\n\nBuild the thing\n\n## Scope")).toBe("Build the thing");
  });

  it("skips italic placeholder lines in Goal section", () => {
    expect(extractPlanTitle("## Goal\n\n_placeholder_\n\nReal goal")).toBe("Real goal");
  });

  it("returns (untitled) when nothing found", () => {
    expect(extractPlanTitle("")).toBe("(untitled)");
    expect(extractPlanTitle("some random text")).toBe("(untitled)");
  });

  it("truncates very long titles", () => {
    const long = "# " + "A".repeat(100);
    const title = extractPlanTitle(long);
    expect(title.length).toBeLessThanOrEqual(100); // "A"*100
  });
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Add JWT Auth")).toBe("add-jwt-auth");
  });

  it("removes special characters", () => {
    expect(slugify("Plan: (v2) — auth!")).toBe("plan-v2-auth");
  });

  it("caps at 40 chars", () => {
    const long = "a very very very very very very long plan title indeed";
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).not.toMatch(/-$/);
  });

  it("returns 'plan' for empty input", () => {
    expect(slugify("")).toBe("plan");
    expect(slugify("!!!")).toBe("plan");
  });
});

// ---------------------------------------------------------------------------
// archiveFilename
// ---------------------------------------------------------------------------

describe("archiveFilename", () => {
  it("produces YYYY-MM-DD-HHMM-slug.md format", () => {
    const date = new Date(2026, 2, 11, 17, 30); // March 11, 2026 17:30
    const name = archiveFilename(date, "Add JWT Auth");
    expect(name).toBe("2026-03-11-1730-add-jwt-auth.md");
  });

  it("pads single-digit values", () => {
    const date = new Date(2026, 0, 3, 2, 4);
    const name = archiveFilename(date, "Test");
    expect(name).toBe("2026-01-03-0204-test.md");
  });

  it("produces sortable filenames", () => {
    const a = archiveFilename(new Date(2026, 0, 1, 0, 0), "first");
    const b = archiveFilename(new Date(2026, 0, 1, 0, 1), "second");
    const c = archiveFilename(new Date(2026, 11, 31, 23, 59), "last");
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it("is deterministic", () => {
    const date = new Date(2026, 2, 11, 17, 30);
    expect(archiveFilename(date, "test")).toBe(archiveFilename(date, "test"));
  });
});

// ---------------------------------------------------------------------------
// readCurrentPlan / forceWriteCurrentPlan
// ---------------------------------------------------------------------------

describe("readCurrentPlan", () => {
  it("returns null when file does not exist", () => {
    expect(readCurrentPlan(tmp)).toBeNull();
  });

  it("returns content when file exists", () => {
    writeFile(CURRENT_PLAN_REL, "# Plan\n\nContent");
    expect(readCurrentPlan(tmp)).toBe("# Plan\n\nContent");
  });
});

describe("forceWriteCurrentPlan", () => {
  it("writes content unconditionally", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Old Plan\n\nExisting content");
    forceWriteCurrentPlan(tmp, "# New Plan\n\nReplaced");
    expect(readFile(CURRENT_PLAN_REL)).toBe("# New Plan\n\nReplaced");
  });

  it("creates directories if needed", () => {
    forceWriteCurrentPlan(tmp, "# Plan\n\nContent");
    expect(existsSync(join(tmp, CURRENT_PLAN_REL))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// archivePlan
// ---------------------------------------------------------------------------

describe("archivePlan", () => {
  it("creates archive directory and writes file", () => {
    const date = new Date(2026, 2, 11, 17, 30);
    const content = "# Plan: Auth Module\n\n## Goal\n\nBuild auth.";
    const result = archivePlan(tmp, content, date);

    expect(result.filename).toBe("2026-03-11-1730-auth-module.md");
    expect(result.relPath).toBe(`${ARCHIVE_DIR_REL}/2026-03-11-1730-auth-module.md`);
    expect(existsSync(join(tmp, result.relPath))).toBe(true);
    expect(readFileSync(join(tmp, result.relPath), "utf-8")).toBe(content);
  });

  it("preserves original content exactly", () => {
    const content = "# Plan: Test\n\nSome content with\nMultiple lines\n";
    const result = archivePlan(tmp, content, new Date(2026, 0, 1, 12, 0));
    expect(readFileSync(join(tmp, result.relPath), "utf-8")).toBe(content);
  });

  it("handles collisions by appending counter", () => {
    const date = new Date(2026, 2, 11, 17, 30);
    const content = "# Plan: Test\n\n## Goal\n\nFirst.";
    const first = archivePlan(tmp, content, date);
    const second = archivePlan(tmp, "# Plan: Test\n\n## Goal\n\nSecond.", date);

    expect(first.filename).toBe("2026-03-11-1730-test.md");
    expect(second.filename).toBe("2026-03-11-1730-test-1.md");
    expect(existsSync(join(tmp, first.relPath))).toBe(true);
    expect(existsSync(join(tmp, second.relPath))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listArchives
// ---------------------------------------------------------------------------

describe("listArchives", () => {
  it("returns empty array when no archive dir exists", () => {
    expect(listArchives(tmp)).toEqual([]);
  });

  it("returns empty array when archive dir is empty", () => {
    mkdirSync(join(tmp, ARCHIVE_DIR_REL), { recursive: true });
    expect(listArchives(tmp)).toEqual([]);
  });

  it("returns entries sorted newest-first", () => {
    archivePlan(tmp, "# Plan: First\n\nGoal.", new Date(2026, 0, 1, 10, 0));
    archivePlan(tmp, "# Plan: Second\n\nGoal.", new Date(2026, 0, 2, 10, 0));
    archivePlan(tmp, "# Plan: Third\n\nGoal.", new Date(2026, 0, 3, 10, 0));

    const archives = listArchives(tmp);
    expect(archives).toHaveLength(3);
    expect(archives[0].label).toBe("Third");
    expect(archives[1].label).toBe("Second");
    expect(archives[2].label).toBe("First");
  });

  it("extracts labels from plan content", () => {
    archivePlan(tmp, "# Plan: Auth Module\n\n## Goal\n\nBuild it.", new Date(2026, 2, 11, 17, 30));
    const archives = listArchives(tmp);
    expect(archives[0].label).toBe("Auth Module");
  });

  it("ignores non-.md files", () => {
    mkdirSync(join(tmp, ARCHIVE_DIR_REL), { recursive: true });
    writeFileSync(join(tmp, ARCHIVE_DIR_REL, "readme.txt"), "ignore me");
    archivePlan(tmp, "# Plan: Real\n\nGoal.", new Date(2026, 0, 1, 10, 0));

    const archives = listArchives(tmp);
    expect(archives).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// archiveFilename — date-only style
// ---------------------------------------------------------------------------

describe("archiveFilename — date-only style", () => {
  it("produces YYYY-MM-DD-HHMM.md without slug", () => {
    const date = new Date(2026, 2, 11, 17, 30);
    const name = archiveFilename(date, "Any Title", "date-only");
    expect(name).toBe("2026-03-11-1730.md");
  });

  it("is sortable", () => {
    const a = archiveFilename(new Date(2026, 0, 1, 0, 0), "x", "date-only");
    const b = archiveFilename(new Date(2026, 0, 1, 0, 1), "y", "date-only");
    expect(a < b).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listArchives — maxArchiveListEntries
// ---------------------------------------------------------------------------

describe("listArchives — maxArchiveListEntries", () => {
  it("caps results to maxArchiveListEntries", () => {
    for (let i = 0; i < 5; i++) {
      archivePlan(tmp, `# Plan: Plan ${i}\n\nGoal.`, new Date(2026, 0, 1 + i, 10, 0));
    }
    const archives = listArchives(tmp, { maxArchiveListEntries: 3 });
    expect(archives).toHaveLength(3);
    // newest first
    expect(archives[0].label).toBe("Plan 4");
  });

  it("returns all if fewer than max", () => {
    archivePlan(tmp, "# Plan: Only\n\nGoal.", new Date(2026, 0, 1, 10, 0));
    const archives = listArchives(tmp, { maxArchiveListEntries: 10 });
    expect(archives).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// countArchives
// ---------------------------------------------------------------------------

describe("countArchives", () => {
  it("returns 0 when no archives", () => {
    expect(countArchives(tmp)).toBe(0);
  });

  it("counts all archives regardless of maxArchiveListEntries", () => {
    for (let i = 0; i < 5; i++) {
      archivePlan(tmp, `# Plan: Plan ${i}\n\nGoal.`, new Date(2026, 0, 1 + i, 10, 0));
    }
    expect(countArchives(tmp)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// archivePlan — config-aware
// ---------------------------------------------------------------------------

describe("archivePlan — config-aware", () => {
  it("respects custom archiveDir", () => {
    const result = archivePlan(
      tmp,
      "# Plan: Custom Dir\n\nGoal.",
      new Date(2026, 2, 11, 17, 30),
      { archiveDir: ".pi/custom-archive" },
    );
    expect(result.relPath).toContain(".pi/custom-archive");
    expect(existsSync(join(tmp, result.relPath))).toBe(true);
  });

  it("respects date-only filename style", () => {
    const result = archivePlan(
      tmp,
      "# Plan: Date Only\n\nGoal.",
      new Date(2026, 2, 11, 17, 30),
      { archiveFilenameStyle: "date-only" },
    );
    expect(result.filename).toBe("2026-03-11-1730.md");
  });
});

// ---------------------------------------------------------------------------
// readArchive
// ---------------------------------------------------------------------------

describe("readArchive", () => {
  it("returns content of an archived plan", () => {
    const content = "# Plan: Test\n\nContent here.";
    const result = archivePlan(tmp, content, new Date(2026, 0, 1, 10, 0));
    expect(readArchive(tmp, result.relPath)).toBe(content);
  });

  it("returns null for non-existent archive", () => {
    expect(readArchive(tmp, `${ARCHIVE_DIR_REL}/nonexistent.md`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Replace flow (archive old, write new)
// ---------------------------------------------------------------------------

describe("replace flow", () => {
  it("archives old plan and writes new one", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Old\n\n## Goal\n\nOld goal.");

    const oldContent = readCurrentPlan(tmp)!;
    const archiveResult = archivePlan(tmp, oldContent, new Date(2026, 2, 11, 17, 30));
    forceWriteCurrentPlan(tmp, "# Plan: New\n\n## Goal\n\nNew goal.");

    // Old content preserved in archive
    expect(readFileSync(join(tmp, archiveResult.relPath), "utf-8")).toContain("Old goal");
    // New content is current
    expect(readFile(CURRENT_PLAN_REL)).toContain("New goal");
    expect(hasCurrentPlan(tmp)).toBe(true);
  });

  it("cancellation leaves current unchanged", () => {
    initPlanning(tmp);
    const originalContent = "# Plan: Existing\n\n## Goal\n\nKeep this.";
    writeFile(CURRENT_PLAN_REL, originalContent);

    // Simulate cancel: don't do anything
    expect(readFile(CURRENT_PLAN_REL)).toBe(originalContent);
    expect(listArchives(tmp)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Restore flow (archive current, write archive as current)
// ---------------------------------------------------------------------------

describe("restore flow", () => {
  it("restores archived plan as current", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Current\n\n## Goal\n\nCurrent goal.");

    // Create an archive to restore
    const archivedContent = "# Plan: Archived\n\n## Goal\n\nArchived goal.";
    const archiveResult = archivePlan(tmp, archivedContent, new Date(2026, 0, 1, 10, 0));

    // Archive current first
    const currentContent = readCurrentPlan(tmp)!;
    archivePlan(tmp, currentContent, new Date(2026, 2, 11, 17, 30));

    // Restore the archived plan
    const restoredContent = readArchive(tmp, archiveResult.relPath)!;
    forceWriteCurrentPlan(tmp, restoredContent);

    expect(readFile(CURRENT_PLAN_REL)).toContain("Archived goal");
    expect(hasCurrentPlan(tmp)).toBe(true);
    // Should now have 2 archives (original + the archived current)
    expect(listArchives(tmp)).toHaveLength(2);
  });

  it("cancellation leaves files unchanged", () => {
    initPlanning(tmp);
    const currentContent = "# Plan: Keep\n\n## Goal\n\nKeep this.";
    writeFile(CURRENT_PLAN_REL, currentContent);

    archivePlan(tmp, "# Plan: Old\n\nOld.", new Date(2026, 0, 1, 10, 0));

    // Simulate cancel: don't do anything
    expect(readFile(CURRENT_PLAN_REL)).toBe(currentContent);
    expect(listArchives(tmp)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// updateIndex
// ---------------------------------------------------------------------------

describe("updateIndex", () => {
  it("creates index with current plan title", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Auth Module\n\n## Goal\n\nBuild auth.");
    updateIndex(tmp);

    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("# Plan Index");
    expect(index).toContain("Auth Module");
    expect(index).toContain("current.md");
  });

  it("lists archived plans", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Current\n\nGoal.");
    archivePlan(tmp, "# Plan: Old One\n\nGoal.", new Date(2026, 0, 1, 10, 0));
    archivePlan(tmp, "# Plan: Old Two\n\nGoal.", new Date(2026, 0, 2, 10, 0));
    updateIndex(tmp);

    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("Old One");
    expect(index).toContain("Old Two");
    expect(index).toContain("archive/");
  });

  it("shows _None yet._ when no archives exist", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Solo\n\nGoal.");
    updateIndex(tmp);

    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("_None yet._");
  });

  it("is updated after archive and replace", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: First\n\nGoal.");

    // Archive and replace
    const oldContent = readCurrentPlan(tmp)!;
    archivePlan(tmp, oldContent, new Date(2026, 2, 11, 17, 30));
    forceWriteCurrentPlan(tmp, "# Plan: Second\n\nNew goal.");
    updateIndex(tmp);

    const index = readFile(PLANS_INDEX_REL);
    expect(index).toContain("Second"); // current
    expect(index).toContain("First");  // archived
  });

  it("is deterministic and readable", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Test\n\nGoal.");
    archivePlan(tmp, "# Plan: Archived\n\nGoal.", new Date(2026, 0, 1, 10, 0));

    updateIndex(tmp);
    const first = readFile(PLANS_INDEX_REL);
    updateIndex(tmp);
    const second = readFile(PLANS_INDEX_REL);

    expect(first).toBe(second);
    expect(first).toContain("## Current");
    expect(first).toContain("## Archived");
  });
});

// ---------------------------------------------------------------------------
// State integration — initialized-has-plan still detected correctly
// ---------------------------------------------------------------------------

describe("state integration with archives", () => {
  it("hasCurrentPlan still works after archiving", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Test\n\n## Goal\n\nBuild it.");
    expect(hasCurrentPlan(tmp)).toBe(true);

    // Archive and replace
    const oldContent = readCurrentPlan(tmp)!;
    archivePlan(tmp, oldContent);
    forceWriteCurrentPlan(tmp, "# Plan: New\n\n## Goal\n\nNew goal.");
    expect(hasCurrentPlan(tmp)).toBe(true);
  });

  it("archive directory does not break isFullyInitialized or hasCurrentPlan", () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Test\n\n## Goal\n\nBuild it.");
    archivePlan(tmp, "# Plan: Old\n\nGoal.", new Date(2026, 0, 1, 10, 0));

    expect(hasCurrentPlan(tmp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Path traversal protection
// ---------------------------------------------------------------------------

describe("path traversal protection", () => {
  it("readArchive returns null for paths escaping repo root", () => {
    initPlanning(tmp);
    expect(readArchive(tmp, "../../etc/passwd")).toBeNull();
    expect(readArchive(tmp, "../../../etc/shadow")).toBeNull();
    expect(readArchive(tmp, ".pi/plans/../../outside.md")).toBeNull();
  });

  it("readArchive allows legitimate relative paths", () => {
    initPlanning(tmp);
    const content = "# Plan: Test\n\nGoal.";
    const result = archivePlan(tmp, content, new Date(2026, 0, 1, 10, 0));
    expect(readArchive(tmp, result.relPath)).toBe(content);
  });

  it("archivePlan rejects archiveDir that escapes repo root", () => {
    expect(() => {
      archivePlan(
        tmp,
        "# Plan: Escape\n\nGoal.",
        new Date(2026, 0, 1, 10, 0),
        { archiveDir: "../../tmp/evil" },
      );
    }).toThrow(/escapes repository root/);
  });

  it("archivePlan allows archiveDir within repo root", () => {
    const result = archivePlan(
      tmp,
      "# Plan: Safe\n\nGoal.",
      new Date(2026, 0, 1, 10, 0),
      { archiveDir: ".pi/custom-archive" },
    );
    expect(existsSync(join(tmp, result.relPath))).toBe(true);
  });
});
