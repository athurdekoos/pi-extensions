/**
 * Factory for fake ToolDefinition objects used in allowlist tests.
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

/**
 * Factory for a fake tool that returns a fixed canary string when called.
 * Used by safe-tool veracity tests to prove tool output flows through.
 */
export function makeFakeToolWithCanary(
  name: string,
  canaryText: string,
  description = `Safe tool: ${name}. Returns secret data.`
): ToolDefinition {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text" as const, text: canaryText }],
        details: {},
      };
    },
  };
}

/**
 * Factory for a fake tool that always throws when executed.
 * Used by safe-tool veracity tests to prove error propagation.
 */
export function makeFakeToolThatThrows(
  name: string,
  errorMessage: string,
  description = `Safe tool: ${name}. Returns data when called.`
): ToolDefinition {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({}),
    async execute() {
      throw new Error(errorMessage);
    },
  };
}
