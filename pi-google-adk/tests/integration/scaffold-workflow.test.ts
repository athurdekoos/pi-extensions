/**
 * Integration tests: full scaffold + capability workflows.
 *
 * Behavior protected:
 * - End-to-end: create project then add capabilities
 * - File structure correctness after full workflows
 * - Manifest tracking across multi-step operations
 * - custom_tool patches agent.py import and tools list
 * - eval_stub, deploy_stub, observability_notes create expected files
 * - Cleanup: temp directories removed after each test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import { readManifest, createManifest, serializeManifest } from "../../src/lib/scaffold-manifest.js";
import { safeWriteFile, safeReadFile } from "../../src/lib/fs-safe.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

let workDir: string;
let capabilityTool: RegisteredToolCapture;
let origCwd: string;

function parseResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = result.content[0];
  return JSON.parse((first as { text: string }).text);
}

/**
 * Scaffold a basic-style project fixture for integration test setup.
 * Uses inline content — legacy template files have been removed (Phase B).
 */
function scaffoldBasicProject(cwd: string, targetPath: string, name: string, model = "gemini-2.5-flash"): void {
  const p = (f: string) => `${targetPath}/${f}`;
  safeWriteFile(cwd, p(`${name}/__init__.py`), `from .agent import root_agent\n__all__ = ["root_agent"]\n`, false);
  safeWriteFile(cwd, p(`${name}/agent.py`),
    `from google.adk import Agent\nroot_agent = Agent(model="${model}", name="${name}", instruction="You are ${name}.", tools=[get_greeting, get_current_time])\n`, false);
  safeWriteFile(cwd, p(".env.example"), "GOOGLE_API_KEY=\n", false);
  safeWriteFile(cwd, p("README.md"), `# ${name}\n`, false);
  safeWriteFile(cwd, p(".gitignore"), ".env\n.venv/\n__pycache__/\n", false);
  const manifest = createManifest(name, "basic", model);
  safeWriteFile(cwd, p(".adk-scaffold.json"), serializeManifest(manifest), false);
}

beforeEach(() => {
  workDir = createTempDir();
  origCwd = process.cwd();
  process.chdir(workDir);

  const { api, getTool } = createMockExtensionAPI();
  piGoogleAdkExtension(api);
  capabilityTool = getTool("add_adk_capability")!;
});

afterEach(() => {
  process.chdir(origCwd);
  removeTempDir(workDir);
});

const ctx = () => createMockExtensionContext({ cwd: workDir });

describe("scaffold then add custom_tool", () => {
  it("creates project and patches agent.py with new tool", async () => {
    // Step 1: scaffold basic project directly (bypasses public API)
    scaffoldBasicProject(workDir, "./int_proj", "int_agent");

    // Step 2: add custom_tool
    const capResult = await capabilityTool.execute(
      "int-2",
      {
        project_path: "./int_proj",
        capability: "custom_tool",
        options: { tool_name: "fetch_data" },
      },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(capResult);
    expect(parsed.ok).toBe(true);

    // Verify: tool file created
    expect(existsSync(join(workDir, "int_proj", "int_agent", "tools", "fetch_data.py"))).toBe(true);

    // Verify: agent.py patched with import and tools list entry
    const agentPy = safeReadFile(workDir, "int_proj/int_agent/agent.py");
    expect(agentPy).toContain("from .tools.fetch_data import fetch_data");
    expect(agentPy).toContain("fetch_data");

    // Verify: manifest updated
    const manifest = readManifest(join(workDir, "int_proj"));
    expect(manifest!.capabilities).toContain("custom_tool");
  });
});

describe("scaffold then add eval_stub", () => {
  it("creates evals directory with README and test_cases", async () => {
    scaffoldBasicProject(workDir, "./eval_proj", "eval_agent");
    const capResult = await capabilityTool.execute(
      "int-eval-2",
      { project_path: "./eval_proj", capability: "eval_stub" },
      undefined, undefined, ctx()
    );
    expect(parseResult(capResult).ok).toBe(true);
    expect(existsSync(join(workDir, "eval_proj", "evals", "README.md"))).toBe(true);
    expect(existsSync(join(workDir, "eval_proj", "evals", "test_cases.json"))).toBe(true);
  });
});

describe("scaffold then add deploy_stub", () => {
  it("creates DEPLOY.md", async () => {
    scaffoldBasicProject(workDir, "./dep_proj", "dep_agent");
    const capResult = await capabilityTool.execute(
      "int-dep-2",
      { project_path: "./dep_proj", capability: "deploy_stub" },
      undefined, undefined, ctx()
    );
    expect(parseResult(capResult).ok).toBe(true);
    expect(existsSync(join(workDir, "dep_proj", "DEPLOY.md"))).toBe(true);
  });
});

describe("scaffold then add observability_notes", () => {
  it("creates OBSERVABILITY.md", async () => {
    scaffoldBasicProject(workDir, "./obs_proj", "obs_agent");
    const capResult = await capabilityTool.execute(
      "int-obs-2",
      { project_path: "./obs_proj", capability: "observability_notes" },
      undefined, undefined, ctx()
    );
    expect(parseResult(capResult).ok).toBe(true);
    expect(existsSync(join(workDir, "obs_proj", "OBSERVABILITY.md"))).toBe(true);
  });
});

describe("scaffold then add sequential_workflow", () => {
  it("creates workflow.py and workflow_agent.py alongside existing agent", async () => {
    scaffoldBasicProject(workDir, "./wf_proj", "wf_agent");
    const capResult = await capabilityTool.execute(
      "int-wf-2",
      {
        project_path: "./wf_proj",
        capability: "sequential_workflow",
        options: { subagents: ["step_a", "step_b"] },
      },
      undefined, undefined, ctx()
    );
    expect(parseResult(capResult).ok).toBe(true);
    expect(existsSync(join(workDir, "wf_proj", "wf_agent", "workflow.py"))).toBe(true);
    expect(existsSync(join(workDir, "wf_proj", "wf_agent", "workflow_agent.py"))).toBe(true);

    const workflow = safeReadFile(workDir, "wf_proj/wf_agent/workflow.py");
    expect(workflow).toContain("step_a = Agent(");
    expect(workflow).toContain("step_b = Agent(");
  });
});

describe("scaffold then add mcp_toolset to basic project", () => {
  it("creates mcp_config.py and patches agent.py", async () => {
    scaffoldBasicProject(workDir, "./mcp_ext_proj", "mcp_ext_agent");
    const capResult = await capabilityTool.execute(
      "int-mcp-2",
      {
        project_path: "./mcp_ext_proj",
        capability: "mcp_toolset",
        options: { server_command: "npx", server_args: ["-y", "test-server"] },
      },
      undefined, undefined, ctx()
    );
    expect(parseResult(capResult).ok).toBe(true);
    expect(existsSync(join(workDir, "mcp_ext_proj", "mcp_ext_agent", "mcp_config.py"))).toBe(true);

    const agentPy = safeReadFile(workDir, "mcp_ext_proj/mcp_ext_agent/agent.py");
    expect(agentPy).toContain("from .mcp_config import get_mcp_toolsets");
    expect(agentPy).toContain("*mcp_toolsets");
  });
});

describe("multiple capabilities accumulate in manifest", () => {
  it("tracks all added capabilities", async () => {
    scaffoldBasicProject(workDir, "./multi_proj", "multi_agent");
    await capabilityTool.execute(
      "int-multi-2",
      { project_path: "./multi_proj", capability: "eval_stub" },
      undefined, undefined, ctx()
    );
    await capabilityTool.execute(
      "int-multi-3",
      { project_path: "./multi_proj", capability: "deploy_stub" },
      undefined, undefined, ctx()
    );
    await capabilityTool.execute(
      "int-multi-4",
      { project_path: "./multi_proj", capability: "observability_notes" },
      undefined, undefined, ctx()
    );

    const manifest = readManifest(join(workDir, "multi_proj"));
    expect(manifest!.capabilities).toContain("eval_stub");
    expect(manifest!.capabilities).toContain("deploy_stub");
    expect(manifest!.capabilities).toContain("observability_notes");
    expect(manifest!.capabilities).toHaveLength(3);
  });
});

describe("idempotent capability addition", () => {
  it("adding same capability twice does not create duplicates", async () => {
    scaffoldBasicProject(workDir, "./idemp_proj", "idemp_agent");
    await capabilityTool.execute(
      "int-idemp-2",
      { project_path: "./idemp_proj", capability: "eval_stub" },
      undefined, undefined, ctx()
    );
    // Second invocation
    const capResult = await capabilityTool.execute(
      "int-idemp-3",
      { project_path: "./idemp_proj", capability: "eval_stub" },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(capResult);
    // Should succeed but files are skipped
    expect(parsed.ok).toBe(true);
    expect((parsed.files_skipped as string[]).length).toBeGreaterThan(0);

    const manifest = readManifest(join(workDir, "idemp_proj"));
    // Capability should appear once (addCapabilityToManifest is idempotent)
    expect(manifest!.capabilities.filter((c: string) => c === "eval_stub")).toHaveLength(1);
  });
});
