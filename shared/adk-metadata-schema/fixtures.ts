/**
 * Shared test fixtures for .pi-adk-metadata.json validation.
 *
 * Used by both pi-google-adk and pi-subagents test suites to ensure
 * consistent interpretation of the same metadata shapes.
 */

import type { AdkMetadataSchema, ToolPlanSchema, SampleProvenanceSchema } from "./index.js";

// ---------------------------------------------------------------------------
// Valid current-version metadata
// ---------------------------------------------------------------------------

export function validNativeAppMetadata(): AdkMetadataSchema {
  return {
    schema_version: "1",
    source_type: "native_app",
    agent_name: "test-agent",
    project_path: "./agents/test-agent",
    adk_cli: {
      detected_version: "1.2.3",
      command_used: "adk create test-agent",
      detected_supported_modes: ["native_app", "native_config"],
    },
    pi_google_adk: {
      extension_version: "0.1.0",
    },
    provenance: {
      created_at: "2025-06-01T00:00:00.000Z",
      creation_args: { mode: "native_app", name: "test-agent" },
    },
    tracking: {},
  };
}

export function validNativeConfigMetadata(): AdkMetadataSchema {
  return {
    ...validNativeAppMetadata(),
    source_type: "native_config",
    agent_name: "config-agent",
    project_path: "./agents/config-agent",
  };
}

export function validOfficialSampleMetadata(): AdkMetadataSchema {
  return {
    schema_version: "1",
    source_type: "official_sample",
    agent_name: "sample-agent",
    project_path: "./agents/sample-agent",
    adk_cli: {
      detected_version: null,
      command_used: "",
      detected_supported_modes: [],
    },
    pi_google_adk: {
      extension_version: "0.1.0",
    },
    provenance: {
      created_at: "2025-06-01T00:00:00.000Z",
      creation_args: { mode: "official_sample", name: "sample-agent" },
      sample_import: validSampleProvenance(),
    },
    tracking: {},
  };
}

export function validSampleProvenance(): SampleProvenanceSchema {
  return {
    upstream_repo: "https://github.com/google/adk-samples.git",
    upstream_path: "agents/brand-search-optimization",
    upstream_ref: "main",
    commit: "abc123def456",
    imported_at: "2025-06-01T00:00:00.000Z",
    sample_slug: "brand-search-optimization",
  };
}

export function validToolPlan(): ToolPlanSchema {
  return {
    adk_native_tools: ["mcp_toolset"],
    adk_native_notes: "Uses MCP server X",
    pi_mono_profile: "coding",
    pi_mono_builtin_tools: ["read", "bash", "edit", "write"],
    installed_extension_tools_detected: ["run_adk_agent", "resolve_adk_agent", "some_ext_tool"],
    installed_extension_tools_selected: ["some_ext_tool"],
    required_safe_custom_tools: ["run_adk_agent", "resolve_adk_agent", "some_ext_tool"],
    notes: ["Tool planning completed."],
    caveats: ["This tool plan is advisory."],
  };
}

export function validMetadataWithToolPlan(): AdkMetadataSchema {
  return {
    ...validNativeAppMetadata(),
    tool_plan: validToolPlan(),
  };
}

export function validMetadataWithDriftTracking(): AdkMetadataSchema {
  return {
    ...validOfficialSampleMetadata(),
    tracking: {
      last_drift_check_at: "2025-07-01T00:00:00.000Z",
      last_drift_status: "up_to_date",
      last_checked_upstream_commit: "def789abc012",
      last_local_hash: "hash_local_1",
      last_upstream_hash: "hash_upstream_1",
    },
    tool_plan: validToolPlan(),
  };
}

// ---------------------------------------------------------------------------
// Legacy / partial metadata (pre-Phase 3, pre-Phase 4)
// ---------------------------------------------------------------------------

/** Pre-Phase 3: no tool_plan field. */
export function legacyMetadataNoToolPlan(): Record<string, unknown> {
  return {
    schema_version: "1",
    source_type: "native_app",
    agent_name: "legacy-agent",
    project_path: "./agents/legacy-agent",
    adk_cli: {
      detected_version: "1.0.0",
      command_used: "adk create legacy-agent",
      detected_supported_modes: ["native_app"],
    },
    pi_google_adk: {
      extension_version: "0.1.0",
    },
    provenance: {
      created_at: "2025-01-01T00:00:00.000Z",
      creation_args: { mode: "native_app" },
    },
    tracking: {},
  };
}

/** Pre-Phase 4: no tracking drift fields. */
export function legacyMetadataNoTracking(): Record<string, unknown> {
  return {
    schema_version: "1",
    source_type: "official_sample",
    agent_name: "old-sample",
    project_path: "./agents/old-sample",
    adk_cli: {
      detected_version: null,
      command_used: "",
      detected_supported_modes: [],
    },
    pi_google_adk: {
      extension_version: "0.1.0",
    },
    provenance: {
      created_at: "2025-01-01T00:00:00.000Z",
      creation_args: {},
      sample_import: {
        upstream_repo: "https://github.com/google/adk-samples.git",
        upstream_path: "agents/some-sample",
        upstream_ref: "main",
        commit: "old_commit_hash",
        imported_at: "2025-01-01T00:00:00.000Z",
        sample_slug: "some-sample",
      },
    },
    // tracking section empty or missing entirely
  };
}

/** Minimal metadata: only source_type and agent_name. */
export function minimalMetadata(): Record<string, unknown> {
  return {
    source_type: "native_app",
    agent_name: "bare-agent",
  };
}

// ---------------------------------------------------------------------------
// Edge cases / pathological
// ---------------------------------------------------------------------------

/** Missing source_type entirely. */
export function metadataMissingSourceType(): Record<string, unknown> {
  return {
    schema_version: "1",
    agent_name: "no-source",
    project_path: "./agents/no-source",
    provenance: { created_at: "2025-01-01T00:00:00.000Z", creation_args: {} },
    tracking: {},
  };
}

/** Unknown additive fields present. */
export function metadataWithUnknownFields(): Record<string, unknown> {
  return {
    ...validNativeAppMetadata(),
    custom_experiment: { data: "some experiment data" },
    future_field: "value from a future version",
  };
}

/** Newer schema_version than current. */
export function metadataFromFutureVersion(): Record<string, unknown> {
  return {
    ...validNativeAppMetadata(),
    schema_version: "99",
    future_section: { x: 1 },
  };
}

/** No schema_version field at all. */
export function metadataNoSchemaVersion(): Record<string, unknown> {
  const m = { ...validNativeAppMetadata() } as Record<string, unknown>;
  delete m.schema_version;
  return m;
}

/** Completely empty object. */
export function emptyObjectMetadata(): Record<string, unknown> {
  return {};
}

/** Non-object values for testing type guards. */
export const nonObjectValues = [null, undefined, 42, "string", true, [1, 2, 3]];
