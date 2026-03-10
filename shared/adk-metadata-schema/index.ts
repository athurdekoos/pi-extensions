/**
 * Canonical schema contract for .pi-adk-metadata.json
 *
 * This module is the single source of truth for the metadata schema used
 * by both pi-google-adk (writer) and pi-subagents (reader). Both packages
 * import from this file using relative paths — no npm coupling.
 *
 * Design decisions:
 * - Pure TypeScript types + runtime validation helpers (no JSON Schema dependency)
 * - Explicit schema_version with forward/backward compatibility handling
 * - Unknown additive fields are preserved, never stripped
 * - Validation returns a structured result (ok/warnings/errors), never throws
 * - Normalization fills safe defaults for missing optional fields
 */

import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Current schema version emitted by writers. */
export const CURRENT_SCHEMA_VERSION = "1";

/** All schema versions this module can normalize from. */
export const KNOWN_SCHEMA_VERSIONS = ["1"] as const;

/** Metadata filename constant — single source of truth. */
export const METADATA_FILENAME = ".pi-adk-metadata.json";

// ---------------------------------------------------------------------------
// Source types
// ---------------------------------------------------------------------------

export const SOURCE_TYPES = ["native_app", "native_config", "official_sample"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

function isSourceType(v: unknown): v is SourceType {
  return typeof v === "string" && (SOURCE_TYPES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Tool plan types (canonical)
// ---------------------------------------------------------------------------

export const ADK_NATIVE_TOOL_CATEGORIES = [
  "none", "mcp_toolset", "openapi_toolset", "custom_function_tools", "other",
] as const;
export type AdkNativeToolCategory = (typeof ADK_NATIVE_TOOL_CATEGORIES)[number];

export const PI_MONO_PROFILES = ["read_only", "coding", "unknown"] as const;
export type PiMonoProfile = (typeof PI_MONO_PROFILES)[number];

/** Canonical tool plan shape. All fields required after normalization. */
export interface ToolPlanSchema {
  adk_native_tools: string[];
  adk_native_notes?: string;
  pi_mono_profile: string;
  pi_mono_builtin_tools: string[];
  installed_extension_tools_detected: string[];
  installed_extension_tools_selected: string[];
  required_safe_custom_tools: string[];
  notes: string[];
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Sample provenance (canonical)
// ---------------------------------------------------------------------------

export interface SampleProvenanceSchema {
  upstream_repo: string;
  upstream_path: string;
  upstream_ref: string;
  commit: string | null;
  imported_at: string;
  sample_slug: string;
}

// ---------------------------------------------------------------------------
// Tracking section (canonical)
// ---------------------------------------------------------------------------

export interface TrackingSchema {
  support_notes?: string;
  last_drift_check_at?: string;
  last_drift_status?: string;
  last_checked_upstream_commit?: string;
  last_local_hash?: string;
  last_upstream_hash?: string;
}

// ---------------------------------------------------------------------------
// Full metadata schema (canonical)
// ---------------------------------------------------------------------------

export interface AdkMetadataSchema {
  schema_version: string;
  source_type: SourceType;
  agent_name: string;
  project_path: string;
  adk_cli: {
    detected_version: string | null;
    command_used: string;
    detected_supported_modes: string[];
  };
  pi_google_adk: {
    extension_version: string;
  };
  provenance: {
    created_at: string;
    creation_args: Record<string, unknown>;
    sample_import?: SampleProvenanceSchema;
  };
  tracking: TrackingSchema;
  tool_plan?: ToolPlanSchema;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export type IssueSeverity = "warning" | "error";

export interface ValidationIssue {
  severity: IssueSeverity;
  field: string;
  message: string;
}

export interface ValidationResult {
  /** Whether core fields are usable (identity + provenance recognizable). */
  ok: boolean;
  /** Normalized metadata, or null if fatally unusable. */
  metadata: NormalizedMetadata | null;
  /** All issues found during validation. */
  issues: ValidationIssue[];
  /** Convenience: just the warnings. */
  warnings: string[];
  /** Convenience: just the errors. */
  errors: string[];
}

/**
 * Normalized metadata: the stable internal shape both packages work with.
 *
 * Includes `_unknown_fields` for any additive properties not in the schema.
 * Includes `_schema_diagnostics` for compatibility notes.
 */
export interface NormalizedMetadata extends AdkMetadataSchema {
  /** Fields present in the raw JSON but not in the canonical schema. */
  _unknown_fields: Record<string, unknown>;
  /** Diagnostics about schema interpretation. */
  _schema_diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Validation + normalization
// ---------------------------------------------------------------------------

/**
 * Validate and normalize raw parsed JSON into a NormalizedMetadata.
 *
 * Behavior:
 * - Missing optional fields get safe defaults
 * - Unknown additive fields are preserved in _unknown_fields
 * - Older schema_version is normalized with a warning
 * - Newer schema_version is read in compatibility mode with a warning
 * - Missing core fields (source_type, agent_name) produce errors
 * - Completely unusable input (non-object, null) produces ok: false
 */
export function validateMetadata(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const diagnostics: string[] = [];

  // ── Gate: must be a non-null object ──
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      metadata: null,
      issues: [{ severity: "error", field: "(root)", message: "Metadata must be a JSON object." }],
      warnings: [],
      errors: ["Metadata must be a JSON object."],
    };
  }

  const obj = raw as Record<string, unknown>;

  // ── schema_version ──
  const rawVersion = typeof obj.schema_version === "string" ? obj.schema_version : undefined;

  if (!rawVersion) {
    issues.push({ severity: "warning", field: "schema_version", message: "Missing schema_version. Assuming version \"1\"." });
    diagnostics.push("schema_version was missing; assumed \"1\".");
  } else if (!(KNOWN_SCHEMA_VERSIONS as readonly string[]).includes(rawVersion)) {
    const vNum = parseInt(rawVersion, 10);
    const curNum = parseInt(CURRENT_SCHEMA_VERSION, 10);
    if (!isNaN(vNum) && vNum > curNum) {
      issues.push({
        severity: "warning",
        field: "schema_version",
        message: `schema_version "${rawVersion}" is newer than expected ("${CURRENT_SCHEMA_VERSION}"). Reading in compatibility mode.`,
      });
      diagnostics.push(`schema_version "${rawVersion}" is newer than expected; reading in compatibility mode.`);
    } else {
      issues.push({
        severity: "warning",
        field: "schema_version",
        message: `Unrecognized schema_version "${rawVersion}". Attempting best-effort normalization.`,
      });
      diagnostics.push(`Unrecognized schema_version "${rawVersion}"; best-effort normalization.`);
    }
  }
  const schemaVersion = rawVersion ?? CURRENT_SCHEMA_VERSION;

  // ── source_type (required for identity) ──
  const rawSourceType = obj.source_type;
  let sourceType: SourceType;
  if (isSourceType(rawSourceType)) {
    sourceType = rawSourceType;
  } else if (typeof rawSourceType === "string") {
    issues.push({ severity: "warning", field: "source_type", message: `Unrecognized source_type "${rawSourceType}". Treating as "native_app".` });
    diagnostics.push(`source_type "${rawSourceType}" unrecognized; defaulted to "native_app".`);
    sourceType = "native_app";
  } else if (rawSourceType === undefined || rawSourceType === null) {
    issues.push({ severity: "warning", field: "source_type", message: "Missing source_type. Defaulting to \"native_app\"." });
    diagnostics.push("source_type was missing; defaulted to \"native_app\".");
    sourceType = "native_app";
  } else {
    issues.push({ severity: "error", field: "source_type", message: "source_type must be a string." });
    return failResult(issues);
  }

  // ── agent_name (required for identity) ──
  const agentName = typeof obj.agent_name === "string" ? obj.agent_name : "";
  if (!agentName) {
    issues.push({ severity: "warning", field: "agent_name", message: "Missing or empty agent_name." });
    diagnostics.push("agent_name was missing or empty.");
  }

  // ── project_path ──
  const projectPath = typeof obj.project_path === "string" ? obj.project_path : "";
  if (!projectPath) {
    issues.push({ severity: "warning", field: "project_path", message: "Missing or empty project_path." });
  }

  // ── adk_cli ──
  const adkCli = normalizeAdkCli(obj.adk_cli, issues);

  // ── pi_google_adk ──
  const piGoogleAdk = normalizePiGoogleAdk(obj.pi_google_adk, issues);

  // ── provenance ──
  const provenance = normalizeProvenance(obj.provenance, issues);

  // ── tracking ──
  const tracking = normalizeTracking(obj.tracking, issues);

  // ── tool_plan ──
  const toolPlan = normalizeToolPlan(obj.tool_plan, issues, diagnostics);

  // ── Collect unknown fields ──
  const knownKeys = new Set([
    "schema_version", "source_type", "agent_name", "project_path",
    "adk_cli", "pi_google_adk", "provenance", "tracking", "tool_plan",
  ]);
  const unknownFields: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      unknownFields[key] = obj[key];
    }
  }
  if (Object.keys(unknownFields).length > 0) {
    diagnostics.push(`Unknown additive fields preserved: ${Object.keys(unknownFields).join(", ")}`);
  }

  const normalized: NormalizedMetadata = {
    schema_version: schemaVersion,
    source_type: sourceType,
    agent_name: agentName,
    project_path: projectPath,
    adk_cli: adkCli,
    pi_google_adk: piGoogleAdk,
    provenance,
    tracking,
    ...(toolPlan !== undefined ? { tool_plan: toolPlan } : {}),
    _unknown_fields: unknownFields,
    _schema_diagnostics: diagnostics,
  };

  return {
    ok: true,
    metadata: normalized,
    issues,
    warnings: issues.filter((i) => i.severity === "warning").map((i) => i.message),
    errors: issues.filter((i) => i.severity === "error").map((i) => i.message),
  };
}

// ---------------------------------------------------------------------------
// Section normalizers
// ---------------------------------------------------------------------------

function normalizeAdkCli(
  raw: unknown,
  issues: ValidationIssue[],
): AdkMetadataSchema["adk_cli"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      issues.push({ severity: "warning", field: "adk_cli", message: "adk_cli is not an object. Using defaults." });
    }
    return { detected_version: null, command_used: "", detected_supported_modes: [] };
  }
  const o = raw as Record<string, unknown>;
  return {
    detected_version: typeof o.detected_version === "string" ? o.detected_version : null,
    command_used: typeof o.command_used === "string" ? o.command_used : "",
    detected_supported_modes: Array.isArray(o.detected_supported_modes)
      ? o.detected_supported_modes.filter((v): v is string => typeof v === "string")
      : [],
  };
}

function normalizePiGoogleAdk(
  raw: unknown,
  issues: ValidationIssue[],
): AdkMetadataSchema["pi_google_adk"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      issues.push({ severity: "warning", field: "pi_google_adk", message: "pi_google_adk is not an object. Using defaults." });
    }
    return { extension_version: "unknown" };
  }
  const o = raw as Record<string, unknown>;
  return {
    extension_version: typeof o.extension_version === "string" ? o.extension_version : "unknown",
  };
}

function normalizeProvenance(
  raw: unknown,
  issues: ValidationIssue[],
): AdkMetadataSchema["provenance"] {
  const defaults: AdkMetadataSchema["provenance"] = {
    created_at: "",
    creation_args: {},
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      issues.push({ severity: "warning", field: "provenance", message: "provenance is not an object. Using defaults." });
    }
    return defaults;
  }
  const o = raw as Record<string, unknown>;

  const result: AdkMetadataSchema["provenance"] = {
    created_at: typeof o.created_at === "string" ? o.created_at : "",
    creation_args: (o.creation_args && typeof o.creation_args === "object" && !Array.isArray(o.creation_args))
      ? o.creation_args as Record<string, unknown>
      : {},
  };

  // sample_import sub-section
  if (o.sample_import && typeof o.sample_import === "object" && !Array.isArray(o.sample_import)) {
    const si = o.sample_import as Record<string, unknown>;
    result.sample_import = {
      upstream_repo: typeof si.upstream_repo === "string" ? si.upstream_repo : "",
      upstream_path: typeof si.upstream_path === "string" ? si.upstream_path : "",
      upstream_ref: typeof si.upstream_ref === "string" ? si.upstream_ref : "main",
      commit: typeof si.commit === "string" ? si.commit : null,
      imported_at: typeof si.imported_at === "string" ? si.imported_at : "",
      sample_slug: typeof si.sample_slug === "string" ? si.sample_slug : "unknown",
    };
  }

  return result;
}

function normalizeTracking(
  raw: unknown,
  issues: ValidationIssue[],
): TrackingSchema {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const result: TrackingSchema = {};
  if (typeof o.support_notes === "string") result.support_notes = o.support_notes;
  if (typeof o.last_drift_check_at === "string") result.last_drift_check_at = o.last_drift_check_at;
  if (typeof o.last_drift_status === "string") result.last_drift_status = o.last_drift_status;
  if (typeof o.last_checked_upstream_commit === "string") result.last_checked_upstream_commit = o.last_checked_upstream_commit;
  if (typeof o.last_local_hash === "string") result.last_local_hash = o.last_local_hash;
  if (typeof o.last_upstream_hash === "string") result.last_upstream_hash = o.last_upstream_hash;
  return result;
}

function normalizeToolPlan(
  raw: unknown,
  issues: ValidationIssue[],
  diagnostics: string[],
): ToolPlanSchema | undefined {
  if (raw === undefined || raw === null) return undefined;

  if (typeof raw !== "object" || Array.isArray(raw)) {
    issues.push({ severity: "warning", field: "tool_plan", message: "tool_plan is not an object. Ignoring." });
    return undefined;
  }

  const o = raw as Record<string, unknown>;

  return {
    adk_native_tools: normalizeStringArray(o.adk_native_tools),
    adk_native_notes: typeof o.adk_native_notes === "string" ? o.adk_native_notes : undefined,
    pi_mono_profile: typeof o.pi_mono_profile === "string" ? o.pi_mono_profile : "unknown",
    pi_mono_builtin_tools: normalizeStringArray(o.pi_mono_builtin_tools),
    installed_extension_tools_detected: normalizeStringArray(o.installed_extension_tools_detected),
    installed_extension_tools_selected: normalizeStringArray(o.installed_extension_tools_selected),
    required_safe_custom_tools: normalizeStringArray(o.required_safe_custom_tools),
    notes: normalizeStringArray(o.notes),
    caveats: normalizeStringArray(o.caveats),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

function failResult(issues: ValidationIssue[]): ValidationResult {
  return {
    ok: false,
    metadata: null,
    issues,
    warnings: issues.filter((i) => i.severity === "warning").map((i) => i.message),
    errors: issues.filter((i) => i.severity === "error").map((i) => i.message),
  };
}

// ---------------------------------------------------------------------------
// Convenience: read + validate from disk
// ---------------------------------------------------------------------------

/**
 * Read and validate .pi-adk-metadata.json from a directory.
 *
 * @param absProjectDir Absolute path to the project directory.
 * @returns ValidationResult, with ok=false if file missing or unparseable.
 */
export function readAndValidateMetadata(absProjectDir: string): ValidationResult {
  const filePath = `${absProjectDir}/${METADATA_FILENAME}`;

  if (!existsSync(filePath)) {
    return {
      ok: false,
      metadata: null,
      issues: [{ severity: "error", field: "(file)", message: `${METADATA_FILENAME} not found.` }],
      warnings: [],
      errors: [`${METADATA_FILENAME} not found.`],
    };
  }

  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf-8");
  } catch (err) {
    return {
      ok: false,
      metadata: null,
      issues: [{ severity: "error", field: "(file)", message: `Failed to read ${METADATA_FILENAME}: ${err instanceof Error ? err.message : String(err)}` }],
      warnings: [],
      errors: [`Failed to read ${METADATA_FILENAME}.`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      metadata: null,
      issues: [{ severity: "error", field: "(file)", message: `${METADATA_FILENAME} contains invalid JSON.` }],
      warnings: [],
      errors: [`${METADATA_FILENAME} contains invalid JSON.`],
    };
  }

  return validateMetadata(parsed);
}
