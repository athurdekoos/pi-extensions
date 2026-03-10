/**
 * Tool: create_adk_agent
 *
 * Creates a new Google ADK agent project.
 *
 * Primary modes (Phase 1 — native creation via installed ADK CLI):
 *   - native_app:    `adk create APP_NAME`
 *   - native_config: `adk create --type=config APP_NAME`
 *
 * Phase 2 — sample import:
 *   - official_sample: import from google/adk-samples
 *
 * Legacy modes (temporary compatibility path):
 *   - legacy_basic, legacy_mcp, legacy_sequential:
 *     Pi-owned template scaffolding (pre-native).
 *
 * Interactive wizard:
 *   When UI is available and required params are missing, presents a
 *   guided creation flow. When UI is unavailable, requires explicit params.
 *
 * Default mode: native_app
 */

import { resolve, relative } from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { safeWriteFile, safeExists, safeReadFile, type WriteResult } from "../lib/fs-safe.js";
import { validateAgentName } from "../lib/validators.js";
import { adkDocsMcpConfig } from "../lib/adk-docs-mcp.js";
import { createManifest, serializeManifest, MANIFEST_FILENAME } from "../lib/scaffold-manifest.js";
import { gitignore } from "../templates/shared.js";
import * as basicTemplate from "../templates/python-basic/files.js";
import * as mcpTemplate from "../templates/python-mcp/files.js";
import * as sequentialTemplate from "../templates/python-sequential/files.js";
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
const LEGACY_MODES = ["legacy_basic", "legacy_mcp", "legacy_sequential"] as const;
const ALL_MODES = [...NATIVE_MODES, ...SAMPLE_MODES, ...LEGACY_MODES] as const;

type CreateMode = (typeof ALL_MODES)[number];

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
    StringEnum([...ALL_MODES] as unknown as string[], {
      description:
        'Creation mode. Native modes use the installed ADK CLI. ' +
        '"native_app" (default): standard ADK app. ' +
        '"native_config": config-based ADK app (requires ADK CLI support). ' +
        '"official_sample": import from google/adk-samples. ' +
        '"legacy_basic", "legacy_mcp", "legacy_sequential": Pi-owned templates (deprecated).',
    })
  ),
  path: Type.Optional(
    Type.String({ description: "Target path relative to cwd. Default: ./agents/<name>" })
  ),
  // Legacy compat: still accept `template` for old callers, mapped to legacy mode
  template: Type.Optional(
    StringEnum(["basic", "mcp", "sequential"] as const, {
      description:
        "DEPRECATED: Use mode instead. Legacy project template. " +
        "If both mode and template are set, mode wins.",
    })
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
  install_adk_skills: Type.Optional(
    Type.Boolean({ description: "Attempt to install ADK-related pi skills. Default: true" })
  ),
  add_adk_docs_mcp: Type.Optional(
    Type.Boolean({
      description: "Emit a project-local ADK docs MCP example config. Default: true (legacy modes only)",
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
      "Primary: native modes use the installed ADK CLI (native_app, native_config). " +
      "Import: official_sample imports from google/adk-samples. " +
      "Legacy: Pi-owned templates (legacy_basic, legacy_mcp, legacy_sequential). " +
      "Default mode: native_app. " +
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

      // Non-interactive: require name
      if (!params.name) {
        return errorResult(
          "Agent name is required. Provide the 'name' parameter, or run interactively with UI available.",
          params.mode
        );
      }

      const name: string = params.name;

      // Resolve effective mode
      const mode = resolveMode(params.mode, params.template);

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

      // Legacy path
      return executeLegacyCreate(name, mode, params, model, overwrite);
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
// Mode resolution
// ---------------------------------------------------------------------------

function resolveMode(
  explicitMode: string | undefined,
  legacyTemplate: string | undefined
): CreateMode {
  // Explicit mode always wins
  if (explicitMode && ALL_MODES.includes(explicitMode as CreateMode)) {
    return explicitMode as CreateMode;
  }

  // Legacy template param maps to legacy mode
  if (legacyTemplate) {
    switch (legacyTemplate) {
      case "basic":
        return "legacy_basic";
      case "mcp":
        return "legacy_mcp";
      case "sequential":
        return "legacy_sequential";
    }
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

// ---------------------------------------------------------------------------
// Legacy creation path (temporary compatibility)
// ---------------------------------------------------------------------------

async function executeLegacyCreate(
  name: string,
  mode: CreateMode,
  params: Record<string, unknown>,
  model: string,
  overwrite: boolean
): Promise<ReturnType<typeof errorResult>> {
  const template = mode.replace("legacy_", "") as "basic" | "mcp" | "sequential";
  const addDocsMcp = (params.add_adk_docs_mcp as boolean) ?? true;
  const installSkills = (params.install_adk_skills as boolean) ?? true;
  const targetPath = (params.path as string) ?? `./agents/${name}`;
  const cwd = process.cwd();

  // Validate target path stays within workspace
  const pathError = validateTargetPath(cwd, targetPath);
  if (pathError) {
    return errorResult(pathError, mode);
  }

  // Guard: check if target exists and overwrite is false
  if (safeExists(cwd, targetPath) && !overwrite) {
    const marker = safeExists(cwd, `${targetPath}/${MANIFEST_FILENAME}`);
    if (marker) {
      return errorResult(
        `Target path "${targetPath}" already contains an ADK project. Use overwrite: true to replace.`,
        mode
      );
    }
  }

  const results: WriteResult[] = [];
  const vars = { name, model };

  try {
    switch (template) {
      case "basic":
        results.push(...scaffoldBasic(cwd, targetPath, vars, overwrite));
        break;
      case "mcp":
        results.push(...scaffoldMcp(cwd, targetPath, vars, overwrite));
        break;
      case "sequential":
        results.push(...scaffoldSequential(cwd, targetPath, vars, overwrite));
        break;
      default:
        return errorResult(`Unknown template: ${template}`, mode);
    }

    // .gitignore
    results.push(
      safeWriteFile(cwd, `${targetPath}/.gitignore`, gitignore(), overwrite)
    );

    // ADK docs MCP example
    if (addDocsMcp) {
      results.push(
        safeWriteFile(
          cwd,
          `${targetPath}/.pi/mcp/adk-docs.example.json`,
          adkDocsMcpConfig(),
          overwrite
        )
      );
    }

    // Scaffold manifest
    const manifest = createManifest(name, template, model);
    results.push(
      safeWriteFile(
        cwd,
        `${targetPath}/${MANIFEST_FILENAME}`,
        serializeManifest(manifest),
        overwrite
      )
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Scaffold failed: ${msg}`, mode);
  }

  const created = results.filter((r) => r.created).map((r) => r.path);
  const skipped = results
    .filter((r) => r.skipped)
    .map((r) => `${r.path} (${r.reason})`);

  let skillsInstalled = false;
  let skillsNote: string | undefined;
  if (installSkills) {
    skillsNote =
      "ADK skills installation skipped: not available in this environment. " +
      "You can manually install ADK-related pi skills if needed.";
  }

  const nextSteps = [
    `cd ${targetPath}`,
    "python -m venv .venv",
    "source .venv/bin/activate",
    "pip install google-adk",
    "cp .env.example .env",
    "# Set GOOGLE_API_KEY in .env",
    `adk web .`,
  ];

  const result: CreateResult = {
    ok: true,
    path: targetPath,
    mode,
    template,
    model,
    files_created: created,
    files_skipped: skipped,
    adk_docs_mcp: addDocsMcp,
    skills_installed: skillsInstalled,
    skills_note: skillsNote,
    next_steps: nextSteps,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

// ── Path validation ───────────────────────────────────────────────────

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

// ── Template scaffolders ──────────────────────────────────────────────

function scaffoldBasic(
  cwd: string,
  base: string,
  vars: { name: string; model: string },
  overwrite: boolean
): WriteResult[] {
  const p = (f: string) => `${base}/${f}`;
  return [
    safeWriteFile(cwd, p(`${vars.name}/__init__.py`), basicTemplate.initPy(vars), overwrite),
    safeWriteFile(cwd, p(`${vars.name}/agent.py`), basicTemplate.agentPy(vars), overwrite),
    safeWriteFile(cwd, p(".env.example"), basicTemplate.envExample(), overwrite),
    safeWriteFile(cwd, p("README.md"), basicTemplate.projectReadme(vars), overwrite),
  ];
}

function scaffoldMcp(
  cwd: string,
  base: string,
  vars: { name: string; model: string },
  overwrite: boolean
): WriteResult[] {
  const p = (f: string) => `${base}/${f}`;
  return [
    safeWriteFile(cwd, p(`${vars.name}/__init__.py`), mcpTemplate.initPy(vars), overwrite),
    safeWriteFile(cwd, p(`${vars.name}/agent.py`), mcpTemplate.agentPy(vars), overwrite),
    safeWriteFile(cwd, p(`${vars.name}/mcp_config.py`), mcpTemplate.mcpConfigPy(vars), overwrite),
    safeWriteFile(cwd, p(".env.example"), mcpTemplate.envExample(), overwrite),
    safeWriteFile(cwd, p("README.md"), mcpTemplate.projectReadme(vars), overwrite),
  ];
}

function scaffoldSequential(
  cwd: string,
  base: string,
  vars: { name: string; model: string },
  overwrite: boolean
): WriteResult[] {
  const p = (f: string) => `${base}/${f}`;
  return [
    safeWriteFile(cwd, p(`${vars.name}/__init__.py`), sequentialTemplate.initPy(vars), overwrite),
    safeWriteFile(cwd, p(`${vars.name}/agent.py`), sequentialTemplate.agentPy(vars), overwrite),
    safeWriteFile(cwd, p(`${vars.name}/steps.py`), sequentialTemplate.stepsPy(vars), overwrite),
    safeWriteFile(cwd, p(".env.example"), sequentialTemplate.envExample(), overwrite),
    safeWriteFile(cwd, p("README.md"), sequentialTemplate.projectReadme(vars), overwrite),
  ];
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
