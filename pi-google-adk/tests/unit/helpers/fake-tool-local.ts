/**
 * Minimal fake ToolDefinition factory for pi-google-adk unit tests.
 */

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function makeFakeTool(name: string, description = `Fake tool: ${name}`): ToolDefinition {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text" as const, text: `${name} executed` }],
        details: {},
      };
    },
  };
}
