# pi-google-adk

A Pi extension for scaffolding Python-first Google ADK (Agent Development Kit) projects.

Registers two LLM-callable tools for creating and extending ADK agent projects locally.

## When to Use

- You want to scaffold a new Google ADK agent project quickly
- You want to add capabilities (tools, MCP, workflows, evals) to an existing ADK project
- You want deterministic, template-driven scaffolding — not freeform generation

## Installation

From this directory:

```bash
npm install
```

Load the extension in Pi:

```bash
pi -e ./src/index.ts
```

Or place it in your Pi extensions directory and reference it via `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## Tools

### `create_adk_agent`

Scaffold a new Python Google ADK project.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | string | (required) | Agent name (lowercase, underscores) |
| `path` | string | `./agents/<name>` | Target directory |
| `template` | `basic` \| `mcp` \| `sequential` | `basic` | Project template |
| `model` | string | `gemini-2.5-flash` | Gemini model |
| `install_adk_skills` | boolean | `true` | Best-effort ADK skill install (see note below) |
| `add_adk_docs_mcp` | boolean | `true` | Emit ADK docs MCP example config |
| `overwrite` | boolean | `false` | Overwrite existing files |

**Example:**

```
Create a new ADK agent called "research_bot" using the sequential template
```

The tool creates:

```
agents/research_bot/
  research_bot/
    __init__.py
    agent.py
    steps.py              # sequential template only
    mcp_config.py         # mcp template only
  .env.example
  .gitignore
  .adk-scaffold.json
  README.md
  .pi/mcp/adk-docs.example.json
```

**Generated Python imports:**

- Basic and MCP templates use `from google.adk import Agent`
- Sequential template uses `from google.adk.agents import SequentialAgent`
- MCP config uses `from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StdioServerParameters`

These match `google-adk` 1.x API conventions. `Agent` is the public alias for `LlmAgent`.

### `add_adk_capability`

Add a capability to an existing ADK project.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `project_path` | string | Path to the ADK project root (must be within the workspace) |
| `capability` | string | One of the capabilities below |
| `options` | object | Capability-specific options |

**Capabilities:**

| Capability | What it does |
|---|---|
| `custom_tool` | Creates a tool module under `tools/` and wires it into `agent.py` |
| `mcp_toolset` | Adds MCP toolset configuration and wiring |
| `sequential_workflow` | Adds a sequential multi-agent workflow |
| `eval_stub` | Creates an `evals/` directory with a starter stub |
| `deploy_stub` | Creates a `DEPLOY.md` deployment notes document |
| `observability_notes` | Creates an `OBSERVABILITY.md` with logging/tracing guidance |

Each applied capability is recorded in `.adk-scaffold.json`.

**Options:**

| Option | Used by | Description |
|---|---|---|
| `tool_name` | `custom_tool` | Name for the new tool function |
| `server_name` | `mcp_toolset` | MCP server display name |
| `server_command` | `mcp_toolset` | MCP server command |
| `server_args` | `mcp_toolset` | MCP server arguments |
| `subagents` | `sequential_workflow` | List of subagent names |
| `model` | `sequential_workflow` | Model for new subagents |

**Example:**

```
Add a custom tool called "fetch_data" to the project at ./agents/research_bot
```

## Scaffold Manifest

Every generated project includes a `.adk-scaffold.json` file:

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

This manifest records what template was used, which model was selected,
and which capabilities have been applied. Both tools use it for project
detection and to avoid duplicate work.

## ADK Docs MCP

When `add_adk_docs_mcp` is true (the default), `create_adk_agent` writes an example
MCP config at `.pi/mcp/adk-docs.example.json` inside the generated project.

This file is a **local example only**. It is not installed globally. To use it,
review the file and adapt it into your Pi MCP configuration manually.

The config connects to the ADK documentation via `llms.txt`:

```json
{
  "mcpServers": {
    "adk-docs-mcp": {
      "command": "uvx",
      "args": [
        "--from", "mcpdoc", "mcpdoc",
        "--urls", "AgentDevelopmentKit:https://google.github.io/adk-docs/llms.txt",
        "--transport", "stdio"
      ]
    }
  }
}
```

## `install_adk_skills` Behavior

The `install_adk_skills` parameter is **best-effort / graceful degradation only**.

The current implementation does not automatically install Pi skills. When
`install_adk_skills` is `true`, the tool returns a note suggesting manual
installation. The tool never fails due to skill installation being unavailable.

This parameter exists as a hook for future environments where programmatic
skill installation is possible.

## Design Notes

- **Python only** — No TypeScript, Go, or Java scaffolding
- **Template-driven** — All output is deterministic; no AI-generated code at runtime
- **Local only** — All filesystem operations are relative to the current workspace
- **ADK docs MCP is an example** — Emitted as a project-local file, never globally installed
- **MVP scope** — Three templates, six capabilities, no production deployment automation
- **Safe writes** — Path traversal is blocked; existing files are not overwritten unless `overwrite: true`
- **Idempotent patching** — `add_adk_capability` checks for existing imports and files before writing
- **Multi-line safe** — `tools=[...]` patching handles both single-line and multi-line formatting

## Verification

Type-check and run the verification suite:

```bash
npm run verify
```

This runs TypeScript type checking followed by 114 automated checks covering:
- input validation (names, paths)
- path traversal rejection
- all three template generators
- Python syntax validation of generated code
- `.gitignore` content
- scaffold manifest creation and capability tracking
- overwrite protection
- patch idempotency
- multi-line `tools=[...]` patching
- stub capability file creation

Manual test:

```bash
pi -e ./src/index.ts
# Then ask: "Create a basic ADK agent called test_agent"
# Then ask: "Add a custom tool called fetch_data to ./agents/test_agent"
```

## Dependencies

- `@mariozechner/pi-coding-agent` — Pi extension API
- `@sinclair/typebox` — JSON schema for tool parameters

## Requirements

For the generated ADK projects (not for this extension):

- Python 3.11+
- `pip install google-adk`
- A Google API key (for Gemini models)
