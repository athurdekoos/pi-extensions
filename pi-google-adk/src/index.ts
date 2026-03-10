/**
 * pi-google-adk — Pi extension for creating, importing, discovering, resolving,
 * and running Google ADK agent projects.
 *
 * Registers six tools:
 * - create_adk_agent:        Create a new ADK project (native CLI, official sample, or legacy template)
 * - add_adk_capability:      Add capabilities to an existing ADK project
 * - run_adk_agent:           Execute an on-disk ADK project and return its output
 * - list_adk_agents:         Discover all ADK projects in the workspace
 * - resolve_adk_agent:       Resolve a name or path to a specific ADK project
 * - check_adk_sample_drift:  Detect drift between an imported sample and upstream
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCreateAdkAgent } from "./tools/create-adk-agent.js";
import { registerAddAdkCapability } from "./tools/add-adk-capability.js";
import { registerRunAdkAgent } from "./tools/run-adk-agent.js";
import { registerListAdkAgents } from "./tools/list-adk-agents.js";
import { registerResolveAdkAgent } from "./tools/resolve-adk-agent.js";
import { registerCheckAdkSampleDrift } from "./tools/check-adk-sample-drift.js";

export default function (pi: ExtensionAPI): void {
  registerCreateAdkAgent(pi);
  registerAddAdkCapability(pi);
  registerRunAdkAgent(pi);
  registerListAdkAgents(pi);
  registerResolveAdkAgent(pi);
  registerCheckAdkSampleDrift(pi);
}
