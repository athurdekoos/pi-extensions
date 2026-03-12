/**
 * diagnostics.ts — Diagnostic snapshot collection and log writing.
 *
 * Owns: Collecting a read-only snapshot of repo planning state, formatting
 *       timestamps, generating log filenames, and writing JSON log files.
 *
 * Does NOT own: State mutation, plan creation, archive writes, or config loading.
 *
 * Invariants:
 *   - Snapshots never include file body content. Only metadata (size, line
 *     count, title, placeholder status) is captured. This is a privacy/safety
 *     boundary.
 *   - State classification reuses isFullyInitialized() and hasCurrentPlan()
 *     from repo.ts so diagnostics and /plan always agree on state.
 *   - Log files are never overwritten — collisions get a counter suffix.
 *   - writeDiagnosticLog() never modifies planning files.
 *
 * Extend here: New snapshot fields, richer metadata, log rotation.
 * Do NOT extend here: State mutation, plan creation, archive operations.
 */

import { existsSync, statSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isFullyInitialized,
  hasCurrentPlan,
  hasPlanningProtocol,
  PLANNING_PROTOCOL_REL,
  TASK_PLAN_TEMPLATE_REL,
  CURRENT_PLAN_REL,
  PLANS_INDEX_REL,
} from "./repo.js";
import { CURRENT_PLAN_SENTINEL } from "./defaults.js";
import { listArchives, extractPlanTitle, readCurrentPlan, ARCHIVE_DIR_REL } from "./archive.js";
import type { PiPlanConfig } from "./config.js";
import { DEFAULT_CONFIG, CONFIG_REL } from "./config.js";
import { analyzeTemplateFromDisk, type TemplateMode } from "./template-analysis.js";

// ---------------------------------------------------------------------------
// Relative path for logs directory (default, kept for backward compat)
// ---------------------------------------------------------------------------

export const LOGS_DIR_REL = ".pi/logs";

// ---------------------------------------------------------------------------
// Diagnostic snapshot shape
// ---------------------------------------------------------------------------

export interface FileInfo {
  path: string;
  exists: boolean;
  sizeBytes: number | null;
}

export interface CurrentPlanInfo {
  exists: boolean;
  isPlaceholder: boolean;
  sizeBytes: number | null;
  lineCount: number | null;
}

export interface ArchiveInfo {
  count: number;
  latestFilename: string | null;
}

export interface ConfigInfo {
  source: "default" | "file";
  configPath: string;
  effectiveArchiveDir: string;
  effectiveDebugLogDir: string;
  maxArchiveListEntries: number;
  archiveFilenameStyle: string;
  allowInlineGoalArgs: boolean;
  resumeShowSummary: boolean;
  configWarnings: string[];
}

export interface TemplateInfo {
  /** Whether the template file exists and has valid H2 sections */
  usable: boolean;
  /** Number of H2 sections found (0 if not usable) */
  sectionCount: number;
  /** Template mode classification from shared analysis */
  mode: TemplateMode;
  /** Whether explicit placeholders were detected */
  hasExplicitPlaceholders: boolean;
  /** Whether built-in fallback sections are used instead of the template */
  usesFallback: boolean;
  /** Whether a repair/reset to default template is recommended */
  repairRecommended: boolean;
}

export interface DiagnosticSnapshot {
  timestamp: string;
  cwd: string;
  repoRoot: string | null;
  state: "no-repo" | "not-initialized" | "initialized-no-plan" | "initialized-has-plan";
  paths: {
    protocol: string;
    template: string;
    current: string;
    index: string;
    logsDir: string;
    archiveDir: string;
  };
  exists: {
    protocol: boolean;
    template: boolean;
    current: boolean;
    index: boolean;
  };
  currentPlan: CurrentPlanInfo & { title: string | null };
  archive: ArchiveInfo;
  template: TemplateInfo;
  initialization: {
    isFullyInitialized: boolean;
  };
  environment: {
    insideRepo: boolean;
  };
  config: ConfigInfo;
  warnings: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// File info helper (pure, no contents logged)
// ---------------------------------------------------------------------------

function fileInfo(repoRoot: string, rel: string): FileInfo {
  const abs = join(repoRoot, rel);
  const ex = existsSync(abs);
  let sizeBytes: number | null = null;
  if (ex) {
    try {
      sizeBytes = statSync(abs).size;
    } catch {
      // stat failed — leave null
    }
  }
  return { path: rel, exists: ex, sizeBytes };
}

// ---------------------------------------------------------------------------
// Current plan info (no content logged, only metadata)
// ---------------------------------------------------------------------------

function currentPlanInfo(repoRoot: string): CurrentPlanInfo {
  const abs = join(repoRoot, CURRENT_PLAN_REL);
  const ex = existsSync(abs);

  if (!ex) {
    return { exists: false, isPlaceholder: true, sizeBytes: null, lineCount: null };
  }

  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return { exists: true, isPlaceholder: false, sizeBytes: null, lineCount: null };
  }

  const sizeBytes = Buffer.byteLength(content, "utf-8");
  const lineCount = content.split("\n").length;
  const trimmed = content.trim();
  const isPlaceholder =
    trimmed.length === 0 || trimmed.includes(CURRENT_PLAN_SENTINEL);

  return { exists: true, isPlaceholder, sizeBytes, lineCount };
}

// ---------------------------------------------------------------------------
// Classify state (reuses the same logic as detectPlanState in repo.ts)
// ---------------------------------------------------------------------------

function classifyState(
  repoRoot: string | null,
): "no-repo" | "not-initialized" | "initialized-no-plan" | "initialized-has-plan" {
  if (!repoRoot) return "no-repo";
  if (!isFullyInitialized(repoRoot)) return "not-initialized";
  if (!hasCurrentPlan(repoRoot)) return "initialized-no-plan";
  return "initialized-has-plan";
}

// ---------------------------------------------------------------------------
// Collect a full diagnostic snapshot
// ---------------------------------------------------------------------------

export function collectDiagnostics(
  repoRoot: string | null,
  cwd: string,
  configOverride?: { config: PiPlanConfig; warnings: string[]; source: "default" | "file" },
): DiagnosticSnapshot {
  const state = classifyState(repoRoot);
  const now = new Date();
  const timestamp = formatTimestamp(now);

  const warnings: string[] = [];
  const notes: string[] = [];

  // Config info
  const effectiveConfig = configOverride?.config ?? DEFAULT_CONFIG;
  const configInfo: ConfigInfo = {
    source: configOverride?.source ?? "default",
    configPath: CONFIG_REL,
    effectiveArchiveDir: effectiveConfig.archiveDir,
    effectiveDebugLogDir: effectiveConfig.debugLogDir,
    maxArchiveListEntries: effectiveConfig.maxArchiveListEntries,
    archiveFilenameStyle: effectiveConfig.archiveFilenameStyle,
    allowInlineGoalArgs: effectiveConfig.allowInlineGoalArgs,
    resumeShowSummary: effectiveConfig.resumeShowSummary,
    configWarnings: configOverride?.warnings ?? [],
  };

  // Paths — use effective config values
  const paths = {
    protocol: PLANNING_PROTOCOL_REL,
    template: TASK_PLAN_TEMPLATE_REL,
    current: CURRENT_PLAN_REL,
    index: PLANS_INDEX_REL,
    logsDir: effectiveConfig.debugLogDir,
    archiveDir: effectiveConfig.archiveDir,
  };

  // If no repo, return a minimal snapshot
  if (!repoRoot) {
    return {
      timestamp,
      cwd,
      repoRoot: null,
      state,
      paths,
      exists: { protocol: false, template: false, current: false, index: false },
      currentPlan: { exists: false, isPlaceholder: true, sizeBytes: null, lineCount: null, title: null },
      archive: { count: 0, latestFilename: null },
      template: {
        usable: false,
        sectionCount: 0,
        mode: "default-fallback" as TemplateMode,
        hasExplicitPlaceholders: false,
        usesFallback: true,
        repairRecommended: false,
      },
      initialization: { isFullyInitialized: false },
      environment: { insideRepo: false },
      config: configInfo,
      warnings: ["No git repository detected."],
      notes,
    };
  }

  // File existence
  const protocolExists = existsSync(join(repoRoot, PLANNING_PROTOCOL_REL));
  const templateExists = existsSync(join(repoRoot, TASK_PLAN_TEMPLATE_REL));
  const currentExists = existsSync(join(repoRoot, CURRENT_PLAN_REL));
  const indexExists = existsSync(join(repoRoot, PLANS_INDEX_REL));

  const fullyInit = isFullyInitialized(repoRoot);
  const cpInfo = currentPlanInfo(repoRoot);

  // Warnings
  if (!fullyInit) {
    const missing: string[] = [];
    if (!protocolExists) missing.push(PLANNING_PROTOCOL_REL);
    if (!templateExists) missing.push(TASK_PLAN_TEMPLATE_REL);
    if (!currentExists) missing.push(CURRENT_PLAN_REL);
    if (!indexExists) missing.push(PLANS_INDEX_REL);
    if (missing.length > 0) {
      warnings.push(`Partial initialization — missing: ${missing.join(", ")}`);
    }
  }

  if (cpInfo.exists && cpInfo.sizeBytes !== null && cpInfo.sizeBytes > 0 && cpInfo.isPlaceholder) {
    // It exists and has content but is still placeholder
    notes.push("current.md exists but contains only the placeholder content.");
  }

  if (cpInfo.exists && cpInfo.sizeBytes === 0) {
    warnings.push("current.md exists but is empty (0 bytes).");
  }

  // Archive info (use config-aware listing, but count all)
  const archives = listArchives(repoRoot, { archiveDir: effectiveConfig.archiveDir, maxArchiveListEntries: 9999 });
  const archiveInfo: ArchiveInfo = {
    count: archives.length,
    latestFilename: archives.length > 0 ? archives[0].filename : null,
  };

  // Current plan title
  let currentTitle: string | null = null;
  if (cpInfo.exists && !cpInfo.isPlaceholder) {
    const content = readCurrentPlan(repoRoot);
    if (content) currentTitle = extractPlanTitle(content);
  }

  // Template info — uses shared analysis from template-analysis.ts
  const analysis = analyzeTemplateFromDisk(repoRoot);
  const templateInfo: TemplateInfo = {
    usable: analysis.usable,
    sectionCount: analysis.sectionCount,
    mode: analysis.mode,
    hasExplicitPlaceholders: analysis.hasExplicitPlaceholders,
    usesFallback: analysis.usesFallback,
    repairRecommended: analysis.repairRecommended,
  };

  notes.push(analysis.summary);

  return {
    timestamp,
    cwd,
    repoRoot,
    state,
    paths,
    exists: {
      protocol: protocolExists,
      template: templateExists,
      current: currentExists,
      index: indexExists,
    },
    currentPlan: { ...cpInfo, title: currentTitle },
    archive: archiveInfo,
    template: templateInfo,
    initialization: { isFullyInitialized: fullyInit },
    environment: { insideRepo: true },
    config: configInfo,
    warnings,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Timestamp formatting — deterministic, sortable
// ---------------------------------------------------------------------------

function pad(n: number, width: number = 2): string {
  return String(n).padStart(width, "0");
}

export function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${mo}-${d}-${h}${mi}${s}`;
}

// ---------------------------------------------------------------------------
// Log filename
// ---------------------------------------------------------------------------

export function logFilename(date: Date): string {
  return `plan-debug-${formatTimestamp(date)}.json`;
}

// ---------------------------------------------------------------------------
// Log path (repo-relative)
// ---------------------------------------------------------------------------

export function logRelPath(date: Date): string {
  return `${LOGS_DIR_REL}/${logFilename(date)}`;
}

// ---------------------------------------------------------------------------
// Write a diagnostic snapshot as a JSON log file
// ---------------------------------------------------------------------------

export interface WriteLogResult {
  absPath: string;
  relPath: string;
}

/**
 * Write a diagnostic snapshot to the debug log directory.
 *
 * - Creates the log directory if it does not exist
 * - Does not overwrite: appends a counter suffix if the file already exists
 * - Returns the absolute and relative paths of the written file
 * - Respects config for debug log dir
 */
export function writeDiagnosticLog(
  repoRoot: string,
  snapshot: DiagnosticSnapshot,
  config?: Partial<Pick<PiPlanConfig, "debugLogDir">>,
): WriteLogResult {
  const logsDirRel = config?.debugLogDir ?? LOGS_DIR_REL;
  const logsDir = join(repoRoot, logsDirRel);
  mkdirSync(logsDir, { recursive: true });

  const date = new Date(
    snapshot.timestamp.replace(
      /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/,
      "$1-$2-$3T$4:$5:$6",
    ),
  );

  const filename = logFilename(date);
  let rel = `${logsDirRel}/${filename}`;
  let abs = join(repoRoot, rel);

  // Avoid overwriting — append counter if needed
  if (existsSync(abs)) {
    let counter = 1;
    while (existsSync(abs)) {
      const base = `plan-debug-${formatTimestamp(date)}-${counter}.json`;
      rel = `${logsDirRel}/${base}`;
      abs = join(repoRoot, rel);
      counter++;
    }
  }

  const json = JSON.stringify(snapshot, null, 2) + "\n";
  writeFileSync(abs, json, "utf-8");

  return { absPath: abs, relPath: rel };
}
