# pi-google-adk

A Pi extension for scaffolding Python-first Google ADK (Agent Development Kit) projects locally.

Registers two LLM-callable tools:

- **`create_adk_agent`** — scaffold a new ADK project from a template
- **`add_adk_capability`** — add tools, MCP, workflows, evals, and docs to an existing project

All output is deterministic and template-driven. No AI-generated code at runtime.

## Quick Start

```bash
git clone <repo-url> && cd pi-google-adk
npm install
pi -e ./src/index.ts
```

Then talk to Pi:

```
Create a basic ADK agent called research_bot
```

```
Add a custom tool called fetch_data to ./agents/research_bot
```

```
Create a sequential agent called pipeline_bot at ./agents/pipeline_bot
```

```
Add an eval stub to the project at ./agents/research_bot
```

That is all you need to get started. The rest of this document is reference.

## Installation

### Prerequisites

- Node.js (for npm)
- Pi (`@mariozechner/pi-coding-agent` 0.57+)
- Python 3.11+ and `pip install google-adk` (for the generated projects, not for this extension)
- A Google API key (for Gemini models in the generated projects)

### Install dependencies

From the extension directory:

```bash
npm install
```

### Load in Pi

**Option A — direct load (recommended for trying it out):**

```bash
pi -e ./src/index.ts
```

**Option B — auto-discovery via Pi extensions directory:**

Copy or symlink the extension folder into `~/.pi/agent/extensions/` or `.pi/extensions/`
in your project. Pi loads it automatically on startup.

**Option C — reference from a Pi package manifest:**

Add to your project's `package.json`:

```json
{
  "pi": {
    "extensions": ["./path/to/pi-google-adk/src/index.ts"]
  }
}
```

## Tools

### `create_adk_agent`

Scaffold a new Python Google ADK project.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | string | *(required)* | Agent name (lowercase, alphanumeric, underscores) |
| `path` | string | `./agents/<name>` | Target directory (must be within the workspace) |
| `template` | `basic` \| `mcp` \| `sequential` | `basic` | Project template |
| `model` | string | `gemini-2.5-flash` | Gemini model for the generated agent |
| `install_adk_skills` | boolean | `true` | Best-effort only; see Limitations |
| `add_adk_docs_mcp` | boolean | `true` | Emit a local ADK docs MCP example config |
| `overwrite` | boolean | `false` | Overwrite existing files |

**Generated project structure (basic template):**

```
agents/research_bot/
  research_bot/
    __init__.py
    agent.py
  .env.example
  .gitignore
  .adk-scaffold.json
  README.md
  .pi/mcp/adk-docs.example.json
```

The `mcp` template adds `mcp_config.py`. The `sequential` template adds `steps.py`.

**Generated Python imports:**

- Basic and MCP templates: `from google.adk import Agent`
- Sequential template: `from google.adk.agents import SequentialAgent`
- MCP config: `from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StdioServerParameters`

These match `google-adk` 1.x API conventions.

### `add_adk_capability`

Add a capability to an existing ADK project.

| Parameter | Type | Description |
|---|---|---|
| `project_path` | string | Path to the ADK project root (must be within the workspace) |
| `capability` | string | One of the capabilities below |
| `options` | object | Capability-specific options (see below) |

**Capabilities:**

| Capability | What it does |
|---|---|
| `custom_tool` | Creates a tool module under `tools/` and wires it into `agent.py` |
| `mcp_toolset` | Adds MCP toolset configuration and wiring |
| `sequential_workflow` | Adds a sequential multi-agent workflow |
| `eval_stub` | Creates an `evals/` directory with a starter stub |
| `deploy_stub` | Creates a `DEPLOY.md` deployment notes document |
| `observability_notes` | Creates an `OBSERVABILITY.md` with logging/tracing guidance |

**Capability options:**

| Option | Used by | Description |
|---|---|---|
| `tool_name` | `custom_tool` | Name for the new tool function |
| `server_command` | `mcp_toolset` | MCP server command |
| `server_args` | `mcp_toolset` | MCP server arguments |
| `subagents` | `sequential_workflow` | List of subagent names |
| `model` | `sequential_workflow` | Model for new subagents |

Each applied capability is recorded in `.adk-scaffold.json` and checked for duplicates on re-application.

## Example Prompts

These are natural-language prompts you can use in a Pi session with this extension loaded:

**Scaffolding:**

```
Create a basic ADK agent called my_assistant
```

```
Scaffold an MCP agent called data_bot with model gemini-2.5-pro
```

```
Create a sequential agent called review_pipeline at ./projects/review_pipeline
```

**Adding capabilities:**

```
Add a custom tool called search_docs to the project at ./agents/my_assistant
```

```
Add MCP toolset support to ./agents/data_bot
```

```
Add eval, deploy, and observability stubs to ./agents/my_assistant
```

## Scaffold Manifest

Every generated project includes `.adk-scaffold.json`:

```json
{
  "name": "research_bot",
  "template": "basic",
  "model": "gemini-2.5-flash",
  "extension": "pi-google-adk",
  "extension_version": "0.1.0",
  "capabilities": ["custom_tool", "eval_stub"]
}
```

Both tools use this manifest for project detection and duplicate avoidance.

## ADK Docs MCP

When `add_adk_docs_mcp` is true (the default), `create_adk_agent` writes an example
MCP config at `.pi/mcp/adk-docs.example.json` inside the generated project.

This file is a **local example only**. It is not installed globally. To use it,
review the file and adapt it into your Pi MCP configuration manually.

## Limitations

These are known, intentional constraints of the current MVP:

- **`install_adk_skills` is a no-op.** The parameter exists as a future hook. When `true`, the tool returns a note suggesting manual installation. It never fails the tool call.
- **Python only.** No TypeScript, Go, or Java scaffolding.
- **Three templates, six capabilities.** No production deployment automation.
- **Regex-based `tools=[...]` patching.** Targets generated code patterns only. If you heavily restructure `agent.py` by hand, `add_adk_capability` patching may not find the insertion point. The tool still creates the files; it just cannot wire them automatically.
- **Manifest is informational.** `.adk-scaffold.json` is not load-bearing. Deleting or editing it does not break the generated project.
- **No custom Pi renderers.** Tool output is plain JSON. Pi renders it as-is.
- **ADK docs MCP is an example.** The emitted config is project-local and must be manually adapted into your Pi MCP settings.

## Safety

- All paths are validated to stay within the current workspace. Path traversal is blocked.
- Existing files are not overwritten unless `overwrite: true` is explicitly set.
- No global config, credentials, or files outside the workspace are read or written.
- No network requests. No background processes.

## Verification

Type-check and run the verification suite:

```bash
npm run verify
```

This runs TypeScript type checking followed by 114 automated checks covering
input validation, path traversal rejection, all three templates, Python syntax
validation, `.gitignore` content, manifest tracking, overwrite protection,
patch idempotency, multi-line `tools=[...]` patching, and stub file creation.

## Release Checklist

Before tagging a release:

- [ ] `npm run verify` passes (114 checks, 0 failures)
- [ ] `npm run typecheck` passes with no errors
- [ ] Manual smoke test: `pi -e ./src/index.ts` loads both tools
- [ ] Manual smoke test: create one project per template, inspect output
- [ ] Manual smoke test: apply at least `custom_tool` and `eval_stub`, confirm manifest
- [ ] CHANGELOG.md updated with release entry
- [ ] Version in `package.json` matches version in `src/lib/scaffold-manifest.ts`

## Dependencies

- `@mariozechner/pi-coding-agent` — Pi extension API
- `@sinclair/typebox` — JSON schema for tool parameters
