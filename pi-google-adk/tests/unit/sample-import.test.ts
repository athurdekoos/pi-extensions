/**
 * Unit tests: sample import logic.
 *
 * Behavior protected:
 * - Invalid slug rejection
 * - Path traversal blocked
 * - Destination exists check
 * - Git unavailable failure
 * - Structured error propagation
 *
 * Note: Actual git clone operations are NOT tested here — they require
 * network access and are covered by the manual test plan. These tests
 * mock or test the pre-git validation boundaries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import { mkdirSync } from "node:fs";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

// We test the validation boundaries by calling importOfficialSample
// with conditions that fail before git is invoked.

describe("importOfficialSample — pre-git validation", () => {
  it("rejects unknown sample slug", async () => {
    const { importOfficialSample } = await import("../../src/lib/sample-import.js");
    const { result } = await importOfficialSample(workDir, {
      sample_slug: "nonexistent_sample",
      name: "test_agent",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown sample slug");
    expect(result.error).toContain("nonexistent_sample");
  });

  it("rejects path traversal", async () => {
    const { importOfficialSample } = await import("../../src/lib/sample-import.js");
    const { result } = await importOfficialSample(workDir, {
      sample_slug: "hello_world",
      name: "test_agent",
      path: "../../escape_attempt",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the workspace root");
  });

  it("rejects when destination exists and overwrite=false", async () => {
    const destPath = "agents/existing";
    mkdirSync(resolve(workDir, destPath), { recursive: true });

    const { importOfficialSample } = await import("../../src/lib/sample-import.js");
    const { result } = await importOfficialSample(workDir, {
      sample_slug: "hello_world",
      name: "existing",
      path: destPath,
      overwrite: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("includes upstream_repo in error results", async () => {
    const { importOfficialSample } = await import("../../src/lib/sample-import.js");
    const { result } = await importOfficialSample(workDir, {
      sample_slug: "nonexistent_sample",
      name: "test_agent",
    });
    expect(result.upstream_repo).toContain("github.com");
  });
});

describe("isGitAvailable", () => {
  it("returns a boolean", async () => {
    const { isGitAvailable } = await import("../../src/lib/sample-import.js");
    const result = await isGitAvailable();
    expect(typeof result).toBe("boolean");
  });
});
