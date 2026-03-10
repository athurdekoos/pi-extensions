/**
 * Metadata-aware delegation advice for ADK-backed agents (Phase 4B).
 *
 * When delegating to an ADK project via pi-subagents, this module reads
 * the project's `.pi-adk-metadata.json` and builds an advisory summary
 * covering:
 * - recommended safe custom tools from the stored tool plan
 * - currently detected vs expected extension tools
 * - Pi Mono profile and built-in tools
 * - ADK-native tool patterns
 * - warnings about mismatches or missing tools
 *
 * All advice is advisory. It does not auto-grant tools, auto-modify
 * projects, or silently change runtime behavior.
 *
 * Phase 5A: Types are now sourced from the shared adk-metadata-schema
 * contract, eliminating the mirrored type definitions that were a
 * maintenance seam between pi-google-adk and pi-subagents.
 */

import { resolve } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  METADATA_FILENAME,
  validateMetadata,
  readAndValidateMetadata,
  type ToolPlanSchema,
  type NormalizedMetadata,
  type ValidationResult,
} from "../../../shared/adk-metadata-schema/index.js";

// ---------------------------------------------------------------------------
// Re-exported types (backward compatibility for existing test imports)
// ---------------------------------------------------------------------------

/** ToolPlanSnapshot is now an alias for the canonical ToolPlanSchema. */
export type ToolPlanSnapshot = ToolPlanSchema;

/**
 * MetadataSnapshot is now a lightweight projection of NormalizedMetadata.
 * Kept for backward compatibility with existing test code.
 */
export interface MetadataSnapshot {
  schema_version?: string;
  source_type?: string;
  agent_name?: string;
  project_path?: string;
  tool_plan?: ToolPlanSnapshot;
}

// ---------------------------------------------------------------------------
// Delegation advice model
// ---------------------------------------------------------------------------

/** Advisory information about delegating to an ADK-backed project. */
export interface DelegationAdvice {
  /** Absolute or relative project path inspected. */
  project_path: string;
  /** Source type from metadata: native_app, native_config, official_sample, or unknown. */
  source_type: string;
  /** Whether a tool_plan was found in metadata. */
  has_tool_plan: boolean;
  /** Safe custom tools recommended by the stored tool plan. */
  recommended_safe_custom_tools: string[];
  /** Safe custom tools that will actually be used for the child session. */
  effective_safe_custom_tools: string[];
  /** Extension tools currently detected in the safe tool registry. */
  currently_detected_extension_tools: string[];
  /** Extension tools expected by the metadata but not currently detected. */
  missing_expected_extension_tools: string[];
  /** Pi Mono built-in profile from the tool plan. */
  pi_mono_profile: string;
  /** Pi Mono built-in tools from the tool plan. */
  pi_mono_builtin_tools: string[];
  /** ADK-native tool categories from the tool plan. */
  adk_native_tools: string[];
  /** Warnings about mismatches or missing tools. */
  warnings: string[];
  /** Informational notes. */
  notes: string[];
  /** Human-readable summary of the advice. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Metadata reading (Phase 5A: uses shared schema validation)
// ---------------------------------------------------------------------------

/**
 * Read `.pi-adk-metadata.json` from a project path.
 *
 * Phase 5A: Now uses shared schema validation and normalization.
 * Returns a MetadataSnapshot for backward compatibility.
 * The `_validation` property on the returned object provides access
 * to the full validation result when needed.
 *
 * @param cwd  Workspace root (absolute).
 * @param projectPath  Relative project path (e.g. "./agents/researcher").
 * @returns Parsed metadata snapshot, or null if missing/unparseable.
 */
export function readAdkMetadata(
  cwd: string,
  projectPath: string
): MetadataSnapshot | null {
  const absDir = resolve(cwd, projectPath);
  const validation = readAndValidateMetadata(absDir);

  if (!validation.ok || !validation.metadata) return null;

  // Return as MetadataSnapshot for backward compat
  return validation.metadata as MetadataSnapshot;
}

/**
 * Read and validate `.pi-adk-metadata.json` with full diagnostics.
 *
 * Unlike readAdkMetadata (which returns null on failure), this returns
 * the full ValidationResult so callers can inspect warnings and errors.
 *
 * @param cwd  Workspace root (absolute).
 * @param projectPath  Relative project path.
 * @returns Full validation result.
 */
export function readAdkMetadataValidated(
  cwd: string,
  projectPath: string,
): ValidationResult {
  const absDir = resolve(cwd, projectPath);
  return readAndValidateMetadata(absDir);
}

// ---------------------------------------------------------------------------
// Extension tool detection at delegation time
// ---------------------------------------------------------------------------

/**
 * Detect extension tools currently available in the safe tool registry.
 *
 * This uses the same registry that pi-subagents uses for safeCustomTools
 * allowlisting, so it reflects what is actually registerable at delegation
 * time — not a theoretical scan.
 *
 * @param safeToolRegistry  The live safe tool registry from pi-subagents.
 * @returns Sorted array of tool names (excluding Pi built-ins).
 */
export function detectCurrentExtensionTools(
  safeToolRegistry: Map<string, ToolDefinition>
): string[] {
  const builtins = new Set([
    "read", "bash", "edit", "write", "grep", "find", "ls",
    "delegate_to_subagent",
  ]);
  return Array.from(safeToolRegistry.keys())
    .filter((name) => !builtins.has(name))
    .sort();
}

// ---------------------------------------------------------------------------
// Advice builder
// ---------------------------------------------------------------------------

/**
 * Build delegation advice for an ADK-backed project.
 *
 * @param cwd  Workspace root.
 * @param projectPath  Relative project path.
 * @param safeToolRegistry  Live safe tool registry.
 * @param userProvidedSafeTools  Tools explicitly provided by the user in
 *   the delegation call (may be undefined/empty).
 * @returns DelegationAdvice, or null if the target has no metadata.
 */
export function buildDelegationAdvice(
  cwd: string,
  projectPath: string,
  safeToolRegistry: Map<string, ToolDefinition>,
  userProvidedSafeTools: string[] | undefined
): DelegationAdvice | null {
  // Phase 5A: use validated read for diagnostics
  const validation = readAdkMetadataValidated(cwd, projectPath);
  if (!validation.ok || !validation.metadata) return null;

  const metadata = validation.metadata;
  const toolPlan = metadata.tool_plan ?? null;
  const sourceType = metadata.source_type ?? "unknown";
  const hasToolPlan = toolPlan !== null;

  // Recommended safe custom tools from the stored plan
  const recommended = toolPlan?.required_safe_custom_tools ?? [];

  // Currently detected extension tools
  const currentlyDetected = detectCurrentExtensionTools(safeToolRegistry);

  // Expected extension tools: what the plan says should be available
  const expectedExtTools = toolPlan?.installed_extension_tools_selected ?? [];

  // Missing: expected but not currently detected in the registry
  const currentSet = new Set(currentlyDetected);
  const missing = expectedExtTools.filter((t) => !currentSet.has(t));

  // Build effective safe custom tools
  const effective = computeEffectiveSafeTools(
    userProvidedSafeTools,
    recommended,
    safeToolRegistry
  );

  // Build warnings
  const warnings = buildWarnings(
    missing,
    recommended,
    userProvidedSafeTools,
    effective,
    safeToolRegistry,
    toolPlan
  );

  // Build notes (Phase 5A: include schema diagnostics when relevant)
  const notes = buildNotes(hasToolPlan, sourceType, toolPlan, validation);

  // Build human-readable summary
  const summary = buildSummaryText({
    sourceType,
    hasToolPlan,
    recommended,
    effective,
    currentlyDetected,
    missing,
    piMonoProfile: toolPlan?.pi_mono_profile ?? "unknown",
    adkNativeTools: toolPlan?.adk_native_tools ?? [],
    warnings,
  });

  return {
    project_path: projectPath,
    source_type: sourceType,
    has_tool_plan: hasToolPlan,
    recommended_safe_custom_tools: recommended,
    effective_safe_custom_tools: effective,
    currently_detected_extension_tools: currentlyDetected,
    missing_expected_extension_tools: missing,
    pi_mono_profile: toolPlan?.pi_mono_profile ?? "unknown",
    pi_mono_builtin_tools: toolPlan?.pi_mono_builtin_tools ?? [],
    adk_native_tools: toolPlan?.adk_native_tools ?? [],
    warnings,
    notes,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Safe custom tools computation
// ---------------------------------------------------------------------------

/**
 * Compute the effective safe custom tools for the child session.
 *
 * Policy (Phase 4B — conservative/advisory-first):
 * - If the user explicitly provided safeCustomTools, those are authoritative.
 *   Recommendations are surfaced in warnings/notes only.
 * - If no user-provided tools, we do NOT silently inject the full
 *   recommended list. The only automatic addition is `run_adk_agent`
 *   (already handled in the main delegation flow when `agent` param
 *   is present). Remaining recommendations are advisory.
 *
 * This function returns the list that would be used. The caller
 * (index.ts execute) still controls the actual allowlist.
 *
 * @param userProvided  Explicit safeCustomTools from the user.
 * @param recommended  Recommended tools from the tool plan.
 * @param registry  Live safe tool registry (for existence checking).
 * @returns Deduped effective tool list.
 */
export function computeEffectiveSafeTools(
  userProvided: string[] | undefined,
  recommended: string[],
  registry: Map<string, ToolDefinition>
): string[] {
  if (userProvided && userProvided.length > 0) {
    // User-provided is authoritative — return deduped copy, never mutate.
    return [...new Set(userProvided)];
  }

  // No user-provided tools. Advisory-first: only auto-add run_adk_agent
  // (which the main flow already does). Don't auto-add others.
  // Return empty — the main flow's Set-based logic handles run_adk_agent.
  return [];
}

// ---------------------------------------------------------------------------
// Warning builder
// ---------------------------------------------------------------------------

function buildWarnings(
  missing: string[],
  recommended: string[],
  userProvided: string[] | undefined,
  effective: string[],
  registry: Map<string, ToolDefinition>,
  toolPlan: ToolPlanSnapshot | null
): string[] {
  const warnings: string[] = [];

  // Warn about missing expected extension tools
  if (missing.length > 0) {
    warnings.push(
      `Expected extension tool(s) not currently detected: ${missing.join(", ")}. ` +
      `These tools were selected when the project was created but are not visible ` +
      `in the current Pi environment. The delegation may still proceed, but the ` +
      `ADK agent may not have access to all intended capabilities.`
    );
  }

  // Warn about recommended safe tools not in user-provided list
  if (userProvided && userProvided.length > 0 && recommended.length > 0) {
    const userSet = new Set(userProvided);
    const notIncluded = recommended.filter((t) => !userSet.has(t));
    if (notIncluded.length > 0) {
      warnings.push(
        `Recommended safe custom tools not in your explicit list: ${notIncluded.join(", ")}. ` +
        `The tool plan suggests these for delegation. Your explicit safeCustomTools ` +
        `list takes precedence.`
      );
    }
  }

  // Warn about recommended safe tools not registered in the safe tool registry
  if (recommended.length > 0) {
    const notRegistered = recommended.filter((t) => !registry.has(t));
    if (notRegistered.length > 0) {
      warnings.push(
        `Recommended safe tool(s) not currently registered: ${notRegistered.join(", ")}. ` +
        `These tools are recommended by the project's tool plan but are not ` +
        `available in the safe tool registry. Ensure the required extensions are loaded.`
      );
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Notes builder
// ---------------------------------------------------------------------------

function buildNotes(
  hasToolPlan: boolean,
  sourceType: string,
  toolPlan: ToolPlanSnapshot | null,
  validation?: ValidationResult,
): string[] {
  const notes: string[] = [];

  if (!hasToolPlan) {
    notes.push(
      "No tool plan found in project metadata. " +
      "This project may have been created before tool planning was available (Phase 3). " +
      "Delegation proceeds without metadata-aware recommendations."
    );
  }

  if (hasToolPlan && toolPlan) {
    for (const caveat of toolPlan.caveats ?? []) {
      notes.push(caveat);
    }
  }

  // Phase 5A: surface schema diagnostics that might affect delegation
  if (validation?.metadata?._schema_diagnostics) {
    for (const diag of validation.metadata._schema_diagnostics) {
      notes.push(`Schema: ${diag}`);
    }
  }

  notes.push(
    "Metadata is advisory. Actual tool availability depends on the current " +
    "Pi environment, loaded extensions, and explicit allowlisting."
  );

  return notes;
}

// ---------------------------------------------------------------------------
// Summary text builder
// ---------------------------------------------------------------------------

interface SummaryInput {
  sourceType: string;
  hasToolPlan: boolean;
  recommended: string[];
  effective: string[];
  currentlyDetected: string[];
  missing: string[];
  piMonoProfile: string;
  adkNativeTools: string[];
  warnings: string[];
}

function buildSummaryText(input: SummaryInput): string {
  const lines: string[] = [];

  lines.push(`── ADK Delegation Advisory ──`);
  lines.push(`Project type: ${input.sourceType}`);
  lines.push(`Tool plan: ${input.hasToolPlan ? "present" : "absent"}`);

  if (input.hasToolPlan) {
    // What the project expects
    lines.push("");
    lines.push("Project expectations:");
    if (input.adkNativeTools.length > 0) {
      lines.push(`  ADK-native tools: ${input.adkNativeTools.join(", ")}`);
    }
    lines.push(`  Pi Mono profile: ${input.piMonoProfile}`);
    if (input.recommended.length > 0) {
      lines.push(`  Recommended safe custom tools: ${input.recommended.join(", ")}`);
    }

    // What is currently available
    lines.push("");
    lines.push("Current availability:");
    lines.push(`  Detected extension tools: ${input.currentlyDetected.length > 0 ? input.currentlyDetected.join(", ") : "(none)"}`);
    if (input.missing.length > 0) {
      lines.push(`  ⚠ Missing expected tools: ${input.missing.join(", ")}`);
    } else if (input.currentlyDetected.length > 0) {
      lines.push(`  All expected extension tools are currently detected.`);
    }

    // What this means
    lines.push("");
    if (input.warnings.length === 0) {
      lines.push("Assessment: Delegation looks well-configured.");
    } else {
      lines.push(`Assessment: ${input.warnings.length} warning(s) — review above.`);
    }
  } else {
    lines.push("No tool plan available. Delegation proceeds without metadata-aware recommendations.");
  }

  lines.push("");
  lines.push("Note: All metadata is advisory, not an execution guarantee.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Convenience: format advice for inclusion in tool result
// ---------------------------------------------------------------------------

/**
 * Format a delegation advice object into a concise text block suitable
 * for appending to tool output.
 */
export function formatAdviceForOutput(advice: DelegationAdvice): string {
  return advice.summary;
}
