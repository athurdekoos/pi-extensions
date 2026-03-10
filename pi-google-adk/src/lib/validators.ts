/**
 * Input validation helpers for ADK project scaffolding.
 */

const VALID_NAME = /^[a-z][a-z0-9_]*$/;
const VALID_TOOL_NAME = /^[a-z][a-z0-9_]*$/;

export function validateAgentName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return "Agent name is required";
  }
  if (!VALID_NAME.test(name)) {
    return `Agent name must be lowercase alphanumeric with underscores, starting with a letter. Got: "${name}"`;
  }
  if (name.length > 64) {
    return "Agent name must be 64 characters or fewer";
  }
  return null;
}

export function validateToolName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return "Tool name is required";
  }
  if (!VALID_TOOL_NAME.test(name)) {
    return `Tool name must be lowercase alphanumeric with underscores, starting with a letter. Got: "${name}"`;
  }
  if (name.length > 64) {
    return "Tool name must be 64 characters or fewer";
  }
  return null;
}

export type TemplateType = "basic" | "mcp" | "sequential";
export type CapabilityType =
  | "custom_tool"
  | "mcp_toolset"
  | "sequential_workflow"
  | "eval_stub"
  | "deploy_stub"
  | "observability_notes";

const VALID_TEMPLATES: TemplateType[] = ["basic", "mcp", "sequential"];
const VALID_CAPABILITIES: CapabilityType[] = [
  "custom_tool",
  "mcp_toolset",
  "sequential_workflow",
  "eval_stub",
  "deploy_stub",
  "observability_notes",
];

export function isValidTemplate(t: string): t is TemplateType {
  return VALID_TEMPLATES.includes(t as TemplateType);
}

export function isValidCapability(c: string): c is CapabilityType {
  return VALID_CAPABILITIES.includes(c as CapabilityType);
}
