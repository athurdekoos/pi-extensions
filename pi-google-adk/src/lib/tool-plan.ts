/**
 * Tool-plan model for ADK agent projects (Phase 3).
 *
 * Records the intended tool access profile for an ADK project:
 * - ADK-native tools (MCP toolsets, OpenAPI, custom functions, etc.)
 * - Pi Mono built-in session tools (read_only, coding profiles)
 * - Installed Pi extension tools (detected and selected)
 * - Required safe custom tools for pi-subagents delegation
 *
 * This is advisory metadata — it records intent, not an execution guarantee.
 * Actual child-session access still depends on mode, allowlisting, and
 * loaded extensions at runtime.
 */

// ---------------------------------------------------------------------------
// ADK-native tool categories
// ---------------------------------------------------------------------------

/** Recognized ADK-native tool patterns. */
export const ADK_NATIVE_TOOL_CATEGORIES = [
  "none",
  "mcp_toolset",
  "openapi_toolset",
  "custom_function_tools",
  "other",
] as const;

export type AdkNativeToolCategory = (typeof ADK_NATIVE_TOOL_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Pi Mono built-in profiles
// ---------------------------------------------------------------------------

/** Recognized Pi Mono built-in tool profiles. */
export const PI_MONO_PROFILES = ["read_only", "coding", "unknown"] as const;

export type PiMonoProfile = (typeof PI_MONO_PROFILES)[number];

/** Maps a Pi Mono profile to its constituent built-in tools. */
export const PI_MONO_PROFILE_TOOLS: Record<PiMonoProfile, string[]> = {
  read_only: ["read", "grep", "find", "ls"],
  coding: ["read", "bash", "edit", "write"],
  unknown: [],
};

/**
 * Return the built-in tool names for a given profile.
 * Returns an empty array for unrecognized profiles.
 */
export function profileTools(profile: PiMonoProfile | string): string[] {
  return PI_MONO_PROFILE_TOOLS[profile as PiMonoProfile] ?? [];
}

// ---------------------------------------------------------------------------
// Tool plan
// ---------------------------------------------------------------------------

/** Serializable tool plan stored in Pi metadata. */
export interface ToolPlan {
  /** ADK-native tool categories the project is expected to use. */
  adk_native_tools: AdkNativeToolCategory[];
  /** Optional free-text note for ADK-native tools (e.g. "uses MCP server X"). */
  adk_native_notes?: string;

  /** Pi Mono built-in session profile. */
  pi_mono_profile: PiMonoProfile;
  /** Resolved built-in tool names implied by the profile. */
  pi_mono_builtin_tools: string[];

  /** Extension tool names detected at planning time. */
  installed_extension_tools_detected: string[];
  /** Extension tool names the user selected as relevant. */
  installed_extension_tools_selected: string[];

  /** Safe custom tools recommended for pi-subagents delegation. */
  required_safe_custom_tools: string[];

  /** Advisory notes about the plan. */
  notes: string[];
  /** Caveats about detection accuracy or runtime guarantees. */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** An empty/default tool plan for when the user skips planning. */
export function emptyToolPlan(): ToolPlan {
  return {
    adk_native_tools: [],
    pi_mono_profile: "unknown",
    pi_mono_builtin_tools: [],
    installed_extension_tools_detected: [],
    installed_extension_tools_selected: [],
    required_safe_custom_tools: [],
    notes: ["Tool planning was skipped."],
    caveats: [],
  };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ToolPlanInput {
  adkNativeTools?: AdkNativeToolCategory[];
  adkNativeNotes?: string;
  piMonoProfile?: PiMonoProfile;
  extensionToolsDetected?: string[];
  extensionToolsSelected?: string[];
  requiredSafeCustomTools?: string[];
  notes?: string[];
  caveats?: string[];
}

/**
 * Build a ToolPlan from structured input.
 *
 * Automatically:
 * - resolves pi_mono_builtin_tools from the profile
 * - ensures run_adk_agent is in required_safe_custom_tools when relevant
 * - adds standard caveats
 */
export function buildToolPlan(input: ToolPlanInput): ToolPlan {
  const profile = input.piMonoProfile ?? "unknown";
  const builtinTools = profileTools(profile);

  const requiredSafe = [...(input.requiredSafeCustomTools ?? [])];

  // Always recommend run_adk_agent for delegation unless the caller
  // explicitly excluded it.
  if (!requiredSafe.includes("run_adk_agent")) {
    requiredSafe.push("run_adk_agent");
  }

  // Also recommend resolve_adk_agent for discovery
  if (!requiredSafe.includes("resolve_adk_agent")) {
    requiredSafe.push("resolve_adk_agent");
  }

  // Add selected extension tools to required safe list if not already present
  for (const tool of input.extensionToolsSelected ?? []) {
    if (!requiredSafe.includes(tool)) {
      requiredSafe.push(tool);
    }
  }

  const caveats = [...(input.caveats ?? [])];
  caveats.push(
    "This tool plan is advisory. Actual child-session access depends on mode, allowlisting, and loaded extensions."
  );

  return {
    adk_native_tools: input.adkNativeTools ?? [],
    adk_native_notes: input.adkNativeNotes,
    pi_mono_profile: profile,
    pi_mono_builtin_tools: builtinTools,
    installed_extension_tools_detected: input.extensionToolsDetected ?? [],
    installed_extension_tools_selected: input.extensionToolsSelected ?? [],
    required_safe_custom_tools: requiredSafe,
    notes: input.notes ?? [],
    caveats,
  };
}

/**
 * Build a tool plan directly from explicit params (non-interactive path).
 */
export function buildToolPlanFromParams(params: {
  adk_native_tools?: string[];
  pi_mono_profile?: string;
  extension_tools?: string[];
  required_safe_custom_tools?: string[];
  tool_notes?: string;
  detectedExtensionTools?: string[];
}): ToolPlan {
  // Validate adk_native_tools
  const adkNative = (params.adk_native_tools ?? []).filter(
    (t): t is AdkNativeToolCategory =>
      ADK_NATIVE_TOOL_CATEGORIES.includes(t as AdkNativeToolCategory)
  );

  // Validate profile
  const profile: PiMonoProfile = PI_MONO_PROFILES.includes(
    params.pi_mono_profile as PiMonoProfile
  )
    ? (params.pi_mono_profile as PiMonoProfile)
    : "unknown";

  return buildToolPlan({
    adkNativeTools: adkNative,
    piMonoProfile: profile,
    extensionToolsDetected: params.detectedExtensionTools ?? [],
    extensionToolsSelected: params.extension_tools ?? [],
    requiredSafeCustomTools: params.required_safe_custom_tools,
    notes: params.tool_notes ? [params.tool_notes] : [],
  });
}
