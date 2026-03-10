/**
 * Extension tool detection (Phase 3).
 *
 * Provides a lightweight way for pi-google-adk to discover which
 * extension tools are currently available in the active Pi environment.
 *
 * Detection approach:
 * - At registration time, the ExtensionAPI reference is captured.
 * - At tool-planning time, `getAllTools()` is called to enumerate
 *   all registered tools (built-in + extension-provided).
 * - Built-in Pi Mono tools are filtered out so only extension tools remain.
 *
 * Limitations:
 * - Detection reflects the state at the time of the call. Tools registered
 *   after detection are not captured.
 * - `getAllTools()` may throw if called before the runtime is fully bound
 *   (e.g. during extension loading). Detection gracefully degrades.
 * - Some tools may be conditionally active. Detection shows all registered
 *   tools, not necessarily all currently active tools.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Built-in tool names to exclude from extension detection
// ---------------------------------------------------------------------------

/** Pi Mono built-in tool names. These are not extension tools. */
const PI_MONO_BUILTIN_TOOLS = new Set([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

/** This extension's own tools — not counted as "other extension" tools. */
const OWN_TOOLS = new Set([
  "create_adk_agent",
  "add_adk_capability",
  "run_adk_agent",
  "list_adk_agents",
  "resolve_adk_agent",
]);

// ---------------------------------------------------------------------------
// API reference holder
// ---------------------------------------------------------------------------

let _capturedApi: ExtensionAPI | null = null;

/**
 * Capture the ExtensionAPI during registration so it can be used
 * for tool detection later (at tool-execution time).
 *
 * Must be called once during extension init.
 */
export function captureExtensionApi(api: ExtensionAPI): void {
  _capturedApi = api;
}

// ---------------------------------------------------------------------------
// Detection result
// ---------------------------------------------------------------------------

export interface DetectedExtensionTools {
  /** Extension tool names detected (excluding built-ins and own tools). */
  tools: string[];
  /** Whether detection was successful. */
  detected: boolean;
  /** Reason detection failed, if applicable. */
  error?: string;
  /** All tools seen (built-in + extension), for debugging. */
  all_tool_count?: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect installed Pi extension tools in the current environment.
 *
 * Calls `getAllTools()` on the captured ExtensionAPI, filters out
 * Pi Mono built-ins and this extension's own tools, and returns
 * the remaining tool names.
 *
 * Returns a graceful result with `detected: false` if the API is
 * not available or the call fails.
 */
export function detectExtensionTools(
  apiOverride?: ExtensionAPI
): DetectedExtensionTools {
  const api = apiOverride ?? _capturedApi;

  if (!api) {
    return {
      tools: [],
      detected: false,
      error: "ExtensionAPI not captured. Tool detection unavailable.",
    };
  }

  try {
    const allTools = api.getAllTools();
    const extensionTools = allTools
      .map((t) => t.name)
      .filter(
        (name) => !PI_MONO_BUILTIN_TOOLS.has(name) && !OWN_TOOLS.has(name)
      );

    return {
      tools: extensionTools.sort(),
      detected: true,
      all_tool_count: allTools.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      tools: [],
      detected: false,
      error: `getAllTools() failed: ${msg}`,
    };
  }
}
