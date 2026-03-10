/**
 * Tool: check_adk_sample_drift
 *
 * Detect whether an imported official ADK sample has drifted relative
 * to its upstream source.
 *
 * Works only on projects created via official_sample import
 * (source_type = "official_sample" in .pi-adk-metadata.json).
 *
 * Returns unsupported_project for native_app / native_config projects.
 *
 * Interactive: when UI is available and target is not specified,
 * shows a picker of imported official samples.
 *
 * Non-interactive: requires project_path or agent param.
 */

import { resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@mariozechner/pi-coding-agent";
import {
  detectDrift,
  writeDriftTracking,
  type DriftCheckResult,
  type DriftTrackingUpdate,
} from "../lib/sample-drift.js";
import { discoverAdkAgents, type DiscoveredAgent } from "../lib/adk-discovery.js";
import { resolveAdkAgent } from "../lib/adk-discovery.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CheckAdkSampleDriftParams = Type.Object({
  project_path: Type.Optional(
    Type.String({
      description:
        "Path to the imported sample project. " +
        "If omitted and agent is also omitted, interactive selection is used when UI is available.",
    }),
  ),
  agent: Type.Optional(
    Type.String({
      description:
        "Agent name to resolve via ADK discovery. " +
        "Alternative to project_path.",
    }),
  ),
  update_metadata: Type.Optional(
    Type.Boolean({
      description:
        "Write last_drift_check tracking fields to metadata. Default: false.",
    }),
  ),
  verbose: Type.Optional(
    Type.Boolean({
      description:
        "Include changed_files detail in the result. Default: false.",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCheckAdkSampleDrift(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "check_adk_sample_drift",
    label: "Check ADK Sample Drift",
    description:
      "Detect whether an imported official ADK sample has drifted " +
      "relative to its upstream source. " +
      "Reports structured status: up_to_date, upstream_updated, local_modified, diverged. " +
      "Works only on official_sample projects. " +
      "When UI is available and no target is specified, shows an interactive picker.",
    parameters: CheckAdkSampleDriftParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const extCtx = ctx as unknown as ExtensionContext;
      const hasUI = extCtx?.hasUI ?? false;
      const ui = extCtx?.ui;
      const cwd = extCtx?.cwd ?? process.cwd();

      const updateMetadata = params.update_metadata ?? false;
      const verbose = params.verbose ?? false;

      // Resolve project path
      let projectPath: string | null = null;

      if (params.project_path) {
        projectPath = resolve(cwd, params.project_path);
      } else if (params.agent) {
        const resolution = resolveAdkAgent(cwd, params.agent);
        if (resolution.status === "found" && resolution.agent) {
          projectPath = resolve(cwd, resolution.agent.project_path);
        } else {
          return toolResult({
            success: false,
            status: "error",
            project_path: "",
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
            summary:
              resolution.status === "ambiguous"
                ? `Ambiguous agent name "${params.agent}". ` +
                  `Matches: ${resolution.matches?.map((m) => m.name).join(", ")}. ` +
                  "Provide a more specific name or use project_path."
                : `Agent "${params.agent}" not found. ` +
                  `Available: ${resolution.available.map((a) => a.name).join(", ") || "none"}.`,
            notes: [],
          });
        }
      } else if (hasUI && ui) {
        // Interactive selection
        projectPath = await selectImportedSample(ui, cwd);
        if (!projectPath) {
          return toolResult({
            success: false,
            status: "error",
            project_path: "",
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
            summary: "Drift check cancelled.",
            notes: [],
          });
        }
      } else {
        return toolResult({
          success: false,
          status: "error",
          project_path: "",
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
          summary:
            "No target specified. " +
            "Provide project_path or agent parameter, " +
            "or run interactively with UI available.",
          notes: [],
        });
      }

      // Run drift detection
      const result = await detectDrift(projectPath);

      // Optionally strip changed_files for non-verbose
      if (!verbose) {
        delete result.changed_files;
      }

      // Optionally update metadata
      if (updateMetadata && result.success) {
        const trackingUpdate: DriftTrackingUpdate = {
          last_drift_check_at: new Date().toISOString(),
          last_drift_status: result.status,
          last_checked_upstream_commit: result.current_upstream_commit,
          last_local_hash: result.local_hash,
          last_upstream_hash: result.current_upstream_hash,
        };

        const written = writeDriftTracking(projectPath, trackingUpdate);
        if (written) {
          result.notes.push("Drift tracking metadata updated.");
        } else {
          result.notes.push("Failed to update drift tracking metadata.");
        }
      }

      return toolResult(result);
    },
  });
}

// ---------------------------------------------------------------------------
// Interactive selection
// ---------------------------------------------------------------------------

async function selectImportedSample(
  ui: ExtensionUIContext,
  cwd: string,
): Promise<string | null> {
  const agents = discoverAdkAgents(cwd);
  const samples = agents.filter((a) => a.source_type === "official_sample");

  if (samples.length === 0) {
    ui.notify(
      "No imported official samples found in the workspace.",
      "info",
    );
    return null;
  }

  const options = samples.map((s) => s.label);
  options.push("Cancel");

  const choice = await ui.select(
    "Check drift — select an imported sample",
    options,
  );

  if (!choice || choice === "Cancel") return null;

  const idx = options.indexOf(choice);
  const selected = samples[idx];
  if (!selected) return null;

  return resolve(cwd, selected.project_path);
}

// ---------------------------------------------------------------------------
// Result helper
// ---------------------------------------------------------------------------

function toolResult(result: DriftCheckResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}
