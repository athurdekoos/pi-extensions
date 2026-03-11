/**
 * Drift detection for imported official ADK samples.
 *
 * Compares three trees:
 *   A. Baseline  — upstream sample at the recorded import commit/ref
 *   B. Upstream   — current upstream sample (HEAD of default branch)
 *   C. Local      — current local project directory
 *
 * Classification:
 *   up_to_date          — A == B == C
 *   upstream_updated    — A == C, A != B
 *   local_modified      — A == B, A != C
 *   diverged            — A != B, A != C
 *
 * Error statuses:
 *   unsupported_project — not an imported official sample
 *   missing_provenance  — required provenance fields are absent
 *   git_unavailable     — git not on PATH
 *   upstream_unavailable — cannot fetch/resolve upstream repo or path
 *   error               — unexpected failure
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isGitAvailable } from "./sample-import.js";
import { hashDirectoryTree, type TreeHashResult } from "./tree-hash.js";
import {
  CREATION_METADATA_FILENAME,
  type AdkCreationMetadata,
  readAndValidateMetadata,
} from "./creation-metadata.js";
import type { SampleProvenance } from "./sample-import.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftStatus =
  | "up_to_date"
  | "upstream_updated"
  | "local_modified"
  | "diverged"
  | "unsupported_project"
  | "missing_provenance"
  | "git_unavailable"
  | "upstream_unavailable"
  | "error";

export interface DriftCheckResult {
  success: boolean;
  status: DriftStatus;
  project_path: string;
  source_type: string;
  upstream_repo: string;
  upstream_path: string;
  imported_ref: string;
  imported_commit: string;
  current_upstream_ref: string;
  current_upstream_commit: string;
  local_hash: string;
  baseline_hash: string;
  current_upstream_hash: string;
  summary: string;
  notes: string[];
  changed_files?: ChangedFilesSummary;
}

export interface ChangedFilesSummary {
  local_vs_baseline: string[];
  upstream_vs_baseline: string[];
}

export interface DriftTrackingUpdate {
  last_drift_check_at: string;
  last_drift_status: DriftStatus;
  last_checked_upstream_commit: string;
  last_local_hash: string;
  last_upstream_hash: string;
}

// ---------------------------------------------------------------------------
// Git helper (reused from sample-import pattern)
// ---------------------------------------------------------------------------

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

function execGit(
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
): Promise<ExecResult> {
  return new Promise((res) => {
    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (exitCode: number | null, error?: string) => {
      if (done) return;
      done = true;
      res({ stdout, stderr, exitCode, error });
    };

    let child;
    try {
      child = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        env: { ...process.env },
      });
    } catch (err) {
      finish(null, `Failed to spawn 'git': ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (err) => finish(null, `git error: ${err.message}`));
    child.on("close", (code) => finish(code));
  });
}

// ---------------------------------------------------------------------------
// Provenance extraction
// ---------------------------------------------------------------------------

export interface ExtractedProvenance {
  upstream_repo: string;
  upstream_path: string;
  upstream_ref: string;
  commit: string | null;
  sample_slug: string;
}

/**
 * Read and validate provenance from .pi-adk-metadata.json.
 *
 * Returns null with an appropriate DriftCheckResult on any failure.
 */
export function extractProvenance(
  projectRoot: string,
): { provenance: ExtractedProvenance } | { error: DriftCheckResult } {
  // Phase 5A: Use shared schema validation for consistent metadata reading
  const validation = readAndValidateMetadata(projectRoot);

  if (!validation.ok || !validation.metadata) {
    // Distinguish file-not-found from parse errors
    const fileError = validation.errors.find((e) => e.includes("not found"));
    if (fileError) {
      return {
        error: makeErrorResult("missing_provenance", projectRoot,
          "No .pi-adk-metadata.json found. Drift detection requires provenance metadata."),
      };
    }
    return {
      error: makeErrorResult("missing_provenance", projectRoot,
        `Failed to parse .pi-adk-metadata.json: ${validation.errors.join("; ")}`),
    };
  }

  const meta = validation.metadata;

  if (meta.source_type !== "official_sample") {
    return {
      error: makeErrorResult("unsupported_project", projectRoot,
        `Project source_type is "${meta.source_type}". ` +
        "Drift detection only works on imported official samples (source_type = official_sample)."),
    };
  }

  const si = meta.provenance?.sample_import;
  if (!si || !si.upstream_repo || !si.upstream_path) {
    return {
      error: makeErrorResult("missing_provenance", projectRoot,
        "Provenance metadata is present but sample_import fields are missing or incomplete. " +
        "Required: upstream_repo, upstream_path."),
    };
  }

  return {
    provenance: {
      upstream_repo: si.upstream_repo,
      upstream_path: si.upstream_path,
      upstream_ref: si.upstream_ref ?? "main",
      commit: si.commit ?? null,
      sample_slug: si.sample_slug ?? "unknown",
    },
  };
}

// ---------------------------------------------------------------------------
// Core drift detection
// ---------------------------------------------------------------------------

/**
 * Perform drift detection on an imported official sample project.
 *
 * @param projectRoot  Absolute path to the local project directory.
 */
export async function detectDrift(projectRoot: string): Promise<DriftCheckResult> {
  // 1. Check git
  const gitOk = await isGitAvailable();
  if (!gitOk) {
    return makeErrorResult("git_unavailable", projectRoot,
      "git is required for drift detection but is not available on $PATH.");
  }

  // 2. Extract provenance
  const prov = extractProvenance(projectRoot);
  if ("error" in prov) return prov.error;
  const { provenance } = prov;

  // 3. Hash local tree
  let localTree: TreeHashResult;
  try {
    localTree = hashDirectoryTree(projectRoot);
  } catch (err) {
    return makeErrorResult("error", projectRoot,
      `Failed to hash local project: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Clone upstream to temp dir
  const tempDir = join(
    tmpdir(),
    `pi-adk-drift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tempDir, { recursive: true });

  try {
    // Clone at the default branch (current upstream)
    const ref = provenance.upstream_ref || "main";
    const cloneResult = await execGit(
      ["clone", "--single-branch", `--branch=${ref}`, provenance.upstream_repo, "."],
      tempDir,
    );

    if (cloneResult.error || (cloneResult.exitCode !== null && cloneResult.exitCode !== 0)) {
      return makeErrorResult("upstream_unavailable", projectRoot,
        `Failed to clone upstream repo: ${cloneResult.error ?? cloneResult.stderr ?? `exit code ${cloneResult.exitCode}`}`);
    }

    // 5. Get current upstream HEAD commit
    const headResult = await execGit(["rev-parse", "HEAD"], tempDir);
    const currentUpstreamCommit = headResult.exitCode === 0
      ? headResult.stdout.trim()
      : "";

    // 6. Hash current upstream sample subtree
    const upstreamSampleDir = join(tempDir, provenance.upstream_path);
    if (!existsSync(upstreamSampleDir)) {
      return makeErrorResult("upstream_unavailable", projectRoot,
        `Upstream sample path "${provenance.upstream_path}" not found in the cloned repo. ` +
        "The upstream repo structure may have changed.");
    }

    let currentUpstreamTree: TreeHashResult;
    try {
      currentUpstreamTree = hashDirectoryTree(upstreamSampleDir);
    } catch (err) {
      return makeErrorResult("error", projectRoot,
        `Failed to hash current upstream sample: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 7. Hash baseline tree (at the import commit)
    let baselineTree: TreeHashResult;
    const notes: string[] = [];

    if (provenance.commit) {
      // Checkout the recorded import commit to get the baseline
      const checkoutResult = await execGit(["checkout", provenance.commit], tempDir);
      if (checkoutResult.error || (checkoutResult.exitCode !== null && checkoutResult.exitCode !== 0)) {
        // Commit might have been garbage-collected or rebased away.
        // Fall back to treating current upstream as baseline (best effort).
        notes.push(
          `Could not checkout baseline commit ${provenance.commit}. ` +
          "Falling back to current upstream as baseline approximation. " +
          "Drift classification may be imprecise."
        );
        baselineTree = currentUpstreamTree;
      } else {
        const baselineSampleDir = join(tempDir, provenance.upstream_path);
        if (!existsSync(baselineSampleDir)) {
          notes.push(
            `Baseline sample path "${provenance.upstream_path}" not found at commit ${provenance.commit}. ` +
            "Falling back to current upstream as baseline."
          );
          baselineTree = currentUpstreamTree;
        } else {
          try {
            baselineTree = hashDirectoryTree(baselineSampleDir);
          } catch {
            notes.push("Failed to hash baseline sample. Using current upstream as fallback.");
            baselineTree = currentUpstreamTree;
          }
        }
      }
    } else {
      // No import commit recorded — cannot determine true baseline.
      // Use current upstream as best-effort baseline.
      notes.push(
        "No import commit recorded in provenance. " +
        "Using current upstream as baseline. " +
        "Cannot distinguish upstream_updated from up_to_date."
      );
      baselineTree = currentUpstreamTree;
    }

    // 8. Classify drift
    const baselineHash = baselineTree.hash;
    const localHash = localTree.hash;
    const upstreamHash = currentUpstreamTree.hash;

    const status = classifyDrift(baselineHash, localHash, upstreamHash);

    // 9. Compute changed files summary
    const changedFiles = computeChangedFiles(baselineTree, localTree, currentUpstreamTree);

    const summary = buildSummary(status, provenance, currentUpstreamCommit, notes);

    return {
      success: true,
      status,
      project_path: projectRoot,
      source_type: "official_sample",
      upstream_repo: provenance.upstream_repo,
      upstream_path: provenance.upstream_path,
      imported_ref: provenance.upstream_ref,
      imported_commit: provenance.commit ?? "",
      current_upstream_ref: ref,
      current_upstream_commit: currentUpstreamCommit,
      local_hash: localHash,
      baseline_hash: baselineHash,
      current_upstream_hash: upstreamHash,
      summary,
      notes,
      changed_files: changedFiles,
    };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify drift from three hashes.
 *
 * Exported for direct unit testing.
 */
export function classifyDrift(
  baselineHash: string,
  localHash: string,
  upstreamHash: string,
): DriftStatus {
  const baselineMatchesLocal = baselineHash === localHash;
  const baselineMatchesUpstream = baselineHash === upstreamHash;

  if (baselineMatchesLocal && baselineMatchesUpstream) return "up_to_date";
  if (baselineMatchesLocal && !baselineMatchesUpstream) return "upstream_updated";
  if (!baselineMatchesLocal && baselineMatchesUpstream) return "local_modified";
  return "diverged";
}

// ---------------------------------------------------------------------------
// Changed files
// ---------------------------------------------------------------------------

function computeChangedFiles(
  baseline: TreeHashResult,
  local: TreeHashResult,
  upstream: TreeHashResult,
): ChangedFilesSummary {
  const baselineMap = new Map(baseline.files.map((f) => [f.relativePath, f.contentHash]));

  const localVsBaseline: string[] = [];
  const localMap = new Map(local.files.map((f) => [f.relativePath, f.contentHash]));
  // Files changed or added in local
  for (const [path, hash] of localMap) {
    const baseHash = baselineMap.get(path);
    if (baseHash !== hash) localVsBaseline.push(path);
  }
  // Files removed from local
  for (const path of baselineMap.keys()) {
    if (!localMap.has(path)) localVsBaseline.push(path);
  }

  const upstreamVsBaseline: string[] = [];
  const upstreamMap = new Map(upstream.files.map((f) => [f.relativePath, f.contentHash]));
  for (const [path, hash] of upstreamMap) {
    const baseHash = baselineMap.get(path);
    if (baseHash !== hash) upstreamVsBaseline.push(path);
  }
  for (const path of baselineMap.keys()) {
    if (!upstreamMap.has(path)) upstreamVsBaseline.push(path);
  }

  return {
    local_vs_baseline: localVsBaseline.sort(),
    upstream_vs_baseline: upstreamVsBaseline.sort(),
  };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(
  status: DriftStatus,
  provenance: ExtractedProvenance,
  currentUpstreamCommit: string,
  notes: string[],
): string {
  const lines: string[] = [];

  switch (status) {
    case "up_to_date":
      lines.push("✓ Up to date — local project matches current upstream sample.");
      break;
    case "upstream_updated":
      lines.push("⬆ Upstream updated — the upstream sample has changed since import.");
      lines.push("  Your local copy still matches the originally imported version.");
      break;
    case "local_modified":
      lines.push("✎ Locally modified — you have made changes to the imported sample.");
      lines.push("  The upstream sample has not changed since import.");
      break;
    case "diverged":
      lines.push("⚡ Diverged — both local and upstream have changed since import.");
      lines.push("  Manual review is recommended before any sync.");
      break;
    default:
      lines.push(`Status: ${status}`);
  }

  lines.push(`Sample: ${provenance.sample_slug} (${provenance.upstream_path})`);
  if (provenance.commit) {
    lines.push(`Imported at commit: ${provenance.commit.slice(0, 12)}`);
  }
  if (currentUpstreamCommit) {
    lines.push(`Current upstream commit: ${currentUpstreamCommit.slice(0, 12)}`);
  }

  if (notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of notes) {
      lines.push(`  • ${note}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Metadata tracking update
// ---------------------------------------------------------------------------

/**
 * Write drift tracking fields into the existing metadata file.
 *
 * Additive: only updates the `tracking` section.
 * Does not touch other metadata fields.
 */
export function writeDriftTracking(
  projectRoot: string,
  update: DriftTrackingUpdate,
): boolean {
  const metaPath = join(projectRoot, CREATION_METADATA_FILENAME);
  if (!existsSync(metaPath)) return false;

  try {
    const raw = readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(raw);

    if (!meta.tracking || typeof meta.tracking !== "object") {
      meta.tracking = {};
    }

    meta.tracking.last_drift_check_at = update.last_drift_check_at;
    meta.tracking.last_drift_status = update.last_drift_status;
    meta.tracking.last_checked_upstream_commit = update.last_checked_upstream_commit;
    meta.tracking.last_local_hash = update.last_local_hash;
    meta.tracking.last_upstream_hash = update.last_upstream_hash;

    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Error result helper
// ---------------------------------------------------------------------------

function makeErrorResult(
  status: DriftStatus,
  projectPath: string,
  message: string,
): DriftCheckResult {
  return {
    success: false,
    status,
    project_path: projectPath,
    source_type: "",
    upstream_repo: "",
    upstream_path: "",
    imported_ref: "",
    imported_commit: "",
    current_upstream_ref: "",
    current_upstream_commit: "",
    local_hash: "",
    baseline_hash: "",
    current_upstream_hash: "",
    summary: message,
    notes: [],
  };
}
