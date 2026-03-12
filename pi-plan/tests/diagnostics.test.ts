import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectDiagnostics,
  formatTimestamp,
  logFilename,
  logRelPath,
  writeDiagnosticLog,
  LOGS_DIR_REL,
  type DiagnosticSnapshot,
} from "../diagnostics.js";
import {
  PLANNING_PROTOCOL_REL,
  TASK_PLAN_TEMPLATE_REL,
  CURRENT_PLAN_REL,
  PLANS_INDEX_REL,
  initPlanning,
} from "../repo.js";
import { CURRENT_PLAN_PLACEHOLDER } from "../defaults.js";

// ---------------------------------------------------------------------------
// Shared temp directory helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-diag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  it("formats a date as YYYY-MM-DD-HHMMSS", () => {
    const d = new Date(2026, 2, 11, 17, 5, 9); // March 11, 2026 17:05:09
    expect(formatTimestamp(d)).toBe("2026-03-11-170509");
  });

  it("pads single-digit values", () => {
    const d = new Date(2026, 0, 3, 2, 4, 7); // Jan 3, 2026 02:04:07
    expect(formatTimestamp(d)).toBe("2026-01-03-020407");
  });

  it("produces sortable strings", () => {
    const a = formatTimestamp(new Date(2026, 0, 1, 0, 0, 0));
    const b = formatTimestamp(new Date(2026, 0, 1, 0, 0, 1));
    const c = formatTimestamp(new Date(2026, 11, 31, 23, 59, 59));
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// logFilename / logRelPath
// ---------------------------------------------------------------------------

describe("logFilename", () => {
  it("produces plan-debug-YYYY-MM-DD-HHMMSS.json", () => {
    const d = new Date(2026, 2, 11, 17, 33, 27);
    expect(logFilename(d)).toBe("plan-debug-2026-03-11-173327.json");
  });
});

describe("logRelPath", () => {
  it("is under .pi/logs/", () => {
    const d = new Date(2026, 2, 11, 17, 33, 27);
    const rel = logRelPath(d);
    expect(rel.startsWith(".pi/logs/")).toBe(true);
    expect(rel.endsWith(".json")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// collectDiagnostics — no repo
// ---------------------------------------------------------------------------

describe("collectDiagnostics — no repo", () => {
  it("returns no-repo state when repoRoot is null", () => {
    const snap = collectDiagnostics(null, "/tmp/nowhere");
    expect(snap.state).toBe("no-repo");
    expect(snap.repoRoot).toBeNull();
    expect(snap.environment.insideRepo).toBe(false);
    expect(snap.initialization.isFullyInitialized).toBe(false);
    expect(snap.warnings.length).toBeGreaterThan(0);
  });

  it("includes expected fields even without a repo", () => {
    const snap = collectDiagnostics(null, "/tmp");
    expect(snap.timestamp).toBeTruthy();
    expect(snap.cwd).toBe("/tmp");
    expect(snap.paths.protocol).toBe(PLANNING_PROTOCOL_REL);
    expect(snap.paths.logsDir).toBe(LOGS_DIR_REL);
    expect(snap.currentPlan.exists).toBe(false);
    expect(snap.archive.count).toBe(0);
    expect(snap.archive.latestFilename).toBeNull();
    expect(snap.currentPlan.title).toBeNull();
    expect(snap.config).toBeDefined();
    expect(snap.config.source).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// collectDiagnostics — repo not initialized
// ---------------------------------------------------------------------------

describe("collectDiagnostics — repo not initialized", () => {
  it("returns not-initialized when .pi/ does not exist", () => {
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.state).toBe("not-initialized");
    expect(snap.environment.insideRepo).toBe(true);
    expect(snap.initialization.isFullyInitialized).toBe(false);
    expect(snap.exists.protocol).toBe(false);
    expect(snap.exists.template).toBe(false);
    expect(snap.exists.current).toBe(false);
    expect(snap.exists.index).toBe(false);
  });

  it("includes partial-init warning when some files exist", () => {
    writeFile(PLANNING_PROTOCOL_REL, "# protocol");
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.state).toBe("not-initialized");
    expect(snap.exists.protocol).toBe(true);
    expect(snap.exists.template).toBe(false);
    expect(snap.warnings.some((w) => w.includes("Partial initialization"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// collectDiagnostics — initialized, no plan
// ---------------------------------------------------------------------------

describe("collectDiagnostics — initialized, no plan", () => {
  beforeEach(() => {
    initPlanning(tmp);
  });

  it("returns initialized-no-plan with placeholder current.md", () => {
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.state).toBe("initialized-no-plan");
    expect(snap.initialization.isFullyInitialized).toBe(true);
    expect(snap.exists.protocol).toBe(true);
    expect(snap.exists.template).toBe(true);
    expect(snap.exists.current).toBe(true);
    expect(snap.exists.index).toBe(true);
  });

  it("classifies current plan as placeholder", () => {
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.currentPlan.exists).toBe(true);
    expect(snap.currentPlan.isPlaceholder).toBe(true);
    expect(snap.currentPlan.sizeBytes).toBeGreaterThan(0);
    expect(snap.currentPlan.lineCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// collectDiagnostics — initialized, has plan
// ---------------------------------------------------------------------------

describe("collectDiagnostics — initialized, has plan", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Refactor auth\n\n## Goal\n\nRefactor auth module.\n");
  });

  it("returns initialized-has-plan with real content", () => {
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.state).toBe("initialized-has-plan");
    expect(snap.currentPlan.isPlaceholder).toBe(false);
    expect(snap.currentPlan.sizeBytes).toBeGreaterThan(0);
    expect(snap.currentPlan.lineCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// collectDiagnostics — snapshot safety (no file contents)
// ---------------------------------------------------------------------------

describe("snapshot safety", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Visible Title\n\nDo not leak this content body.\n");
  });

  it("does not include file body content in the snapshot", () => {
    const snap = collectDiagnostics(tmp, tmp);
    const json = JSON.stringify(snap);
    // Title is intentionally extracted as metadata
    expect(json).toContain("Visible Title");
    // Body content should not appear
    expect(json).not.toContain("Do not leak this content body");
  });

  it("includes size, line count, and title instead of full content", () => {
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.currentPlan.sizeBytes).toBeGreaterThan(0);
    expect(snap.currentPlan.lineCount).toBeGreaterThan(0);
    expect(snap.currentPlan.title).toBe("Visible Title");
  });
});

// ---------------------------------------------------------------------------
// collectDiagnostics — template info (Phase 6)
// ---------------------------------------------------------------------------

describe("collectDiagnostics — template info", () => {
  it("reports template as not usable when not initialized", () => {
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.template.usable).toBe(false);
    expect(snap.template.sectionCount).toBe(0);
    expect(snap.template.mode).toBe("default-fallback");
  });

  it("reports template as usable after initialization with default template", () => {
    initPlanning(tmp);
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.template.usable).toBe(true);
    expect(snap.template.sectionCount).toBeGreaterThan(0);
    expect(snap.template.mode).toBe("explicit-placeholders");
    expect(snap.template.hasExplicitPlaceholders).toBe(true);
    expect(snap.template.usesFallback).toBe(false);
    expect(snap.template.repairRecommended).toBe(false);
    expect(snap.notes.some((n) => n.includes("section(s)"))).toBe(true);
  });

  it("reports template as not usable when template has no H2 sections", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "Just text, no headings.");
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.template.usable).toBe(false);
    expect(snap.template.sectionCount).toBe(0);
    expect(snap.template.mode).toBe("invalid");
    expect(snap.template.repairRecommended).toBe(true);
    expect(snap.notes.some((n) => n.includes("fallback"))).toBe(true);
  });

  it("reports correct section count for custom template", () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## A\n\n## B\n\n## C\n\n");
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.template.usable).toBe(true);
    expect(snap.template.sectionCount).toBe(3);
    // No placeholders in this template
    expect(snap.template.mode).toBe("legacy-section-fallback");
    expect(snap.template.hasExplicitPlaceholders).toBe(false);
  });

  it("template info for no-repo is not usable", () => {
    const snap = collectDiagnostics(null, "/tmp");
    expect(snap.template.usable).toBe(false);
    expect(snap.template.sectionCount).toBe(0);
    expect(snap.template.mode).toBe("default-fallback");
    expect(snap.template.repairRecommended).toBe(false);
  });

  it("does not include template mode or repair in no-repo file content", () => {
    const snap = collectDiagnostics(null, "/tmp");
    const json = JSON.stringify(snap);
    // These are metadata fields, safe to include
    expect(json).toContain("default-fallback");
    // But no file contents
    expect(json).not.toContain("{{GOAL}}");
  });
});

// ---------------------------------------------------------------------------
// collectDiagnostics — config awareness
// ---------------------------------------------------------------------------

describe("collectDiagnostics — config awareness", () => {
  beforeEach(() => {
    initPlanning(tmp);
  });

  it("uses default config when no override provided", () => {
    const snap = collectDiagnostics(tmp, tmp);
    expect(snap.config.source).toBe("default");
    expect(snap.config.effectiveArchiveDir).toBe(".pi/plans/archive");
    expect(snap.config.effectiveDebugLogDir).toBe(".pi/logs");
  });

  it("reflects custom config when override provided", () => {
    const snap = collectDiagnostics(tmp, tmp, {
      config: {
        archiveDir: ".pi/custom-archive",
        archiveFilenameStyle: "date-only",
        archiveCollisionStrategy: "counter",
        resumeShowSummary: false,
        allowInlineGoalArgs: false,
        debugLogDir: ".pi/custom-logs",
        debugLogFilenameStyle: "timestamp",
        maxArchiveListEntries: 5,
      },
      warnings: ["test warning"],
      source: "file",
    });
    expect(snap.config.source).toBe("file");
    expect(snap.config.effectiveArchiveDir).toBe(".pi/custom-archive");
    expect(snap.config.effectiveDebugLogDir).toBe(".pi/custom-logs");
    expect(snap.config.maxArchiveListEntries).toBe(5);
    expect(snap.config.configWarnings).toEqual(["test warning"]);
    expect(snap.paths.archiveDir).toBe(".pi/custom-archive");
    expect(snap.paths.logsDir).toBe(".pi/custom-logs");
  });

  it("does not include full file contents in config snapshot", () => {
    writeFile(CURRENT_PLAN_REL, "# Plan: Visible\n\nSecret body content.");
    const snap = collectDiagnostics(tmp, tmp);
    const json = JSON.stringify(snap);
    expect(json).not.toContain("Secret body content");
    expect(json).toContain("Visible"); // title is metadata
  });
});

// ---------------------------------------------------------------------------
// writeDiagnosticLog
// ---------------------------------------------------------------------------

describe("writeDiagnosticLog", () => {
  it("creates .pi/logs/ if missing", () => {
    const snap = collectDiagnostics(tmp, tmp);
    const { absPath, relPath } = writeDiagnosticLog(tmp, snap);

    expect(existsSync(join(tmp, LOGS_DIR_REL))).toBe(true);
    expect(existsSync(absPath)).toBe(true);
    expect(relPath.startsWith(".pi/logs/")).toBe(true);
  });

  it("writes valid JSON", () => {
    const snap = collectDiagnostics(tmp, tmp);
    const { absPath } = writeDiagnosticLog(tmp, snap);

    const content = readFileSync(absPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.state).toBe(snap.state);
    expect(parsed.timestamp).toBe(snap.timestamp);
  });

  it("does not overwrite existing logs (appends counter)", () => {
    const snap = collectDiagnostics(tmp, tmp);
    const first = writeDiagnosticLog(tmp, snap);
    const second = writeDiagnosticLog(tmp, snap);

    expect(first.absPath).not.toBe(second.absPath);
    expect(existsSync(first.absPath)).toBe(true);
    expect(existsSync(second.absPath)).toBe(true);
    expect(second.relPath).toMatch(/-1\.json$/);
  });

  it("log filename matches deterministic pattern", () => {
    const snap = collectDiagnostics(tmp, tmp);
    const { relPath } = writeDiagnosticLog(tmp, snap);

    const filename = relPath.split("/").pop()!;
    expect(filename).toMatch(/^plan-debug-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  });
});
