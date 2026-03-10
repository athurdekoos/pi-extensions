/**
 * Temp directory helper for tests that need filesystem isolation.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createTempDir(prefix = "pi-adk-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
