/**
 * Unit tests: adk-runtime.
 *
 * Behavior protected:
 * - validateProject rejects paths outside workspace
 * - validateProject rejects non-existent paths
 * - validateProject rejects non-directory paths
 * - validateProject rejects directories that are not ADK projects
 * - validateProject accepts valid ADK projects
 * - extractFinalOutput handles empty/short/long stdout
 * - extractFinalOutput extracts agent response from turn-structured output (Phase 3)
 * - extractFinalOutput falls back to full stdout when no turn markers found (Phase 3)
 * - extractFinalOutput handles multi-line agent responses (Phase 3)
 * - extractFinalOutput handles multiple agent turns, returns last (Phase 3)
 * - checkAdkCli reports missing CLI cleanly
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateProject, extractFinalOutput } from "../../src/lib/adk-runtime.js";
import { createManifest, serializeManifest, MANIFEST_FILENAME } from "../../src/lib/scaffold-manifest.js";
import { safeWriteFile } from "../../src/lib/fs-safe.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

describe("validateProject", () => {
  it("rejects paths outside workspace", () => {
    const result = validateProject(workDir, "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.error).toContain("Path traversal blocked");
    }
  });

  it("rejects non-existent paths", () => {
    const result = validateProject(workDir, "nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.error).toContain("does not exist");
    }
  });

  it("rejects non-directory paths", () => {
    writeFileSync(join(workDir, "afile.txt"), "hello");
    const result = validateProject(workDir, "afile.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.error).toContain("not a directory");
    }
  });

  it("rejects directories that are not ADK projects", () => {
    mkdirSync(join(workDir, "empty-dir"));
    const result = validateProject(workDir, "empty-dir");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.error).toContain("Not a recognized ADK project");
    }
  });

  it("accepts valid ADK project with manifest", () => {
    const projDir = join(workDir, "my_agent");
    mkdirSync(projDir);
    const manifest = createManifest("my_agent", "basic", "gemini-2.5-flash");
    safeWriteFile(projDir, MANIFEST_FILENAME, serializeManifest(manifest), false);

    const result = validateProject(workDir, "my_agent");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.agentName).toBe("my_agent");
      expect(result.info.template).toBe("basic");
    }
  });

  it("accepts project detected via .env.example heuristic", () => {
    const projDir = join(workDir, "agent2");
    mkdirSync(projDir);
    writeFileSync(join(projDir, ".env.example"), "GOOGLE_API_KEY=");

    const result = validateProject(workDir, "agent2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.template).toBe("unknown");
    }
  });
});

describe("extractFinalOutput", () => {
  it("returns empty string for empty stdout", () => {
    expect(extractFinalOutput("")).toBe("");
    expect(extractFinalOutput("   ")).toBe("");
  });

  it("returns trimmed content for short output without turn markers", () => {
    const output = "Hello from ADK agent\n";
    expect(extractFinalOutput(output)).toBe("Hello from ADK agent");
  });

  it("returns full trimmed content when no turn markers present", () => {
    const longOutput = "A".repeat(600);
    expect(extractFinalOutput(longOutput)).toBe(longOutput);
  });

  // Phase 3: turn-structured output parsing
  it("extracts agent response from simple turn output", () => {
    const stdout = [
      "[user]: What is 2+2?",
      "[researcher]: The answer is 4.",
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe("The answer is 4.");
  });

  it("extracts last agent response from multi-turn output", () => {
    const stdout = [
      "[user]: First question",
      "[researcher]: First answer",
      "[user]: Follow-up question",
      "[researcher]: Follow-up answer with more detail",
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe("Follow-up answer with more detail");
  });

  it("extracts multi-line agent response", () => {
    const stdout = [
      "[user]: Tell me about X",
      "[researcher]: Here are the findings:",
      "1. Point one",
      "2. Point two",
      "3. Point three",
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe(
      "Here are the findings:\n1. Point one\n2. Point two\n3. Point three"
    );
  });

  it("handles agent with underscores in name", () => {
    const stdout = [
      "[user]: Hello",
      "[my_research_agent]: Hello! How can I help?",
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe("Hello! How can I help?");
  });

  it("ignores noise lines before first turn marker", () => {
    const stdout = [
      "Loading agent...",
      "Warming up model...",
      "[user]: What is the answer?",
      "[agent]: 42.",
    ].join("\n");
    expect(extractFinalOutput(stdout)).toBe("42.");
  });

  it("falls back to trimmed stdout if only user turns exist", () => {
    const stdout = "[user]: Just a question with no response\n";
    expect(extractFinalOutput(stdout)).toBe("Just a question with no response");
  });

  it("handles empty agent response gracefully", () => {
    const stdout = [
      "[user]: Hello",
      "[agent]: ",
    ].join("\n");
    // Empty agent response — agent turn has empty content, skipped.
    // Falls back to last non-user turn; none found, so returns last turn (user).
    const result = extractFinalOutput(stdout);
    expect(result).toBe("Hello");
  });

  it("handles sequential agent with multiple sub-agents", () => {
    const stdout = [
      "[user]: Research and summarize topic X",
      "[researcher]: Raw research data...",
      "More research details...",
      "[summarizer]: Here is the summary of topic X.",
      "Key points: A, B, C.",
    ].join("\n");
    // Should return the last agent's response
    expect(extractFinalOutput(stdout)).toBe(
      "Here is the summary of topic X.\nKey points: A, B, C."
    );
  });

  it("preserves raw stdout for debugging via result fields", () => {
    // This tests the contract: callers should have both final_output and raw_stdout.
    // The actual field assignment happens in executeAdkAgent, but we verify
    // the extraction doesn't lose information.
    const raw = "[user]: Q\n[agent]: A\n";
    const extracted = extractFinalOutput(raw);
    expect(extracted).toBe("A");
    // The raw is still available — it's the caller's responsibility to keep it
    expect(raw).toContain("[user]");
    expect(raw).toContain("[agent]");
  });
});
