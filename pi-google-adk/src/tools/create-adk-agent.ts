/**
 * Tool: create_adk_agent
 *
 * Scaffolds a new Python Google ADK project from templates.
 */

import { resolve, relative } from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { safeWriteFile, safeExists, type WriteResult } from "../lib/fs-safe.js";
import { validateAgentName } from "../lib/validators.js";
import { adkDocsMcpConfig } from "../lib/adk-docs-mcp.js";
import { createManifest, serializeManifest, MANIFEST_FILENAME } from "../lib/scaffold-manifest.js";
import { gitignore } from "../templates/shared.js";
import * as basicTemplate from "../templates/python-basic/files.js";
import * as mcpTemplate from "../templates/python-mcp/files.js";
import * as sequentialTemplate from "../templates/python-sequential/files.js";

export const CreateAdkAgentParams = Type.Object({
  name: Type.String({ description: "Agent name (lowercase, alphanumeric, underscores)" }),
  path: Type.Optional(Type.String({ description: "Target path relative to cwd. Default: ./agents/<name>" })),
  template: Type.Optional(
    StringEnum(["basic", "mcp", "sequential"] as const, {
      description: "Project template. Default: basic",
    })
  ),
  model: Type.Optional(
    Type.String({ description: "Gemini model to use. Default: gemini-2.5-flash" })
  ),
  install_adk_skills: Type.Optional(
    Type.Boolean({ description: "Attempt to install ADK-related pi skills. Default: true" })
  ),
  add_adk_docs_mcp: Type.Optional(
    Type.Boolean({ description: "Emit a project-local ADK docs MCP example config. Default: true" })
  ),
  overwrite: Type.Optional(
    Type.Boolean({ description: "Overwrite existing files. Default: false" })
  ),
});

interface CreateResult {
  ok: boolean;
  path: string;
  template: string;
  model: string;
  files_created: string[];
  files_skipped: string[];
  adk_docs_mcp: boolean;
  skills_installed: boolean;
  skills_note?: string;
  next_steps: string[];
  error?: string;
}

export function registerCreateAdkAgent(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "create_adk_agent",
    label: "Create ADK Agent",
    description:
      "Scaffold a new Python Google ADK agent project from a template. " +
      "Templates: basic, mcp, sequential. " +
      "Generates agent code, environment template, README, and optional ADK docs MCP config.",
    parameters: CreateAdkAgentParams,

    async execute(_toolCallId, params) {
      const name: string = params.name;
      const template = params.template ?? "basic";
      const model = params.model ?? "gemini-2.5-flash";
      const overwrite = params.overwrite ?? false;
      const addDocsMcp = params.add_adk_docs_mcp ?? true;
      const installSkills = params.install_adk_skills ?? true;

      // Validate name
      const nameError = validateAgentName(name);
      if (nameError) {
        return errorResult(nameError);
      }

      const targetPath = params.path ?? `./agents/${name}`;
      const cwd = process.cwd();

      // Validate target path stays within workspace
      const pathError = validateTargetPath(cwd, targetPath);
      if (pathError) {
        return errorResult(pathError);
      }

      // Guard: check if target exists and overwrite is false
      if (safeExists(cwd, targetPath) && !overwrite) {
        const marker = safeExists(cwd, `${targetPath}/${MANIFEST_FILENAME}`);
        if (marker) {
          return errorResult(
            `Target path "${targetPath}" already contains an ADK project. Use overwrite: true to replace.`
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
            return errorResult(`Unknown template: ${template}`);
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
        return errorResult(`Scaffold failed: ${msg}`);
      }

      const created = results.filter((r) => r.created).map((r) => r.path);
      const skipped = results.filter((r) => r.skipped).map((r) => `${r.path} (${r.reason})`);

      // Skills installation is best-effort
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
    },
  });
}

// ── Path validation ───────────────────────────────────────────────────

/**
 * Return an error string if the target path escapes the workspace root.
 * Returns null if valid.
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

function errorResult(message: string) {
  const result: CreateResult = {
    ok: false,
    path: "",
    template: "",
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
