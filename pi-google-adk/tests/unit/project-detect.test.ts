/**
 * Unit tests: project-detect.
 *
 * Behavior protected:
 * - Detects valid project from manifest
 * - Returns agent name and template from manifest
 * - Detects project from heuristic (.env.example fallback)
 * - Returns invalid for empty directory
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectAdkProject } from "../../src/lib/project-detect.js";
import { createManifest, serializeManifest, MANIFEST_FILENAME } from "../../src/lib/scaffold-manifest.js";
import { safeWriteFile } from "../../src/lib/fs-safe.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

describe("detectAdkProject", () => {
  it("detects valid project from manifest", () => {
    const m = createManifest("my_agent", "basic", "gemini-2.5-flash");
    safeWriteFile(workDir, MANIFEST_FILENAME, serializeManifest(m), false);

    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(true);
    expect(info.agentName).toBe("my_agent");
    expect(info.template).toBe("basic");
  });

  it("falls back to heuristic when .env.example exists", () => {
    safeWriteFile(workDir, ".env.example", "GOOGLE_API_KEY=", false);

    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(true);
    expect(info.template).toBe("unknown");
  });

  it("returns invalid for empty directory", () => {
    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(false);
    expect(info.error).toBeTruthy();
  });

  it("handles malformed manifest gracefully", () => {
    safeWriteFile(workDir, MANIFEST_FILENAME, "not-json", false);
    const info = detectAdkProject(workDir);
    // parseMarker catch clause returns valid=true, template=unknown
    expect(info.valid).toBe(true);
    expect(info.template).toBe("unknown");
  });
});
