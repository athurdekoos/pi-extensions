import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_CONFIG, CONFIG_REL, type PiPlanConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(content: string): void {
  const abs = join(tmp, CONFIG_REL);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Defaults when config missing
// ---------------------------------------------------------------------------

describe("loadConfig — missing config", () => {
  it("returns defaults with no warnings", () => {
    const result = loadConfig(tmp);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warnings).toHaveLength(0);
    expect(result.source).toBe("default");
  });

  it("defaults are sensible", () => {
    const d = DEFAULT_CONFIG;
    expect(d.archiveDir).toBe(".pi/plans/archive");
    expect(d.archiveFilenameStyle).toBe("date-slug");
    expect(d.archiveCollisionStrategy).toBe("counter");
    expect(d.resumeShowSummary).toBe(true);
    expect(d.allowInlineGoalArgs).toBe(true);
    expect(d.debugLogDir).toBe(".pi/logs");
    expect(d.debugLogFilenameStyle).toBe("timestamp");
    expect(d.maxArchiveListEntries).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Valid overrides
// ---------------------------------------------------------------------------

describe("loadConfig — valid overrides", () => {
  it("overrides archiveDir", () => {
    writeConfig(JSON.stringify({ archiveDir: ".pi/archive" }));
    const { config, warnings, source } = loadConfig(tmp);
    expect(config.archiveDir).toBe(".pi/archive");
    expect(warnings).toHaveLength(0);
    expect(source).toBe("file");
  });

  it("overrides archiveFilenameStyle to date-only", () => {
    writeConfig(JSON.stringify({ archiveFilenameStyle: "date-only" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveFilenameStyle).toBe("date-only");
    expect(warnings).toHaveLength(0);
  });

  it("overrides resumeShowSummary to false", () => {
    writeConfig(JSON.stringify({ resumeShowSummary: false }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.resumeShowSummary).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("overrides allowInlineGoalArgs to false", () => {
    writeConfig(JSON.stringify({ allowInlineGoalArgs: false }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.allowInlineGoalArgs).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("overrides debugLogDir", () => {
    writeConfig(JSON.stringify({ debugLogDir: ".pi/debug" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.debugLogDir).toBe(".pi/debug");
    expect(warnings).toHaveLength(0);
  });

  it("overrides maxArchiveListEntries", () => {
    writeConfig(JSON.stringify({ maxArchiveListEntries: 5 }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.maxArchiveListEntries).toBe(5);
    expect(warnings).toHaveLength(0);
  });

  it("preserves defaults for unset fields", () => {
    writeConfig(JSON.stringify({ archiveDir: ".pi/custom" }));
    const { config } = loadConfig(tmp);
    expect(config.archiveDir).toBe(".pi/custom");
    expect(config.resumeShowSummary).toBe(DEFAULT_CONFIG.resumeShowSummary);
    expect(config.debugLogDir).toBe(DEFAULT_CONFIG.debugLogDir);
    expect(config.maxArchiveListEntries).toBe(DEFAULT_CONFIG.maxArchiveListEntries);
  });

  it("supports all fields overridden at once", () => {
    const full: PiPlanConfig = {
      archiveDir: ".pi/custom-archive",
      archiveFilenameStyle: "date-only",
      archiveCollisionStrategy: "counter",
      resumeShowSummary: false,
      allowInlineGoalArgs: false,
      debugLogDir: ".pi/custom-logs",
      debugLogFilenameStyle: "timestamp",
      maxArchiveListEntries: 3,
      currentStateTemplate: null,
      injectPlanContext: true,
      reviewDir: ".pi/plans/reviews",
      stepFormat: "both",
      tddEnforcement: false,
      testFilePatterns: ["*.test.*"],
      brainstormEnabled: false,
      worktreeEnabled: false,
      specDir: ".pi/custom-specs",
      tddLogDir: ".pi/custom-tdd",
      worktreeStateDir: ".pi/custom-worktrees",
      defaultFinishAction: "merge",
      prTemplate: "PR for {{BRANCH}}",
    };
    writeConfig(JSON.stringify(full));
    const { config, warnings } = loadConfig(tmp);
    expect(config).toEqual(full);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid config — graceful fallback
// ---------------------------------------------------------------------------

describe("loadConfig — invalid config", () => {
  it("handles malformed JSON with warning", () => {
    writeConfig("not valid json {{{");
    const { config, warnings, source } = loadConfig(tmp);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("invalid JSON");
    expect(source).toBe("default");
  });

  it("handles array JSON with warning", () => {
    writeConfig("[]");
    const { config, warnings } = loadConfig(tmp);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings[0]).toContain("not a JSON object");
  });

  it("handles null JSON with warning", () => {
    writeConfig("null");
    const { config, warnings } = loadConfig(tmp);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings[0]).toContain("not a JSON object");
  });

  it("falls back for invalid archiveDir type", () => {
    writeConfig(JSON.stringify({ archiveDir: 123 }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveDir).toBe(DEFAULT_CONFIG.archiveDir);
    expect(warnings.some(w => w.includes("archiveDir"))).toBe(true);
  });

  it("falls back for empty archiveDir string", () => {
    writeConfig(JSON.stringify({ archiveDir: "   " }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveDir).toBe(DEFAULT_CONFIG.archiveDir);
    expect(warnings.some(w => w.includes("archiveDir"))).toBe(true);
  });

  it("falls back for invalid archiveFilenameStyle", () => {
    writeConfig(JSON.stringify({ archiveFilenameStyle: "invalid" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveFilenameStyle).toBe(DEFAULT_CONFIG.archiveFilenameStyle);
    expect(warnings.some(w => w.includes("archiveFilenameStyle"))).toBe(true);
  });

  it("falls back for non-boolean resumeShowSummary", () => {
    writeConfig(JSON.stringify({ resumeShowSummary: "yes" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.resumeShowSummary).toBe(DEFAULT_CONFIG.resumeShowSummary);
    expect(warnings.some(w => w.includes("resumeShowSummary"))).toBe(true);
  });

  it("falls back for non-integer maxArchiveListEntries", () => {
    writeConfig(JSON.stringify({ maxArchiveListEntries: 2.5 }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.maxArchiveListEntries).toBe(DEFAULT_CONFIG.maxArchiveListEntries);
    expect(warnings.some(w => w.includes("maxArchiveListEntries"))).toBe(true);
  });

  it("falls back for zero maxArchiveListEntries", () => {
    writeConfig(JSON.stringify({ maxArchiveListEntries: 0 }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.maxArchiveListEntries).toBe(DEFAULT_CONFIG.maxArchiveListEntries);
    expect(warnings.some(w => w.includes("maxArchiveListEntries"))).toBe(true);
  });

  it("falls back for negative maxArchiveListEntries", () => {
    writeConfig(JSON.stringify({ maxArchiveListEntries: -1 }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.maxArchiveListEntries).toBe(DEFAULT_CONFIG.maxArchiveListEntries);
    expect(warnings.some(w => w.includes("maxArchiveListEntries"))).toBe(true);
  });

  it("valid fields survive alongside invalid ones", () => {
    writeConfig(JSON.stringify({
      archiveDir: ".pi/custom",
      resumeShowSummary: "bad",
      maxArchiveListEntries: 10,
    }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveDir).toBe(".pi/custom");
    expect(config.resumeShowSummary).toBe(DEFAULT_CONFIG.resumeShowSummary);
    expect(config.maxArchiveListEntries).toBe(10);
    expect(warnings).toHaveLength(1);
  });

  it("ignores unknown keys without warnings", () => {
    writeConfig(JSON.stringify({ unknownKey: "whatever", archiveDir: ".pi/ok" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveDir).toBe(".pi/ok");
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// currentStateTemplate
// ---------------------------------------------------------------------------

describe("loadConfig — currentStateTemplate", () => {
  it("defaults to null when not set", () => {
    const { config } = loadConfig(tmp);
    expect(config.currentStateTemplate).toBeNull();
  });

  it("accepts a valid string", () => {
    writeConfig(JSON.stringify({ currentStateTemplate: "Custom state: `{{REPO_ROOT}}`" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.currentStateTemplate).toBe("Custom state: `{{REPO_ROOT}}`");
    expect(warnings).toHaveLength(0);
  });

  it("accepts explicit null", () => {
    writeConfig(JSON.stringify({ currentStateTemplate: null }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.currentStateTemplate).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it("falls back for empty string", () => {
    writeConfig(JSON.stringify({ currentStateTemplate: "   " }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.currentStateTemplate).toBeNull();
    expect(warnings.some(w => w.includes("currentStateTemplate"))).toBe(true);
  });

  it("falls back for non-string type", () => {
    writeConfig(JSON.stringify({ currentStateTemplate: 42 }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.currentStateTemplate).toBeNull();
    expect(warnings.some(w => w.includes("currentStateTemplate"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resolved paths
// ---------------------------------------------------------------------------

describe("loadConfig — resolved paths", () => {
  it("archive dir path from config is used as-is", () => {
    writeConfig(JSON.stringify({ archiveDir: "custom/archive/path" }));
    const { config } = loadConfig(tmp);
    expect(config.archiveDir).toBe("custom/archive/path");
  });

  it("debug log dir path from config is used as-is", () => {
    writeConfig(JSON.stringify({ debugLogDir: "custom/logs" }));
    const { config } = loadConfig(tmp);
    expect(config.debugLogDir).toBe("custom/logs");
  });
});

// ---------------------------------------------------------------------------
// Path traversal prevention
// ---------------------------------------------------------------------------

describe("loadConfig — path traversal prevention", () => {
  it("rejects archiveDir containing '..'", () => {
    writeConfig(JSON.stringify({ archiveDir: "../outside" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveDir).toBe(DEFAULT_CONFIG.archiveDir);
    expect(warnings.some(w => w.includes("archiveDir") && w.includes(".."))).toBe(true);
  });

  it("rejects archiveDir with nested '..' traversal", () => {
    writeConfig(JSON.stringify({ archiveDir: ".pi/plans/../../etc" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveDir).toBe(DEFAULT_CONFIG.archiveDir);
    expect(warnings.some(w => w.includes("archiveDir"))).toBe(true);
  });

  it("accepts archiveDir without '..'", () => {
    writeConfig(JSON.stringify({ archiveDir: ".pi/plans/archive" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.archiveDir).toBe(".pi/plans/archive");
    expect(warnings).toHaveLength(0);
  });

  it("rejects debugLogDir containing '..'", () => {
    writeConfig(JSON.stringify({ debugLogDir: "../../tmp/logs" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.debugLogDir).toBe(DEFAULT_CONFIG.debugLogDir);
    expect(warnings.some(w => w.includes("debugLogDir") && w.includes(".."))).toBe(true);
  });

  it("accepts debugLogDir without '..'", () => {
    writeConfig(JSON.stringify({ debugLogDir: ".pi/custom-logs" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.debugLogDir).toBe(".pi/custom-logs");
    expect(warnings).toHaveLength(0);
  });

  it("rejects specDir containing '..'", () => {
    writeConfig(JSON.stringify({ specDir: "../outside" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.specDir).toBe(DEFAULT_CONFIG.specDir);
    expect(warnings.some(w => w.includes("specDir") && w.includes(".."))).toBe(true);
  });

  it("rejects tddLogDir containing '..'", () => {
    writeConfig(JSON.stringify({ tddLogDir: "../outside" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.tddLogDir).toBe(DEFAULT_CONFIG.tddLogDir);
    expect(warnings.some(w => w.includes("tddLogDir") && w.includes(".."))).toBe(true);
  });

  it("rejects worktreeStateDir containing '..'", () => {
    writeConfig(JSON.stringify({ worktreeStateDir: "../outside" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.worktreeStateDir).toBe(DEFAULT_CONFIG.worktreeStateDir);
    expect(warnings.some(w => w.includes("worktreeStateDir") && w.includes(".."))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// New config fields
// ---------------------------------------------------------------------------

describe("loadConfig — new config fields", () => {
  it("defaults tddEnforcement to true", () => {
    const { config } = loadConfig(tmp);
    expect(config.tddEnforcement).toBe(true);
  });

  it("overrides tddEnforcement to false", () => {
    writeConfig(JSON.stringify({ tddEnforcement: false }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.tddEnforcement).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("falls back for non-boolean tddEnforcement", () => {
    writeConfig(JSON.stringify({ tddEnforcement: "yes" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.tddEnforcement).toBe(DEFAULT_CONFIG.tddEnforcement);
    expect(warnings.some(w => w.includes("tddEnforcement"))).toBe(true);
  });

  it("defaults testFilePatterns to standard patterns", () => {
    const { config } = loadConfig(tmp);
    expect(config.testFilePatterns).toEqual(DEFAULT_CONFIG.testFilePatterns);
    expect(config.testFilePatterns).toContain("*.test.*");
  });

  it("overrides testFilePatterns", () => {
    writeConfig(JSON.stringify({ testFilePatterns: ["*.test.ts"] }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.testFilePatterns).toEqual(["*.test.ts"]);
    expect(warnings).toHaveLength(0);
  });

  it("falls back for non-array testFilePatterns", () => {
    writeConfig(JSON.stringify({ testFilePatterns: "*.test.*" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.testFilePatterns).toEqual(DEFAULT_CONFIG.testFilePatterns);
    expect(warnings.some(w => w.includes("testFilePatterns"))).toBe(true);
  });

  it("falls back for testFilePatterns with non-string elements", () => {
    writeConfig(JSON.stringify({ testFilePatterns: [42, "*.test.*"] }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.testFilePatterns).toEqual(DEFAULT_CONFIG.testFilePatterns);
    expect(warnings.some(w => w.includes("testFilePatterns"))).toBe(true);
  });

  it("defaults brainstormEnabled to true", () => {
    const { config } = loadConfig(tmp);
    expect(config.brainstormEnabled).toBe(true);
  });

  it("overrides brainstormEnabled to false", () => {
    writeConfig(JSON.stringify({ brainstormEnabled: false }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.brainstormEnabled).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("defaults worktreeEnabled to true", () => {
    const { config } = loadConfig(tmp);
    expect(config.worktreeEnabled).toBe(true);
  });

  it("overrides worktreeEnabled to false", () => {
    writeConfig(JSON.stringify({ worktreeEnabled: false }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.worktreeEnabled).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("defaults specDir to .pi/specs", () => {
    const { config } = loadConfig(tmp);
    expect(config.specDir).toBe(".pi/specs");
  });

  it("overrides specDir", () => {
    writeConfig(JSON.stringify({ specDir: ".pi/custom-specs" }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.specDir).toBe(".pi/custom-specs");
    expect(warnings).toHaveLength(0);
  });

  it("falls back for empty specDir", () => {
    writeConfig(JSON.stringify({ specDir: "  " }));
    const { config, warnings } = loadConfig(tmp);
    expect(config.specDir).toBe(DEFAULT_CONFIG.specDir);
    expect(warnings.some(w => w.includes("specDir"))).toBe(true);
  });

  it("defaults tddLogDir to .pi/tdd", () => {
    const { config } = loadConfig(tmp);
    expect(config.tddLogDir).toBe(".pi/tdd");
  });

  it("defaults worktreeStateDir to .pi/worktrees", () => {
    const { config } = loadConfig(tmp);
    expect(config.worktreeStateDir).toBe(".pi/worktrees");
  });
});
