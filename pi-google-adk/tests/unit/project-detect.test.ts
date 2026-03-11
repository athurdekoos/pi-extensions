/**
 * Unit tests: project-detect.
 *
 * Behavior protected:
 * - Detects valid project from .pi-adk-metadata.json
 * - Returns agent name and template from pi-metadata
 * - Detects project from heuristic (.env.example fallback)
 * - Detects project from agent subdirectory heuristic
 * - Returns invalid for empty directory
 * - Legacy .adk-scaffold.json is NOT treated as a detection signal
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectAdkProject } from "../../src/lib/project-detect.js";
import {
  buildCreationMetadata,
  writeCreationMetadata,
} from "../../src/lib/creation-metadata.js";
import { safeWriteFile, safeEnsureDir } from "../../src/lib/fs-safe.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

describe("detectAdkProject", () => {
  it("detects valid project from .pi-adk-metadata.json", () => {
    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "my_agent",
      projectPath: workDir,
      adkVersion: "1.0.0",
      commandUsed: "adk create my_agent",
      supportedModes: ["native_app"],
      creationArgs: { mode: "native_app", name: "my_agent" },
    });
    writeCreationMetadata(workDir, ".", meta);

    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(true);
    expect(info.agentName).toBe("my_agent");
    expect(info.template).toBe("native_app");
    expect(info.detectedVia).toBe("pi-metadata");
  });

  it("falls back to heuristic when .env.example exists", () => {
    safeWriteFile(workDir, ".env.example", "GOOGLE_API_KEY=", false);

    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(true);
    expect(info.template).toBe("unknown");
    expect(info.detectedVia).toBe("heuristic");
  });

  it("detects project via agent subdirectory heuristic", () => {
    safeEnsureDir(workDir, "my_agent");
    safeWriteFile(workDir, "my_agent/agent.py", "root_agent = None", false);

    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(true);
    expect(info.agentName).toBe("my_agent");
    expect(info.detectedVia).toBe("heuristic");
  });

  it("returns invalid for empty directory", () => {
    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(false);
    expect(info.error).toBeTruthy();
  });

  it("does NOT detect project from .adk-scaffold.json alone", () => {
    safeWriteFile(workDir, ".adk-scaffold.json", JSON.stringify({ name: "old_agent", template: "basic" }), false);
    const info = detectAdkProject(workDir);
    expect(info.valid).toBe(false);
  });
});
