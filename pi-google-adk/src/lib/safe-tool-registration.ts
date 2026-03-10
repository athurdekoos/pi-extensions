/**
 * Load-order-safe registration of tools into the pi-subagents safe tool registry.
 *
 * Handles the case where pi-subagents may load before or after pi-google-adk:
 *
 * 1. If __piSubagents_registerSafeTool exists on globalThis, register immediately.
 * 2. Otherwise, push the tool into __piSubagents_pendingSafeTools for pi-subagents
 *    to drain when it initializes.
 */

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

/** Global key used by pi-subagents for immediate registration. */
const REGISTER_FN_KEY = "__piSubagents_registerSafeTool";

/** Global key for pending registrations when pi-subagents hasn't loaded yet. */
const PENDING_KEY = "__piSubagents_pendingSafeTools";

/**
 * Register a tool definition as safe for subagent use.
 * Works regardless of whether pi-subagents has loaded yet.
 */
export function registerSafeToolForSubagents(tool: ToolDefinition): void {
  const g = globalThis as Record<string, unknown>;

  // Path 1: pi-subagents already loaded — register immediately
  if (typeof g[REGISTER_FN_KEY] === "function") {
    (g[REGISTER_FN_KEY] as (tool: ToolDefinition) => void)(tool);
    return;
  }

  // Path 2: pi-subagents not yet loaded — queue for later
  if (!Array.isArray(g[PENDING_KEY])) {
    g[PENDING_KEY] = [];
  }
  (g[PENDING_KEY] as ToolDefinition[]).push(tool);
}
