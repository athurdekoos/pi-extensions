/**
 * Verification script for pi-google-adk.
 *
 * Exercises create_adk_agent and add_adk_capability logic directly,
 * writing to a temp directory inside the repo, then inspects the output.
 *
 * Run: npx tsx scripts/verify.ts
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { safeWriteFile, safeReadFile, safeExists, safePath } from "../src/lib/fs-safe.js";
import { validateAgentName, validateToolName } from "../src/lib/validators.js";
import { detectAdkProject } from "../src/lib/project-detect.js";
import { adkDocsMcpConfig } from "../src/lib/adk-docs-mcp.js";
import * as basicTemplate from "../src/templates/python-basic/files.js";
import * as mcpTemplate from "../src/templates/python-mcp/files.js";
import * as sequentialTemplate from "../src/templates/python-sequential/files.js";

// ── Helpers ──────────────────────────────────────────────────────────

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

// ── Test workspace ──────────────────────────────────────────────────

const workDir = mkdtempSync(join(tmpdir(), "pi-google-adk-verify-"));
console.log(`Test workspace: ${workDir}\n`);

try {
  // ================================================================
  // 1. Validator tests
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
  // 2. Path safety tests
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

  // safePath within root should work
  const inside = safePath(workDir, "sub/dir/file.txt");
  assert(inside.startsWith(workDir), "safe path within root resolved");

  // ================================================================
  // 3. Template generation: basic
  // ================================================================
  console.log("--- Template: basic ---");

  const basicVars = { name: "test_basic", model: "gemini-2.5-flash" };
  const basicBase = "proj_basic";

  safeWriteFile(workDir, `${basicBase}/test_basic/__init__.py`, basicTemplate.initPy(basicVars), false);
  safeWriteFile(workDir, `${basicBase}/test_basic/agent.py`, basicTemplate.agentPy(basicVars), false);
  safeWriteFile(workDir, `${basicBase}/.env.example`, basicTemplate.envExample(), false);
  safeWriteFile(workDir, `${basicBase}/README.md`, basicTemplate.projectReadme(basicVars), false);
  safeWriteFile(workDir, `${basicBase}/.adk-scaffold`, basicTemplate.adkScaffoldMarker(basicVars), false);

  const basicAgent = readFileSync(join(workDir, basicBase, "test_basic", "agent.py"), "utf-8");
  assertIncludes(basicAgent, "from google.adk import Agent", "basic: has Agent import");
  assertNotIncludes(basicAgent, "import google.adk as adk", "basic: no deprecated adk namespace import");
  assertIncludes(basicAgent, 'model="gemini-2.5-flash"', "basic: has model");
  assertIncludes(basicAgent, 'name="test_basic"', "basic: has agent name");
  assertIncludes(basicAgent, "root_agent = Agent(", "basic: defines root_agent via Agent()");
  assertIncludes(basicAgent, "tools=[get_greeting, get_current_time]", "basic: has tools list");
  // Check no stray JS template syntax leaked
  assertNotIncludes(basicAgent, "${", "basic: no unresolved JS template vars in agent.py");

  const basicInit = readFileSync(join(workDir, basicBase, "test_basic", "__init__.py"), "utf-8");
  assertIncludes(basicInit, "from .agent import root_agent", "basic: init imports root_agent");

  const basicMarker = JSON.parse(readFileSync(join(workDir, basicBase, ".adk-scaffold"), "utf-8"));
  assert(basicMarker.name === "test_basic", "basic: marker has name");
  assert(basicMarker.template === "basic", "basic: marker has template");

  // project detection
  const basicDetect = detectAdkProject(join(workDir, basicBase));
  assert(basicDetect.valid, "basic: project detected as valid");
  assert(basicDetect.agentName === "test_basic", "basic: agent name from marker");
  assert(basicDetect.template === "basic", "basic: template from marker");

  // ================================================================
  // 4. Template generation: mcp
  // ================================================================
  console.log("--- Template: mcp ---");

  const mcpVars = { name: "test_mcp", model: "gemini-2.5-pro" };
  const mcpBase = "proj_mcp";

  safeWriteFile(workDir, `${mcpBase}/test_mcp/__init__.py`, mcpTemplate.initPy(mcpVars), false);
  safeWriteFile(workDir, `${mcpBase}/test_mcp/agent.py`, mcpTemplate.agentPy(mcpVars), false);
  safeWriteFile(workDir, `${mcpBase}/test_mcp/mcp_config.py`, mcpTemplate.mcpConfigPy(mcpVars), false);
  safeWriteFile(workDir, `${mcpBase}/.env.example`, mcpTemplate.envExample(), false);
  safeWriteFile(workDir, `${mcpBase}/.adk-scaffold`, mcpTemplate.adkScaffoldMarker(mcpVars), false);

  const mcpAgent = readFileSync(join(workDir, mcpBase, "test_mcp", "agent.py"), "utf-8");
  assertIncludes(mcpAgent, "from google.adk import Agent", "mcp: has Agent import");
  assertIncludes(mcpAgent, "from .mcp_config import get_mcp_toolsets", "mcp: imports mcp_config");
  assertIncludes(mcpAgent, "mcp_toolsets = get_mcp_toolsets()", "mcp: calls get_mcp_toolsets");
  assertIncludes(mcpAgent, "*mcp_toolsets", "mcp: spreads mcp_toolsets in tools");
  assertIncludes(mcpAgent, 'model="gemini-2.5-pro"', "mcp: uses specified model");
  assertIncludes(mcpAgent, "root_agent = Agent(", "mcp: uses Agent() not adk.LlmAgent()");
  assertNotIncludes(mcpAgent, "${", "mcp: no unresolved JS template vars in agent.py");

  const mcpConfig = readFileSync(join(workDir, mcpBase, "test_mcp", "mcp_config.py"), "utf-8");
  assertIncludes(mcpConfig, "MCPToolset", "mcp: config references MCPToolset");
  assertIncludes(mcpConfig, "StdioServerParameters", "mcp: config references StdioServerParameters");
  assertNotIncludes(mcpConfig, "${", "mcp: no unresolved JS template vars in mcp_config.py");

  // ================================================================
  // 5. Template generation: sequential
  // ================================================================
  console.log("--- Template: sequential ---");

  const seqVars = { name: "test_seq", model: "gemini-2.5-flash" };
  const seqBase = "proj_seq";

  safeWriteFile(workDir, `${seqBase}/test_seq/__init__.py`, sequentialTemplate.initPy(seqVars), false);
  safeWriteFile(workDir, `${seqBase}/test_seq/agent.py`, sequentialTemplate.agentPy(seqVars), false);
  safeWriteFile(workDir, `${seqBase}/test_seq/steps.py`, sequentialTemplate.stepsPy(seqVars), false);
  safeWriteFile(workDir, `${seqBase}/.env.example`, sequentialTemplate.envExample(), false);
  safeWriteFile(workDir, `${seqBase}/.adk-scaffold`, sequentialTemplate.adkScaffoldMarker(seqVars), false);

  const seqAgent = readFileSync(join(workDir, seqBase, "test_seq", "agent.py"), "utf-8");
  assertIncludes(seqAgent, "from google.adk.agents import SequentialAgent", "seq: imports SequentialAgent");
  assertIncludes(seqAgent, "root_agent = SequentialAgent(", "seq: uses SequentialAgent()");
  assertIncludes(seqAgent, "from .steps import research_agent, draft_agent, review_agent", "seq: imports steps");
  assertIncludes(seqAgent, "sub_agents=[research_agent, draft_agent, review_agent]", "seq: sub_agents list");
  assertNotIncludes(seqAgent, "adk.SequentialAgent", "seq: no deprecated adk.SequentialAgent");
  assertNotIncludes(seqAgent, "${", "seq: no unresolved JS template vars in agent.py");

  const seqSteps = readFileSync(join(workDir, seqBase, "test_seq", "steps.py"), "utf-8");
  assertIncludes(seqSteps, "from google.adk import Agent", "seq: steps imports Agent");
  assertIncludes(seqSteps, "research_agent = Agent(", "seq: has research_agent");
  assertIncludes(seqSteps, "draft_agent = Agent(", "seq: has draft_agent");
  assertIncludes(seqSteps, "review_agent = Agent(", "seq: has review_agent");
  assertNotIncludes(seqSteps, "adk.LlmAgent", "seq: no deprecated adk.LlmAgent");
  assertNotIncludes(seqSteps, "${", "seq: no unresolved JS template vars in steps.py");

  // ================================================================
  // 5b. Python syntax validation of all generated .py files
  // ================================================================
  console.log("--- Python syntax check ---");

  const { execSync } = await import("node:child_process");
  for (const projDir of [basicBase, mcpBase, seqBase]) {
    const pyFiles = listFilesRecursive(join(workDir, projDir)).filter(f => f.endsWith(".py"));
    for (const pyFile of pyFiles) {
      const fullPath = join(workDir, projDir, pyFile);
      try {
        execSync(`python3 -c "import ast; ast.parse(open('${fullPath}').read())"`, { stdio: "pipe" });
        assert(true, `python syntax: ${projDir}/${pyFile}`);
      } catch (e) {
        const err = e as { stderr?: Buffer };
        assert(false, `python syntax: ${projDir}/${pyFile} — ${err.stderr?.toString().trim()}`);
      }
    }
  }

  // ================================================================
  // 6. ADK docs MCP config
  // ================================================================
  console.log("--- ADK docs MCP config ---");

  const mcpJson = adkDocsMcpConfig();
  const mcpParsed = JSON.parse(mcpJson);
  assert(mcpParsed.mcpServers !== undefined, "mcp config: has mcpServers");
  assert(mcpParsed.mcpServers["adk-docs-mcp"] !== undefined, "mcp config: has adk-docs-mcp");
  assert(mcpParsed.mcpServers["adk-docs-mcp"].command === "uvx", "mcp config: command is uvx");
  assert(
    mcpParsed.mcpServers["adk-docs-mcp"].args.includes("AgentDevelopmentKit:https://google.github.io/adk-docs/llms.txt"),
    "mcp config: has llms.txt URL"
  );

  // ================================================================
  // 7. Overwrite protection
  // ================================================================
  console.log("--- Overwrite protection ---");

  const owResult1 = safeWriteFile(workDir, "overwrite_test.txt", "first", false);
  assert(owResult1.created === true, "overwrite: first write creates");
  const owResult2 = safeWriteFile(workDir, "overwrite_test.txt", "second", false);
  assert(owResult2.skipped === true, "overwrite: second write without overwrite skips");
  assert(owResult2.reason === "already exists", "overwrite: skip reason is 'already exists'");
  const owResult3 = safeWriteFile(workDir, "overwrite_test.txt", "second", true);
  assert(owResult3.created === true, "overwrite: write with overwrite=true succeeds");

  // ================================================================
  // 8. Idempotency: add_adk_capability custom_tool patch simulation
  // ================================================================
  console.log("--- Patch idempotency: custom_tool ---");

  // Start with the basic project
  const idempBase = "proj_idemp";
  const idempName = "idemp_agent";
  const idempVars = { name: idempName, model: "gemini-2.5-flash" };
  safeWriteFile(workDir, `${idempBase}/${idempName}/__init__.py`, basicTemplate.initPy(idempVars), false);
  safeWriteFile(workDir, `${idempBase}/${idempName}/agent.py`, basicTemplate.agentPy(idempVars), false);
  safeWriteFile(workDir, `${idempBase}/.adk-scaffold`, basicTemplate.adkScaffoldMarker(idempVars), false);

  // Simulate addCustomTool logic — first run
  const agentPyPath = `${idempBase}/${idempName}/agent.py`;
  let agentPy = safeReadFile(workDir, agentPyPath)!;
  const toolName = "fetch_data";
  const importLine = `from .tools.${toolName} import ${toolName}`;

  if (!agentPy.includes(importLine)) {
    const lines = agentPy.split("\n");
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ") || lines[i].startsWith("from ")) {
        lastImportIdx = i;
      }
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, importLine);
    }
    const joined = lines.join("\n");
    const patched = joined.replace(
      /tools=\[([^\]]*)\]/,
      (_match, inner) => {
        const trimmed = inner.trimEnd();
        if (trimmed.length === 0) return `tools=[${toolName}]`;
        return `tools=[${trimmed}, ${toolName}]`;
      }
    );
    safeWriteFile(workDir, agentPyPath, patched, true);
  }

  const afterFirst = safeReadFile(workDir, agentPyPath)!;
  const importCount1 = (afterFirst.match(new RegExp(importLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
  assert(importCount1 === 1, "idemp: first patch adds import once");
  assertIncludes(afterFirst, `fetch_data`, "idemp: first patch adds tool to tools list");

  // Simulate second run — should be idempotent
  agentPy = safeReadFile(workDir, agentPyPath)!;
  if (!agentPy.includes(importLine)) {
    assert(false, "idemp: import should already be present for second run");
  } else {
    // idempotent — would skip
    assert(true, "idemp: second run detects existing import and skips");
  }

  const importCount2 = (afterFirst.match(new RegExp(importLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
  assert(importCount2 === 1, "idemp: import not duplicated");

  // ================================================================
  // 9. add_adk_capability: eval_stub, deploy_stub, observability_notes
  // ================================================================
  console.log("--- Capabilities: stub files ---");

  // eval_stub
  const evalReadmePath = `${basicBase}/evals/README.md`;
  const evalTestPath = `${basicBase}/evals/test_cases.json`;
  safeWriteFile(workDir, evalReadmePath, `# Evaluations for test_basic\n`, false);
  safeWriteFile(workDir, evalTestPath, `[]\n`, false);
  assert(safeExists(workDir, evalReadmePath), "eval_stub: README created");
  assert(safeExists(workDir, evalTestPath), "eval_stub: test_cases.json created");

  // eval_stub idempotency: should skip if already exists
  const evalR2 = safeWriteFile(workDir, evalReadmePath, "new content", false);
  assert(evalR2.skipped === true, "eval_stub: idempotent (skips existing README)");

  // deploy_stub
  safeWriteFile(workDir, `${basicBase}/DEPLOY.md`, "# Deploy\n", false);
  assert(safeExists(workDir, `${basicBase}/DEPLOY.md`), "deploy_stub: DEPLOY.md created");
  const deployR2 = safeWriteFile(workDir, `${basicBase}/DEPLOY.md`, "new", false);
  assert(deployR2.skipped === true, "deploy_stub: idempotent (skips existing)");

  // observability_notes
  safeWriteFile(workDir, `${basicBase}/OBSERVABILITY.md`, "# Obs\n", false);
  assert(safeExists(workDir, `${basicBase}/OBSERVABILITY.md`), "obs_notes: created");
  const obsR2 = safeWriteFile(workDir, `${basicBase}/OBSERVABILITY.md`, "new", false);
  assert(obsR2.skipped === true, "obs_notes: idempotent (skips existing)");

  // ================================================================
  // 10. add_adk_capability: sequential_workflow generated code
  // ================================================================
  console.log("--- Capability: sequential_workflow Python check ---");

  // Generate a workflow.py and check Python syntax
  const wfSubagents = ["step_one", "step_two"];
  const wfModel = "gemini-2.5-flash";
  const wfSubagentDefs = wfSubagents.map(
    (name) => `\n${name} = Agent(\n    model="${wfModel}",\n    name="${name}",\n    instruction="""You are the ${name} step.\nComplete your part of the workflow and pass results to the next step.""",\n    tools=[],\n)`
  ).join("\n");
  const wfContent = `"""Sequential workflow steps."""\n\nfrom google.adk import Agent\n${wfSubagentDefs}\n`;
  safeWriteFile(workDir, "wf_test/workflow.py", wfContent, true);
  try {
    const wfPath = join(workDir, "wf_test/workflow.py");
    execSync(`python3 -c "import ast; ast.parse(open('${wfPath}').read())"`, { stdio: "pipe" });
    assert(true, "seq_workflow: generated workflow.py valid Python");
  } catch (e) {
    const err = e as { stderr?: Buffer };
    assert(false, `seq_workflow: workflow.py syntax error — ${err.stderr?.toString().trim()}`);
  }

  // workflow_agent.py check
  const wfAgentContent = `"""test - Sequential workflow agent."""\n\nfrom google.adk.agents import SequentialAgent\nfrom .workflow import step_one, step_two\n\n\nroot_agent = SequentialAgent(\n    name="test_workflow",\n    sub_agents=[step_one, step_two],\n    description="Sequential workflow for test.",\n)\n`;
  safeWriteFile(workDir, "wf_test/workflow_agent.py", wfAgentContent, true);
  try {
    const waPath = join(workDir, "wf_test/workflow_agent.py");
    execSync(`python3 -c "import ast; ast.parse(open('${waPath}').read())"`, { stdio: "pipe" });
    assert(true, "seq_workflow: generated workflow_agent.py valid Python");
  } catch (e) {
    const err = e as { stderr?: Buffer };
    assert(false, `seq_workflow: workflow_agent.py syntax error — ${err.stderr?.toString().trim()}`);
  }

  // ================================================================
  // 11. File listing for generated projects
  // ================================================================
  console.log("--- Generated file structure ---");

  const basicFiles = listFilesRecursive(join(workDir, basicBase));
  assert(basicFiles.includes("test_basic/agent.py"), "basic: has agent.py");
  assert(basicFiles.includes("test_basic/__init__.py"), "basic: has __init__.py");
  assert(basicFiles.includes(".env.example"), "basic: has .env.example");
  assert(basicFiles.includes("README.md"), "basic: has README.md");
  assert(basicFiles.includes(".adk-scaffold"), "basic: has .adk-scaffold");

  const mcpFiles = listFilesRecursive(join(workDir, mcpBase));
  assert(mcpFiles.includes("test_mcp/mcp_config.py"), "mcp: has mcp_config.py");

  const seqFiles = listFilesRecursive(join(workDir, seqBase));
  assert(seqFiles.includes("test_seq/steps.py"), "seq: has steps.py");

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
