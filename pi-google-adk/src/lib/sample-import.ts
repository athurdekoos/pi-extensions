/**
 * Git-based selective import of official ADK samples.
 *
 * Fetches only the selected sample from google/adk-samples into a
 * target project directory. Uses git sparse-checkout or shallow clone
 * with copy-out to avoid leaving the full upstream repo as the artifact.
 *
 * Strategy:
 * 1. Shallow-clone the upstream repo into a temp directory.
 * 2. Copy only the selected sample's directory into the target path.
 * 3. Clean up the temp clone.
 * 4. Write provenance metadata.
 */

import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findSampleBySlug,
  UPSTREAM_REPO,
  type CatalogEntry,
} from "./sample-catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SampleImportParams {
  /** Sample slug from the curated catalog. */
  sample_slug: string;
  /** Agent name for the imported project. */
  name: string;
  /** Target path relative to cwd. Default: ./agents/<name> */
  path?: string;
  /** Overwrite existing destination. Default: false */
  overwrite?: boolean;
  /** Git ref to checkout. Default: "main" */
  ref?: string;
}

export interface SampleImportResult {
  ok: boolean;
  name: string;
  sample_slug: string;
  project_path: string;
  upstream_repo: string;
  upstream_path: string;
  upstream_ref: string;
  commit?: string;
  error?: string;
}

export interface SampleProvenance {
  upstream_repo: string;
  upstream_path: string;
  upstream_ref: string;
  commit: string | null;
  imported_at: string;
  sample_slug: string;
}

// ---------------------------------------------------------------------------
// Git detection
// ---------------------------------------------------------------------------

/**
 * Check whether git is available on PATH.
 */
export async function isGitAvailable(): Promise<boolean> {
  return new Promise((res) => {
    let child;
    try {
      child = spawn("git", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
    } catch {
      res(false);
      return;
    }

    child.on("error", () => res(false));
    child.on("close", (code) => res(code === 0));
  });
}

// ---------------------------------------------------------------------------
// Subprocess helpers
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
  timeoutMs = 60_000
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
      finish(
        null,
        `Failed to spawn 'git': ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        finish(null, "git is not installed or not on $PATH.");
      } else {
        finish(null, `git error: ${err.message}`);
      }
    });
    child.on("close", (code) => finish(code));
  });
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

function validateTargetPath(cwd: string, targetPath: string): string | null {
  const resolvedCwd = resolve(cwd);
  const resolvedTarget = resolve(cwd, targetPath);
  const rel = relative(resolvedCwd, resolvedTarget);
  if (rel.startsWith("..")) {
    return (
      `Target path "${targetPath}" resolves outside the workspace root. ` +
      `Resolved: ${resolvedTarget}. Workspace: ${resolvedCwd}.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main import
// ---------------------------------------------------------------------------

/**
 * Import a single official ADK sample into the target project directory.
 *
 * 1. Validate slug against curated catalog.
 * 2. Validate target path.
 * 3. Check git availability.
 * 4. Shallow-clone upstream repo to temp dir.
 * 5. Copy selected sample directory to target.
 * 6. Extract commit hash.
 * 7. Clean up temp clone.
 */
export async function importOfficialSample(
  cwd: string,
  params: SampleImportParams
): Promise<{ result: SampleImportResult; provenance: SampleProvenance | null }> {
  const { sample_slug, name, overwrite = false } = params;
  const targetPath = params.path ?? `./agents/${name}`;
  const ref = params.ref ?? "main";

  // 1. Validate slug
  const catalogEntry = findSampleBySlug(sample_slug);
  if (!catalogEntry) {
    return {
      result: importError(name, sample_slug, targetPath, ref,
        `Unknown sample slug "${sample_slug}". ` +
        `Available slugs: ${(await import("./sample-catalog.js")).allSampleSlugs().join(", ")}`
      ),
      provenance: null,
    };
  }

  // 2. Path safety
  const pathError = validateTargetPath(cwd, targetPath);
  if (pathError) {
    return {
      result: importError(name, sample_slug, targetPath, ref, pathError),
      provenance: null,
    };
  }

  // 3. Destination exists check
  const resolvedTarget = resolve(cwd, targetPath);
  if (existsSync(resolvedTarget) && !overwrite) {
    return {
      result: importError(name, sample_slug, targetPath, ref,
        `Destination "${targetPath}" already exists. Use overwrite: true to replace.`
      ),
      provenance: null,
    };
  }

  // 4. Check git
  const gitOk = await isGitAvailable();
  if (!gitOk) {
    return {
      result: importError(name, sample_slug, targetPath, ref,
        "git is required for sample import but is not available on $PATH. " +
        "Please install git."
      ),
      provenance: null,
    };
  }

  // 5. Shallow clone to temp
  const tempDir = join(tmpdir(), `pi-adk-sample-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const cloneResult = await execGit(
      ["clone", "--depth=1", `--branch=${ref}`, "--single-branch", UPSTREAM_REPO, "."],
      tempDir
    );

    if (cloneResult.error || (cloneResult.exitCode !== null && cloneResult.exitCode !== 0)) {
      return {
        result: importError(name, sample_slug, targetPath, ref,
          `Failed to clone ${UPSTREAM_REPO}: ` +
          (cloneResult.error ?? cloneResult.stderr ?? `exit code ${cloneResult.exitCode}`)
        ),
        provenance: null,
      };
    }

    // 6. Verify the sample directory exists in the cloned repo
    const sampleSrcDir = join(tempDir, catalogEntry.upstream_path);
    if (!existsSync(sampleSrcDir) || !statSync(sampleSrcDir).isDirectory()) {
      return {
        result: importError(name, sample_slug, targetPath, ref,
          `Sample directory "${catalogEntry.upstream_path}" not found in upstream repo. ` +
          `The upstream repo structure may have changed.`
        ),
        provenance: null,
      };
    }

    // 7. Copy sample to target
    if (existsSync(resolvedTarget) && overwrite) {
      rmSync(resolvedTarget, { recursive: true, force: true });
    }
    mkdirSync(resolvedTarget, { recursive: true });
    cpSync(sampleSrcDir, resolvedTarget, { recursive: true });

    // 8. Get commit hash
    let commit: string | null = null;
    const logResult = await execGit(["rev-parse", "HEAD"], tempDir);
    if (logResult.exitCode === 0) {
      commit = logResult.stdout.trim();
    }

    // Build provenance
    const provenance: SampleProvenance = {
      upstream_repo: UPSTREAM_REPO,
      upstream_path: catalogEntry.upstream_path,
      upstream_ref: ref,
      commit,
      imported_at: new Date().toISOString(),
      sample_slug,
    };

    const result: SampleImportResult = {
      ok: true,
      name,
      sample_slug,
      project_path: targetPath,
      upstream_repo: UPSTREAM_REPO,
      upstream_path: catalogEntry.upstream_path,
      upstream_ref: ref,
      commit: commit ?? undefined,
    };

    return { result, provenance };
  } finally {
    // 9. Cleanup temp clone
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function importError(
  name: string,
  sample_slug: string,
  project_path: string,
  ref: string,
  error: string
): SampleImportResult {
  return {
    ok: false,
    name,
    sample_slug,
    project_path,
    upstream_repo: UPSTREAM_REPO,
    upstream_path: "",
    upstream_ref: ref,
    error,
  };
}
