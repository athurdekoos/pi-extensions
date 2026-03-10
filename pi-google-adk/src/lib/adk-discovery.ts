/**
 * ADK project discovery and resolution.
 *
 * Enumerates ADK projects under the workspace (primarily ./agents/)
 * and resolves a name-or-path query to a specific project.
 *
 * This module is the source of truth for what counts as a discoverable
 * ADK project. pi-subagents should call into this rather than duplicating
 * detection logic.
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, relative, basename } from "node:path";
import { detectAdkProject, type ProjectInfo } from "./project-detect.js";
import { readManifest, type ScaffoldManifest } from "./scaffold-manifest.js";
import { safePath } from "./fs-safe.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredAgent {
  /** Agent name from manifest, or directory basename as fallback. */
  name: string;
  /** Relative path from workspace root to the project directory. */
  project_path: string;
  /** Template type from manifest or detection. */
  template: string | null;
  /** Capabilities list from manifest, if available. */
  capabilities: string[];
  /** Display label: "name (template) — path". */
  label: string;
  /** Detection source: "manifest" | "heuristic". */
  source: "manifest" | "heuristic";
}

export interface ResolveResult {
  status: "found" | "not_found" | "ambiguous";
  /** Matched agent (only when status === "found"). */
  agent?: DiscoveredAgent;
  /** All matches (when status === "ambiguous"). */
  matches?: DiscoveredAgent[];
  /** All discovered agents (for fallback selection). */
  available: DiscoveredAgent[];
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Default directories to scan for ADK projects, relative to workspace root.
 * Currently only ./agents/ — the default output of create_adk_agent.
 */
const SCAN_DIRS = ["agents"];

/**
 * Discover all ADK agent projects under the workspace.
 *
 * Scans each directory in SCAN_DIRS for subdirectories that pass
 * detectAdkProject(). Does NOT recurse deeper than one level below
 * each scan dir.
 *
 * @param cwd Workspace root (absolute path).
 * @returns Array of discovered agents, sorted by name.
 */
export function discoverAdkAgents(cwd: string): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];

  for (const scanDir of SCAN_DIRS) {
    const absScanDir = resolve(cwd, scanDir);

    let entries: string[];
    try {
      entries = readdirSync(absScanDir);
    } catch {
      // Directory doesn't exist — skip silently.
      continue;
    }

    for (const entry of entries) {
      const absEntry = resolve(absScanDir, entry);

      let stat;
      try {
        stat = statSync(absEntry);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const info = detectAdkProject(absEntry);
      if (!info.valid) continue;

      const manifest = readManifest(absEntry);
      const relPath = `./${relative(cwd, absEntry)}`;

      const name = manifest?.name ?? info.agentName ?? basename(absEntry);
      const template = manifest?.template ?? info.template ?? null;
      const capabilities = manifest?.capabilities ?? [];
      const source: "manifest" | "heuristic" = manifest ? "manifest" : "heuristic";

      const templateLabel = template && template !== "unknown" ? ` (${template})` : "";
      const capsLabel = capabilities.length > 0 ? ` [${capabilities.join(", ")}]` : "";
      const label = `${name}${templateLabel}${capsLabel} — ${relPath}`;

      agents.push({
        name,
        project_path: relPath,
        template,
        capabilities,
        label,
        source,
      });
    }
  }

  // Also check if cwd itself is an ADK project (edge case: user is inside one).
  // Skip this — it would be confusing and outside the target workflow.

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a name-or-path query to a specific ADK agent.
 *
 * Resolution order:
 * 1. If query looks like a path (contains / or .), try detectAdkProject directly.
 * 2. Otherwise, discover all agents and filter by exact name match.
 * 3. If no exact match, try case-insensitive and prefix matching.
 *
 * @param cwd Workspace root.
 * @param query Agent name or relative path.
 * @returns Resolution result with status and available agents.
 */
export function resolveAdkAgent(cwd: string, query: string): ResolveResult {
  const available = discoverAdkAgents(cwd);

  // Path-based resolution: if query contains / or starts with .
  if (query.includes("/") || query.startsWith(".")) {
    return resolveByPath(cwd, query, available);
  }

  // Name-based resolution
  return resolveByName(query, available);
}

function resolveByPath(
  cwd: string,
  query: string,
  available: DiscoveredAgent[]
): ResolveResult {
  // Try to resolve the path directly
  let absPath: string;
  try {
    absPath = safePath(cwd, query);
  } catch {
    return { status: "not_found", available };
  }

  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return { status: "not_found", available };
  }
  if (!stat.isDirectory()) {
    return { status: "not_found", available };
  }

  const info = detectAdkProject(absPath);
  if (!info.valid) {
    return { status: "not_found", available };
  }

  const manifest = readManifest(absPath);
  const relPath = `./${relative(cwd, absPath)}`;
  const name = manifest?.name ?? info.agentName ?? basename(absPath);
  const template = manifest?.template ?? info.template ?? null;
  const capabilities = manifest?.capabilities ?? [];
  const source: "manifest" | "heuristic" = manifest ? "manifest" : "heuristic";
  const templateLabel = template && template !== "unknown" ? ` (${template})` : "";
  const capsLabel = capabilities.length > 0 ? ` [${capabilities.join(", ")}]` : "";

  const agent: DiscoveredAgent = {
    name,
    project_path: relPath,
    template,
    capabilities,
    label: `${name}${templateLabel}${capsLabel} — ${relPath}`,
    source,
  };

  return { status: "found", agent, available };
}

function resolveByName(
  query: string,
  available: DiscoveredAgent[]
): ResolveResult {
  // 1. Exact name match
  const exact = available.filter((a) => a.name === query);
  if (exact.length === 1) {
    return { status: "found", agent: exact[0], available };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", matches: exact, available };
  }

  // 2. Case-insensitive match
  const queryLower = query.toLowerCase();
  const caseInsensitive = available.filter(
    (a) => a.name.toLowerCase() === queryLower
  );
  if (caseInsensitive.length === 1) {
    return { status: "found", agent: caseInsensitive[0], available };
  }
  if (caseInsensitive.length > 1) {
    return { status: "ambiguous", matches: caseInsensitive, available };
  }

  // 3. Prefix match
  const prefix = available.filter(
    (a) => a.name.toLowerCase().startsWith(queryLower)
  );
  if (prefix.length === 1) {
    return { status: "found", agent: prefix[0], available };
  }
  if (prefix.length > 1) {
    return { status: "ambiguous", matches: prefix, available };
  }

  // No match
  return { status: "not_found", available };
}
