/**
 * Unit tests: ADK discovery and resolution.
 *
 * Behavior protected:
 * - discoverAdkAgents finds projects under ./agents/
 * - discoverAdkAgents uses pi-metadata when present
 * - discoverAdkAgents falls back to heuristic detection
 * - discoverAdkAgents returns empty array for empty workspace
 * - resolveAdkAgent by exact name works
 * - resolveAdkAgent by path works
 * - resolveAdkAgent case-insensitive match works
 * - resolveAdkAgent prefix match works
 * - resolveAdkAgent no-match returns not_found
 * - resolveAdkAgent ambiguous match returns ambiguous
 * - Newly created agents are discoverable immediately
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverAdkAgents, resolveAdkAgent } from "../../src/lib/adk-discovery.js";
import {
  buildCreationMetadata,
  buildSampleImportMetadata,
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

/** Helper: scaffold a project with pi-metadata under agents/<name>. */
function scaffoldAgent(
  name: string,
  sourceType: "native_app" | "native_config" | "official_sample" = "native_app",
) {
  const agentDir = `agents/${name}`;
  safeEnsureDir(workDir, agentDir);

  if (sourceType === "official_sample") {
    const meta = buildSampleImportMetadata({
      agentName: name,
      projectPath: `./${agentDir}`,
      importArgs: { mode: "official_sample", name, sample_slug: "hello_world" },
      sampleProvenance: {
        upstream_repo: "https://github.com/google/adk-samples.git",
        upstream_path: "agents/hello-world",
        upstream_ref: "main",
        commit: "abc123",
        imported_at: new Date().toISOString(),
        sample_slug: "hello_world",
      },
    });
    writeCreationMetadata(workDir, agentDir, meta);
  } else {
    const meta = buildCreationMetadata({
      sourceType,
      agentName: name,
      projectPath: `./${agentDir}`,
      adkVersion: "1.0.0",
      commandUsed: `adk create ${name}`,
      supportedModes: ["native_app"],
      creationArgs: { mode: sourceType, name },
    });
    writeCreationMetadata(workDir, agentDir, meta);
  }

  // Simulate agent subdirectory
  safeEnsureDir(workDir, `${agentDir}/${name}`);
  safeWriteFile(workDir, `${agentDir}/${name}/agent.py`, "root_agent = None", false);
}

/** Helper: scaffold a heuristic-only agent (no metadata). */
function scaffoldHeuristicAgent(name: string) {
  const agentDir = `agents/${name}`;
  safeEnsureDir(workDir, agentDir);
  safeWriteFile(workDir, `${agentDir}/.env.example`, "GOOGLE_API_KEY=", false);
}

describe("discoverAdkAgents", () => {
  it("returns empty array for empty workspace", () => {
    const agents = discoverAdkAgents(workDir);
    expect(agents).toEqual([]);
  });

  it("returns empty array when agents/ exists but is empty", () => {
    safeEnsureDir(workDir, "agents");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toEqual([]);
  });

  it("discovers a single agent with pi-metadata", () => {
    scaffoldAgent("researcher");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("researcher");
    expect(agents[0].template).toBe("native_app");
    expect(agents[0].project_path).toBe("./agents/researcher");
    expect(agents[0].source).toBe("pi-metadata");
  });

  it("discovers multiple agents", () => {
    scaffoldAgent("researcher", "native_app");
    scaffoldAgent("writer", "native_config");
    scaffoldAgent("connector", "official_sample");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.name).sort()).toEqual(["connector", "researcher", "writer"]);
  });

  it("uses metadata for template type", () => {
    scaffoldAgent("researcher", "native_config");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].template).toBe("native_config");
  });

  it("falls back to heuristic detection when no metadata", () => {
    scaffoldHeuristicAgent("legacy_agent");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("legacy_agent");
    expect(agents[0].template).toBe("unknown");
    expect(agents[0].source).toBe("heuristic");
  });

  it("skips non-ADK directories", () => {
    safeEnsureDir(workDir, "agents/not_an_agent");
    safeWriteFile(workDir, "agents/not_an_agent/random.txt", "hello", false);
    scaffoldAgent("real_agent");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("real_agent");
  });

  it("newly created agent is discoverable immediately", () => {
    expect(discoverAdkAgents(workDir)).toHaveLength(0);
    scaffoldAgent("new_agent");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("new_agent");
  });

  it("includes label with name and path", () => {
    scaffoldAgent("researcher");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].label).toContain("researcher");
    expect(agents[0].label).toContain("./agents/researcher");
  });

  it("label includes source type tag", () => {
    scaffoldAgent("researcher", "native_app");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].label).toContain("[native_app]");
  });
});

describe("resolveAdkAgent", () => {
  it("resolves by exact name", () => {
    scaffoldAgent("researcher");
    const result = resolveAdkAgent(workDir, "researcher");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("researcher");
    expect(result.agent?.project_path).toBe("./agents/researcher");
  });

  it("resolves by path", () => {
    scaffoldAgent("researcher");
    const result = resolveAdkAgent(workDir, "./agents/researcher");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("researcher");
  });

  it("resolves by case-insensitive name", () => {
    scaffoldAgent("researcher");
    const result = resolveAdkAgent(workDir, "Researcher");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("researcher");
  });

  it("resolves by prefix when unique", () => {
    scaffoldAgent("researcher");
    scaffoldAgent("writer");
    const result = resolveAdkAgent(workDir, "res");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("researcher");
  });

  it("returns not_found for unknown name", () => {
    scaffoldAgent("researcher");
    const result = resolveAdkAgent(workDir, "nonexistent");
    expect(result.status).toBe("not_found");
    expect(result.available).toHaveLength(1);
  });

  it("returns not_found for unknown path", () => {
    const result = resolveAdkAgent(workDir, "./agents/nonexistent");
    expect(result.status).toBe("not_found");
  });

  it("returns ambiguous when prefix matches multiple agents", () => {
    scaffoldAgent("researcher_a");
    scaffoldAgent("researcher_b");
    const result = resolveAdkAgent(workDir, "researcher");
    expect(result.status).toBe("ambiguous");
    expect(result.matches).toHaveLength(2);
  });

  it("available field always lists all agents", () => {
    scaffoldAgent("a");
    scaffoldAgent("b");
    scaffoldAgent("c");
    const result = resolveAdkAgent(workDir, "nonexistent");
    expect(result.available).toHaveLength(3);
  });

  it("resolves newly created agent immediately", () => {
    expect(resolveAdkAgent(workDir, "dynamic").status).toBe("not_found");
    scaffoldAgent("dynamic");
    const result = resolveAdkAgent(workDir, "dynamic");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("dynamic");
  });
});
