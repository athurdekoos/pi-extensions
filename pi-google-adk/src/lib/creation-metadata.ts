/**
 * Thin Pi-owned metadata for native-created and imported ADK projects.
 *
 * Written as `.pi-adk-metadata.json` in the project root after native
 * creation or sample import. This file is additive only — it does not
 * affect ADK project runnability. The ADK project works identically
 * with or without it.
 *
 * Phase 5A: Types and constants are re-exported from the shared schema
 * contract (shared/adk-metadata-schema) to ensure consistency between
 * pi-google-adk (writer) and pi-subagents (reader).
 */

import { safeWriteFile } from "./fs-safe.js";
import type { SampleProvenance } from "./sample-import.js";
import type { ToolPlan } from "./tool-plan.js";
import {
  CURRENT_SCHEMA_VERSION,
  METADATA_FILENAME,
  validateMetadata,
  readAndValidateMetadata,
  type AdkMetadataSchema,
  type SourceType,
  type NormalizedMetadata,
  type ValidationResult,
  type ToolPlanSchema,
  type TrackingSchema,
  type SampleProvenanceSchema,
} from "../../../shared/adk-metadata-schema/index.js";

// ---------------------------------------------------------------------------
// Re-exports from shared schema (for backward compatibility)
// ---------------------------------------------------------------------------

export type { SourceType, NormalizedMetadata, ValidationResult };
export { validateMetadata, readAndValidateMetadata };

/**
 * AdkCreationMetadata is the same as AdkMetadataSchema from the shared
 * contract. Re-exported for backward compatibility with existing code.
 */
export type AdkCreationMetadata = AdkMetadataSchema;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CREATION_METADATA_FILENAME = METADATA_FILENAME;
const SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
const EXTENSION_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Builder — native creation
// ---------------------------------------------------------------------------

export function buildCreationMetadata(opts: {
  sourceType: "native_app" | "native_config";
  agentName: string;
  projectPath: string;
  adkVersion: string | null;
  commandUsed: string;
  supportedModes: string[];
  creationArgs: Record<string, unknown>;
  toolPlan?: ToolPlan;
}): AdkCreationMetadata {
  const meta: AdkCreationMetadata = {
    schema_version: SCHEMA_VERSION,
    source_type: opts.sourceType,
    agent_name: opts.agentName,
    project_path: opts.projectPath,
    adk_cli: {
      detected_version: opts.adkVersion,
      command_used: opts.commandUsed,
      detected_supported_modes: opts.supportedModes,
    },
    pi_google_adk: {
      extension_version: EXTENSION_VERSION,
    },
    provenance: {
      created_at: new Date().toISOString(),
      creation_args: opts.creationArgs,
    },
    tracking: {},
  };
  if (opts.toolPlan) {
    meta.tool_plan = opts.toolPlan;
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Builder — sample import
// ---------------------------------------------------------------------------

export function buildSampleImportMetadata(opts: {
  agentName: string;
  projectPath: string;
  importArgs: Record<string, unknown>;
  sampleProvenance: SampleProvenance;
  toolPlan?: ToolPlan;
}): AdkCreationMetadata {
  const meta: AdkCreationMetadata = {
    schema_version: SCHEMA_VERSION,
    source_type: "official_sample",
    agent_name: opts.agentName,
    project_path: opts.projectPath,
    adk_cli: {
      detected_version: null,
      command_used: "",
      detected_supported_modes: [],
    },
    pi_google_adk: {
      extension_version: EXTENSION_VERSION,
    },
    provenance: {
      created_at: opts.sampleProvenance.imported_at,
      creation_args: opts.importArgs,
      sample_import: opts.sampleProvenance,
    },
    tracking: {},
  };
  if (opts.toolPlan) {
    meta.tool_plan = opts.toolPlan;
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write Pi creation metadata into the project directory.
 * Overwrites any existing metadata file.
 */
export function writeCreationMetadata(
  cwd: string,
  projectPath: string,
  metadata: AdkCreationMetadata
): void {
  const filePath = `${projectPath}/${CREATION_METADATA_FILENAME}`;
  safeWriteFile(cwd, filePath, JSON.stringify(metadata, null, 2) + "\n", true);
}
