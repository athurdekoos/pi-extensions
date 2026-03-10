/**
 * Native ADK project creation via the installed `adk` CLI.
 *
 * Wraps `adk create APP_NAME` and `adk create --type=config APP_NAME`
 * as subprocess calls with workspace safety checks.
 */

import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { detectAdkCli, type AdkCliCapabilities } from "./adk-cli-detect.js";
import {
  buildCreationMetadata,
  writeCreationMetadata,
  type AdkCreationMetadata,
} from "./creation-metadata.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NativeCreateMode = "native_app" | "native_config";

export interface NativeCreateParams {
  mode: NativeCreateMode;
  name: string;
  /** Target path relative to cwd. Default: `./agents/<name>` */
  path?: string;
  model?: string;
  overwrite?: boolean;
}

export interface NativeCreateResult {
  ok: boolean;
  mode: NativeCreateMode;
  name: string;
  project_path: string;
  adk_cli_version: string | null;
  command_used: string;
  metadata_written: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Validate that targetPath stays within the workspace root.
 * Returns an error string, or null if valid.
 */
function validateTargetPath(cwd: string, targetPath: string): string | null {
  const resolvedCwd = resolve(cwd);
  const resolvedTarget = resolve(cwd, targetPath);
  const rel = relative(resolvedCwd, resolvedTarget);
  if (rel.startsWith("..")) {
    return (
      `project_path "${targetPath}" resolves outside the workspace root. ` +
      `Resolved: ${resolvedTarget}. Workspace: ${resolvedCwd}. ` +
      `Use a relative path within the current working directory.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

/**
 * Build the adk create command args.
 * - native_app:    adk create APP_NAME
 * - native_config: adk create --type=config APP_NAME
 *
 * The command runs from the parent directory of the target, since
 * `adk create <name>` creates a subdirectory with that name.
 */
export function buildCreateCommand(
  mode: NativeCreateMode,
  name: string
): { args: string[]; description: string } {
  const args = ["create"];
  if (mode === "native_config") {
    args.push("--type=config");
  }
  args.push(name);
  const description = `adk ${args.join(" ")}`;
  return { args, description };
}

// ---------------------------------------------------------------------------
// Subprocess execution
// ---------------------------------------------------------------------------

interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

function runAdkCreate(
  args: string[],
  cwd: string,
  timeoutMs = 30_000
): Promise<SubprocessResult> {
  return new Promise((resolveP) => {
    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (exitCode: number | null, error?: string) => {
      if (done) return;
      done = true;
      resolveP({ stdout, stderr, exitCode, error });
    };

    let child;
    try {
      child = spawn("adk", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        env: { ...process.env },
      });
    } catch (err) {
      finish(
        null,
        `Failed to spawn 'adk': ${err instanceof Error ? err.message : String(err)}`
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
        finish(null, "The 'adk' CLI is not installed or not on $PATH. Install it with: pip install google-adk");
      } else {
        finish(null, `Failed to run 'adk': ${err.message}`);
      }
    });

    child.on("close", (code) => {
      finish(code);
    });
  });
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Create a native ADK project using the installed CLI.
 *
 * 1. Validates workspace safety.
 * 2. Runs capability detection.
 * 3. Shells out to `adk create`.
 * 4. Writes thin Pi metadata on success.
 */
export async function createNativeAdkProject(
  cwd: string,
  params: NativeCreateParams
): Promise<NativeCreateResult> {
  const { mode, name, overwrite = false } = params;
  const targetPath = params.path ?? `./agents/${name}`;

  // 1. Path safety
  const pathError = validateTargetPath(cwd, targetPath);
  if (pathError) {
    return errorResult(mode, name, targetPath, pathError);
  }

  // 2. Destination exists check
  const resolvedTarget = resolve(cwd, targetPath);
  if (existsSync(resolvedTarget) && !overwrite) {
    return errorResult(
      mode,
      name,
      targetPath,
      `Destination "${targetPath}" already exists. Use overwrite: true to replace.`
    );
  }

  // 3. Capability detection
  let caps: AdkCliCapabilities;
  try {
    caps = await detectAdkCli();
  } catch (err) {
    return errorResult(
      mode,
      name,
      targetPath,
      `ADK CLI detection failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!caps.available) {
    return errorResult(
      mode,
      name,
      targetPath,
      caps.error ?? "The 'adk' CLI is not available."
    );
  }

  // 4. Mode-specific capability checks
  if (mode === "native_app" && !caps.nativeAppCreate) {
    return errorResult(
      mode,
      name,
      targetPath,
      "The installed ADK CLI does not support the 'create' command. " +
        `Detected version: ${caps.version ?? "unknown"}. ` +
        "Checked: adk --help. " +
        "Please update google-adk: pip install --upgrade google-adk"
    );
  }

  if (mode === "native_config" && !caps.nativeConfigCreate) {
    return errorResult(
      mode,
      name,
      targetPath,
      "Native config app creation (adk create --type=config) is not supported " +
        "by the installed ADK CLI. " +
        `Detected ADK version: ${caps.version ?? "unknown"}. ` +
        "Checked: adk create --help — the --type=config option was not found. " +
        "This feature may require a newer version of google-adk."
    );
  }

  // 5. Build and run command
  // `adk create <name>` creates a subdirectory. We need to ensure
  // the parent directory exists and run from there.
  const parentDir = resolve(cwd, targetPath, "..");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(parentDir, { recursive: true });

  const { args, description } = buildCreateCommand(mode, name);
  const result = await runAdkCreate(args, parentDir);

  if (result.error) {
    return errorResult(mode, name, targetPath, result.error);
  }

  if (result.exitCode !== 0) {
    return {
      ok: false,
      mode,
      name,
      project_path: targetPath,
      adk_cli_version: caps.version,
      command_used: description,
      metadata_written: false,
      stdout: result.stdout,
      stderr: result.stderr,
      error:
        `ADK CLI command failed with exit code ${result.exitCode}. ` +
        `Command: ${description}` +
        (result.stderr ? `\nstderr: ${result.stderr.slice(0, 2000)}` : "") +
        (result.stdout ? `\nstdout: ${result.stdout.slice(0, 2000)}` : ""),
    };
  }

  // 6. Verify the directory was created
  if (!existsSync(resolvedTarget)) {
    return {
      ok: false,
      mode,
      name,
      project_path: targetPath,
      adk_cli_version: caps.version,
      command_used: description,
      metadata_written: false,
      stdout: result.stdout,
      stderr: result.stderr,
      error:
        `ADK CLI reported success but the expected directory "${targetPath}" was not created. ` +
        `The 'adk create' command may have used a different directory name.`,
    };
  }

  // 7. Write thin Pi metadata
  let metadataWritten = false;
  try {
    const supportedModes: string[] = [];
    if (caps.nativeAppCreate) supportedModes.push("native_app");
    if (caps.nativeConfigCreate) supportedModes.push("native_config");

    const metadata: AdkCreationMetadata = buildCreationMetadata({
      sourceType: mode,
      agentName: name,
      projectPath: targetPath,
      adkVersion: caps.version,
      commandUsed: description,
      supportedModes,
      creationArgs: { mode, name, path: targetPath, model: params.model },
    });

    writeCreationMetadata(cwd, targetPath, metadata);
    metadataWritten = true;
  } catch {
    // Metadata write failure is non-fatal — the project is still usable.
  }

  return {
    ok: true,
    mode,
    name,
    project_path: targetPath,
    adk_cli_version: caps.version,
    command_used: description,
    metadata_written: metadataWritten,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResult(
  mode: NativeCreateMode,
  name: string,
  projectPath: string,
  error: string
): NativeCreateResult {
  return {
    ok: false,
    mode,
    name,
    project_path: projectPath,
    adk_cli_version: null,
    command_used: "",
    metadata_written: false,
    stdout: "",
    stderr: "",
    error,
  };
}
