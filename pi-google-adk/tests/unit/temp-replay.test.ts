/**
 * Unit tests: temp-replay.
 *
 * Behavior protected:
 * - createTempReplay creates a JSON file with ADK InputFile schema
 * - buildReplayPayload produces correct structure
 * - cleanupTempReplay removes the file and directory
 * - cleanupTempReplay is safe to call on missing files
 */

import { describe, it, expect } from "vitest";
import {
  createTempReplay,
  cleanupTempReplay,
  buildReplayPayload,
  type AdkReplayPayload,
} from "../../src/lib/temp-replay.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

describe("buildReplayPayload", () => {
  it("returns an object with state and queries", () => {
    const payload = buildReplayPayload("Say hello");
    expect(payload).toEqual({
      state: {},
      queries: ["Say hello"],
    });
  });

  it("preserves the full prompt string in queries[0]", () => {
    const prompt = "Research the latest advances in quantum computing";
    const payload = buildReplayPayload(prompt);
    expect(payload.queries).toHaveLength(1);
    expect(payload.queries[0]).toBe(prompt);
  });

  it("handles multiline prompts as a single query", () => {
    const payload = buildReplayPayload("Line 1\nLine 2\nLine 3");
    expect(payload.queries).toHaveLength(1);
    expect(payload.queries[0]).toBe("Line 1\nLine 2\nLine 3");
  });

  it("state is an empty object", () => {
    const payload = buildReplayPayload("anything");
    expect(payload.state).toEqual({});
    expect(Object.keys(payload.state)).toHaveLength(0);
  });
});

describe("createTempReplay", () => {
  it("creates a JSON file matching ADK InputFile schema", () => {
    const path = createTempReplay("Hello agent");
    try {
      expect(existsSync(path)).toBe(true);
      expect(path.endsWith(".json")).toBe(true);
      const content = readFileSync(path, "utf-8");
      const parsed: AdkReplayPayload = JSON.parse(content);
      expect(parsed.state).toEqual({});
      expect(parsed.queries).toEqual(["Hello agent"]);
    } finally {
      cleanupTempReplay(path);
    }
  });

  it("produces valid JSON", () => {
    const path = createTempReplay('Prompt with "quotes" and special chars: <>&');
    try {
      const content = readFileSync(path, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
      const parsed = JSON.parse(content);
      expect(parsed.queries[0]).toBe('Prompt with "quotes" and special chars: <>&');
    } finally {
      cleanupTempReplay(path);
    }
  });
});

describe("cleanupTempReplay", () => {
  it("removes file and directory", () => {
    const path = createTempReplay("test");
    const dir = dirname(path);
    expect(existsSync(path)).toBe(true);
    cleanupTempReplay(path);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  it("does not throw on missing file", () => {
    expect(() => cleanupTempReplay("/tmp/nonexistent-pi-adk-replay/replay.json")).not.toThrow();
  });
});
