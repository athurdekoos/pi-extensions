/**
 * Detect whether a directory looks like a generated ADK project.
 *
 * Supported detection signals (in priority order):
 * 1. .pi-adk-metadata.json (Pi creation metadata)
 * 2. .env.example heuristic
 * 3. Subdirectory with agent.py or __init__.py heuristic
 *
 * Legacy .adk-scaffold.json detection has been removed.
 */

import { readdirSync, statSync } from "node:fs";
import { safeExists, safeReadFile } from "./fs-safe.js";
import { CREATION_METADATA_FILENAME, readAndValidateMetadata } from "./creation-metadata.js";

export interface ProjectInfo {
  valid: boolean;
  agentName: string | null;
  template: "native_app" | "native_config" | "official_sample" | "unknown" | null;
  /** Detection source: "pi-metadata", "heuristic". */
  detectedVia?: string;
  error?: string;
}

/**
 * Inspect a directory and determine if it contains a recognized ADK project.
 */
export function detectAdkProject(projectRoot: string): ProjectInfo {
  // Primary: .pi-adk-metadata.json (validated)
  const piMetaValidation = readAndValidateMetadata(projectRoot);
  if (piMetaValidation.ok && piMetaValidation.metadata) {
    return {
      valid: true,
      agentName: piMetaValidation.metadata.agent_name || null,
      template: (piMetaValidation.metadata.source_type as ProjectInfo["template"]) ?? "unknown",
      detectedVia: "pi-metadata",
    };
  }
  // Fall through if validation failed but file existed — check if file is present but malformed
  const piMetadata = safeReadFile(projectRoot, CREATION_METADATA_FILENAME);
  if (piMetadata) {
    // File exists but failed validation — still treat as detected but with unknown shape
    return { valid: true, agentName: null, template: "unknown", detectedVia: "pi-metadata" };
  }

  // Heuristic fallback: look for .env.example
  const hasEnvExample = safeExists(projectRoot, ".env.example");
  if (hasEnvExample) {
    return { valid: true, agentName: null, template: "unknown", detectedVia: "heuristic" };
  }

  // Heuristic: native ADK projects typically have a subdirectory with agent.py
  if (hasAgentSubdir(projectRoot)) {
    return {
      valid: true,
      agentName: findAgentSubdirName(projectRoot),
      template: "unknown",
      detectedVia: "heuristic",
    };
  }

  return {
    valid: false,
    agentName: null,
    template: null,
    error:
      "Not a recognized ADK project (no .pi-adk-metadata.json, " +
      ".env.example, or recognizable ADK structure)",
  };
}

// ---------------------------------------------------------------------------
// Agent subdirectory heuristic
// ---------------------------------------------------------------------------

function hasAgentSubdir(projectRoot: string): boolean {
  return findAgentSubdirName(projectRoot) !== null;
}

function findAgentSubdirName(projectRoot: string): string | null {
  try {
    const entries = readdirSync(projectRoot);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      try {
        const entryPath = `${projectRoot}/${entry}`;
        if (statSync(entryPath).isDirectory()) {
          if (
            safeExists(projectRoot, `${entry}/agent.py`) ||
            safeExists(projectRoot, `${entry}/__init__.py`)
          ) {
            return entry;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // directory not readable
  }
  return null;
}
