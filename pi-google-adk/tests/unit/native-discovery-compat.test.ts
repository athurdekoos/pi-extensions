/**
 * Unit tests: discovery compatibility with native-created projects.
 *
 * Behavior protected:
 * - Native projects with .pi-adk-metadata.json are discoverable
 * - Native projects with agent.py subdirectory heuristic are discoverable
 * - Native projects can be resolved by name and path
 * - Mixed native workspaces discover all projects
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverAdkAgents, resolveAdkAgent } from "../../src/lib/adk-discovery.js";
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

/** Scaffold a native-created project with pi metadata. */
function scaffoldNativeProject(
  name: string,
  sourceType: "native_app" | "native_config" = "native_app"
) {
  const agentDir = `agents/${name}`;
  safeEnsureDir(workDir, agentDir);

  // Write Pi creation metadata
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

  // Simulate what native ADK create produces: a subdirectory with agent.py
  safeEnsureDir(workDir, `${agentDir}/${name}`);
  safeWriteFile(
    workDir,
    `${agentDir}/${name}/__init__.py`,
    `from . import agent`,
    false
  );
  safeWriteFile(
    workDir,
    `${agentDir}/${name}/agent.py`,
    `root_agent = None  # placeholder`,
    false
  );
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe("detectAdkProject with native metadata", () => {
  it("detects project with .pi-adk-metadata.json", () => {
    scaffoldNativeProject("native_agent");
    const info = detectAdkProject(`${workDir}/agents/native_agent`);
    expect(info.valid).toBe(true);
    expect(info.agentName).toBe("native_agent");
    expect(info.template).toBe("native_app");
    expect(info.detectedVia).toBe("pi-metadata");
  });

  it("detects native_config source type", () => {
    scaffoldNativeProject("config_agent", "native_config");
    const info = detectAdkProject(`${workDir}/agents/config_agent`);
    expect(info.valid).toBe(true);
    expect(info.template).toBe("native_config");
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe("discoverAdkAgents with native projects", () => {
  it("discovers a native-created project", () => {
    scaffoldNativeProject("native_hello");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("native_hello");
    expect(agents[0].project_path).toBe("./agents/native_hello");
  });

  it("discovers multiple native projects", () => {
    scaffoldNativeProject("native_agent_a");
    scaffoldNativeProject("native_agent_b", "native_config");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(2);
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["native_agent_a", "native_agent_b"]);
  });

  it("native project has template from metadata", () => {
    scaffoldNativeProject("typed_agent", "native_config");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].template).toBe("native_config");
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("resolveAdkAgent with native projects", () => {
  it("resolves native project by name", () => {
    scaffoldNativeProject("resolvable");
    const result = resolveAdkAgent(workDir, "resolvable");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("resolvable");
  });

  it("resolves native project by path", () => {
    scaffoldNativeProject("path_resolve");
    const result = resolveAdkAgent(workDir, "./agents/path_resolve");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("path_resolve");
  });
});
