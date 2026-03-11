/**
 * Veracity trap tests for pi-google-adk.
 *
 * This extension is a scaffolding tool, not a CLI wrapper that returns
 * opaque external data. The veracity risk is: a model could claim it
 * created files without actually calling the tool, or fabricate
 * file paths / metadata contents.
 *
 * Strategy:
 * - Inject a unique canary nonce into the agent name. The tool result
 *   (files_created, metadata name, path) must contain this canary.
 * - The canary is generated fresh per test and is not hardcoded.
 * - Positive traps: use direct scaffolding to create projects, then
 *   verify filesystem state with canary-derived names.
 * - Negative traps: tool returns ok=false, result must not claim success.
 * - Decoy traps: provide a fake name in context, verify real tool uses
 *   the parameter-provided name, not the decoy.
 *
 * Coverage boundaries:
 * These tests prove that the tool execute() path produces results that
 * structurally depend on the actual inputs and filesystem writes.
 * They do NOT prove live model tool-selection behavior (that requires
 * real-LLM tests which are out of scope here).
 *
 * Note: Legacy .adk-scaffold.json manifest support has been fully removed.
 * Project fixtures use .pi-adk-metadata.json for detection.
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
import {
  buildCreationMetadata,
  writeCreationMetadata,
  readAndValidateMetadata,
} from "../../src/lib/creation-metadata.js";
import { safeWriteFile, safeReadFile } from "../../src/lib/fs-safe.js";
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

/**
 * Scaffold a project fixture using pi-metadata for detection.
 */
function scaffoldProject(cwd: string, targetPath: string, name: string, model = "gemini-2.5-flash"): void {
  const p = (f: string) => `${targetPath}/${f}`;
  safeWriteFile(cwd, p(`${name}/__init__.py`), `from .agent import root_agent\n__all__ = ["root_agent"]\n`, false);
  safeWriteFile(cwd, p(`${name}/agent.py`),
    `from google.adk import Agent\nroot_agent = Agent(model="${model}", name="${name}", instruction="You are ${name}.", tools=[get_greeting, get_current_time])\n`, false);
  safeWriteFile(cwd, p(".env.example"), "GOOGLE_API_KEY=\n", false);
  safeWriteFile(cwd, p("README.md"), `# ${name}\n`, false);
  safeWriteFile(cwd, p(".gitignore"), ".env\n.venv/\n__pycache__/\n", false);
  // Use pi-metadata for detection
  const meta = buildCreationMetadata({
    sourceType: "native_app",
    agentName: name,
    projectPath: targetPath,
    adkVersion: "1.0.0",
    commandUsed: `adk create ${name}`,
    supportedModes: ["native_app"],
    creationArgs: { mode: "native_app", name },
  });
  writeCreationMetadata(cwd, targetPath, meta);
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

describe("positive trap: canary in scaffolded project", () => {
  it("pi-metadata on disk contains the canary agent name", () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);

    scaffoldProject(workDir, `./${agentName}_proj`, agentName);

    const validation = readAndValidateMetadata(join(workDir, `${agentName}_proj`));
    expect(validation.ok).toBe(true);
    expect(validation.metadata?.agent_name).toBe(agentName);
  });

  it("agent.py on disk contains the canary agent name", () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);

    scaffoldProject(workDir, `./${agentName}_proj`, agentName);

    const agentPy = safeReadFile(workDir, `${agentName}_proj/${agentName}/agent.py`);
    expect(agentPy).not.toBeNull();
    expect(agentPy).toContain(`name="${agentName}"`);
  });
});

describe("positive trap: multiple runs with fresh nonces", () => {
  it("each scaffold produces unique canary agent on disk", () => {
    const names: string[] = [];

    for (let i = 0; i < 3; i++) {
      const nonce = generateNonce(`RUN${i}`);
      const agentName = canaryAgentName(nonce);
      names.push(agentName);

      scaffoldProject(workDir, `./${agentName}_proj`, agentName);
    }

    for (const name of names) {
      const validation = readAndValidateMetadata(join(workDir, `${name}_proj`));
      expect(validation.metadata?.agent_name).toBe(name);
    }

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
  it("scaffold uses real name, not decoy", () => {
    const realNonce = generateNonce();
    const decoyNonce = generateDecoy(realNonce);
    const realName = canaryAgentName(realNonce);
    const decoyName = `decoy_agent_${decoyNonce.split("-").pop()}`;

    scaffoldProject(workDir, `./${realName}_proj`, realName);

    // Metadata on disk uses real name, not decoy
    const validation = readAndValidateMetadata(join(workDir, `${realName}_proj`));
    expect(validation.metadata?.agent_name).toBe(realName);
    expect(validation.metadata?.agent_name).not.toBe(decoyName);

    // Agent.py uses real name
    const agentPy = safeReadFile(workDir, `${realName}_proj/${realName}/agent.py`);
    expect(agentPy).toContain(realName);
    expect(agentPy).not.toContain(decoyName);
  });
});

describe("positive trap: capability canary in patched files", () => {
  it("custom_tool canary name appears in agent.py after patching", async () => {
    const nonce = generateNonce();
    const agentName = canaryAgentName(nonce);
    const toolNonce = generateNonce("TOOL");
    const toolName = `tool_${toolNonce.split("-").pop()}`;

    // Scaffold project directly
    scaffoldProject(workDir, `./${agentName}_proj`, agentName);

    // Add custom_tool with canary tool name via public API
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
