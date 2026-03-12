import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handlePlan, handlePlanDebug, resolveGoal, type PlanUI } from "../orchestration.js";
import { initPlanning, CURRENT_PLAN_REL, PLANS_INDEX_REL, TASK_PLAN_TEMPLATE_REL, type PlanState } from "../repo.js";
import { DEFAULT_CONFIG } from "../config.js";
import { CURRENT_PLAN_SENTINEL } from "../defaults.js";
import { archivePlan } from "../archive.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-orch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
// Mock PlanUI
// ---------------------------------------------------------------------------

interface MockUILog {
  notifications: Array<{ message: string; level: string }>;
  confirms: string[];
  selects: string[];
  inputs: string[];
}

function createMockUI(overrides?: {
  confirmResult?: boolean | boolean[];
  selectResult?: string | null | (string | null)[];
  inputResult?: string | null | (string | null)[];
}): PlanUI & { log: MockUILog } {
  const log: MockUILog = {
    notifications: [],
    confirms: [],
    selects: [],
    inputs: [],
  };

  // Support sequences: if an array is passed, pop values in order
  let confirmIdx = 0;
  let selectIdx = 0;
  let inputIdx = 0;

  function getConfirm(): boolean {
    const v = overrides?.confirmResult;
    if (Array.isArray(v)) return v[confirmIdx++] ?? false;
    return v ?? false;
  }
  function getSelect(): string | null {
    const v = overrides?.selectResult;
    if (Array.isArray(v)) return v[selectIdx++] ?? null;
    return v ?? null;
  }
  function getInput(): string | null {
    const v = overrides?.inputResult;
    if (Array.isArray(v)) return v[inputIdx++] ?? null;
    return v ?? null;
  }

  return {
    log,
    notify(message: string, level: string) {
      log.notifications.push({ message, level: level as string });
    },
    async confirm(title: string, _message: string) {
      log.confirms.push(title);
      return getConfirm();
    },
    async select(title: string, _options: string[]) {
      log.selects.push(title);
      return getSelect();
    },
    async input(title: string, _placeholder: string) {
      log.inputs.push(title);
      return getInput();
    },
  };
}

// ---------------------------------------------------------------------------
// handlePlan — no-repo
// ---------------------------------------------------------------------------

describe("handlePlan — no-repo", () => {
  it("notifies error when no repo detected", async () => {
    const ui = createMockUI();
    await handlePlan({ status: "no-repo" }, "", ui);
    expect(ui.log.notifications).toHaveLength(1);
    expect(ui.log.notifications[0].level).toBe("error");
    expect(ui.log.notifications[0].message).toContain("No repository detected");
  });
});

// ---------------------------------------------------------------------------
// handlePlan — not-initialized
// ---------------------------------------------------------------------------

describe("handlePlan — not-initialized", () => {
  it("offers initialization and creates files when confirmed", async () => {
    const ui = createMockUI({ confirmResult: true });
    await handlePlan({ status: "not-initialized", repoRoot: tmp }, "", ui);

    expect(ui.log.confirms).toHaveLength(1);
    expect(ui.log.confirms[0]).toBe("Initialize planning?");
    // Files should be created
    expect(existsSync(join(tmp, CURRENT_PLAN_REL))).toBe(true);
    // Success notification
    expect(ui.log.notifications.some((n) => n.level === "success")).toBe(true);
  });

  it("does nothing when initialization is cancelled", async () => {
    const ui = createMockUI({ confirmResult: false });
    await handlePlan({ status: "not-initialized", repoRoot: tmp }, "", ui);

    expect(ui.log.confirms).toHaveLength(1);
    expect(existsSync(join(tmp, CURRENT_PLAN_REL))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handlePlan — initialized-no-plan (create)
// ---------------------------------------------------------------------------

describe("handlePlan — initialized-no-plan", () => {
  beforeEach(() => {
    initPlanning(tmp);
  });

  it("creates a plan when goal provided and confirmed", async () => {
    const ui = createMockUI({ inputResult: "Build a widget", confirmResult: true });
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    expect(ui.log.inputs).toHaveLength(1);
    expect(ui.log.confirms).toHaveLength(1);
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Build a widget");
    expect(current).not.toContain(CURRENT_PLAN_SENTINEL);
    expect(ui.log.notifications.some((n) => n.level === "success")).toBe(true);
  });

  it("uses inline args when config allows", async () => {
    const ui = createMockUI({ confirmResult: true });
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "Inline goal text", ui);

    // No input prompt — inline args used
    expect(ui.log.inputs).toHaveLength(0);
    expect(ui.log.confirms).toHaveLength(1);
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Inline goal text");
  });

  it("cancels when no goal provided", async () => {
    const ui = createMockUI({ inputResult: "" });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
    expect(ui.log.notifications.some((n) => n.message.includes("cancelled"))).toBe(true);
  });

  it("cancels when confirm is rejected", async () => {
    const ui = createMockUI({ inputResult: "Some goal", confirmResult: false });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
    expect(ui.log.notifications.some((n) => n.message.includes("cancelled"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handlePlan — initialized-has-plan (action menu)
// ---------------------------------------------------------------------------

describe("handlePlan — initialized-has-plan — cancel", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Active\n\n## Goal\n\nActive goal.");
  });

  it("shows action menu and does nothing on cancel", async () => {
    const ui = createMockUI({ selectResult: "Cancel" });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    expect(ui.log.selects).toHaveLength(1);
    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
    expect(ui.log.notifications.some((n) => n.message === "Cancelled.")).toBe(true);
  });

  it("shows action menu and does nothing on null selection", async () => {
    const ui = createMockUI({ selectResult: null });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
  });
});

describe("handlePlan — initialized-has-plan — resume", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Auth Module\n\n## Goal\n\nBuild JWT auth.");
  });

  it("shows plan info on resume", async () => {
    const ui = createMockUI({ selectResult: "Resume current plan" });
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    const notifyMsg = ui.log.notifications.find((n) => n.level === "info");
    expect(notifyMsg).toBeDefined();
    expect(notifyMsg!.message).toContain("Auth Module");
    expect(notifyMsg!.message).toContain("Resuming");
  });
});

// ---------------------------------------------------------------------------
// handlePlanDebug
// ---------------------------------------------------------------------------

describe("handlePlanDebug", () => {
  it("notifies error when no repo", async () => {
    const ui = createMockUI();
    await handlePlanDebug(null, "/tmp", ui);

    expect(ui.log.notifications).toHaveLength(1);
    expect(ui.log.notifications[0].level).toBe("error");
  });

  it("writes diagnostic log when in repo", async () => {
    initPlanning(tmp);
    const ui = createMockUI();
    await handlePlanDebug(tmp, tmp, ui);

    expect(ui.log.notifications.some((n) => n.message.includes("debug log written"))).toBe(true);
    // Log file should exist
    expect(existsSync(join(tmp, ".pi", "logs"))).toBe(true);
  });

  it("writes diagnostic log for not-initialized repo", async () => {
    const ui = createMockUI();
    await handlePlanDebug(tmp, tmp, ui);

    expect(ui.log.notifications.some((n) => n.message.includes("not initialized"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handlePlan — initialized-has-plan — replace (success)
// ---------------------------------------------------------------------------

describe("handlePlan — initialized-has-plan — replace success", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Old Plan\n\n## Goal\n\nOld goal text.");
  });

  it("archives old plan and writes new plan on confirmed replace", async () => {
    const ui = createMockUI({
      selectResult: "Replace current plan",
      inputResult: "Build a new widget",
      confirmResult: true,
    });
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    // New plan should be current
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Build a new widget");
    expect(current).not.toContain("Old goal text");

    // Old plan should be archived
    const archiveDir = join(tmp, ".pi/plans/archive");
    expect(existsSync(archiveDir)).toBe(true);
    const files = require("node:fs").readdirSync(archiveDir) as string[];
    expect(files.length).toBe(1);
    const archivedContent = readFileSync(join(archiveDir, files[0]), "utf-8");
    expect(archivedContent).toContain("Old goal text");

    // Success notification
    expect(ui.log.notifications.some((n) => n.level === "success")).toBe(true);
  });

  it("uses inline goal args on replace when allowed", async () => {
    const ui = createMockUI({
      selectResult: "Replace current plan",
      confirmResult: true,
    });
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "Inline replace goal", ui);

    // No input prompt needed
    expect(ui.log.inputs).toHaveLength(0);
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Inline replace goal");
  });
});

// ---------------------------------------------------------------------------
// handlePlan — initialized-has-plan — replace (cancelled)
// ---------------------------------------------------------------------------

describe("handlePlan — initialized-has-plan — replace cancelled", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Keep Me\n\n## Goal\n\nOriginal goal.");
  });

  it("leaves files unchanged when replace confirm is rejected", async () => {
    const ui = createMockUI({
      selectResult: "Replace current plan",
      inputResult: "New goal that will be cancelled",
      confirmResult: false,
    });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
    // No archive created
    const archiveDir = join(tmp, ".pi/plans/archive");
    if (existsSync(archiveDir)) {
      const files = require("node:fs").readdirSync(archiveDir) as string[];
      expect(files.filter((f: string) => f.endsWith(".md")).length).toBe(0);
    }
    expect(ui.log.notifications.some((n) => n.message.includes("Cancelled"))).toBe(true);
  });

  it("leaves files unchanged when no goal provided for replace", async () => {
    const ui = createMockUI({
      selectResult: "Replace current plan",
      inputResult: "",
    });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// handlePlan — initialized-has-plan — revisit/restore (success)
// ---------------------------------------------------------------------------

describe("handlePlan — initialized-has-plan — restore success", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Current Active\n\n## Goal\n\nCurrent goal.");
    // Create an archive to restore
    archivePlan(tmp, "# Plan: Old Archived\n\n## Goal\n\nArchived goal content.", new Date(2026, 0, 15, 10, 0));
  });

  it("restores selected archive and archives current plan", async () => {
    // The select needs to pick the archive label. formatArchiveLabel produces
    // something like "Old Archived  (2026-01-15 10:00)"
    const ui = createMockUI({
      selectResult: ["Revisit archived plans", "Old Archived  (2026-01-15 10:00)"],
      confirmResult: true,
    });
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    // Restored plan should be current
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Archived goal content");

    // Old current should be archived (now 2 archives total)
    const archiveDir = join(tmp, ".pi/plans/archive");
    const files = (require("node:fs").readdirSync(archiveDir) as string[]).filter((f: string) => f.endsWith(".md"));
    expect(files.length).toBe(2);

    expect(ui.log.notifications.some((n) => n.level === "success")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handlePlan — initialized-has-plan — revisit/restore (cancelled)
// ---------------------------------------------------------------------------

describe("handlePlan — initialized-has-plan — restore cancelled", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Keep This\n\n## Goal\n\nStay here.");
    archivePlan(tmp, "# Plan: Old Archived\n\n## Goal\n\nOld.", new Date(2026, 0, 15, 10, 0));
  });

  it("leaves files unchanged when restore confirm is rejected", async () => {
    const ui = createMockUI({
      selectResult: ["Revisit archived plans", "Old Archived  (2026-01-15 10:00)"],
      confirmResult: false,
    });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
    // Only original archive, no new archive created
    const archiveDir = join(tmp, ".pi/plans/archive");
    const files = (require("node:fs").readdirSync(archiveDir) as string[]).filter((f: string) => f.endsWith(".md"));
    expect(files.length).toBe(1);
    expect(ui.log.notifications.some((n) => n.message.includes("Cancelled"))).toBe(true);
  });

  it("leaves files unchanged when cancel is chosen from archive list", async () => {
    const ui = createMockUI({
      selectResult: ["Revisit archived plans", "Cancel"],
    });
    const before = readFile(CURRENT_PLAN_REL);
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    expect(readFile(CURRENT_PLAN_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// handlePlan — initialized-has-plan — revisit with no archives
// ---------------------------------------------------------------------------

describe("handlePlan — initialized-has-plan — no archives", () => {
  beforeEach(() => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Solo\n\n## Goal\n\nOnly plan.");
  });

  it("shows 'no archives' message when revisiting with empty archive", async () => {
    const ui = createMockUI({
      selectResult: "Revisit archived plans",
    });
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    expect(ui.log.notifications.some((n) => n.message.includes("No archived plans"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Template repair/reset flow (Phase 7)
// ---------------------------------------------------------------------------

describe("handlePlan — template repair flow", () => {
  it("offers template reset when template is missing and user accepts", async () => {
    initPlanning(tmp);
    // Delete the template file
    const fs = require("node:fs");
    fs.unlinkSync(join(tmp, TASK_PLAN_TEMPLATE_REL));
    expect(existsSync(join(tmp, TASK_PLAN_TEMPLATE_REL))).toBe(false);

    // confirmResult: [true for template reset, true for plan creation]
    const ui = createMockUI({
      confirmResult: [true, true],
      inputResult: "Test goal",
    });
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    // Template should be restored
    expect(existsSync(join(tmp, TASK_PLAN_TEMPLATE_REL))).toBe(true);
    // Plan should still be created
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Test goal");
    // Should see restore success notification
    expect(ui.log.notifications.some((n) => n.message.includes("Default template restored"))).toBe(true);
  });

  it("skips template reset when user declines but still creates plan", async () => {
    initPlanning(tmp);
    const fs = require("node:fs");
    fs.unlinkSync(join(tmp, TASK_PLAN_TEMPLATE_REL));

    // confirmResult: [false for template reset, true for plan creation]
    const ui = createMockUI({
      confirmResult: [false, true],
      inputResult: "Test goal",
    });
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    // Template not restored
    expect(existsSync(join(tmp, TASK_PLAN_TEMPLATE_REL))).toBe(false);
    // Plan still created (using fallback sections)
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Test goal");
  });

  it("shows info notice for legacy template without blocking", async () => {
    initPlanning(tmp);
    // Write a legacy template (no placeholders)
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\nDescribe.\n\n## Scope\n\nScope.");

    const ui = createMockUI({
      confirmResult: true,
      inputResult: "Test goal",
    });
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    // Should see legacy notice
    expect(ui.log.notifications.some((n) => n.message.includes("legacy format"))).toBe(true);
    // Plan should be created
    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain("Test goal");
  });

  it("does not show any template notice for healthy template", async () => {
    initPlanning(tmp);
    // Default template has placeholders — healthy state

    const ui = createMockUI({
      confirmResult: true,
      inputResult: "Test goal",
    });
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    // No template-related notices
    expect(ui.log.notifications.some((n) => n.message.includes("legacy format"))).toBe(false);
    expect(ui.log.notifications.some((n) => n.message.includes("Default template restored"))).toBe(false);
  });

  it("offers template reset during replace flow", async () => {
    initPlanning(tmp);
    writeFile(CURRENT_PLAN_REL, "# Plan: Old\n\n## Goal\n\nOld goal.");
    // Make template invalid
    writeFile(TASK_PLAN_TEMPLATE_REL, "no sections at all");

    // confirmResult: [true for template reset, true for replace confirm]
    const ui = createMockUI({
      selectResult: "Replace current plan",
      confirmResult: [true, true],
      inputResult: "New goal",
    });
    await handlePlan({ status: "initialized-has-plan", repoRoot: tmp }, "", ui);

    // Template should be restored
    expect(existsSync(join(tmp, TASK_PLAN_TEMPLATE_REL))).toBe(true);
    const templateContent = readFile(TASK_PLAN_TEMPLATE_REL);
    expect(templateContent).toContain("{{GOAL}}");
  });
});

// ---------------------------------------------------------------------------
// CURRENT_STATE config passthrough (Phase 7)
// ---------------------------------------------------------------------------

describe("handlePlan — currentStateTemplate config passthrough", () => {
  it("passes currentStateTemplate from config to plan generation", async () => {
    initPlanning(tmp);
    writeFile(TASK_PLAN_TEMPLATE_REL, "## Goal\n\n{{GOAL}}\n\n## State\n\n{{CURRENT_STATE}}");
    // Write config with custom currentStateTemplate
    const configContent = JSON.stringify({ currentStateTemplate: "Custom: `{{REPO_ROOT}}`\n\nCheck it." });
    writeFile(".pi/pi-plan.json", configContent);

    const ui = createMockUI({
      confirmResult: true,
      inputResult: "My goal",
    });
    await handlePlan({ status: "initialized-no-plan", repoRoot: tmp }, "", ui);

    const current = readFile(CURRENT_PLAN_REL);
    expect(current).toContain(`Custom: \`${tmp}\``);
    expect(current).toContain("Check it.");
    // Should NOT contain the default text
    expect(current).not.toContain("_Describe what exists today.");
  });
});

// ---------------------------------------------------------------------------
// resolveGoal
// ---------------------------------------------------------------------------

describe("resolveGoal", () => {
  it("returns inline args when allowed and non-empty", async () => {
    const ui = createMockUI();
    const goal = await resolveGoal(DEFAULT_CONFIG, "Inline goal", ui);
    expect(goal).toBe("Inline goal");
    expect(ui.log.inputs).toHaveLength(0);
  });

  it("prompts when inline args empty", async () => {
    const ui = createMockUI({ inputResult: "Interactive goal" });
    const goal = await resolveGoal(DEFAULT_CONFIG, "", ui);
    expect(goal).toBe("Interactive goal");
    expect(ui.log.inputs).toHaveLength(1);
  });

  it("prompts when inline args disabled", async () => {
    const config = { ...DEFAULT_CONFIG, allowInlineGoalArgs: false };
    const ui = createMockUI({ inputResult: "Interactive goal" });
    const goal = await resolveGoal(config, "ignored args", ui);
    expect(goal).toBe("Interactive goal");
    expect(ui.log.inputs).toHaveLength(1);
  });

  it("returns null when input is empty", async () => {
    const ui = createMockUI({ inputResult: "" });
    const goal = await resolveGoal(DEFAULT_CONFIG, "", ui);
    expect(goal).toBeNull();
  });

  it("returns null when input is null", async () => {
    const ui = createMockUI({ inputResult: null });
    const goal = await resolveGoal(DEFAULT_CONFIG, "", ui);
    expect(goal).toBeNull();
  });
});
