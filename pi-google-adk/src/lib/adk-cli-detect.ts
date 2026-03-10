/**
 * ADK CLI detection and capability probing.
 *
 * Locates the installed `adk` CLI, reads its help surfaces, and determines
 * which creation modes are available (native app, native config).
 *
 * This module shells out to `adk --help`, `adk create --help`, and
 * `adk --version` (or equivalent) to build a structured capability report.
 */

import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdkCliCapabilities {
  /** Whether the adk CLI is available on PATH at all. */
  available: boolean;
  /** Version string if parseable, or null. */
  version: string | null;
  /** Whether `adk create` is recognized (native app creation). */
  nativeAppCreate: boolean;
  /** Whether `adk create --type=config` is recognized (native config creation). */
  nativeConfigCreate: boolean;
  /** Raw `adk --help` output for diagnostics. */
  helpOutput: string;
  /** Raw `adk create --help` output for diagnostics. */
  createHelpOutput: string;
  /** Error message if adk is not available. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

/**
 * Run a command and capture stdout/stderr.
 * Returns cleanly on ENOENT and other spawn errors.
 */
function execCapture(
  command: string,
  args: string[],
  timeoutMs = 10_000
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (exitCode: number | null, error?: string) => {
      if (done) return;
      done = true;
      resolve({ stdout, stderr, exitCode, error });
    };

    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });
    } catch (err) {
      finish(null, `Failed to spawn '${command}': ${err instanceof Error ? err.message : String(err)}`);
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
        finish(null, `'${command}' not found on PATH.`);
      } else {
        finish(null, `Failed to run '${command}': ${err.message}`);
      }
    });

    child.on("close", (code) => {
      finish(code);
    });
  });
}

// ---------------------------------------------------------------------------
// Version parsing
// ---------------------------------------------------------------------------

/**
 * Try to extract a version string from `adk --version` or `adk version` output.
 * Returns null if unparseable.
 */
export function parseAdkVersion(output: string): string | null {
  // Common patterns:
  //   "adk 1.2.3"
  //   "ADK version 1.2.3"
  //   "1.2.3"
  //   "google-adk==1.2.3"
  const patterns = [
    /(?:adk|ADK|google-adk)[=, ]+v(?:ersion\s+)?(\d+\.\d+\S*)/i,
    /(?:adk|ADK|google-adk)[= ]+(\d+\.\d+\S*)/i,
    /\bversion\s+(\d+\.\d+\S*)/i,
    /^v?(\d+\.\d+\.\d+\S*)$/m,
  ];
  for (const pat of patterns) {
    const m = pat.exec(output);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Help parsing
// ---------------------------------------------------------------------------

/**
 * Determine whether `adk create` is a recognized subcommand
 * by inspecting `adk --help` output.
 */
export function helpShowsCreate(helpOutput: string): boolean {
  // Look for "create" as a word in the help text, typically in a commands list
  return /\bcreate\b/i.test(helpOutput);
}

/**
 * Determine whether `adk create --type=config` (or `--type config`) is supported
 * by inspecting `adk create --help` output.
 */
export function createHelpShowsConfigType(createHelpOutput: string): boolean {
  // Look for --type and config mentioned together in the help
  // Patterns: "--type", "config" as a type option value
  if (!createHelpOutput) return false;

  const hasTypeFlag = /--type\b/i.test(createHelpOutput);
  const hasConfigValue = /\bconfig\b/i.test(createHelpOutput);

  return hasTypeFlag && hasConfigValue;
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

/**
 * Detect the installed ADK CLI and probe its capabilities.
 *
 * Steps:
 * 1. Run `adk --help` — determines if adk is on PATH and whether `create` exists.
 * 2. Run `adk create --help` — determines if `--type=config` is supported.
 * 3. Run `adk --version` — tries to extract version info.
 *
 * Returns a structured capability report.
 */
export async function detectAdkCli(): Promise<AdkCliCapabilities> {
  // Step 1: adk --help
  const helpResult = await execCapture("adk", ["--help"]);

  if (helpResult.error?.includes("not found")) {
    return {
      available: false,
      version: null,
      nativeAppCreate: false,
      nativeConfigCreate: false,
      helpOutput: "",
      createHelpOutput: "",
      error:
        "The 'adk' CLI is not installed or not on $PATH. " +
        "Install it with: pip install google-adk",
    };
  }

  // adk --help may exit non-zero and still produce useful output
  const helpOutput = helpResult.stdout || helpResult.stderr;
  const hasCreate = helpShowsCreate(helpOutput);

  // Step 2: adk create --help (only if create was found)
  let createHelpOutput = "";
  let hasConfigType = false;

  if (hasCreate) {
    const createHelpResult = await execCapture("adk", ["create", "--help"]);
    createHelpOutput = createHelpResult.stdout || createHelpResult.stderr;
    hasConfigType = createHelpShowsConfigType(createHelpOutput);
  }

  // Step 3: adk --version (best effort)
  let version: string | null = null;
  const versionResult = await execCapture("adk", ["--version"]);
  if (!versionResult.error) {
    version = parseAdkVersion(versionResult.stdout || versionResult.stderr);
  }
  // fallback: try to extract version from help output
  if (!version) {
    version = parseAdkVersion(helpOutput);
  }

  return {
    available: true,
    version,
    nativeAppCreate: hasCreate,
    nativeConfigCreate: hasCreate && hasConfigType,
    helpOutput,
    createHelpOutput,
  };
}
