/**
 * config.ts — Config loading, validation, and normalization.
 *
 * Owns: Reading .pi/pi-plan.json, validating each field, falling back to
 *       defaults for invalid/missing values, and emitting per-field warnings.
 *       Also owns the PiPlanConfig type, DEFAULT_CONFIG, and CONFIG_REL path.
 *
 * Does NOT own: File writes, state detection, plan generation, or archive logic.
 *
 * Invariants:
 *   - loadConfig() never throws. It always returns a valid PiPlanConfig.
 *   - Missing config file → defaults, no warnings, source = "default".
 *   - Invalid fields get per-field fallback + warning. Valid fields survive.
 *   - Unknown keys are silently ignored.
 *
 * Extend here: New config fields, new validation rules, config migration.
 *   When adding a field: add to PiPlanConfig, DEFAULT_CONFIG, and loadConfig().
 * Do NOT extend here: File writes, state logic, UI concerns.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface PiPlanConfig {
  /** Relative path for archive directory (from repo root) */
  archiveDir: string;
  /** Archive filename style: "date-slug" (YYYY-MM-DD-HHMM-slug.md) or "date-only" */
  archiveFilenameStyle: "date-slug" | "date-only";
  /** Collision strategy when archive filename already exists */
  archiveCollisionStrategy: "counter";
  /** Show a concise plan summary on resume */
  resumeShowSummary: boolean;
  /** Allow /plan <goal text> inline args */
  allowInlineGoalArgs: boolean;
  /** Relative path for debug log directory (from repo root) */
  debugLogDir: string;
  /** Debug log filename style: "timestamp" (plan-debug-YYYY-MM-DD-HHMMSS.json) */
  debugLogFilenameStyle: "timestamp";
  /** Max entries shown in archive browse list */
  maxArchiveListEntries: number;
  /** Custom template text for {{CURRENT_STATE}} expansion (may contain {{REPO_ROOT}}) */
  currentStateTemplate: string | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Readonly<PiPlanConfig> = {
  archiveDir: ".pi/plans/archive",
  archiveFilenameStyle: "date-slug",
  archiveCollisionStrategy: "counter",
  resumeShowSummary: true,
  allowInlineGoalArgs: true,
  debugLogDir: ".pi/logs",
  debugLogFilenameStyle: "timestamp",
  maxArchiveListEntries: 15,
  currentStateTemplate: null,
};

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

export const CONFIG_REL = ".pi/pi-plan.json";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_ARCHIVE_FILENAME_STYLES = new Set(["date-slug", "date-only"]);
const VALID_ARCHIVE_COLLISION_STRATEGIES = new Set(["counter"]);
const VALID_DEBUG_LOG_FILENAME_STYLES = new Set(["timestamp"]);

export interface ConfigLoadResult {
  config: PiPlanConfig;
  warnings: string[];
  source: "default" | "file";
}

// ---------------------------------------------------------------------------
// Load and normalize config
// ---------------------------------------------------------------------------

/**
 * Load pi-plan config from `.pi/pi-plan.json` in the given repo root.
 *
 * Behavior:
 * - If config file is missing → returns defaults, no warnings
 * - If config file is malformed JSON → returns defaults with a warning
 * - If config file has invalid values → uses defaults for invalid fields,
 *   keeps valid overrides, emits per-field warnings
 * - Never throws
 */
export function loadConfig(repoRoot: string): ConfigLoadResult {
  const abs = join(repoRoot, CONFIG_REL);
  const warnings: string[] = [];

  if (!existsSync(abs)) {
    return { config: { ...DEFAULT_CONFIG }, warnings, source: "default" };
  }

  let raw: string;
  try {
    raw = readFileSync(abs, "utf-8");
  } catch (err) {
    warnings.push(`Could not read ${CONFIG_REL}: ${String(err)}`);
    return { config: { ...DEFAULT_CONFIG }, warnings, source: "default" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push(`${CONFIG_REL} contains invalid JSON — using defaults.`);
    return { config: { ...DEFAULT_CONFIG }, warnings, source: "default" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push(`${CONFIG_REL} is not a JSON object — using defaults.`);
    return { config: { ...DEFAULT_CONFIG }, warnings, source: "default" };
  }

  const obj = parsed as Record<string, unknown>;
  const config: PiPlanConfig = { ...DEFAULT_CONFIG };

  // archiveDir
  if ("archiveDir" in obj) {
    if (typeof obj.archiveDir === "string" && obj.archiveDir.trim().length > 0) {
      config.archiveDir = obj.archiveDir.trim();
    } else {
      warnings.push(`Invalid archiveDir — using default "${DEFAULT_CONFIG.archiveDir}".`);
    }
  }

  // archiveFilenameStyle
  if ("archiveFilenameStyle" in obj) {
    if (typeof obj.archiveFilenameStyle === "string" && VALID_ARCHIVE_FILENAME_STYLES.has(obj.archiveFilenameStyle)) {
      config.archiveFilenameStyle = obj.archiveFilenameStyle as PiPlanConfig["archiveFilenameStyle"];
    } else {
      warnings.push(`Invalid archiveFilenameStyle — using default "${DEFAULT_CONFIG.archiveFilenameStyle}".`);
    }
  }

  // archiveCollisionStrategy
  if ("archiveCollisionStrategy" in obj) {
    if (typeof obj.archiveCollisionStrategy === "string" && VALID_ARCHIVE_COLLISION_STRATEGIES.has(obj.archiveCollisionStrategy)) {
      config.archiveCollisionStrategy = obj.archiveCollisionStrategy as PiPlanConfig["archiveCollisionStrategy"];
    } else {
      warnings.push(`Invalid archiveCollisionStrategy — using default "${DEFAULT_CONFIG.archiveCollisionStrategy}".`);
    }
  }

  // resumeShowSummary
  if ("resumeShowSummary" in obj) {
    if (typeof obj.resumeShowSummary === "boolean") {
      config.resumeShowSummary = obj.resumeShowSummary;
    } else {
      warnings.push(`Invalid resumeShowSummary — using default ${DEFAULT_CONFIG.resumeShowSummary}.`);
    }
  }

  // allowInlineGoalArgs
  if ("allowInlineGoalArgs" in obj) {
    if (typeof obj.allowInlineGoalArgs === "boolean") {
      config.allowInlineGoalArgs = obj.allowInlineGoalArgs;
    } else {
      warnings.push(`Invalid allowInlineGoalArgs — using default ${DEFAULT_CONFIG.allowInlineGoalArgs}.`);
    }
  }

  // debugLogDir
  if ("debugLogDir" in obj) {
    if (typeof obj.debugLogDir === "string" && obj.debugLogDir.trim().length > 0) {
      config.debugLogDir = obj.debugLogDir.trim();
    } else {
      warnings.push(`Invalid debugLogDir — using default "${DEFAULT_CONFIG.debugLogDir}".`);
    }
  }

  // debugLogFilenameStyle
  if ("debugLogFilenameStyle" in obj) {
    if (typeof obj.debugLogFilenameStyle === "string" && VALID_DEBUG_LOG_FILENAME_STYLES.has(obj.debugLogFilenameStyle)) {
      config.debugLogFilenameStyle = obj.debugLogFilenameStyle as PiPlanConfig["debugLogFilenameStyle"];
    } else {
      warnings.push(`Invalid debugLogFilenameStyle — using default "${DEFAULT_CONFIG.debugLogFilenameStyle}".`);
    }
  }

  // maxArchiveListEntries
  if ("maxArchiveListEntries" in obj) {
    if (typeof obj.maxArchiveListEntries === "number" && Number.isInteger(obj.maxArchiveListEntries) && obj.maxArchiveListEntries >= 1) {
      config.maxArchiveListEntries = obj.maxArchiveListEntries;
    } else {
      warnings.push(`Invalid maxArchiveListEntries — using default ${DEFAULT_CONFIG.maxArchiveListEntries}.`);
    }
  }

  // currentStateTemplate
  if ("currentStateTemplate" in obj) {
    if (obj.currentStateTemplate === null) {
      config.currentStateTemplate = null;
    } else if (typeof obj.currentStateTemplate === "string" && obj.currentStateTemplate.trim().length > 0) {
      config.currentStateTemplate = obj.currentStateTemplate;
    } else {
      warnings.push(`Invalid currentStateTemplate — using default.`);
    }
  }

  return { config, warnings, source: "file" };
}
