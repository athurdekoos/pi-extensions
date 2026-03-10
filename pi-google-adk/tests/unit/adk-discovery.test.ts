/**
 * Unit tests: ADK discovery and resolution.
 *
 * Behavior protected:
 * - discoverAdkAgents finds scaffolded agents under ./agents/
 * - discoverAdkAgents uses manifest data when present
 * - discoverAdkAgents falls back to heuristic detection
 * - discoverAdkAgents returns empty array for empty workspace
 * - resolveAdkAgent by exact name works
 * - resolveAdkAgent by path works
 * - resolveAdkAgent case-insensitive match works
 * - resolveAdkAgent prefix match works
 * - resolveAdkAgent no-match returns not_found
 * - resolveAdkAgent ambiguous match returns ambiguous
 * - Newly created agents are discoverable immediately
 * - basic, mcp, sequential templates are all discoverable
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverAdkAgents, resolveAdkAgent } from "../../src/lib/adk-discovery.js";
import { createManifest, serializeManifest, MANIFEST_FILENAME } from "../../src/lib/scaffold-manifest.js";
import { safeWriteFile, safeEnsureDir } from "../../src/lib/fs-safe.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

/** Helper: scaffold a minimal ADK agent with manifest under agents/<name>. */
function scaffoldAgent(
  name: string,
  template: "basic" | "mcp" | "sequential" = "basic",
  model = "gemini-2.5-flash",
  capabilities: string[] = []
) {
  const agentDir = `agents/${name}`;
  safeEnsureDir(workDir, agentDir);
  const manifest = createManifest(name, template, model);
  manifest.capabilities = capabilities;
  safeWriteFile(workDir, `${agentDir}/${MANIFEST_FILENAME}`, serializeManifest(manifest), false);
  safeWriteFile(workDir, `${agentDir}/.env.example`, "GOOGLE_API_KEY=", false);
}

/** Helper: scaffold a heuristic-only agent (no manifest). */
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

  it("discovers a single agent with manifest", () => {
    scaffoldAgent("researcher");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("researcher");
    expect(agents[0].template).toBe("basic");
    expect(agents[0].project_path).toBe("./agents/researcher");
    expect(agents[0].source).toBe("manifest");
  });

  it("discovers multiple agents", () => {
    scaffoldAgent("researcher", "basic");
    scaffoldAgent("writer", "sequential");
    scaffoldAgent("connector", "mcp");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.name).sort()).toEqual(["connector", "researcher", "writer"]);
  });

  it("uses manifest data for template and capabilities", () => {
    scaffoldAgent("researcher", "mcp", "gemini-2.5-flash", ["web_search", "code_exec"]);
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].template).toBe("mcp");
    expect(agents[0].capabilities).toEqual(["web_search", "code_exec"]);
  });

  it("falls back to heuristic detection when no manifest", () => {
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

  it("discovers all template types", () => {
    scaffoldAgent("basic_agent", "basic");
    scaffoldAgent("mcp_agent", "mcp");
    scaffoldAgent("seq_agent", "sequential");
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(3);
    const templates = agents.map((a) => a.template).sort();
    expect(templates).toEqual(["basic", "mcp", "sequential"]);
  });

  it("newly created agent is discoverable immediately", () => {
    // First discovery — empty
    expect(discoverAdkAgents(workDir)).toHaveLength(0);

    // Create an agent
    scaffoldAgent("new_agent");

    // Immediate re-discovery — should find it
    const agents = discoverAdkAgents(workDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("new_agent");
  });

  it("includes label with name, template, and path", () => {
    scaffoldAgent("researcher", "mcp");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].label).toContain("researcher");
    expect(agents[0].label).toContain("mcp");
    expect(agents[0].label).toContain("./agents/researcher");
  });

  // Phase 3: richer labels with capabilities
  it("includes capabilities in label when present", () => {
    scaffoldAgent("researcher", "mcp", "gemini-2.5-flash", ["web_search", "code_exec"]);
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].label).toContain("[web_search, code_exec]");
    expect(agents[0].label).toContain("researcher");
    expect(agents[0].label).toContain("mcp");
  });

  it("omits capabilities bracket from label when empty", () => {
    scaffoldAgent("basic_agent", "basic");
    const agents = discoverAdkAgents(workDir);
    expect(agents[0].label).not.toContain("[");
    expect(agents[0].label).not.toContain("]");
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
    // Not found before creation
    expect(resolveAdkAgent(workDir, "dynamic").status).toBe("not_found");

    // Create it
    scaffoldAgent("dynamic");

    // Found after creation
    const result = resolveAdkAgent(workDir, "dynamic");
    expect(result.status).toBe("found");
    expect(result.agent?.name).toBe("dynamic");
  });
});
