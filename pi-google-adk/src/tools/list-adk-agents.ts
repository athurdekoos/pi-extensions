/**
 * Tool: list_adk_agents
 *
 * Enumerates discoverable ADK agent projects in the workspace.
 * Used for integration with pi-subagents and for user-facing queries.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { discoverAdkAgents } from "../lib/adk-discovery.js";

export const ListAdkAgentsParams = Type.Object({});

export function registerListAdkAgents(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_adk_agents",
    label: "List ADK Agents",
    description:
      "Discover and list all ADK agent projects in the workspace. " +
      "Scans ./agents/ for projects created by create_adk_agent. " +
      "Returns name, path, template, and capabilities for each agent.",
    parameters: ListAdkAgentsParams,
    promptSnippet:
      "list_adk_agents - List all discoverable ADK agent projects in the workspace.",
    promptGuidelines: [
      "Use to see what ADK agents are available before delegating work.",
      "Agents are discovered from ./agents/ based on .adk-scaffold.json manifests or heuristics.",
    ],

    async execute(
      _toolCallId: string,
      _params: Record<string, never>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string }
    ) {
      const cwd = ctx.cwd ?? process.cwd();
      const agents = discoverAdkAgents(cwd);

      const result = {
        count: agents.length,
        agents: agents.map((a) => ({
          name: a.name,
          project_path: a.project_path,
          template: a.template,
          capabilities: a.capabilities,
          source: a.source,
          label: a.label,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
