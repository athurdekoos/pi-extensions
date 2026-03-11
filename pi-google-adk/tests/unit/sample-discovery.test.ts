/**
 * Unit tests: discovery compatibility with imported samples.
 *
 * Behavior protected:
 * - Imported samples are discoverable
 * - Imported samples are resolvable by name and path
 * - Labels distinguish official_sample from native_app/native_config
 * - source_type field is populated correctly
 * - Mixed workspaces (native + sample) discover all
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverAdkAgents, resolveAdkAgent } from "../../src/lib/adk-discovery.js";
import { detectAdkProject } from "../../src/lib/project-detect.js";
import {
  buildSampleImportMetadata,
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

/** Scaffold an imported sample project with Pi metadata. */
function scaffoldSampleProject(name: string) {
  const agentDir = `agents/${name}`;
  safeEnsureDir(workDir, agentDir);

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

  // Simulate imported structure: subdirectory with agent.py
  safeEnsureDir(workDir, `${agentDir}/${name}`);
  safeWriteFile(workDir, `${agentDir}/${name}/agent.py`, "root_agent = None", false);
}

/** Scaffold a native project. */
function scaffoldNativeProject(name: string, sourceType: "native_app" | "native_config" = "native_app") {
  const agentDir = `agents/${name}`;
  safeEnsureDir(workDir, agentDir);

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

  safeEnsureDir(workDir, `${agentDir}/${name}`);
  safeWriteFile(workDir, `${agentDir}/${name}/agent.py`, "root_agent = None", false);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe("detectAdkProject with sample metadata", () => {
  it("detects imported sample project", () => {
    scaffoldSampleProject("my_sample");
    const info = detectAdkProject(`${workDir}/agents/my_sample`);
    expect(info.valid).toBe(true);
    expect(info.agentName).toBe("my_sample");
    expect(info.template).toBe("official_sample");
    expect(info.detectedVia).toBe("pi-metadata");
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe("discoverAdkAgents with imported samples", () => {
  it("discovers an imported sample", () => {
    scaffoldSampleProject("sample_hello");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("sample_hello");
    expect(agents[0].source_type).toBe("official_sample");
  });

  it("label contains [official_sample]", () => {
    scaffoldSampleProject("sample_hello");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].label).toContain("[official_sample]");
  });

  it("native project label contains [native_app]", () => {
    scaffoldNativeProject("native_agent");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].label).toContain("[native_app]");
  });

  it("labels distinguish native vs sample", () => {
    scaffoldNativeProject("native_agent");
    scaffoldSampleProject("sample_agent");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(2);

    const nativeAgent = agents.find((a) => a.name === "native_agent");
    const sampleAgent = agents.find((a) => a.name === "sample_agent");

    expect(nativeAgent!.label).toContain("[native_app]");
    expect(nativeAgent!.source_type).toBe("native_app");

    expect(sampleAgent!.label).toContain("[official_sample]");
    expect(sampleAgent!.source_type).toBe("official_sample");
  });

  it("discovers mixed workspace: native + sample", () => {
    scaffoldNativeProject("native_one");
    scaffoldSampleProject("sample_one");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(2);
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["native_one", "sample_one"]);
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("resolveAdkAgent with imported samples", () => {
  it("resolves sample project by name", () => {
    scaffoldSampleProject("resolvable_sample");
    const result = resolveAdkAgent(workDir, "resolvable_sample");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("resolvable_sample");
    expect(result.agent?.source_type).toBe("official_sample");
  });

  it("resolves sample project by path", () => {
    scaffoldSampleProject("path_sample");
    const result = resolveAdkAgent(workDir, "./agents/path_sample");
    expect(result.status).toBe("found");
    expect(result.agent?.source_type).toBe("official_sample");
  });

  it("resolves in mixed workspace", () => {
    scaffoldNativeProject("native_x");
    scaffoldSampleProject("sample_x");
    const r1 = resolveAdkAgent(workDir, "native_x");
    const r2 = resolveAdkAgent(workDir, "sample_x");
    expect(r1.status).toBe("found");
    expect(r1.agent?.source_type).toBe("native_app");
    expect(r2.status).toBe("found");
    expect(r2.agent?.source_type).toBe("official_sample");
  });
});
