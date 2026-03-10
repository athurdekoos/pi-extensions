/**
 * Tool: run_adk_agent
 *
 * Executes an on-disk ADK project using `adk run --replay` and returns
 * the agent's output. Designed to be safe-tool-registered for use in
 * pi-subagents child sessions.
 */

import { Type } from "@sinclair/typebox";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import {
  validateProject,
  checkAdkCli,
  executeAdkAgent,
  type AdkRunResult,
} from "../lib/adk-runtime.js";
import { registerSafeToolForSubagents } from "../lib/safe-tool-registration.js";

export const RunAdkAgentParams = Type.Object({
  project_path: Type.String({
    description:
      "Path to the ADK project root, relative to the workspace. " +
      "Must be a directory containing an .adk-scaffold.json manifest or recognized ADK project structure.",
  }),
  prompt: Type.String({
    description: "Task or query to send to the ADK agent.",
  }),
  timeout_seconds: Type.Optional(
    Type.Number({
      description: "Maximum execution time in seconds. Default: 180.",
      minimum: 5,
      maximum: 600,
    })
  ),
});

const DEFAULT_TIMEOUT = 180;

/**
 * Build the ToolDefinition for run_adk_agent.
 * Exported separately so it can be registered as a safe tool for subagents
 * AND as a regular Pi tool.
 */
export function buildRunAdkAgentToolDef(): ToolDefinition {
  return {
    name: "run_adk_agent",
    label: "Run ADK Agent",
    description:
      "Execute an on-disk Google ADK agent project and return its output. " +
      "The project must have been created with create_adk_agent or be a recognized ADK project. " +
      "Requires the 'adk' CLI (pip install google-adk). " +
      "Credentials (e.g. GOOGLE_API_KEY) can be set in the environment or in the project's .env file.",
    parameters: RunAdkAgentParams,
    promptSnippet:
      "run_adk_agent - Execute an ADK agent project on disk and get its output.",
    promptGuidelines: [
      "Provide the project_path relative to the workspace root (e.g., ./agents/researcher).",
      "The prompt should be a clear, self-contained task for the ADK agent.",
      "The ADK agent runs in a subprocess — it cannot access Pi tools or context.",
      "GOOGLE_API_KEY should be set in the environment or in the project's .env file.",
      "Use timeout_seconds for long-running agent tasks (default: 180s).",
    ],

    async execute(
      _toolCallId: string,
      params: { project_path: string; prompt: string; timeout_seconds?: number },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string }
    ) {
      const cwd = ctx.cwd ?? process.cwd();
      const projectPath = params.project_path;
      const prompt = params.prompt;
      const timeout = params.timeout_seconds ?? DEFAULT_TIMEOUT;

      // 1. Validate project path and structure
      const validation = validateProject(cwd, projectPath);
      if (!validation.ok) {
        return formatResult(validation.result);
      }

      // 2. Check adk CLI availability
      const cliCheck = await checkAdkCli();
      if (!cliCheck.available) {
        const result: AdkRunResult = {
          success: false,
          project_path: projectPath,
          agent_name: validation.info.agentName,
          template: validation.info.template,
          final_output: "",
          raw_stdout: "",
          raw_stderr: "",
          stdout: "",
          stderr: "",
          exit_code: null,
          error: cliCheck.error ?? "The 'adk' CLI is not available.",
        };
        return formatResult(result);
      }

      // 3. Execute the agent
      // Note: GOOGLE_API_KEY is NOT checked here. ADK Python projects may
      // load credentials from a project .env file via python-dotenv at
      // runtime. The subprocess is the source of truth for auth failures.
      const result = await executeAdkAgent(
        validation.resolvedPath,
        projectPath,
        prompt,
        validation.info,
        timeout,
        signal
      );

      return formatResult(result);
    },
  } as ToolDefinition;
}

function formatResult(result: AdkRunResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

/**
 * Register run_adk_agent as a Pi tool and as a safe tool for subagents.
 */
export function registerRunAdkAgent(pi: ExtensionAPI): void {
  const toolDef = buildRunAdkAgentToolDef();

  // Register as a standard Pi tool
  pi.registerTool(toolDef);

  // Register as a safe tool for pi-subagents (load-order resilient)
  registerSafeToolForSubagents(toolDef);
}
