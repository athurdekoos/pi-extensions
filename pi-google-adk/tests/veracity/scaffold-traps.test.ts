/**
 * Veracity trap tests for pi-google-adk.
 *
 * This extension is a scaffolding tool, not a CLI wrapper that returns
 * opaque external data. The veracity risk is: a model could claim it
 * created files without actually calling the tool, or fabricate
 * file paths / manifest contents.
 *
 * Strategy:
 * - Inject a unique canary nonce into the agent name. The tool result
 *   (files_created, manifest name, path) must contain this canary.
 * - The canary is generated fresh per test and is not hardcoded.
 * - Positive traps: tool called, result structurally depends on canary.
 * - Negative traps: tool returns ok=false, result must not claim success.
 * - Decoy traps: provide a fake name in context, verify real tool uses
 *   the parameter-provided name, not the decoy.
 * - Derived canary: verify manifest file on disk matches the tool result.
 *
 * Coverage boundaries:
 * These tests prove that the tool execute() path produces results that
 * structurally depend on the actual inputs and filesystem writes.
 * They do NOT prove live model tool-selection behavior (that requires
 * real-LLM tests which are out of scope here).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import piGoogleAdkExtension from "../../src/index.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
  type RegisteredToolCapture,
} from "../helpers/mock-extension-api.js";
import { generateNonce, deriveFromNonce, generateDecoy, resetNonceCounter } from "../helpers/nonce.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import { readManifest } from "../../src/lib/scaffold-manifest.js";
import { safeReadFile } from "../../src/lib/fs-safe.js";
import { join } from "node:path";

let workDir: string;
let origCwd: string;
let createTool: RegisteredToolCapture;
let capabilityTool: RegisteredToolCapture;

function parseResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = result.content[0];
  return JSON.parse((first as { text: string }).text);
}

/**
 * Generate a valid Python identifier from a nonce by taking the numeric
 * suffix and building a lowercase name. This ensures the canary-derived
 * agent name passes validation.
 */
function canaryAgentName(nonce: string): string {
  const parts = nonce.split("-");
  const num = parts[parts.length - 1];
  return `canary_agent_${num}`;
}

beforeEach(() => {
  workDir = createTempDir();
  origCwd = process.cwd();
  process.chdir(workDir);
  resetNonceCounter();

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

describe("positive trap: canary in tool result", () => {
  it("files_created paths contain the canary-derived agent name", async () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);

    const result = await createTool.execute(
      "trap-pos-1",
      { name: agentName, template: "basic", path: `./${agentName}_proj` },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(result);

    // Telemetry: tool succeeded
    expect(parsed.ok).toBe(true);

    // Structural dependence: files_created paths include the canary agent name
    const files = parsed.files_created as string[];
    expect(files.length).toBeGreaterThan(0);
    const hasCanaryPath = files.some((f) => f.includes(agentName));
    expect(hasCanaryPath).toBe(true);
  });

  it("manifest on disk contains the canary agent name", async () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);

    await createTool.execute(
      "trap-pos-2",
      { name: agentName, template: "basic", path: `./${agentName}_proj` },
      undefined, undefined, ctx()
    );

    // Derived evidence: read the manifest from disk and verify the name
    const manifest = readManifest(join(workDir, `${agentName}_proj`));
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe(agentName);
  });

  it("agent.py on disk contains the canary agent name", async () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);

    await createTool.execute(
      "trap-pos-3",
      { name: agentName, template: "basic", path: `./${agentName}_proj` },
      undefined, undefined, ctx()
    );

    const agentPy = safeReadFile(workDir, `${agentName}_proj/${agentName}/agent.py`);
    expect(agentPy).not.toBeNull();
    expect(agentPy).toContain(`name="${agentName}"`);
  });
});

describe("positive trap: derived canary from disk vs result", () => {
  it("manifest name on disk matches the tool result path", async () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);
    const projPath = `./${agentName}_proj`;

    const result = await createTool.execute(
      "trap-derived-1",
      { name: agentName, template: "mcp", path: projPath },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(result);

    // Tool result says the path is correct
    expect(parsed.path).toBe(projPath);

    // Derived evidence: manifest on disk contains the same name
    const manifest = readManifest(join(workDir, `${agentName}_proj`));
    expect(manifest!.name).toBe(agentName);
    expect(manifest!.template).toBe("mcp");

    // Cross-check: MCP config file exists
    const mcpConfig = safeReadFile(workDir, `${agentName}_proj/${agentName}/mcp_config.py`);
    expect(mcpConfig).not.toBeNull();
    expect(mcpConfig).toContain("MCPToolset");
  });
});

describe("positive trap: multiple runs with fresh nonces", () => {
  it("each run produces unique canary agent in result and on disk", async () => {
    const names: string[] = [];

    for (let i = 0; i < 3; i++) {
      const nonce = generateNonce(`RUN${i}`);
      const agentName = canaryAgentName(nonce);
      names.push(agentName);

      const result = await createTool.execute(
        `trap-multi-${i}`,
        { name: agentName, template: "basic", path: `./${agentName}_proj` },
        undefined, undefined, ctx()
      );
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
    }

    // Each run created a distinct manifest with its own name
    for (const name of names) {
      const manifest = readManifest(join(workDir, `${name}_proj`));
      expect(manifest!.name).toBe(name);
    }

    // Names are all unique
    expect(new Set(names).size).toBe(3);
  });
});

describe("negative trap: tool rejects invalid input", () => {
  it("does not produce files or claim success for invalid name", async () => {
    const result = await createTool.execute(
      "trap-neg-1",
      { name: "INVALID-NAME", template: "basic", path: "./bad_proj" },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(result);

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
    expect((parsed.files_created as string[]).length).toBe(0);
  });

  it("does not produce files for path traversal", async () => {
    const result = await createTool.execute(
      "trap-neg-2",
      { name: "good_agent", path: "../../../escape" },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(result);

    expect(parsed.ok).toBe(false);
    expect((parsed.files_created as string[]).length).toBe(0);
  });
});

describe("negative trap: capability on non-project", () => {
  it("returns ok=false for capability on empty directory", async () => {
    const result = await capabilityTool.execute(
      "trap-neg-cap",
      { project_path: ".", capability: "custom_tool" },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect((parsed.files_created as string[]).length).toBe(0);
  });
});

describe("decoy trap: context name vs parameter name", () => {
  it("tool uses parameter name, not any hypothetical context name", async () => {
    const realNonce = generateNonce();
    const decoyNonce = generateDecoy(realNonce);
    const realName = canaryAgentName(realNonce);
    const decoyName = `decoy_agent_${decoyNonce.split("-").pop()}`;

    // The decoy name is not passed as a parameter — only the real name is.
    // A fabricating model might use a plausible name from context.
    const result = await createTool.execute(
      "trap-decoy-1",
      { name: realName, template: "basic", path: `./${realName}_proj` },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(result);

    expect(parsed.ok).toBe(true);

    // Result contains real name, not decoy
    const files = parsed.files_created as string[];
    expect(files.some((f) => f.includes(realName))).toBe(true);
    expect(files.some((f) => f.includes(decoyName))).toBe(false);

    // Manifest on disk uses real name
    const manifest = readManifest(join(workDir, `${realName}_proj`));
    expect(manifest!.name).toBe(realName);
    expect(manifest!.name).not.toBe(decoyName);
  });
});

describe("positive trap: capability canary in patched files", () => {
  it("custom_tool canary name appears in agent.py after patching", async () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);
    const toolNonce = generateNonce("TOOL");
    const toolName = `tool_${toolNonce.split("-").pop()}`;

    // Create project
    await createTool.execute(
      "trap-cap-1",
      { name: agentName, template: "basic", path: `./${agentName}_proj` },
      undefined, undefined, ctx()
    );

    // Add custom_tool with canary tool name
    const result = await capabilityTool.execute(
      "trap-cap-2",
      {
        project_path: `./${agentName}_proj`,
        capability: "custom_tool",
        options: { tool_name: toolName },
      },
      undefined, undefined, ctx()
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);

    // Derived evidence: agent.py on disk contains the canary tool name
    const agentPy = safeReadFile(workDir, `${agentName}_proj/${agentName}/agent.py`);
    expect(agentPy).toContain(`from .tools.${toolName} import ${toolName}`);
    expect(agentPy).toContain(toolName);
  });
});
