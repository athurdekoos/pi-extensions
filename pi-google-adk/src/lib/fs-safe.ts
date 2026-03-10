/**
 * Safe filesystem operations with path traversal prevention.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, normalize, join } from "node:path";

export interface WriteResult {
  path: string;
  created: boolean;
  skipped: boolean;
  reason?: string;
}

/**
 * Resolve a path and verify it stays within the allowed root.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(root, normalize(target));
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith("..")) {
    throw new Error(`Path traversal blocked: "${target}" escapes root "${root}"`);
  }
  return resolvedTarget;
}

/**
 * Write a file safely within the given root directory.
 * Returns metadata about the write operation.
 */
export function safeWriteFile(
  root: string,
  filePath: string,
  content: string,
  overwrite: boolean
): WriteResult {
  const absPath = safePath(root, filePath);
  const relPath = relative(resolve(root), absPath);

  if (existsSync(absPath) && !overwrite) {
    return { path: relPath, created: false, skipped: true, reason: "already exists" };
  }

  const dir = resolve(absPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(absPath, content, "utf-8");
  return { path: relPath, created: true, skipped: false };
}

/**
 * Create a directory safely within the given root.
 */
export function safeEnsureDir(root: string, dirPath: string): string {
  const absPath = safePath(root, dirPath);
  if (!existsSync(absPath)) {
    mkdirSync(absPath, { recursive: true });
  }
  return absPath;
}

/**
 * Read a file safely within the given root. Returns null if not found.
 */
export function safeReadFile(root: string, filePath: string): string | null {
  const absPath = safePath(root, filePath);
  if (!existsSync(absPath)) return null;
  return readFileSync(absPath, "utf-8");
}

/**
 * Check if a path exists within the given root.
 */
export function safeExists(root: string, filePath: string): boolean {
  const absPath = safePath(root, filePath);
  return existsSync(absPath);
}
