/**
 * Tests for tdd.ts — TDD enforcement module.
 *
 * What these tests prove:
 *   - globToRegex correctly converts simple glob patterns to regexes
 *   - isTestFile matches test files against configurable patterns
 *   - evaluateTddGate returns correct gate decisions for all scenarios
 *   - validateStepCompletion checks test-written flag
 *   - logTddCompliance writes daily compliance entries
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  globToRegex,
  isTestFile,
  evaluateTddGate,
  validateStepCompletion,
  logTddCompliance,
} from "../tdd.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-tdd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// globToRegex
// ---------------------------------------------------------------------------

describe("globToRegex", () => {
  it("converts *.test.* to match test files", () => {
    const re = globToRegex("*.test.*");
    expect(re.test("foo.test.ts")).toBe(true);
    expect(re.test("bar.test.js")).toBe(true);
    expect(re.test("foo.ts")).toBe(false);
  });

  it("converts *.spec.* to match spec files", () => {
    const re = globToRegex("*.spec.*");
    expect(re.test("foo.spec.ts")).toBe(true);
    expect(re.test("foo.ts")).toBe(false);
  });

  it("converts __tests__/** to match test directories", () => {
    const re = globToRegex("__tests__/**");
    expect(re.test("__tests__/foo.ts")).toBe(true);
    expect(re.test("__tests__/sub/bar.ts")).toBe(true);
    expect(re.test("src/foo.ts")).toBe(false);
  });

  it("converts test/** to match test directory", () => {
    const re = globToRegex("test/**");
    expect(re.test("test/unit.ts")).toBe(true);
    expect(re.test("test/sub/deep.ts")).toBe(true);
    expect(re.test("src/test.ts")).toBe(false);
  });

  it("converts tests/** to match tests directory", () => {
    const re = globToRegex("tests/**");
    expect(re.test("tests/unit.ts")).toBe(true);
    expect(re.test("src/tests.ts")).toBe(false);
  });

  it("escapes dots in patterns", () => {
    const re = globToRegex("*.test.ts");
    expect(re.test("foo.test.ts")).toBe(true);
    expect(re.test("footestXts")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe("isTestFile", () => {
  const defaultPatterns = ["*.test.*", "*.spec.*", "__tests__/**", "test/**", "tests/**"];

  it("matches .test. files", () => {
    expect(isTestFile("src/foo.test.ts", defaultPatterns, "/repo")).toBe(true);
  });

  it("matches .spec. files", () => {
    expect(isTestFile("src/bar.spec.js", defaultPatterns, "/repo")).toBe(true);
  });

  it("matches __tests__ directory files", () => {
    expect(isTestFile("__tests__/foo.ts", defaultPatterns, "/repo")).toBe(true);
  });

  it("matches tests/ directory files", () => {
    expect(isTestFile("tests/unit.ts", defaultPatterns, "/repo")).toBe(true);
  });

  it("does not match production files", () => {
    expect(isTestFile("src/main.ts", defaultPatterns, "/repo")).toBe(false);
  });

  it("handles absolute paths", () => {
    expect(isTestFile("/repo/src/foo.test.ts", defaultPatterns, "/repo")).toBe(true);
    expect(isTestFile("/repo/src/main.ts", defaultPatterns, "/repo")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateTddGate
// ---------------------------------------------------------------------------

describe("evaluateTddGate", () => {
  const patterns = ["*.test.*", "*.spec.*", "__tests__/**", "test/**", "tests/**"];

  it("allows .pi/ files always", () => {
    const result = evaluateTddGate(".pi/plans/current.md", false, patterns, "/repo");
    expect(result.action).toBe("allow-pi");
  });

  it("allows test files and returns allow-test", () => {
    const result = evaluateTddGate("src/foo.test.ts", false, patterns, "/repo");
    expect(result.action).toBe("allow-test");
  });

  it("allows prod files when test was written", () => {
    const result = evaluateTddGate("src/main.ts", true, patterns, "/repo");
    expect(result.action).toBe("allow-prod");
  });

  it("blocks prod files when no test was written", () => {
    const result = evaluateTddGate("src/main.ts", false, patterns, "/repo");
    expect(result.action).toBe("block");
    expect(result.reason).toContain("TDD");
    expect(result.reason).toContain("test");
  });

  it("always allows .pi/ files regardless of test state", () => {
    const result = evaluateTddGate(".pi/tdd/compliance.json", false, patterns, "/repo");
    expect(result.action).toBe("allow-pi");
  });

  it("handles absolute paths under .pi/", () => {
    const result = evaluateTddGate("/repo/.pi/specs/draft.md", false, patterns, "/repo");
    expect(result.action).toBe("allow-pi");
  });
});

// ---------------------------------------------------------------------------
// validateStepCompletion
// ---------------------------------------------------------------------------

describe("validateStepCompletion", () => {
  it("returns true when test was written", () => {
    expect(validateStepCompletion(true)).toBe(true);
  });

  it("returns false when no test was written", () => {
    expect(validateStepCompletion(false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logTddCompliance
// ---------------------------------------------------------------------------

describe("logTddCompliance", () => {
  it("creates compliance log file", () => {
    logTddCompliance(tmp, 1, true, ".pi/tdd");
    const tddDir = join(tmp, ".pi/tdd");
    expect(existsSync(tddDir)).toBe(true);

    const files = require("node:fs").readdirSync(tddDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^compliance-\d{4}-\d{2}-\d{2}\.json$/);

    const entries = JSON.parse(readFileSync(join(tddDir, files[0]), "utf-8"));
    expect(entries).toHaveLength(1);
    expect(entries[0].stepNumber).toBe(1);
    expect(entries[0].compliant).toBe(true);
  });

  it("appends to existing compliance log", () => {
    logTddCompliance(tmp, 1, true, ".pi/tdd");
    logTddCompliance(tmp, 2, false, ".pi/tdd");

    const tddDir = join(tmp, ".pi/tdd");
    const files = require("node:fs").readdirSync(tddDir);
    const entries = JSON.parse(readFileSync(join(tddDir, files[0]), "utf-8"));
    expect(entries).toHaveLength(2);
    expect(entries[0].stepNumber).toBe(1);
    expect(entries[1].stepNumber).toBe(2);
    expect(entries[1].compliant).toBe(false);
  });
});
