/**
 * Verification script for pi-google-adk.
 *
 * Exercises create_adk_agent and add_adk_capability logic directly,
 * writing to a temp directory, then inspects the output.
 *
 * Run: npx tsx scripts/verify.ts
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { safeWriteFile, safeReadFile, safeExists, safePath } from "../src/lib/fs-safe.js";
import { validateAgentName, validateToolName } from "../src/lib/validators.js";
import { detectAdkProject } from "../src/lib/project-detect.js";
import { adkDocsMcpConfig } from "../src/lib/adk-docs-mcp.js";
import {
  createManifest, serializeManifest, readManifest,
  addCapabilityToManifest, MANIFEST_FILENAME,
} from "../src/lib/scaffold-manifest.js";
import { gitignore } from "../src/templates/shared.js";
import * as basicTemplate from "../src/templates/python-basic/files.js";
import * as mcpTemplate from "../src/templates/python-mcp/files.js";
import * as sequentialTemplate from "../src/templates/python-sequential/files.js";

// ── Test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  }
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  assert(haystack.includes(needle), `${label} — expected to contain "${needle}"`);
}

function assertNotIncludes(haystack: string, needle: string, label: string): void {
  assert(!haystack.includes(needle), `${label} — expected NOT to contain "${needle}"`);
}

function assertPythonSyntax(filePath: string, label: string): void {
  try {
    execSync(`python3 -c "import ast; ast.parse(open('${filePath}').read())"`, { stdio: "pipe" });
    assert(true, label);
  } catch (e) {
    const err = e as { stderr?: Buffer };
    assert(false, `${label} — ${err.stderr?.toString().trim()}`);
  }
}

function listFilesRecursive(dir: string, prefix = ""): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      results.push(...listFilesRecursive(full, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/**
 * Scaffold a full project in workDir, including manifest and .gitignore.
 */
function scaffoldProject(
  workDir: string,
  base: string,
  vars: { name: string; model: string },
  template: "basic" | "mcp" | "sequential",
): void {
  const p = (f: string) => `${base}/${f}`;

  if (template === "basic") {
    safeWriteFile(workDir, p(`${vars.name}/__init__.py`), basicTemplate.initPy(vars), false);
    safeWriteFile(workDir, p(`${vars.name}/agent.py`), basicTemplate.agentPy(vars), false);
    safeWriteFile(workDir, p(".env.example"), basicTemplate.envExample(), false);
    safeWriteFile(workDir, p("README.md"), basicTemplate.projectReadme(vars), false);
  } else if (template === "mcp") {
    safeWriteFile(workDir, p(`${vars.name}/__init__.py`), mcpTemplate.initPy(vars), false);
    safeWriteFile(workDir, p(`${vars.name}/agent.py`), mcpTemplate.agentPy(vars), false);
    safeWriteFile(workDir, p(`${vars.name}/mcp_config.py`), mcpTemplate.mcpConfigPy(vars), false);
    safeWriteFile(workDir, p(".env.example"), mcpTemplate.envExample(), false);
    safeWriteFile(workDir, p("README.md"), mcpTemplate.projectReadme(vars), false);
  } else {
    safeWriteFile(workDir, p(`${vars.name}/__init__.py`), sequentialTemplate.initPy(vars), false);
    safeWriteFile(workDir, p(`${vars.name}/agent.py`), sequentialTemplate.agentPy(vars), false);
    safeWriteFile(workDir, p(`${vars.name}/steps.py`), sequentialTemplate.stepsPy(vars), false);
    safeWriteFile(workDir, p(".env.example"), sequentialTemplate.envExample(), false);
    safeWriteFile(workDir, p("README.md"), sequentialTemplate.projectReadme(vars), false);
  }
  safeWriteFile(workDir, p(".gitignore"), gitignore(), false);
  const manifest = createManifest(vars.name, template, vars.model);
  safeWriteFile(workDir, p(MANIFEST_FILENAME), serializeManifest(manifest), false);
}

// ── Test workspace ──────────────────────────────────────────────────

const workDir = mkdtempSync(join(tmpdir(), "pi-google-adk-verify-"));
console.log(`Test workspace: ${workDir}\n`);

try {
  // ================================================================
  // 1. Validators
  // ================================================================
  console.log("--- Validators ---");

  assert(validateAgentName("my_agent") === null, "valid agent name accepted");
  assert(validateAgentName("a") === null, "single char name accepted");
  assert(validateAgentName("agent123") === null, "alphanumeric name accepted");
  assert(validateAgentName("") !== null, "empty name rejected");
  assert(validateAgentName("123bad") !== null, "leading digit rejected");
  assert(validateAgentName("BAD") !== null, "uppercase rejected");
  assert(validateAgentName("has-dash") !== null, "dash rejected");
  assert(validateAgentName("has space") !== null, "space rejected");
  assert(validateAgentName("a".repeat(65)) !== null, "too-long name rejected");

  assert(validateToolName("my_tool") === null, "valid tool name accepted");
  assert(validateToolName("") !== null, "empty tool name rejected");
  assert(validateToolName("BAD") !== null, "uppercase tool name rejected");

  // ================================================================
  // 2. Path safety
  // ================================================================
  console.log("--- Path safety ---");

  try {
    safePath(workDir, "../escape");
    assert(false, "path traversal with .. should throw");
  } catch {
    assert(true, "path traversal with .. blocked");
  }

  try {
    safePath(workDir, "/etc/passwd");
    assert(false, "absolute path outside root should throw");
  } catch {
    assert(true, "absolute path outside root blocked");
  }

  const inside = safePath(workDir, "sub/dir/file.txt");
  assert(inside.startsWith(workDir), "safe path within root resolved");

  // ================================================================
  // 3. Template: basic
  // ================================================================
  console.log("--- Template: basic ---");

  const basicVars = { name: "test_basic", model: "gemini-2.5-flash" };
  const basicBase = "proj_basic";
  scaffoldProject(workDir, basicBase, basicVars, "basic");

  const basicAgent = readFileSync(join(workDir, basicBase, "test_basic", "agent.py"), "utf-8");
  assertIncludes(basicAgent, "from google.adk import Agent", "basic: has Agent import");
  assertNotIncludes(basicAgent, "import google.adk as adk", "basic: no deprecated adk namespace");
  assertIncludes(basicAgent, 'model="gemini-2.5-flash"', "basic: has model");
  assertIncludes(basicAgent, 'name="test_basic"', "basic: has agent name");
  assertIncludes(basicAgent, "root_agent = Agent(", "basic: defines root_agent via Agent()");
  assertIncludes(basicAgent, "tools=[get_greeting, get_current_time]", "basic: has tools list");
  assertNotIncludes(basicAgent, "${", "basic: no unresolved JS template vars");

  const basicInit = readFileSync(join(workDir, basicBase, "test_basic", "__init__.py"), "utf-8");
  assertIncludes(basicInit, "from .agent import root_agent", "basic: init imports root_agent");

  // ================================================================
  // 4. Template: mcp
  // ================================================================
  console.log("--- Template: mcp ---");

  const mcpVars = { name: "test_mcp", model: "gemini-2.5-pro" };
  const mcpBase = "proj_mcp";
  scaffoldProject(workDir, mcpBase, mcpVars, "mcp");

  const mcpAgent = readFileSync(join(workDir, mcpBase, "test_mcp", "agent.py"), "utf-8");
  assertIncludes(mcpAgent, "from google.adk import Agent", "mcp: has Agent import");
  assertIncludes(mcpAgent, "from .mcp_config import get_mcp_toolsets", "mcp: imports mcp_config");
  assertIncludes(mcpAgent, "mcp_toolsets = get_mcp_toolsets()", "mcp: calls get_mcp_toolsets");
  assertIncludes(mcpAgent, "*mcp_toolsets", "mcp: spreads mcp_toolsets");
  assertIncludes(mcpAgent, "root_agent = Agent(", "mcp: uses Agent()");
  assertNotIncludes(mcpAgent, "${", "mcp: no unresolved JS template vars");

  const mcpConfig = readFileSync(join(workDir, mcpBase, "test_mcp", "mcp_config.py"), "utf-8");
  assertIncludes(mcpConfig, "MCPToolset", "mcp: config references MCPToolset");
  assertIncludes(mcpConfig, "StdioServerParameters", "mcp: config references StdioServerParameters");
  assertNotIncludes(mcpConfig, "${", "mcp: no unresolved JS template vars in mcp_config.py");

  // ================================================================
  // 5. Template: sequential
  // ================================================================
  console.log("--- Template: sequential ---");

  const seqVars = { name: "test_seq", model: "gemini-2.5-flash" };
  const seqBase = "proj_seq";
  scaffoldProject(workDir, seqBase, seqVars, "sequential");

  const seqAgent = readFileSync(join(workDir, seqBase, "test_seq", "agent.py"), "utf-8");
  assertIncludes(seqAgent, "from google.adk.agents import SequentialAgent", "seq: imports SequentialAgent");
  assertIncludes(seqAgent, "root_agent = SequentialAgent(", "seq: uses SequentialAgent()");
  assertIncludes(seqAgent, "from .steps import research_agent, draft_agent, review_agent", "seq: imports steps");
  assertNotIncludes(seqAgent, "adk.SequentialAgent", "seq: no deprecated adk.SequentialAgent");
  assertNotIncludes(seqAgent, "${", "seq: no unresolved JS template vars");

  const seqSteps = readFileSync(join(workDir, seqBase, "test_seq", "steps.py"), "utf-8");
  assertIncludes(seqSteps, "from google.adk import Agent", "seq: steps imports Agent");
  assertIncludes(seqSteps, "research_agent = Agent(", "seq: has research_agent");
  assertNotIncludes(seqSteps, "adk.LlmAgent", "seq: no deprecated adk.LlmAgent");
  assertNotIncludes(seqSteps, "${", "seq: no unresolved JS template vars in steps.py");

  // ================================================================
  // 6. Python syntax validation
  // ================================================================
  console.log("--- Python syntax check ---");

  for (const projDir of [basicBase, mcpBase, seqBase]) {
    const pyFiles = listFilesRecursive(join(workDir, projDir)).filter(f => f.endsWith(".py"));
    for (const pyFile of pyFiles) {
      assertPythonSyntax(join(workDir, projDir, pyFile), `python syntax: ${projDir}/${pyFile}`);
    }
  }

  // ================================================================
  // 7. .gitignore
  // ================================================================
  console.log("--- .gitignore ---");

  for (const projDir of [basicBase, mcpBase, seqBase]) {
    const gi = readFileSync(join(workDir, projDir, ".gitignore"), "utf-8");
    assertIncludes(gi, ".env", `${projDir} .gitignore: has .env`);
    assertIncludes(gi, ".venv/", `${projDir} .gitignore: has .venv/`);
    assertIncludes(gi, "__pycache__/", `${projDir} .gitignore: has __pycache__/`);
    assertIncludes(gi, "*.py[cod]", `${projDir} .gitignore: has *.py[cod]`);
  }

  // ================================================================
  // 8. Scaffold manifest (.adk-scaffold.json)
  // ================================================================
  console.log("--- Scaffold manifest ---");

  const basicManifest = readManifest(join(workDir, basicBase));
  assert(basicManifest !== null, "basic: manifest readable");
  assert(basicManifest?.name === "test_basic", "basic: manifest name");
  assert(basicManifest?.template === "basic", "basic: manifest template");
  assert(basicManifest?.model === "gemini-2.5-flash", "basic: manifest model");
  assert(basicManifest?.extension === "pi-google-adk", "basic: manifest extension");
  assert(basicManifest?.extension_version === "0.1.0", "basic: manifest version");
  assert(Array.isArray(basicManifest?.capabilities), "basic: manifest has capabilities array");
  assert(basicManifest?.capabilities.length === 0, "basic: manifest starts with empty capabilities");

  // project detection from manifest
  const basicDetect = detectAdkProject(join(workDir, basicBase));
  assert(basicDetect.valid, "basic: detected as valid project");
  assert(basicDetect.agentName === "test_basic", "basic: agent name from manifest");
  assert(basicDetect.template === "basic", "basic: template from manifest");

  // ================================================================
  // 9. Manifest capability tracking
  // ================================================================
  console.log("--- Manifest capability tracking ---");

  addCapabilityToManifest(workDir, basicBase, "custom_tool");
  const m1 = readManifest(join(workDir, basicBase));
  assert(m1?.capabilities.length === 1, "manifest: one capability after first add");
  assert(m1?.capabilities[0] === "custom_tool", "manifest: custom_tool recorded");

  // Idempotent — adding same capability again
  addCapabilityToManifest(workDir, basicBase, "custom_tool");
  const m2 = readManifest(join(workDir, basicBase));
  assert(m2?.capabilities.length === 1, "manifest: still one capability (no duplicate)");

  // Second different capability
  addCapabilityToManifest(workDir, basicBase, "eval_stub");
  const m3 = readManifest(join(workDir, basicBase));
  assert(m3?.capabilities.length === 2, "manifest: two capabilities after second add");
  assert(m3?.capabilities[1] === "eval_stub", "manifest: eval_stub recorded");

  // ================================================================
  // 10. ADK docs MCP config
  // ================================================================
  console.log("--- ADK docs MCP config ---");

  const mcpJson = adkDocsMcpConfig();
  const mcpParsed = JSON.parse(mcpJson);
  assert(mcpParsed.mcpServers !== undefined, "mcp config: has mcpServers");
  assert(mcpParsed.mcpServers["adk-docs-mcp"] !== undefined, "mcp config: has adk-docs-mcp");
  assert(mcpParsed.mcpServers["adk-docs-mcp"].command === "uvx", "mcp config: command is uvx");
  assert(
    mcpParsed.mcpServers["adk-docs-mcp"].args.includes(
      "AgentDevelopmentKit:https://google.github.io/adk-docs/llms.txt"
    ),
    "mcp config: has llms.txt URL"
  );

  // ================================================================
  // 11. Overwrite protection
  // ================================================================
  console.log("--- Overwrite protection ---");

  const ow1 = safeWriteFile(workDir, "overwrite_test.txt", "first", false);
  assert(ow1.created === true, "overwrite: first write creates");
  const ow2 = safeWriteFile(workDir, "overwrite_test.txt", "second", false);
  assert(ow2.skipped === true, "overwrite: second write skips");
  assert(ow2.reason === "already exists", "overwrite: skip reason correct");
  const ow3 = safeWriteFile(workDir, "overwrite_test.txt", "second", true);
  assert(ow3.created === true, "overwrite: write with overwrite=true succeeds");

  // ================================================================
  // 12. Patch idempotency: custom_tool import injection
  // ================================================================
  console.log("--- Patch idempotency: custom_tool ---");

  const idempBase = "proj_idemp";
  const idempVars = { name: "idemp_agent", model: "gemini-2.5-flash" };
  scaffoldProject(workDir, idempBase, idempVars, "basic");

  const agentPyPath = `${idempBase}/idemp_agent/agent.py`;
  const toolName = "fetch_data";
  const importLine = `from .tools.${toolName} import ${toolName}`;

  // First patch
  let src = safeReadFile(workDir, agentPyPath)!;
  assert(!src.includes(importLine), "idemp: import not present before patch");

  // Simulate insertImport + patchToolsList
  const lines1 = src.split("\n");
  let lastIdx = -1;
  for (let i = 0; i < lines1.length; i++) {
    if (lines1[i].startsWith("import ") || lines1[i].startsWith("from ")) lastIdx = i;
  }
  lines1.splice(lastIdx + 1, 0, importLine);
  let patched = lines1.join("\n");
  // Single-line tools patch
  patched = patched.replace(
    /tools=\[([^\]]*)\]/,
    (_m, inner) => {
      const t = inner.trim();
      return t.length === 0 ? `tools=[${toolName}]` : `tools=[${t}, ${toolName}]`;
    }
  );
  safeWriteFile(workDir, agentPyPath, patched, true);

  const after1 = safeReadFile(workDir, agentPyPath)!;
  const count1 = (after1.match(new RegExp(importLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
  assert(count1 === 1, "idemp: import added exactly once");
  assertIncludes(after1, "fetch_data", "idemp: tool wired into tools list");

  // Second patch attempt — should detect existing import
  const src2 = safeReadFile(workDir, agentPyPath)!;
  assert(src2.includes(importLine), "idemp: second run detects existing import");
  assertPythonSyntax(join(workDir, agentPyPath), "idemp: patched agent.py valid Python");

  // ================================================================
  // 13. Multi-line tools=[...] patching
  // ================================================================
  console.log("--- Multi-line tools patching ---");

  // patchToolsList is internal to add-adk-capability but we test the
  // same logic inline here since it's the critical behavior.

  // Single-line
  const sl = `root_agent = Agent(\n    tools=[get_greeting, get_current_time],\n)`;
  const slPatched = sl.replace(
    /tools=\[([^\]]*)\]/,
    (_m, inner) => `tools=[${inner.trim()}, new_tool]`
  );
  assertIncludes(slPatched, "tools=[get_greeting, get_current_time, new_tool]", "patch: single-line");

  // Multi-line
  const ml = `root_agent = Agent(
    tools=[
        get_greeting,
        get_current_time,
    ],
)`;

  // Simulate patchToolsList multi-line logic
  const multiLineRe = /tools=\[\s*\n([\s\S]*?)\n(\s*)\]/;
  const mlMatch = ml.match(multiLineRe);
  assert(mlMatch !== null, "patch: multi-line regex matches");
  if (mlMatch) {
    const body = mlMatch[1];
    const closingIndent = mlMatch[2];
    const itemIndent = closingIndent + "    ";
    const newBody = body.trimEnd() + "\n" + itemIndent + "new_tool,";
    const mlPatched = ml.replace(multiLineRe, `tools=[\n${newBody}\n${closingIndent}]`);
    assertIncludes(mlPatched, "        new_tool,", "patch: multi-line appends with correct indent");
    assertIncludes(mlPatched, "    ]", "patch: multi-line preserves closing bracket indent");
    // Verify readable structure
    assertNotIncludes(mlPatched, "get_current_time,, new_tool", "patch: no double comma");
  }

  // Empty
  const empty = `root_agent = Agent(\n    tools=[],\n)`;
  const emptyPatched = empty.replace(
    /tools=\[([^\]]*)\]/,
    (_m, inner) => {
      const t = inner.trim();
      return t.length === 0 ? `tools=[new_tool]` : `tools=[${t}, new_tool]`;
    }
  );
  assertIncludes(emptyPatched, "tools=[new_tool]", "patch: empty list");

  // ================================================================
  // 14. Stub capabilities (idempotent file creation)
  // ================================================================
  console.log("--- Stub capabilities ---");

  safeWriteFile(workDir, `${basicBase}/evals/README.md`, "# Evals\n", false);
  safeWriteFile(workDir, `${basicBase}/evals/test_cases.json`, "[]\n", false);
  assert(safeExists(workDir, `${basicBase}/evals/README.md`), "eval_stub: created");
  const evalR2 = safeWriteFile(workDir, `${basicBase}/evals/README.md`, "new", false);
  assert(evalR2.skipped === true, "eval_stub: idempotent");

  safeWriteFile(workDir, `${basicBase}/DEPLOY.md`, "# Deploy\n", false);
  const depR2 = safeWriteFile(workDir, `${basicBase}/DEPLOY.md`, "new", false);
  assert(depR2.skipped === true, "deploy_stub: idempotent");

  safeWriteFile(workDir, `${basicBase}/OBSERVABILITY.md`, "# Obs\n", false);
  const obsR2 = safeWriteFile(workDir, `${basicBase}/OBSERVABILITY.md`, "new", false);
  assert(obsR2.skipped === true, "obs_notes: idempotent");

  // ================================================================
  // 15. Sequential workflow generated code
  // ================================================================
  console.log("--- Capability: sequential_workflow Python check ---");

  const wfSubagents = ["step_one", "step_two"];
  const wfModel = "gemini-2.5-flash";
  const wfDefs = wfSubagents.map(
    (name) => `\n${name} = Agent(\n    model="${wfModel}",\n    name="${name}",\n    instruction="""You are the ${name} step.\nComplete your part of the workflow and pass results to the next step.""",\n    tools=[],\n)`
  ).join("\n");
  const wfContent = `"""Sequential workflow steps."""\n\nfrom google.adk import Agent\n${wfDefs}\n`;
  safeWriteFile(workDir, "wf_test/workflow.py", wfContent, true);
  assertPythonSyntax(join(workDir, "wf_test/workflow.py"), "seq_workflow: workflow.py valid Python");

  const waContent = `"""test - Sequential workflow agent."""\n\nfrom google.adk.agents import SequentialAgent\nfrom .workflow import step_one, step_two\n\n\nroot_agent = SequentialAgent(\n    name="test_workflow",\n    sub_agents=[step_one, step_two],\n    description="Sequential workflow for test.",\n)\n`;
  safeWriteFile(workDir, "wf_test/workflow_agent.py", waContent, true);
  assertPythonSyntax(join(workDir, "wf_test/workflow_agent.py"), "seq_workflow: workflow_agent.py valid Python");

  // ================================================================
  // 16. Generated file structure
  // ================================================================
  console.log("--- File structure ---");

  const basicFiles = listFilesRecursive(join(workDir, basicBase));
  assert(basicFiles.includes("test_basic/agent.py"), "basic: has agent.py");
  assert(basicFiles.includes("test_basic/__init__.py"), "basic: has __init__.py");
  assert(basicFiles.includes(".env.example"), "basic: has .env.example");
  assert(basicFiles.includes("README.md"), "basic: has README.md");
  assert(basicFiles.includes(".adk-scaffold.json"), "basic: has .adk-scaffold.json");
  assert(basicFiles.includes(".gitignore"), "basic: has .gitignore");

  const mcpFiles = listFilesRecursive(join(workDir, mcpBase));
  assert(mcpFiles.includes("test_mcp/mcp_config.py"), "mcp: has mcp_config.py");
  assert(mcpFiles.includes(".adk-scaffold.json"), "mcp: has .adk-scaffold.json");
  assert(mcpFiles.includes(".gitignore"), "mcp: has .gitignore");

  const seqFiles = listFilesRecursive(join(workDir, seqBase));
  assert(seqFiles.includes("test_seq/steps.py"), "seq: has steps.py");
  assert(seqFiles.includes(".adk-scaffold.json"), "seq: has .adk-scaffold.json");
  assert(seqFiles.includes(".gitignore"), "seq: has .gitignore");

  // ================================================================
  // Summary
  // ================================================================
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
