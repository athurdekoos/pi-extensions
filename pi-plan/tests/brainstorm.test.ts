/**
 * Tests for brainstorm.ts — Brainstorming/design spec module.
 *
 * What these tests prove:
 *   - generateSpecFilename produces YYYY-MM-DD-HHMM-slug.md format
 *   - writeSpec creates specs under the configured directory
 *   - readSpec reads spec content by relative path
 *   - listSpecs lists specs newest-first with title extraction
 *   - Slug derivation handles edge cases (special chars, empty titles)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateSpecFilename,
  writeSpec,
  readSpec,
  listSpecs,
} from "../brainstorm.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-brainstorm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// generateSpecFilename
// ---------------------------------------------------------------------------

describe("generateSpecFilename", () => {
  it("produces YYYY-MM-DD-HHMM-slug.md format", () => {
    const date = new Date(2026, 2, 15, 14, 30); // March 15, 2026, 14:30
    const filename = generateSpecFilename("Auth Flow Design", date);
    expect(filename).toBe("2026-03-15-1430-auth-flow-design.md");
  });

  it("handles special characters in title", () => {
    const date = new Date(2026, 0, 1, 9, 5);
    const filename = generateSpecFilename("API v2.0 — Breaking Changes!", date);
    expect(filename).toMatch(/^2026-01-01-0905-api-v2-0-breaking-changes\.md$/);
  });

  it("handles empty title", () => {
    const date = new Date(2026, 5, 20, 0, 0);
    const filename = generateSpecFilename("", date);
    expect(filename).toBe("2026-06-20-0000-spec.md");
  });

  it("truncates long titles in slug", () => {
    const longTitle = "A".repeat(100);
    const date = new Date(2026, 0, 1, 0, 0);
    const filename = generateSpecFilename(longTitle, date);
    // Slug is max 40 chars
    expect(filename.length).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// writeSpec
// ---------------------------------------------------------------------------

describe("writeSpec", () => {
  it("creates spec file under spec directory", () => {
    const date = new Date(2026, 2, 15, 14, 30);
    const relPath = writeSpec(tmp, "# Spec: Test\n\nContent here.", "Test", ".pi/specs", date);
    expect(relPath).toBe(".pi/specs/2026-03-15-1430-test.md");
    expect(existsSync(join(tmp, relPath))).toBe(true);
  });

  it("creates spec directory if it doesn't exist", () => {
    const date = new Date(2026, 2, 15, 14, 30);
    writeSpec(tmp, "Content", "My Spec", ".pi/specs", date);
    expect(existsSync(join(tmp, ".pi/specs"))).toBe(true);
  });

  it("handles filename collisions", () => {
    const date = new Date(2026, 2, 15, 14, 30);
    const path1 = writeSpec(tmp, "Content 1", "Dup", ".pi/specs", date);
    const path2 = writeSpec(tmp, "Content 2", "Dup", ".pi/specs", date);
    expect(path1).not.toBe(path2);
    expect(existsSync(join(tmp, path1))).toBe(true);
    expect(existsSync(join(tmp, path2))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readSpec
// ---------------------------------------------------------------------------

describe("readSpec", () => {
  it("reads existing spec content", () => {
    mkdirSync(join(tmp, ".pi/specs"), { recursive: true });
    writeFileSync(join(tmp, ".pi/specs/test.md"), "# Spec: Test\n\nHello", "utf-8");
    const content = readSpec(tmp, ".pi/specs/test.md");
    expect(content).toBe("# Spec: Test\n\nHello");
  });

  it("returns null for missing spec", () => {
    expect(readSpec(tmp, ".pi/specs/nonexistent.md")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listSpecs
// ---------------------------------------------------------------------------

describe("listSpecs", () => {
  it("returns empty array when no specs directory", () => {
    expect(listSpecs(tmp, ".pi/specs")).toEqual([]);
  });

  it("lists specs newest-first", () => {
    mkdirSync(join(tmp, ".pi/specs"), { recursive: true });
    writeFileSync(join(tmp, ".pi/specs/2026-03-14-1000-first.md"), "# Spec: First\n\nOlder", "utf-8");
    writeFileSync(join(tmp, ".pi/specs/2026-03-15-1430-second.md"), "# Spec: Second\n\nNewer", "utf-8");

    const specs = listSpecs(tmp, ".pi/specs");
    expect(specs).toHaveLength(2);
    expect(specs[0].title).toBe("Second");
    expect(specs[1].title).toBe("First");
  });

  it("extracts title from H1 heading", () => {
    mkdirSync(join(tmp, ".pi/specs"), { recursive: true });
    writeFileSync(join(tmp, ".pi/specs/2026-03-15-1430-test.md"), "# Spec: My Great Design\n\nContent", "utf-8");

    const specs = listSpecs(tmp, ".pi/specs");
    expect(specs[0].title).toBe("My Great Design");
  });

  it("extracts date from filename", () => {
    mkdirSync(join(tmp, ".pi/specs"), { recursive: true });
    writeFileSync(join(tmp, ".pi/specs/2026-03-15-1430-test.md"), "# Spec: Test\n", "utf-8");

    const specs = listSpecs(tmp, ".pi/specs");
    expect(specs[0].date).toBe("2026-03-15");
  });

  it("falls back to filename as title", () => {
    mkdirSync(join(tmp, ".pi/specs"), { recursive: true });
    writeFileSync(join(tmp, ".pi/specs/2026-03-15-1430-test.md"), "No heading here\n", "utf-8");

    const specs = listSpecs(tmp, ".pi/specs");
    expect(specs[0].title).toBe("2026-03-15-1430-test");
  });
});
