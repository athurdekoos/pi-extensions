/**
 * Tool: resolve_adk_agent
 *
 * Resolves a name-or-path query to a specific ADK agent project.
 * Designed for cross-extension integration: pi-subagents calls this
 * to resolve an agent name before delegating.
 *
 * Also registered as a safe tool for subagent sessions.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { resolveAdkAgent } from "../lib/adk-discovery.js";
import { registerSafeToolForSubagents } from "../lib/safe-tool-registration.js";

export const ResolveAdkAgentParams = Type.Object({
  query: Type.String({
    description:
      "Agent name or relative path to resolve. " +
      "Examples: 'researcher', './agents/researcher', 'my_pipeline'.",
  }),
});

export function buildResolveAdkAgentToolDef(): ToolDefinition {
  return {
    name: "resolve_adk_agent",
    label: "Resolve ADK Agent",
    description:
      "Resolve an agent name or path to a specific ADK project. " +
      "Returns the match status, resolved agent metadata, and the list of all available agents. " +
      "Used by pi-subagents for ADK agent delegation.",
    parameters: ResolveAdkAgentParams,
    promptSnippet:
      "resolve_adk_agent - Resolve an ADK agent name or path to a project.",
    promptGuidelines: [
      "Use a plain agent name like 'researcher' for name-based resolution.",
      "Use a path like './agents/researcher' for direct path-based resolution.",
      "Check the 'status' field: 'found', 'not_found', or 'ambiguous'.",
    ],

    async execute(
      _toolCallId: string,
      params: { query: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string }
    ) {
      const cwd = ctx.cwd ?? process.cwd();
      const result = resolveAdkAgent(cwd, params.query);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as ToolDefinition;
}

export function registerResolveAdkAgent(pi: ExtensionAPI): void {
  const toolDef = buildResolveAdkAgentToolDef();
  pi.registerTool(toolDef);
  // Also safe-register so subagent children can call this if needed.
  registerSafeToolForSubagents(toolDef);
}
