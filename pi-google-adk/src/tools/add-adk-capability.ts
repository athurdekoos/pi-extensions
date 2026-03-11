/**
 * Tool: add_adk_capability
 *
 * Adds a capability to an existing ADK project by patching files deterministically.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { safeWriteFile, safeReadFile, safeExists, type WriteResult } from "../lib/fs-safe.js";
import { detectAdkProject } from "../lib/project-detect.js";
import { validateToolName } from "../lib/validators.js";

export const AddAdkCapabilityParams = Type.Object({
  project_path: Type.String({ description: "Path to the ADK project root" }),
  capability: StringEnum(
    [
      "custom_tool",
      "mcp_toolset",
      "sequential_workflow",
      "eval_stub",
      "deploy_stub",
      "observability_notes",
    ] as const,
    { description: "Capability to add" }
  ),
  options: Type.Optional(
    Type.Object(
      {
        tool_name: Type.Optional(Type.String({ description: "Name for custom tool" })),
        server_name: Type.Optional(Type.String({ description: "MCP server display name" })),
        server_command: Type.Optional(Type.String({ description: "MCP server command" })),
        server_args: Type.Optional(
          Type.Array(Type.String(), { description: "MCP server command arguments" })
        ),
        subagents: Type.Optional(
          Type.Array(Type.String(), { description: "Subagent names for sequential workflow" })
        ),
        model: Type.Optional(Type.String({ description: "Model for new agents" })),
      },
      { description: "Capability-specific options" }
    )
  ),
});

interface CapabilityResult {
  ok: boolean;
  project_path: string;
  capability: string;
  files_created: string[];
  files_modified: string[];
  files_skipped: string[];
  notes: string[];
  error?: string;
}

export function registerAddAdkCapability(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "add_adk_capability",
    label: "Add ADK Capability",
    description:
      "Add a capability to an existing Google ADK project. " +
      "Capabilities: custom_tool, mcp_toolset, sequential_workflow, eval_stub, deploy_stub, observability_notes.",
    parameters: AddAdkCapabilityParams,

    async execute(_toolCallId, params) {
      const projectPath = params.project_path;
      const capability = params.capability;
      const options = params.options ?? {};
      const cwd = process.cwd();

      // Validate project_path stays within workspace
      const pathError = validateProjectPath(cwd, projectPath);
      if (pathError) {
        return errorResult(projectPath, capability, pathError);
      }

      // Validate project
      const projectRoot = resolve(cwd, projectPath);
      const info = detectAdkProject(projectRoot);
      if (!info.valid) {
        return errorResult(projectPath, capability, info.error ?? "Not a valid ADK project");
      }

      const agentName = info.agentName ?? detectAgentDirName(projectRoot);
      if (!agentName) {
        return errorResult(
          projectPath,
          capability,
          "Could not determine agent name. Ensure the project has a .pi-adk-metadata.json file or a recognizable agent directory."
        );
      }

      try {
        let result;
        switch (capability) {
          case "custom_tool":
            result = addCustomTool(cwd, projectPath, agentName, options);
            break;
          case "mcp_toolset":
            result = addMcpToolset(cwd, projectPath, agentName, options);
            break;
          case "sequential_workflow":
            result = addSequentialWorkflow(cwd, projectPath, agentName, options);
            break;
          case "eval_stub":
            result = addEvalStub(cwd, projectPath, agentName);
            break;
          case "deploy_stub":
            result = addDeployStub(cwd, projectPath, agentName);
            break;
          case "observability_notes":
            result = addObservabilityNotes(cwd, projectPath, agentName);
            break;
          default:
            return errorResult(projectPath, capability, `Unknown capability: ${capability}`);
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(projectPath, capability, `Failed: ${msg}`);
      }
    },
  });
}

// ── Path validation ──────────────────────────────────────────────────

function validateProjectPath(cwd: string, projectPath: string): string | null {
  const resolvedCwd = resolve(cwd);
  const resolvedTarget = resolve(cwd, projectPath);
  const rel = relative(resolvedCwd, resolvedTarget);
  if (rel.startsWith("..")) {
    return (
      `project_path "${projectPath}" resolves outside the workspace root. ` +
      `Resolved: ${resolvedTarget}. Workspace: ${resolvedCwd}. ` +
      `Use a relative path within the current working directory.`
    );
  }
  return null;
}

// ── tools=[...] patching ─────────────────────────────────────────────

/**
 * Append an entry to a Python tools=[...] list, handling both single-line
 * and multi-line formatting.
 *
 * Single-line:  tools=[a, b]        -> tools=[a, b, new]
 * Multi-line:   tools=[             -> tools=[
 *                   a,                      a,
 *                   b,                      b,
 *               ]                           new,
 *                                       ]
 * Empty:        tools=[]             -> tools=[new]
 */
function patchToolsList(source: string, newEntry: string): string {
  // Multi-line: tools=[\n  ...\n<indent>]
  const multiLine = /tools=\[\s*\n([\s\S]*?)\n(\s*)\]/;
  const mlMatch = source.match(multiLine);
  if (mlMatch) {
    const body = mlMatch[1];
    const closingIndent = mlMatch[2];
    // Derive item indent from the closing bracket indent + 4 spaces
    const itemIndent = closingIndent + "    ";
    const newBody = body.trimEnd() + "\n" + itemIndent + newEntry + ",";
    return source.replace(multiLine, `tools=[\n${newBody}\n${closingIndent}]`);
  }

  // Single-line: tools=[...]
  const singleLine = /tools=\[([^\]]*)\]/;
  const slMatch = source.match(singleLine);
  if (slMatch) {
    const inner = slMatch[1].trim();
    if (inner.length === 0) {
      return source.replace(singleLine, `tools=[${newEntry}]`);
    }
    return source.replace(singleLine, `tools=[${inner}, ${newEntry}]`);
  }

  // No tools= list found — return unchanged
  return source;
}

// ── Capability: custom_tool ───────────────────────────────────────────

function addCustomTool(
  cwd: string,
  base: string,
  agentName: string,
  options: Record<string, unknown>
): ReturnType<typeof makeResult> {
  const toolName = (options.tool_name as string) ?? "my_tool";
  const nameError = validateToolName(toolName);
  if (nameError) {
    return errorResult(base, "custom_tool", nameError);
  }

  const results: WriteResult[] = [];
  const modified: string[] = [];
  const notes: string[] = [];

  // Create tools directory and tool file
  const toolContent = `"""Custom tool: ${toolName}"""


def ${toolName}(input_text: str) -> str:
    """Process the input and return a result.

    Args:
        input_text: The text to process.

    Returns:
        The processed result.
    """
    # TODO: Implement your tool logic here
    return f"Processed: {input_text}"
`;

  results.push(
    safeWriteFile(cwd, `${base}/${agentName}/tools/${toolName}.py`, toolContent, false)
  );

  // Create tools __init__.py
  const toolsInit = `"""Tools package for ${agentName}."""

from .${toolName} import ${toolName}

__all__ = ["${toolName}"]
`;
  const toolsInitPath = `${base}/${agentName}/tools/__init__.py`;
  if (safeExists(cwd, toolsInitPath)) {
    const existing = safeReadFile(cwd, toolsInitPath);
    if (existing && !existing.includes(`from .${toolName}`)) {
      const updated = existing.trimEnd() + `\nfrom .${toolName} import ${toolName}\n`;
      results.push(safeWriteFile(cwd, toolsInitPath, updated, true));
      modified.push(toolsInitPath);
    } else {
      notes.push(`tools/__init__.py already imports ${toolName}`);
    }
  } else {
    results.push(safeWriteFile(cwd, toolsInitPath, toolsInit, false));
  }

  // Patch agent.py to import and wire the tool
  const agentPyPath = `${base}/${agentName}/agent.py`;
  const agentPy = safeReadFile(cwd, agentPyPath);
  if (agentPy) {
    const importLine = `from .tools.${toolName} import ${toolName}`;
    if (!agentPy.includes(importLine)) {
      const withImport = insertImport(agentPy, importLine);
      const patched = patchToolsList(withImport, toolName);
      results.push(safeWriteFile(cwd, agentPyPath, patched, true));
      modified.push(agentPyPath);
    } else {
      notes.push("agent.py already imports this tool");
    }
  } else {
    notes.push("agent.py not found; tool file created but not wired");
  }

  return makeResult(base, "custom_tool", results, modified, notes);
}

// ── Capability: mcp_toolset ───────────────────────────────────────────

function addMcpToolset(
  cwd: string,
  base: string,
  agentName: string,
  options: Record<string, unknown>
): ReturnType<typeof makeResult> {
  const serverCommand = (options.server_command as string) ?? "npx";
  const serverArgs = (options.server_args as string[]) ?? ["-y", "@modelcontextprotocol/server-example"];

  const results: WriteResult[] = [];
  const modified: string[] = [];
  const notes: string[] = [];

  const mcpConfigContent = `"""MCP toolset configuration for ${agentName}.

Edit this file to configure MCP server connections.
"""

from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StdioServerParameters


def get_mcp_toolsets() -> list:
    """Return configured MCP toolsets."""
    return [
        MCPToolset(
            connection_params=StdioServerParameters(
                command="${serverCommand}",
                args=${JSON.stringify(serverArgs)},
            ),
        ),
    ]
`;

  const mcpConfigPath = `${base}/${agentName}/mcp_config.py`;
  if (safeExists(cwd, mcpConfigPath)) {
    notes.push("mcp_config.py already exists; creating mcp_config_new.py instead");
    results.push(
      safeWriteFile(cwd, `${base}/${agentName}/mcp_config_new.py`, mcpConfigContent, false)
    );
  } else {
    results.push(safeWriteFile(cwd, mcpConfigPath, mcpConfigContent, false));
  }

  // Patch agent.py to import MCP toolsets
  const agentPyPath = `${base}/${agentName}/agent.py`;
  const agentPy = safeReadFile(cwd, agentPyPath);
  if (agentPy && !agentPy.includes("mcp_config")) {
    const importLine = "from .mcp_config import get_mcp_toolsets";
    let patched = insertImport(agentPy, importLine);
    // Add assignment after imports
    const lines = patched.split("\n");
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ") || lines[i].startsWith("from ")) {
        lastImportIdx = i;
      }
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, "mcp_toolsets = get_mcp_toolsets()");
    }
    patched = lines.join("\n");

    patched = patchToolsList(patched, "*mcp_toolsets");

    results.push(safeWriteFile(cwd, agentPyPath, patched, true));
    modified.push(agentPyPath);
  } else if (agentPy) {
    notes.push("agent.py already references mcp_config");
  }

  return makeResult(base, "mcp_toolset", results, modified, notes);
}

// ── Capability: sequential_workflow ──────────────────────────────────

function addSequentialWorkflow(
  cwd: string,
  base: string,
  agentName: string,
  options: Record<string, unknown>
): ReturnType<typeof makeResult> {
  const subagents = (options.subagents as string[]) ?? ["step_one", "step_two"];
  const model = (options.model as string) ?? "gemini-2.5-flash";

  const results: WriteResult[] = [];
  const modified: string[] = [];
  const notes: string[] = [];

  const subagentDefs = subagents
    .map(
      (name) => `
${name} = Agent(
    model="${model}",
    name="${name}",
    instruction="""You are the ${name} step.
Complete your part of the workflow and pass results to the next step.""",
    tools=[],
)`
    )
    .join("\n");

  const workflowContent = `"""Sequential workflow steps for ${agentName}.

Edit the subagents below to define your workflow steps.
"""

from google.adk import Agent

${subagentDefs}
`;

  results.push(
    safeWriteFile(cwd, `${base}/${agentName}/workflow.py`, workflowContent, false)
  );

  // Create or update agent.py to use SequentialAgent
  const agentPyPath = `${base}/${agentName}/agent.py`;
  const agentPy = safeReadFile(cwd, agentPyPath);

  if (agentPy && !agentPy.includes("SequentialAgent")) {
    const subagentImports = subagents.join(", ");
    const workflowAgentPy = `"""${agentName} - Sequential workflow agent."""

from google.adk.agents import SequentialAgent
from .workflow import ${subagentImports}


root_agent = SequentialAgent(
    name="${agentName}_workflow",
    sub_agents=[${subagentImports}],
    description="Sequential workflow for ${agentName}.",
)
`;
    results.push(
      safeWriteFile(cwd, `${base}/${agentName}/workflow_agent.py`, workflowAgentPy, false)
    );
    notes.push(
      "Created workflow_agent.py alongside existing agent.py. " +
      "To use the workflow, update __init__.py to import from workflow_agent instead."
    );
  } else if (!agentPy) {
    const subagentImports = subagents.join(", ");
    const newAgentPy = `"""${agentName} - Sequential workflow agent."""

from google.adk.agents import SequentialAgent
from .workflow import ${subagentImports}


root_agent = SequentialAgent(
    name="${agentName}_workflow",
    sub_agents=[${subagentImports}],
    description="Sequential workflow for ${agentName}.",
)
`;
    results.push(safeWriteFile(cwd, agentPyPath, newAgentPy, false));
  } else {
    notes.push("agent.py already uses SequentialAgent");
  }

  return makeResult(base, "sequential_workflow", results, modified, notes);
}

// ── Capability: eval_stub ────────────────────────────────────────────

function addEvalStub(
  cwd: string,
  base: string,
  agentName: string
): ReturnType<typeof makeResult> {
  const results: WriteResult[] = [];
  const notes: string[] = [];

  const evalReadme = `# Evaluations for ${agentName}

This directory is a stub for agent evaluations.

## Getting Started

Google ADK supports evaluation through test datasets and assertions.
See: https://google.github.io/adk-docs/evaluate/

## Structure

\`\`\`
evals/
  README.md          <- You are here
  test_cases.json    <- Add test cases here
\`\`\`

## Example Test Case Format

\`\`\`json
[
  {
    "input": "What time is it?",
    "expected_tool": "get_current_time",
    "expected_contains": ["UTC"]
  }
]
\`\`\`

## Running Evaluations

This is a stub. Implement evaluation logic based on your agent's needs.
ADK evaluation support is evolving; check the docs for the latest patterns.
`;

  const testCases = JSON.stringify(
    [
      {
        input: "Hello",
        expected_contains: ["Hello"],
        description: "Basic greeting test",
      },
    ],
    null,
    2
  ) + "\n";

  results.push(safeWriteFile(cwd, `${base}/evals/README.md`, evalReadme, false));
  results.push(safeWriteFile(cwd, `${base}/evals/test_cases.json`, testCases, false));

  return makeResult(base, "eval_stub", results, [], notes);
}

// ── Capability: deploy_stub ──────────────────────────────────────────

function addDeployStub(
  cwd: string,
  base: string,
  agentName: string
): ReturnType<typeof makeResult> {
  const results: WriteResult[] = [];

  const deployMd = `# Deployment Notes for ${agentName}

> This is a stub. It does not automate deployment.

## Options

### Local Development

\`\`\`bash
adk web .
\`\`\`

### Google Cloud Run

1. Build a container image
2. Deploy to Cloud Run
3. Set environment variables (GOOGLE_API_KEY or use Vertex AI service account)

See: https://google.github.io/adk-docs/deploy/

### Vertex AI Agent Engine

ADK agents can be deployed to Vertex AI Agent Engine for managed hosting.

See: https://google.github.io/adk-docs/deploy/agent-engine/

## Environment Variables

Required:
- \`GOOGLE_API_KEY\` — For Gemini API access

Optional:
- \`GOOGLE_CLOUD_PROJECT\` — For Vertex AI
- \`GOOGLE_CLOUD_LOCATION\` — Region (default: us-central1)

## Pre-deployment Checklist

- [ ] All tools tested locally
- [ ] Environment variables documented
- [ ] Error handling covers edge cases
- [ ] Logging/tracing configured
- [ ] Rate limits understood
`;

  results.push(safeWriteFile(cwd, `${base}/DEPLOY.md`, deployMd, false));

  return makeResult(base, "deploy_stub", results, [], []);
}

// ── Capability: observability_notes ──────────────────────────────────

function addObservabilityNotes(
  cwd: string,
  base: string,
  agentName: string
): ReturnType<typeof makeResult> {
  const results: WriteResult[] = [];

  const obsMd = `# Observability Notes for ${agentName}

## Logging

ADK agents log to stdout by default. For structured logging:

\`\`\`python
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("${agentName}")
\`\`\`

## Tracing

Google ADK integrates with OpenTelemetry for tracing.

### Setup

\`\`\`bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-gcp-trace
\`\`\`

### Basic Configuration

\`\`\`python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter

trace.set_tracer_provider(TracerProvider())
trace.get_tracer_provider().add_span_processor(
    SimpleSpanProcessor(ConsoleSpanExporter())
)
\`\`\`

See: https://google.github.io/adk-docs/observe/

## Metrics to Track

- Request latency per tool call
- Token usage per agent invocation
- Error rates by tool
- MCP server connection health (if using MCP)

## Cloud Monitoring

When deployed to Google Cloud:
- Cloud Logging captures stdout/stderr
- Cloud Trace integrates with OpenTelemetry
- Cloud Monitoring can alert on custom metrics

## Local Development

Use \`adk web .\` which provides a built-in trace viewer in the dev UI.
`;

  results.push(safeWriteFile(cwd, `${base}/OBSERVABILITY.md`, obsMd, false));

  return makeResult(base, "observability_notes", results, [], []);
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Insert an import line after the last existing import in a Python source file.
 */
function insertImport(source: string, importLine: string): string {
  const lines = source.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("import ") || lines[i].startsWith("from ")) {
      lastImportIdx = i;
    }
  }
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importLine);
  } else {
    lines.unshift(importLine);
  }
  return lines.join("\n");
}

function detectAgentDirName(projectRoot: string): string | null {
  try {
    const entries = readdirSync(projectRoot);
    for (const entry of entries) {
      const entryPath = join(projectRoot, entry);
      if (statSync(entryPath).isDirectory() && !entry.startsWith(".")) {
        if (existsSync(join(entryPath, "agent.py"))) {
          return entry;
        }
      }
    }
  } catch {
    // directory not readable
  }
  return null;
}

function makeResult(
  base: string,
  capability: string,
  results: WriteResult[],
  modified: string[],
  notes: string[]
) {
  const created = results.filter((r) => r.created).map((r) => r.path);
  const skipped = results.filter((r) => r.skipped).map((r) => `${r.path} (${r.reason})`);

  const result: CapabilityResult = {
    ok: true,
    project_path: base,
    capability,
    files_created: created,
    files_modified: modified,
    files_skipped: skipped,
    notes,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

function errorResult(base: string, capability: string, message: string) {
  const result: CapabilityResult = {
    ok: false,
    project_path: base,
    capability,
    files_created: [],
    files_modified: [],
    files_skipped: [],
    notes: [],
    error: message,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}
