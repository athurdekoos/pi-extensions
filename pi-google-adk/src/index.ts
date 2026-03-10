/**
 * pi-google-adk — Pi extension for scaffolding Google ADK projects.
 *
 * Registers two tools:
 * - create_adk_agent: Scaffold a new Python ADK agent project
 * - add_adk_capability: Add capabilities to an existing ADK project
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCreateAdkAgent } from "./tools/create-adk-agent.js";
import { registerAddAdkCapability } from "./tools/add-adk-capability.js";

export default function (pi: ExtensionAPI): void {
  registerCreateAdkAgent(pi);
  registerAddAdkCapability(pi);
}
