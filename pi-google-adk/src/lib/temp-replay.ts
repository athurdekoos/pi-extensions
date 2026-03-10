/**
 * Temp replay file management for `adk run --replay`.
 *
 * Creates a temporary JSON file matching the ADK CLI InputFile schema:
 *   { "state": {}, "queries": ["<prompt>"] }
 *
 * See: google.adk.cli.cli.InputFile (Pydantic model)
 */

import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

/**
 * The ADK replay payload shape, matching the InputFile Pydantic model
 * in google.adk.cli.cli.
 */
export interface AdkReplayPayload {
  state: Record<string, unknown>;
  queries: string[];
}

/**
 * Build the replay payload for a given prompt.
 * Exported for testing.
 */
export function buildReplayPayload(prompt: string): AdkReplayPayload {
  return {
    state: {},
    queries: [prompt],
  };
}

/**
 * Create a temporary replay JSON file with the given prompt.
 *
 * The file matches the ADK CLI `--replay` contract:
 *   { "state": {}, "queries": ["<prompt>"] }
 *
 * Returns the absolute path to the temp file.
 */
export function createTempReplay(prompt: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-adk-replay-"));
  const filePath = join(dir, "replay.json");
  const payload = buildReplayPayload(prompt);
  writeFileSync(filePath, JSON.stringify(payload), "utf-8");
  return filePath;
}

/**
 * Clean up a temp replay file and its parent temp directory.
 */
export function cleanupTempReplay(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Already removed or never created
  }
  // Try to remove the parent temp dir
  try {
    rmdirSync(dirname(filePath));
  } catch {
    // Not empty or already removed
  }
}
