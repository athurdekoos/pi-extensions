/**
 * pi-google-adk — Pi extension for scaffolding and running Google ADK projects.
 *
 * Registers three tools:
 * - create_adk_agent: Scaffold a new Python ADK agent project
 * - add_adk_capability: Add capabilities to an existing ADK project
 * - run_adk_agent: Execute an on-disk ADK project and return its output
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCreateAdkAgent } from "./tools/create-adk-agent.js";
import { registerAddAdkCapability } from "./tools/add-adk-capability.js";
import { registerRunAdkAgent } from "./tools/run-adk-agent.js";
import { registerListAdkAgents } from "./tools/list-adk-agents.js";
import { registerResolveAdkAgent } from "./tools/resolve-adk-agent.js";

export default function (pi: ExtensionAPI): void {
  registerCreateAdkAgent(pi);
  registerAddAdkCapability(pi);
  registerRunAdkAgent(pi);
  registerListAdkAgents(pi);
  registerResolveAdkAgent(pi);
}
