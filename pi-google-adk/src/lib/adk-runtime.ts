/**
 * ADK project runtime execution.
 *
 * Executes an on-disk ADK project using `adk run --replay` and captures
 * the output. Works for basic, mcp, and sequential templates.
 */

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { detectAdkProject, type ProjectInfo } from "./project-detect.js";
import { safePath } from "./fs-safe.js";
import { createTempReplay, cleanupTempReplay } from "./temp-replay.js";

export interface AdkRunResult {
  success: boolean;
  project_path: string;
  agent_name: string | null;
  template: string | null;
  /** Best-effort clean final response from the agent. */
  final_output: string;
  /** Complete raw stdout for debugging. */
  raw_stdout: string;
  /** Complete raw stderr for debugging. */
  raw_stderr: string;
  /** @deprecated Use raw_stdout. Alias kept for backward compat. */
  stdout: string;
  /** @deprecated Use raw_stderr. Alias kept for backward compat. */
  stderr: string;
  exit_code: number | null;
  error?: string;
  timed_out?: boolean;
}

/**
 * Validate that a project path is safe and points to a recognized ADK project.
 * Returns a ProjectInfo on success, or an AdkRunResult error on failure.
 */
export function validateProject(
  cwd: string,
  projectPath: string
): { ok: true; resolvedPath: string; info: ProjectInfo } | { ok: false; result: AdkRunResult } {
  // Resolve and confine to workspace
  let resolvedPath: string;
  try {
    resolvedPath = safePath(cwd, projectPath);
  } catch (err) {
    return {
      ok: false,
      result: errorResult(projectPath, `Path validation failed: ${err instanceof Error ? err.message : String(err)}`),
    };
  }

  // Check the directory exists
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(resolvedPath);
  } catch {
    return {
      ok: false,
      result: errorResult(projectPath, `Project path does not exist: "${projectPath}"`),
    };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      result: errorResult(projectPath, `Project path is not a directory: "${projectPath}"`),
    };
  }

  // Detect ADK project
  const info = detectAdkProject(resolvedPath);
  if (!info.valid) {
    return {
      ok: false,
      result: errorResult(
        projectPath,
        info.error ?? `"${projectPath}" is not a recognized ADK project. Expected .adk-scaffold.json manifest or .env.example.`
      ),
    };
  }

  return { ok: true, resolvedPath, info };
}

/**
 * Check whether the `adk` CLI is available on $PATH.
 */
export async function checkAdkCli(): Promise<{ available: boolean; error?: string }> {
  return new Promise((resolveP) => {
    const child = spawn("adk", ["--help"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });

    let done = false;
    const finish = (available: boolean, error?: string) => {
      if (done) return;
      done = true;
      resolveP({ available, error });
    };

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        finish(false, "The 'adk' CLI is not installed or not on $PATH. Install it with: pip install google-adk");
      } else {
        finish(false, `Failed to run 'adk': ${err.message}`);
      }
    });

    child.on("close", (code) => {
      finish(code === 0);
    });
  });
}

/**
 * Execute an ADK agent project with a given prompt and return the result.
 *
 * Uses `adk run --replay <tempfile> <project_path>` to run non-interactively.
 */
export async function executeAdkAgent(
  resolvedProjectPath: string,
  projectPath: string,
  prompt: string,
  info: ProjectInfo,
  timeoutSeconds: number,
  signal?: AbortSignal
): Promise<AdkRunResult> {
  // Create temp replay file
  let replayPath: string;
  try {
    replayPath = createTempReplay(prompt);
  } catch (err) {
    return errorResult(
      projectPath,
      `Failed to create temp replay file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return new Promise<AdkRunResult>((resolveP) => {
    let done = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      cleanupTempReplay(replayPath);

      if (timedOut) {
        resolveP({
          success: false,
          project_path: projectPath,
          agent_name: info.agentName,
          template: info.template,
          final_output: "",
          raw_stdout: stdout,
          raw_stderr: stderr,
          stdout,
          stderr,
          exit_code: code,
          error: `ADK agent execution timed out after ${timeoutSeconds} seconds.`,
          timed_out: true,
        });
        return;
      }

      if (code !== 0) {
        resolveP({
          success: false,
          project_path: projectPath,
          agent_name: info.agentName,
          template: info.template,
          final_output: "",
          raw_stdout: stdout,
          raw_stderr: stderr,
          stdout,
          stderr,
          exit_code: code,
          error: `ADK agent exited with code ${code}.${stderr ? ` stderr: ${stderr.slice(0, 2000)}` : ""}`,
        });
        return;
      }

      // Extract final output from stdout (Phase 3: improved parsing).
      const finalOutput = extractFinalOutput(stdout);

      resolveP({
        success: true,
        project_path: projectPath,
        agent_name: info.agentName,
        template: info.template,
        final_output: finalOutput,
        raw_stdout: stdout,
        raw_stderr: stderr,
        stdout,
        stderr,
        exit_code: code,
      });
    };

    // Run: adk run --replay <tempfile> <project_path>
    const child = spawn("adk", ["run", "--replay", replayPath, resolvedProjectPath], {
      cwd: resolvedProjectPath,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      cleanupTempReplay(replayPath);

      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolveP(errorResult(
          projectPath,
          "The 'adk' CLI is not installed or not on $PATH. Install it with: pip install google-adk"
        ));
      } else {
        resolveP(errorResult(projectPath, `Failed to spawn ADK process: ${err.message}`));
      }
    });

    child.on("close", (code) => {
      finish(code);
    });

    // Timeout enforcement
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
        // Give a grace period then SIGKILL
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already dead */ }
        }, 2_000);
      } catch { /* already dead */ }
    }, timeoutSeconds * 1000);

    // Abort signal support
    if (signal) {
      const onAbort = () => {
        if (done) return;
        timedOut = false;
        done = true;
        if (timer) clearTimeout(timer);
        cleanupTempReplay(replayPath);
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
        resolveP(errorResult(projectPath, "ADK agent execution was cancelled."));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Extract the meaningful final output from ADK run stdout.
 *
 * Phase 3: improved parsing. ADK `run --replay` typically outputs:
 *
 *   [user]: <prompt>
 *   [agent_name]: <response line 1>
 *   <response line 2>
 *   ...
 *
 * We try to extract the last agent response block. If parsing is
 * uncertain, fall back to the full trimmed stdout for safety.
 */
export function extractFinalOutput(stdout: string): string {
  if (!stdout.trim()) return "";

  const trimmed = stdout.trim();
  const lines = trimmed.split("\n");

  // Pattern: [speaker]: content
  // ADK uses square-bracket prefixed lines for turn markers.
  const turnPattern = /^\[([^\]]+)\]:\s*(.*)/;

  // Collect turns
  const turns: Array<{ speaker: string; content: string }> = [];
  let currentTurn: { speaker: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = turnPattern.exec(line);
    if (match) {
      // Flush previous turn
      if (currentTurn) {
        turns.push({
          speaker: currentTurn.speaker,
          content: currentTurn.lines.join("\n").trim(),
        });
      }
      currentTurn = { speaker: match[1], lines: [match[2]] };
    } else if (currentTurn) {
      currentTurn.lines.push(line);
    }
    // Lines before the first turn marker are ignored (noise/headers)
  }
  // Flush last turn
  if (currentTurn) {
    turns.push({
      speaker: currentTurn.speaker,
      content: currentTurn.lines.join("\n").trim(),
    });
  }

  // If we parsed at least one turn, return the last non-user turn's content
  if (turns.length > 0) {
    // Walk backward to find the last non-user turn with content
    for (let i = turns.length - 1; i >= 0; i--) {
      const speaker = turns[i].speaker.toLowerCase();
      if (speaker !== "user" && turns[i].content) {
        return turns[i].content;
      }
    }
    // No non-user turns with content — try any turn with content
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].content) {
        return turns[i].content;
      }
    }
    // All turns empty — return empty string
    return "";
  }

  // No turn markers found — fallback to trimmed stdout
  return trimmed;
}

function errorResult(projectPath: string, error: string): AdkRunResult {
  return {
    success: false,
    project_path: projectPath,
    agent_name: null,
    template: null,
    final_output: "",
    raw_stdout: "",
    raw_stderr: "",
    stdout: "",
    stderr: "",
    exit_code: null,
    error,
  };
}
