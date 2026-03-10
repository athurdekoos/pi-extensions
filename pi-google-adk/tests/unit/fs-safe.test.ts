/**
 * Unit tests: fs-safe.
 *
 * Behavior protected:
 * - Path traversal prevention (safePath blocks .., absolute escapes)
 * - safeWriteFile creates files, respects overwrite flag
 * - safeReadFile returns null for missing files
 * - safeExists returns correct boolean
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { safePath, safeWriteFile, safeReadFile, safeExists } from "../../src/lib/fs-safe.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

describe("safePath", () => {
  it("resolves a valid relative path inside root", () => {
    const result = safePath(workDir, "sub/dir/file.txt");
    expect(result.startsWith(workDir)).toBe(true);
  });

  it("throws on .. traversal", () => {
    expect(() => safePath(workDir, "../escape")).toThrow("Path traversal blocked");
  });

  it("throws on absolute path outside root", () => {
    expect(() => safePath(workDir, "/etc/passwd")).toThrow("Path traversal blocked");
  });

  it("throws on nested traversal", () => {
    expect(() => safePath(workDir, "a/b/../../../../../../etc/shadow")).toThrow("Path traversal blocked");
  });

  it("allows path that resolves within root even with redundant separators", () => {
    const result = safePath(workDir, "a//b/./c");
    expect(result.startsWith(workDir)).toBe(true);
  });
});

describe("safeWriteFile", () => {
  it("creates a new file and returns created=true", () => {
    const result = safeWriteFile(workDir, "new.txt", "hello", false);
    expect(result.created).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it("skips existing file when overwrite=false", () => {
    safeWriteFile(workDir, "exist.txt", "first", false);
    const result = safeWriteFile(workDir, "exist.txt", "second", false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("already exists");
    // Content should still be first write
    expect(safeReadFile(workDir, "exist.txt")).toBe("first");
  });

  it("overwrites existing file when overwrite=true", () => {
    safeWriteFile(workDir, "exist.txt", "first", false);
    const result = safeWriteFile(workDir, "exist.txt", "second", true);
    expect(result.created).toBe(true);
    expect(safeReadFile(workDir, "exist.txt")).toBe("second");
  });

  it("creates nested directories automatically", () => {
    safeWriteFile(workDir, "a/b/c/deep.txt", "deep", false);
    expect(safeReadFile(workDir, "a/b/c/deep.txt")).toBe("deep");
  });

  it("throws on path traversal", () => {
    expect(() => safeWriteFile(workDir, "../escape.txt", "bad", false)).toThrow();
  });
});

describe("safeReadFile", () => {
  it("returns null for non-existent file", () => {
    expect(safeReadFile(workDir, "missing.txt")).toBeNull();
  });

  it("reads existing file content", () => {
    safeWriteFile(workDir, "readable.txt", "content", false);
    expect(safeReadFile(workDir, "readable.txt")).toBe("content");
  });
});

describe("safeExists", () => {
  it("returns false for missing path", () => {
    expect(safeExists(workDir, "nope")).toBe(false);
  });

  it("returns true for existing path", () => {
    safeWriteFile(workDir, "yes.txt", "x", false);
    expect(safeExists(workDir, "yes.txt")).toBe(true);
  });
});
