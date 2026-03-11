/**
 * Tool: create_adk_agent
 *
 * Creates a new Google ADK agent project.
 *
 * Supported modes:
 *   - native_app:      `adk create APP_NAME` (default)
 *   - native_config:   `adk create --type=config APP_NAME`
 *   - official_sample: import from google/adk-samples
 *
 * Legacy Pi-owned scaffolding modes (legacy_basic, legacy_mcp,
 * legacy_sequential) and the deprecated `template` parameter are no
 * longer accepted as supported public inputs. Callers using those
 * paths will receive a migration error with guidance on which
 * supported mode to use instead.
 *
 * Interactive wizard:
 *   When UI is available and required params are missing, presents a
 *   guided creation flow. When UI is unavailable, requires explicit params.
 *
 * Default mode: native_app
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { safeWriteFile, safeReadFile } from "../lib/fs-safe.js";
import { validateAgentName } from "../lib/validators.js";
import {
  createNativeAdkProject,
  type NativeCreateResult,
} from "../lib/adk-native-create.js";
import {
  importOfficialSample,
} from "../lib/sample-import.js";
import {
  buildSampleImportMetadata,
  writeCreationMetadata,
  CREATION_METADATA_FILENAME,
} from "../lib/creation-metadata.js";
import { findSampleBySlug, allSampleSlugs } from "../lib/sample-catalog.js";
import { runCreationWizard, type WizardChoice } from "../lib/wizard.js";
import {
  type ToolPlan,
  buildToolPlanFromParams,
} from "../lib/tool-plan.js";
import { captureExtensionApi, detectExtensionTools } from "../lib/tool-detect.js";
import { buildToolAccessSummary } from "../lib/tool-summary.js";

// ---------------------------------------------------------------------------
// Supported modes
// ---------------------------------------------------------------------------

const NATIVE_MODES = ["native_app", "native_config"] as const;
const SAMPLE_MODES = ["official_sample"] as const;
const SUPPORTED_MODES = [...NATIVE_MODES, ...SAMPLE_MODES] as const;

/** Legacy modes — recognized only to produce migration errors. */
const LEGACY_MODES = ["legacy_basic", "legacy_mcp", "legacy_sequential"] as const;

type SupportedMode = (typeof SUPPORTED_MODES)[number];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CreateAdkAgentParams = Type.Object({
  name: Type.Optional(
    Type.String({
      description: "Agent name (lowercase, alphanumeric, underscores). Required in non-interactive mode.",
    })
  ),
  mode: Type.Optional(
    StringEnum([...SUPPORTED_MODES] as unknown as string[], {
      description:
        'Creation mode. Native modes use the installed ADK CLI. ' +
        '"native_app" (default): standard ADK app. ' +
        '"native_config": config-based ADK app (requires ADK CLI support). ' +
        '"official_sample": import from google/adk-samples.',
    })
  ),
  path: Type.Optional(
    Type.String({ description: "Target path relative to cwd. Default: ./agents/<name>" })
  ),
  model: Type.Optional(
    Type.String({ description: "Gemini model to use. Default: gemini-2.5-flash" })
  ),
  /** Sample slug for official_sample mode. */
  sample_slug: Type.Optional(
    Type.String({
      description:
        "Sample slug from the curated catalog. Required for official_sample mode in non-interactive use.",
    })
  ),
  overwrite: Type.Optional(
    Type.Boolean({ description: "Overwrite existing files. Default: false" })
  ),
  // Phase 3: tool-planning params
  configure_tools_now: Type.Optional(
    Type.Boolean({
      description:
        "Whether to include tool planning in this creation. " +
        "When true with explicit params, builds a tool plan from the other tool_* params. " +
        "When omitted in interactive mode, the wizard will ask.",
    })
  ),
  adk_native_tools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "ADK-native tool categories: none, mcp_toolset, openapi_toolset, custom_function_tools, other.",
    })
  ),
  pi_mono_profile: Type.Optional(
    Type.String({
      description: 'Pi Mono built-in session profile: "read_only", "coding", or "unknown".',
    })
  ),
  extension_tools: Type.Optional(
    Type.Array(Type.String(), {
      description: "Extension tool names to include in the tool plan.",
    })
  ),
  required_safe_custom_tools: Type.Optional(
    Type.Array(Type.String(), {
      description: "Safe custom tools needed for pi-subagents delegation.",
    })
  ),
  tool_notes: Type.Optional(
    Type.String({ description: "Free-text note about the tool plan." })
  ),
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface CreateResult {
  ok: boolean;
  path: string;
  mode: string;
  /** Legacy template name, or null for native/sample modes. */
  template: string | null;
  model: string;
  files_created: string[];
  files_skipped: string[];
  adk_docs_mcp: boolean;
  skills_installed: boolean;
  skills_note?: string;
  next_steps: string[];
  /** Native creation details (only for native modes). */
  native?: {
    adk_cli_version: string | null;
    command_used: string;
    metadata_written: boolean;
    stdout: string;
    stderr: string;
  };
  /** Sample import details (only for official_sample mode). */
  sample_import?: {
    sample_slug: string;
    upstream_repo: string;
    upstream_path: string;
    upstream_ref: string;
    commit?: string;
    metadata_written: boolean;
  };
  /** Tool access plan (Phase 3). */
  tool_plan?: ToolPlan;
  /** Human-readable tool access summary. */
  tool_access_summary?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCreateAdkAgent(pi: ExtensionAPI): void {
  // Capture the API reference for tool detection (Phase 3).
  captureExtensionApi(pi);

  pi.registerTool({
    name: "create_adk_agent",
    label: "Create ADK Agent",
    description:
      "Create a new Google ADK agent project. " +
      "Supported modes: native_app (default, uses ADK CLI), native_config (config-based, uses ADK CLI), " +
      "official_sample (import from google/adk-samples). " +
      "When UI is available and params are incomplete, presents an interactive wizard.",
    parameters: CreateAdkAgentParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const extCtx = ctx as unknown as ExtensionContext;
      const hasUI = extCtx?.hasUI ?? false;
      const ui = extCtx?.ui;

      // If UI is available and caller hasn't fully specified mode+name,
      // run the interactive wizard.
      if (hasUI && ui && !params.name && !params.mode) {
        return executeWizard(ui, params);
      }

      // ── Reject legacy modes and deprecated template param ───────────
      // `template` was removed from the public schema but old callers may
      // still send it.  Probe the raw input without widening the typed API.
      const rawTemplate = (params as Record<string, unknown>).template as string | undefined;
      const legacyError = checkLegacyUsage(params.mode, rawTemplate);
      if (legacyError) {
        return errorResult(legacyError, params.mode ?? rawTemplate ?? "");
      }

      // Non-interactive: require name
      if (!params.name) {
        return errorResult(
          "Agent name is required. Provide the 'name' parameter, or run interactively with UI available.",
          params.mode
        );
      }

      const name: string = params.name;

      // Resolve effective mode (only supported modes reach here)
      const mode = resolveMode(params.mode);

      const model = params.model ?? "gemini-2.5-flash";
      const overwrite = params.overwrite ?? false;

      // Validate name
      const nameError = validateAgentName(name);
      if (nameError) {
        return errorResult(nameError, mode);
      }

      // Build tool plan from explicit params if requested (non-interactive)
      const toolPlan = resolveNonInteractiveToolPlan(params);

      // Dispatch based on mode
      if (mode === "official_sample") {
        return executeSampleImport(name, params, overwrite, toolPlan);
      }

      if (mode === "native_app" || mode === "native_config") {
        return executeNativeCreate(name, mode, params, model, overwrite, toolPlan);
      }

      // Should not be reachable — all supported modes are dispatched above
      return errorResult(`Unsupported mode: ${mode}`, mode);
    },
  });
}

// ---------------------------------------------------------------------------
// Wizard execution
// ---------------------------------------------------------------------------

async function executeWizard(
  ui: ExtensionContext["ui"],
  params: Record<string, unknown>
): Promise<ReturnType<typeof errorResult>> {
  const choice: WizardChoice = await runCreationWizard(ui);

  if (choice.kind === "cancel") {
    return errorResult("Creation cancelled by user.", "");
  }

  const overwrite = (params.overwrite as boolean) ?? false;

  if (choice.kind === "native_app" || choice.kind === "native_config") {
    const nameError = validateAgentName(choice.name);
    if (nameError) return errorResult(nameError, choice.kind);

    return executeNativeCreate(
      choice.name,
      choice.kind,
      { path: choice.path, model: choice.model },
      choice.model,
      overwrite,
      choice.tool_plan
    );
  }

  if (choice.kind === "official_sample") {
    const nameError = validateAgentName(choice.name);
    if (nameError) return errorResult(nameError, choice.kind);

    return executeSampleImport(choice.name, {
      path: choice.path,
      sample_slug: choice.sample_slug,
    }, overwrite, choice.tool_plan);
  }

  return errorResult("Unexpected wizard result.", "");
}

// ---------------------------------------------------------------------------
// Legacy usage detection — produces migration errors
// ---------------------------------------------------------------------------

const LEGACY_TEMPLATE_MIGRATION: Record<string, string> = {
  basic: "Use mode=native_app instead.",
  mcp: "Use mode=native_app and add_adk_capability with mcp_toolset, or use tool planning.",
  sequential: "Use mode=native_app or mode=official_sample depending on your goal.",
};

const LEGACY_MODE_MIGRATION: Record<string, string> = {
  legacy_basic: "Use mode=native_app instead.",
  legacy_mcp: "Use mode=native_app and add_adk_capability with mcp_toolset, or use tool planning.",
  legacy_sequential: "Use mode=native_app or mode=official_sample depending on your goal.",
};

/**
 * Check for legacy mode or deprecated template usage.
 * Returns a migration error message if legacy usage is detected, or null if OK.
 */
function checkLegacyUsage(
  mode: string | undefined,
  template: string | undefined
): string | null {
  // Check for legacy mode values
  if (mode && mode in LEGACY_MODE_MIGRATION) {
    return (
      `mode=${mode} is no longer supported. ` +
      `Pi-owned scaffolding modes have been removed from the public API. ` +
      `Supported modes: native_app, native_config, official_sample. ` +
      LEGACY_MODE_MIGRATION[mode]
    );
  }

  // Check for deprecated template param
  if (template && template in LEGACY_TEMPLATE_MIGRATION) {
    return (
      `template=${template} is no longer supported. ` +
      `The old Pi-owned scaffolding path has been removed from the public API. ` +
      `Supported modes: native_app, native_config, official_sample. ` +
      LEGACY_TEMPLATE_MIGRATION[template]
    );
  }

  // Check for unknown template values
  if (template) {
    return (
      `template parameter is no longer supported. ` +
      `Use mode=native_app, mode=native_config, or mode=official_sample instead.`
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mode resolution (supported modes only)
// ---------------------------------------------------------------------------

function resolveMode(
  explicitMode: string | undefined
): SupportedMode {
  if (explicitMode && (SUPPORTED_MODES as readonly string[]).includes(explicitMode)) {
    return explicitMode as SupportedMode;
  }

  // Default: native_app
  return "native_app";
}

// ---------------------------------------------------------------------------
// Official sample import path
// ---------------------------------------------------------------------------

async function executeSampleImport(
  name: string,
  params: Record<string, unknown>,
  overwrite: boolean,
  toolPlan?: ToolPlan
): Promise<ReturnType<typeof errorResult>> {
  const sampleSlug = params.sample_slug as string | undefined;

  if (!sampleSlug) {
    return errorResult(
      "sample_slug is required for official_sample mode. " +
      `Available slugs: ${allSampleSlugs().join(", ")}`,
      "official_sample"
    );
  }

  const entry = findSampleBySlug(sampleSlug);
  if (!entry) {
    return errorResult(
      `Unknown sample slug "${sampleSlug}". ` +
      `Available slugs: ${allSampleSlugs().join(", ")}`,
      "official_sample"
    );
  }

  const targetPath = (params.path as string) ?? `./agents/${name}`;
  const cwd = process.cwd();

  const { result: importResult, provenance } = await importOfficialSample(cwd, {
    sample_slug: sampleSlug,
    name,
    path: targetPath,
    overwrite,
  });

  if (!importResult.ok) {
    return errorResult(importResult.error ?? "Sample import failed.", "official_sample");
  }

  // Write provenance metadata
  let metadataWritten = false;
  if (provenance) {
    try {
      const metadata = buildSampleImportMetadata({
        agentName: name,
        projectPath: targetPath,
        importArgs: { mode: "official_sample", name, sample_slug: sampleSlug, path: targetPath },
        sampleProvenance: provenance,
        toolPlan,
      });
      writeCreationMetadata(cwd, targetPath, metadata);
      metadataWritten = true;
    } catch {
      // Non-fatal
    }
  }

  const nextSteps = [
    `cd ${targetPath}`,
    "python -m venv .venv",
    "source .venv/bin/activate",
    "pip install google-adk",
    "# Review the imported sample code",
    `adk web .`,
  ];

  const result: CreateResult = {
    ok: true,
    path: targetPath,
    mode: "official_sample",
    template: null,
    model: "",
    files_created: [],
    files_skipped: [],
    adk_docs_mcp: false,
    skills_installed: false,
    next_steps: nextSteps,
    sample_import: {
      sample_slug: sampleSlug,
      upstream_repo: importResult.upstream_repo,
      upstream_path: importResult.upstream_path,
      upstream_ref: importResult.upstream_ref,
      commit: importResult.commit,
      metadata_written: metadataWritten,
    },
    tool_plan: toolPlan,
    tool_access_summary: toolPlan ? buildToolAccessSummary(toolPlan) : undefined,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

// ---------------------------------------------------------------------------
// Native creation path
// ---------------------------------------------------------------------------

async function executeNativeCreate(
  name: string,
  mode: "native_app" | "native_config",
  params: Record<string, unknown>,
  model: string,
  overwrite: boolean,
  toolPlan?: ToolPlan
): Promise<ReturnType<typeof errorResult>> {
  const targetPath = (params.path as string) ?? `./agents/${name}`;
  const cwd = process.cwd();

  const nativeResult: NativeCreateResult = await createNativeAdkProject(cwd, {
    mode,
    name,
    path: targetPath,
    model,
    overwrite,
  });

  if (!nativeResult.ok) {
    return errorResult(nativeResult.error ?? "Native creation failed.", mode);
  }

  const nextSteps = [
    `cd ${targetPath}`,
    "python -m venv .venv",
    "source .venv/bin/activate",
    "pip install google-adk",
    `adk web .`,
  ];

  // Phase 3: If a tool plan was provided, merge it into the existing metadata file.
  if (toolPlan && nativeResult.metadata_written) {
    try {
      const raw = safeReadFile(cwd, `${targetPath}/${CREATION_METADATA_FILENAME}`);
      if (raw) {
        const existing = JSON.parse(raw);
        existing.tool_plan = toolPlan;
        safeWriteFile(cwd, `${targetPath}/${CREATION_METADATA_FILENAME}`, JSON.stringify(existing, null, 2) + "\n", true);
      }
    } catch {
      // Non-fatal: tool plan just won't be in metadata
    }
  }

  const result: CreateResult = {
    ok: true,
    path: targetPath,
    mode,
    template: null,
    model,
    files_created: [],
    files_skipped: [],
    adk_docs_mcp: false,
    skills_installed: false,
    skills_note:
      "ADK skills installation skipped: not available in this environment.",
    next_steps: nextSteps,
    native: {
      adk_cli_version: nativeResult.adk_cli_version,
      command_used: nativeResult.command_used,
      metadata_written: nativeResult.metadata_written,
      stdout: nativeResult.stdout,
      stderr: nativeResult.stderr,
    },
    tool_plan: toolPlan,
    tool_access_summary: toolPlan ? buildToolAccessSummary(toolPlan) : undefined,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Non-interactive tool plan resolution
// ---------------------------------------------------------------------------

function resolveNonInteractiveToolPlan(
  params: Record<string, unknown>
): ToolPlan | undefined {
  const configure = params.configure_tools_now as boolean | undefined;

  // If explicitly false or not set, skip tool planning
  if (configure !== true) return undefined;

  // Detect extension tools for metadata
  const detection = detectExtensionTools();

  return buildToolPlanFromParams({
    adk_native_tools: params.adk_native_tools as string[] | undefined,
    pi_mono_profile: params.pi_mono_profile as string | undefined,
    extension_tools: params.extension_tools as string[] | undefined,
    required_safe_custom_tools: params.required_safe_custom_tools as string[] | undefined,
    tool_notes: params.tool_notes as string | undefined,
    detectedExtensionTools: detection.detected ? detection.tools : [],
  });
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

function errorResult(message: string, mode?: string) {
  const result: CreateResult = {
    ok: false,
    path: "",
    mode: mode ?? "",
    template: null,
    model: "",
    files_created: [],
    files_skipped: [],
    adk_docs_mcp: false,
    skills_installed: false,
    next_steps: [],
    error: message,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}
