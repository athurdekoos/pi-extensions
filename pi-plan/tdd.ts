/**
 * tdd.ts — TDD enforcement module.
 *
 * Owns: Test-file pattern matching, per-step gate decision, TDD compliance logging.
 * Does NOT own: Pi API calls, hook wiring, config loading.
 *
 * Invariants:
 *   - evaluateTddGate() is a pure function — deterministic, no side effects.
 *   - isTestFile() uses simple glob-to-regex conversion (no external deps).
 *   - Compliance logs are append-only under .pi/tdd/.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Gate decision types
// ---------------------------------------------------------------------------

export interface TddGateDecision {
  action: "allow-test" | "allow-prod" | "allow-pi" | "block";
  reason?: string;
}

// ---------------------------------------------------------------------------
// Glob-to-regex conversion (simple, no external deps)
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern to a regex.
 *
 * Supports:
 *   - `*` → matches any characters except `/`
 *   - `**` → matches any characters including `/`
 *   - `.` → literal dot
 *
 * Examples:
 *   - "*.test.*" → /^[^/]*\.test\.[^/]*$/
 *   - "__tests__/**" → /^__tests__\/.*$/
 *   - "test/**" → /^test\/.*$/
 */
export function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches anything including path separators
        regex += ".*";
        i += 2;
        // Skip trailing slash after **
        if (pattern[i] === "/") i++;
      } else {
        // * matches anything except path separators
        regex += "[^/]*";
        i++;
      }
    } else if (char === ".") {
      regex += "\\.";
      i++;
    } else if (char === "?") {
      regex += "[^/]";
      i++;
    } else if ("{([+^$|\\".includes(char)) {
      regex += "\\" + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

// ---------------------------------------------------------------------------
// Test file detection
// ---------------------------------------------------------------------------

/**
 * Check whether a file path matches any of the test file patterns.
 *
 * The filePath is made relative to repoRoot before matching.
 * Patterns are matched against the relative path.
 */
export function isTestFile(
  filePath: string,
  patterns: string[],
  repoRoot: string,
): boolean {
  const rel = isAbsolute(filePath)
    ? relative(repoRoot, filePath)
    : filePath;

  // Normalize to forward slashes
  const normalized = rel.replace(/\\/g, "/");

  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    // Match against full relative path
    if (regex.test(normalized)) return true;
    // Also match against just the filename (for patterns like "*.test.*")
    const filename = normalized.split("/").pop() || "";
    if (regex.test(filename)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// TDD gate evaluation (pure function)
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a write operation should be allowed under TDD enforcement.
 *
 * Gate logic (deterministic):
 *   1. Target under `.pi/` → allow-pi (planning files exempt)
 *   2. Target matches test pattern → allow-test
 *   3. Target is non-test AND testWrittenThisStep === true → allow-prod
 *   4. Target is non-test AND testWrittenThisStep === false → block
 */
export function evaluateTddGate(
  targetPath: string,
  testWrittenThisStep: boolean,
  testFilePatterns: string[],
  repoRoot: string,
): TddGateDecision {
  const rel = isAbsolute(targetPath)
    ? relative(repoRoot, targetPath)
    : targetPath;
  const normalized = rel.replace(/\\/g, "/");

  // 1. Planning files always allowed
  if (normalized.startsWith(".pi/") || normalized === ".pi") {
    return { action: "allow-pi" };
  }

  // 2. Test files always allowed
  if (isTestFile(targetPath, testFilePatterns, repoRoot)) {
    return { action: "allow-test" };
  }

  // 3. Non-test file: check if test was written this step
  if (testWrittenThisStep) {
    return { action: "allow-prod" };
  }

  // 4. Block: no test written yet
  return {
    action: "block",
    reason:
      "TDD: Write a failing test before production code. No test file modified this step.",
  };
}

// ---------------------------------------------------------------------------
// Step completion validation
// ---------------------------------------------------------------------------

/**
 * Validate a [DONE:n] claim — returns false if TDD was not satisfied for this step.
 */
export function validateStepCompletion(testWrittenThisStep: boolean): boolean {
  return testWrittenThisStep;
}

// ---------------------------------------------------------------------------
// Compliance logging
// ---------------------------------------------------------------------------

export interface TddComplianceEntry {
  stepNumber: number;
  compliant: boolean;
  timestamp: string;
}

/**
 * Write a compliance entry to .pi/tdd/.
 *
 * Creates or appends to a daily compliance log file.
 * Log files are named compliance-YYYY-MM-DD.json and contain an array of entries.
 */
export function logTddCompliance(
  repoRoot: string,
  stepNumber: number,
  compliant: boolean,
  logDir: string,
): void {
  const dir = join(repoRoot, logDir);
  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const filename = `compliance-${dateStr}.json`;
  const abs = join(dir, filename);

  const entry: TddComplianceEntry = {
    stepNumber,
    compliant,
    timestamp: now.toISOString(),
  };

  let entries: TddComplianceEntry[] = [];
  if (existsSync(abs)) {
    try {
      entries = JSON.parse(readFileSync(abs, "utf-8"));
    } catch {
      entries = [];
    }
  }

  entries.push(entry);
  writeFileSync(abs, JSON.stringify(entries, null, 2), "utf-8");
}
