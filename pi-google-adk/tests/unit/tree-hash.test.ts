/**
 * Unit tests: tree hashing / normalisation.
 *
 * Behavior protected:
 * - Same tree produces same hash (determinism)
 * - Ignored files do not affect hash
 * - Different file contents produce different hash
 * - Different file paths produce different hash
 * - Empty directory produces deterministic empty hash
 * - Nested directories work correctly
 * - DEFAULT_IGNORE_BASENAMES and DEFAULT_IGNORE_EXTENSIONS are respected
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hashDirectoryTree,
  hashFileContent,
  DEFAULT_IGNORE_BASENAMES,
  DEFAULT_IGNORE_EXTENSIONS,
} from "../../src/lib/tree-hash.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tree-hash-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string) {
  const fullPath = join(tempDir, relPath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("hashDirectoryTree", () => {
  it("produces same hash for identical trees", () => {
    writeFile("a.txt", "hello");
    writeFile("b.txt", "world");
    const h1 = hashDirectoryTree(tempDir);

    // Create identical tree in another dir
    const tempDir2 = mkdtempSync(join(tmpdir(), "tree-hash-test2-"));
    try {
      const p2 = (r: string) => join(tempDir2, r);
      mkdirSync(tempDir2, { recursive: true });
      writeFileSync(join(tempDir2, "a.txt"), "hello", "utf-8");
      writeFileSync(join(tempDir2, "b.txt"), "world", "utf-8");
      const h2 = hashDirectoryTree(tempDir2);
      expect(h1.hash).toBe(h2.hash);
    } finally {
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });

  it("different file contents produce different hash", () => {
    writeFile("a.txt", "hello");
    const h1 = hashDirectoryTree(tempDir).hash;

    writeFileSync(join(tempDir, "a.txt"), "changed", "utf-8");
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).not.toBe(h2);
  });

  it("different file paths produce different hash", () => {
    writeFile("a.txt", "hello");
    const h1 = hashDirectoryTree(tempDir).hash;

    rmSync(join(tempDir, "a.txt"));
    writeFile("b.txt", "hello");
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).not.toBe(h2);
  });

  it("empty directory produces a deterministic hash", () => {
    const h1 = hashDirectoryTree(tempDir);
    const h2 = hashDirectoryTree(tempDir);
    expect(h1.hash).toBe(h2.hash);
    expect(h1.files).toHaveLength(0);
  });

  it("ignores .pi-adk-metadata.json by default", () => {
    writeFile("agent.py", "code");
    const h1 = hashDirectoryTree(tempDir).hash;

    writeFile(".pi-adk-metadata.json", '{"source_type":"official_sample"}');
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).toBe(h2);
  });

  it("ignores .git directory by default", () => {
    writeFile("agent.py", "code");
    const h1 = hashDirectoryTree(tempDir).hash;

    writeFile(".git/HEAD", "ref: refs/heads/main");
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).toBe(h2);
  });

  it("ignores .DS_Store by default", () => {
    writeFile("agent.py", "code");
    const h1 = hashDirectoryTree(tempDir).hash;

    writeFile(".DS_Store", "\x00\x00");
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).toBe(h2);
  });

  it("ignores __pycache__ by default", () => {
    writeFile("agent.py", "code");
    const h1 = hashDirectoryTree(tempDir).hash;

    writeFile("__pycache__/module.cpython-310.pyc", "\x00\x00");
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).toBe(h2);
  });

  it("ignores .pyc files by default", () => {
    writeFile("agent.py", "code");
    const h1 = hashDirectoryTree(tempDir).hash;

    writeFile("module.pyc", "\x00\x00");
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).toBe(h2);
  });

  it("ignores .adk-scaffold.json by default", () => {
    writeFile("agent.py", "code");
    const h1 = hashDirectoryTree(tempDir).hash;

    writeFile(".adk-scaffold.json", '{"name":"test"}');
    const h2 = hashDirectoryTree(tempDir).hash;

    expect(h1).toBe(h2);
  });

  it("handles nested directory trees", () => {
    writeFile("a/b/c.txt", "deep");
    writeFile("a/d.txt", "shallow");
    const result = hashDirectoryTree(tempDir);

    expect(result.files).toHaveLength(2);
    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain("a/b/c.txt");
    expect(paths).toContain("a/d.txt");
  });

  it("uses forward slashes in relative paths", () => {
    writeFile("sub/file.txt", "content");
    const result = hashDirectoryTree(tempDir);
    expect(result.files[0].relativePath).toBe("sub/file.txt");
  });

  it("respects custom ignore basenames", () => {
    writeFile("keep.txt", "keep");
    writeFile("skip.txt", "skip");
    const ignoreSet = new Set(["skip.txt"]);
    const result = hashDirectoryTree(tempDir, ignoreSet, new Set());
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe("keep.txt");
  });

  it("file entries include correct content hashes", () => {
    writeFile("test.txt", "test content");
    const result = hashDirectoryTree(tempDir);
    expect(result.files[0].contentHash).toBe(
      hashFileContent(join(tempDir, "test.txt")),
    );
  });
});

describe("hashFileContent", () => {
  it("produces deterministic hash", () => {
    const path = join(tempDir, "file.txt");
    writeFileSync(path, "hello world", "utf-8");
    const h1 = hashFileContent(path);
    const h2 = hashFileContent(path);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("DEFAULT_IGNORE_BASENAMES", () => {
  it("contains expected entries", () => {
    expect(DEFAULT_IGNORE_BASENAMES.has(".pi-adk-metadata.json")).toBe(true);
    expect(DEFAULT_IGNORE_BASENAMES.has(".git")).toBe(true);
    expect(DEFAULT_IGNORE_BASENAMES.has(".DS_Store")).toBe(true);
    expect(DEFAULT_IGNORE_BASENAMES.has("__pycache__")).toBe(true);
    expect(DEFAULT_IGNORE_BASENAMES.has(".adk-scaffold.json")).toBe(true);
  });
});

describe("DEFAULT_IGNORE_EXTENSIONS", () => {
  it("contains .pyc", () => {
    expect(DEFAULT_IGNORE_EXTENSIONS.has(".pyc")).toBe(true);
  });
});
