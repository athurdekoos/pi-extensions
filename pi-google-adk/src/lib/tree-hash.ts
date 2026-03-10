/**
 * Deterministic directory-tree hashing for drift comparison.
 *
 * Walks a directory recursively, normalises relative paths, hashes
 * each file's content, then combines everything into a single
 * deterministic tree hash.
 *
 * Ignore rules:
 * - .pi-adk-metadata.json   (Pi-owned metadata — would always cause false drift)
 * - .git/                   (version-control internals)
 * - .DS_Store               (macOS junk)
 * - __pycache__/            (Python bytecode cache)
 * - *.pyc                   (compiled Python)
 * - .adk-scaffold.json      (legacy Pi manifest)
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Default ignore list
// ---------------------------------------------------------------------------

/** Files/dirs to exclude from tree hashing (basename match). */
export const DEFAULT_IGNORE_BASENAMES = new Set([
  ".pi-adk-metadata.json",
  ".adk-scaffold.json",
  ".git",
  ".DS_Store",
  "__pycache__",
  "Thumbs.db",
]);

/** File extensions to exclude. */
export const DEFAULT_IGNORE_EXTENSIONS = new Set([".pyc"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEntry {
  /** Normalised relative path (forward slashes). */
  relativePath: string;
  /** SHA-256 hex digest of file content. */
  contentHash: string;
}

export interface TreeHashResult {
  /** SHA-256 hex digest of the combined tree. */
  hash: string;
  /** Sorted file entries that contributed to the hash. */
  files: FileEntry[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic hash of a directory tree.
 *
 * The hash is derived from:
 *  - the sorted list of normalised relative file paths
 *  - the SHA-256 of each file's content
 *
 * Two trees with identical file paths and identical file contents
 * will always produce the same hash regardless of platform.
 *
 * @param root  Absolute path to the directory to hash.
 * @param ignoreBasenames  Set of basenames to skip (default: DEFAULT_IGNORE_BASENAMES).
 * @param ignoreExtensions  Set of extensions to skip (default: DEFAULT_IGNORE_EXTENSIONS).
 */
export function hashDirectoryTree(
  root: string,
  ignoreBasenames: Set<string> = DEFAULT_IGNORE_BASENAMES,
  ignoreExtensions: Set<string> = DEFAULT_IGNORE_EXTENSIONS,
): TreeHashResult {
  const files: FileEntry[] = [];
  walkDir(root, root, ignoreBasenames, ignoreExtensions, files);

  // Sort by relative path for determinism
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // Combine into a single tree hash
  const treeHasher = createHash("sha256");
  for (const f of files) {
    treeHasher.update(f.relativePath);
    treeHasher.update("\0");
    treeHasher.update(f.contentHash);
    treeHasher.update("\0");
  }

  return {
    hash: treeHasher.digest("hex"),
    files,
  };
}

/**
 * Compute a content-hash for a single file.
 */
export function hashFileContent(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function walkDir(
  currentDir: string,
  root: string,
  ignoreBasenames: Set<string>,
  ignoreExtensions: Set<string>,
  out: FileEntry[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignoreBasenames.has(entry)) continue;

    // Extension check
    const dotIdx = entry.lastIndexOf(".");
    if (dotIdx >= 0) {
      const ext = entry.slice(dotIdx);
      if (ignoreExtensions.has(ext)) continue;
    }

    const fullPath = join(currentDir, entry);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(fullPath, root, ignoreBasenames, ignoreExtensions, out);
    } else if (stat.isFile()) {
      const relPath = relative(root, fullPath).replace(/\\/g, "/");
      const contentHash = hashFileContent(fullPath);
      out.push({ relativePath: relPath, contentHash });
    }
  }
}
