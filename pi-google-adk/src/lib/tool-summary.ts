/**
 * Tool access summary builder (Phase 3).
 *
 * Produces a concise, user-facing summary of the tool plan for an ADK
 * project. Shown at the end of create/import and designed to help users
 * understand:
 * - What the ADK project itself can use
 * - What a Pi subagent session may have access to
 * - What safe custom tools are needed for delegation
 * - Any uncertainty or caveats
 */

import type { ToolPlan } from "./tool-plan.js";
import { PI_MONO_PROFILE_TOOLS } from "./tool-plan.js";

// ---------------------------------------------------------------------------
// ADK-native labels
// ---------------------------------------------------------------------------

const ADK_NATIVE_LABELS: Record<string, string> = {
  none: "No extra ADK-native tools",
  mcp_toolset: "MCP toolset",
  openapi_toolset: "OpenAPI / API toolset",
  custom_function_tools: "Local custom function tools",
  other: "Other ADK-native tools",
};

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Build a concise multi-section text summary of the tool plan.
 */
export function buildToolAccessSummary(plan: ToolPlan): string {
  const sections: string[] = [];

  // Section 1: ADK project tools
  sections.push(formatAdkSection(plan));

  // Section 2: Pi subagent/session tools
  sections.push(formatPiSessionSection(plan));

  // Section 3: Required safe custom tools
  sections.push(formatSafeToolsSection(plan));

  // Section 4: Caveats / uncertainty
  sections.push(formatCaveatsSection(plan));

  return sections.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Section formatters
// ---------------------------------------------------------------------------

function formatAdkSection(plan: ToolPlan): string {
  const lines: string[] = ["── ADK Project Tools ──"];
  lines.push("What this ADK project is configured to use:");

  if (plan.adk_native_tools.length === 0) {
    lines.push("  (none configured)");
  } else {
    for (const cat of plan.adk_native_tools) {
      lines.push(`  • ${ADK_NATIVE_LABELS[cat] ?? cat}`);
    }
  }

  if (plan.adk_native_notes) {
    lines.push(`  Note: ${plan.adk_native_notes}`);
  }

  return lines.join("\n");
}

function formatPiSessionSection(plan: ToolPlan): string {
  const lines: string[] = ["── Pi Subagent/Session Tools ──"];
  lines.push("What a Pi subagent may have access to when delegating:");

  // Built-in profile
  const profileLabel =
    plan.pi_mono_profile === "read_only"
      ? "Read-only"
      : plan.pi_mono_profile === "coding"
        ? "Coding"
        : "No preference";

  const builtinTools = plan.pi_mono_builtin_tools.length > 0
    ? plan.pi_mono_builtin_tools.join(", ")
    : "(none)";

  lines.push(`  Profile: ${profileLabel} → ${builtinTools}`);

  // Extension tools
  if (plan.installed_extension_tools_selected.length > 0) {
    lines.push("  Selected extension tools:");
    for (const t of plan.installed_extension_tools_selected) {
      const detected = plan.installed_extension_tools_detected.includes(t);
      const status = detected ? "detected" : "requested but not currently detected";
      lines.push(`    • ${t} (${status})`);
    }
  }

  if (
    plan.installed_extension_tools_detected.length > 0 &&
    plan.installed_extension_tools_selected.length === 0
  ) {
    lines.push(`  ${plan.installed_extension_tools_detected.length} extension tool(s) detected but none selected.`);
  }

  return lines.join("\n");
}

function formatSafeToolsSection(plan: ToolPlan): string {
  const lines: string[] = ["── Required Safe Custom Tools ──"];
  lines.push("What pi-subagents will likely need allowlisted:");

  if (plan.required_safe_custom_tools.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of plan.required_safe_custom_tools) {
      lines.push(`  • ${t}`);
    }
  }

  return lines.join("\n");
}

function formatCaveatsSection(plan: ToolPlan): string {
  const items: string[] = [];

  // Add notes
  for (const n of plan.notes) {
    items.push(n);
  }

  // Add caveats
  for (const c of plan.caveats) {
    items.push(c);
  }

  if (items.length === 0) return "";

  const lines = ["── Notes & Caveats ──"];
  for (const item of items) {
    lines.push(`  ⚠ ${item}`);
  }

  return lines.join("\n");
}

/**
 * Build a short one-liner indicating tool plan status for discovery labels.
 */
export function toolPlanStatusLabel(plan: ToolPlan | undefined): string {
  if (!plan) return "";
  if (plan.pi_mono_profile === "unknown" && plan.adk_native_tools.length === 0) {
    return "[no tool plan]";
  }
  const parts: string[] = [];
  if (plan.pi_mono_profile !== "unknown") {
    parts.push(plan.pi_mono_profile);
  }
  if (plan.adk_native_tools.length > 0) {
    parts.push(plan.adk_native_tools.join("+"));
  }
  return `[tools: ${parts.join(", ")}]`;
}
