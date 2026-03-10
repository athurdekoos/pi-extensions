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
import { readManifest } from "../../src/lib/scaffold-manifest.js";
import { safeReadFile } from "../../src/lib/fs-safe.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

let workDir: string;
let createTool: RegisteredToolCapture;
let capabilityTool: RegisteredToolCapture;
let origCwd: string;

function parseResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = result.content[0];
  return JSON.parse((first as { text: string }).text);
}

beforeEach(() => {
  workDir = createTempDir();
  origCwd = process.cwd();
  process.chdir(workDir);

  const { api, getTool } = createMockExtensionAPI();
  piGoogleAdkExtension(api);
  createTool = getTool("create_adk_agent")!;
  capabilityTool = getTool("add_adk_capability")!;
});

afterEach(() => {
  process.chdir(origCwd);
  removeTempDir(workDir);
});

const ctx = () => createMockExtensionContext({ cwd: workDir });

describe("scaffold then add custom_tool", () => {
  it("creates project and patches agent.py with new tool", async () => {
    // Step 1: create basic project
    const createResult = await createTool.execute(
      "int-1",
      { name: "int_agent", template: "basic", path: "./int_proj" },
      undefined, undefined, ctx()
    );
    expect(parseResult(createResult).ok).toBe(true);

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
    await createTool.execute(
      "int-eval-1",
      { name: "eval_agent", template: "basic", path: "./eval_proj" },
      undefined, undefined, ctx()
    );
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
    await createTool.execute(
      "int-dep-1",
      { name: "dep_agent", template: "basic", path: "./dep_proj" },
      undefined, undefined, ctx()
    );
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
    await createTool.execute(
      "int-obs-1",
      { name: "obs_agent", template: "basic", path: "./obs_proj" },
      undefined, undefined, ctx()
    );
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
    await createTool.execute(
      "int-wf-1",
      { name: "wf_agent", template: "basic", path: "./wf_proj" },
      undefined, undefined, ctx()
    );
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
    await createTool.execute(
      "int-mcp-1",
      { name: "mcp_ext_agent", template: "basic", path: "./mcp_ext_proj" },
      undefined, undefined, ctx()
    );
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
    await createTool.execute(
      "int-multi-1",
      { name: "multi_agent", template: "basic", path: "./multi_proj" },
      undefined, undefined, ctx()
    );
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
    await createTool.execute(
      "int-idemp-1",
      { name: "idemp_agent", template: "basic", path: "./idemp_proj" },
      undefined, undefined, ctx()
    );
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
