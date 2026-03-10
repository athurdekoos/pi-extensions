# pi-google-adk

A Pi extension for scaffolding, discovering, resolving, and running Python-first Google ADK (Agent Development Kit) projects locally.

Registers five LLM-callable tools:

| Tool | Purpose |
|------|---------|
| **`create_adk_agent`** | Scaffold a new ADK project from a template |
| **`add_adk_capability`** | Add tools, MCP, workflows, evals, and docs to an existing project |
| **`run_adk_agent`** | Execute an on-disk ADK project and return its output |
| **`list_adk_agents`** | Discover all ADK projects in the workspace |
| **`resolve_adk_agent`** | Resolve a name or path to a specific ADK project |

All scaffolding output is deterministic and template-driven. No AI-generated code at runtime.

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
List available ADK agents
```

```
Run the research_bot agent with: "What is the capital of France?"
```

That is all you need to get started. The rest of this document is reference.

## Installation

### Prerequisites

- Node.js (for npm)
- Pi (`@mariozechner/pi-coding-agent` 0.57+)
- Python 3.10+ and `pip install google-adk` (for the generated projects and `run_adk_agent`; upstream `google-adk` requires `>=3.10`)
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

**Option B — with pi-subagents for ADK delegation:**

```bash
pi -e ./src/index.ts -e ../pi-subagents/index.ts
```

**Option C — auto-discovery via Pi extensions directory:**

Copy or symlink the extension folder into `~/.pi/agent/extensions/` or `.pi/extensions/`
in your project. Pi loads it automatically on startup.

**Option D — reference from a Pi package manifest:**

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

### `run_adk_agent`

Execute an on-disk ADK project using `adk run --replay` and return the agent's output.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `project_path` | string | *(required)* | Path to the ADK project root, relative to workspace |
| `prompt` | string | *(required)* | Task or query to send to the ADK agent |
| `timeout_seconds` | number | `180` | Maximum execution time (5–600 seconds) |

**Result structure:**

| Field | Description |
|---|---|
| `success` | Whether execution completed successfully |
| `final_output` | Best-effort clean final agent response (parsed from turn markers) |
| `raw_stdout` | Complete stdout for debugging |
| `raw_stderr` | Complete stderr for debugging |
| `agent_name` | Detected agent name |
| `template` | Detected template type |
| `exit_code` | Process exit code |
| `error` | Error message if failed |

**Output parsing (Phase 3):** The `final_output` field extracts the last non-user turn from ADK's `[speaker]: content` output format. Multi-line agent responses are preserved. If no turn markers are found, falls back safely to trimmed stdout.

### `list_adk_agents`

Discover and list all ADK agent projects in the workspace.

No parameters. Returns an array of discovered agents with name, path, template, capabilities, source (manifest or heuristic), and display label.

### `resolve_adk_agent`

Resolve a name or path query to a specific ADK project.

| Parameter | Type | Description |
|---|---|---|
| `query` | string | Agent name or relative path (e.g., `researcher`, `./agents/researcher`) |

**Resolution order:**
1. If query contains `/` or starts with `.`, resolve as a path first
2. Exact name match
3. Case-insensitive name match (only if unique)
4. Prefix match (only if unique)
5. If multiple matches, returns `ambiguous` status with match list

**Result statuses:** `found`, `not_found`, `ambiguous`

## Cross-Extension Integration with pi-subagents

When both pi-google-adk and pi-subagents are loaded, ADK agents can be delegated to by name:

```json
{
  "task": "Research the current state of quantum computing",
  "agent": "researcher",
  "mode": "read_only"
}
```

### How it works

1. pi-google-adk registers `run_adk_agent` and `resolve_adk_agent` as safe tools via `registerSafeToolForSubagents()`
2. This uses a load-order-resilient mechanism: if pi-subagents is already loaded, registers immediately; otherwise queues in `__piSubagents_pendingSafeTools`
3. When pi-subagents receives an `agent` parameter, it calls `resolve_adk_agent` through the safe tool registry
4. The resolved project path is injected into the child's instructions
5. `run_adk_agent` is auto-allowlisted in the child session

### Provider availability (Phase 3)

pi-subagents distinguishes these states:
- **`provider_unavailable`**: pi-google-adk not loaded (resolve_adk_agent not registered)
- **`execution_unavailable`**: resolution works but run_adk_agent not registered
- **`not_found`**: ADK provider loaded but no matching agent
- **`ambiguous`**: multiple matches requiring disambiguation
- **`interactive_selection_required`**: disambiguation needed but no UI available

## Discovery

ADK agents are discovered by scanning `./agents/` for subdirectories containing:
- `.adk-scaffold.json` manifest (preferred, from `create_adk_agent`)
- `.env.example` file (heuristic fallback)

Discovery is live — newly created agents are found on the next scan without restart.

### Display labels

Agent labels include name, template, capabilities, and path for disambiguation:

```
researcher (mcp) [web_search, code_exec] — ./agents/researcher
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

Both `create_adk_agent` and `add_adk_capability` use this manifest for project detection and duplicate avoidance.

## Example Prompts

**Scaffolding:**

```
Create a basic ADK agent called my_assistant
Scaffold an MCP agent called data_bot with model gemini-2.5-pro
Create a sequential agent called review_pipeline at ./projects/review_pipeline
```

**Adding capabilities:**

```
Add a custom tool called search_docs to the project at ./agents/my_assistant
Add MCP toolset support to ./agents/data_bot
Add eval, deploy, and observability stubs to ./agents/my_assistant
```

**Discovery and execution:**

```
List all ADK agents
Run the researcher agent with: "Summarize recent AI safety papers"
Delegate to researcher: analyze the trade-offs of microservices vs monoliths
```

## Limitations

These are known, intentional constraints:

- **`install_adk_skills` is a no-op.** The parameter exists as a future hook.
- **Python only.** No TypeScript, Go, or Java scaffolding.
- **Three templates, six capabilities.** No production deployment automation.
- **Regex-based `tools=[...]` patching.** Targets generated code patterns only.
- **Manifest is informational.** `.adk-scaffold.json` is not load-bearing.
- **No custom Pi renderers.** Tool output is plain JSON.
- **ADK docs MCP is an example.** The emitted config is project-local.
- **Output parsing is heuristic.** The `[speaker]: content` turn parser works with observed ADK CLI output. If ADK changes format, parsing falls back safely to full stdout.

## Safety

- All paths are validated to stay within the current workspace. Path traversal is blocked.
- Existing files are not overwritten unless `overwrite: true` is explicitly set.
- No global config, credentials, or files outside the workspace are read or written.
- No network requests from the extension itself. `run_adk_agent` spawns a subprocess that may make network calls.
- No background processes. ADK execution is synchronous with configurable timeout.

## Testing

150 automated tests across unit, extension, integration, and veracity layers.

```bash
npm test              # all tests (excludes LLM)
npm run verify        # typecheck + verification suite
```

### Test coverage

| Layer | Tests | What it protects |
|---|---|---|
| Unit: adk-discovery | 21 | Discovery scanning, name/path/case/prefix resolution, labels, capabilities |
| Unit: adk-runtime | 18 | Project validation, output parsing (turn extraction, multi-line, fallback) |
| Unit: validators | 17 | Input validation for names, paths, templates, models |
| Unit: templates | 12 | Template file generation for basic, mcp, sequential |
| Unit: scaffold-manifest | 8 | Manifest creation, serialization, reading |
| Unit: temp-replay | 8 | Replay file creation and cleanup |
| Unit: project-detect | 4 | Project detection via manifest and heuristic |
| Unit: fs-safe | 14 | Path safety, file operations, traversal prevention |
| Unit: adk-docs-mcp | 3 | MCP config generation |
| Unit: safe-tool-registration | 3 | Load-order-resilient safe tool registration |
| Extension: registration | 10 | All 5 tools registered with correct metadata |
| Extension: run-adk-agent | 6 | Runtime behavior, CLI availability, credential handling |
| Integration: scaffold-workflow | 8 | End-to-end scaffold + capability workflows |
| Veracity: scaffold-traps | 10 | Canary-based proof of actual file creation |

## Release Checklist

Before tagging a release:

- [ ] `npm run verify` passes
- [ ] `npm test` passes (150 tests)
- [ ] Manual smoke test: `pi -e ./src/index.ts` loads all 5 tools
- [ ] Manual smoke test: create one project per template, inspect output
- [ ] Manual smoke test: `run_adk_agent` executes a project (requires ADK CLI + API key)
- [ ] Manual smoke test: `list_adk_agents` and `resolve_adk_agent` find created projects
- [ ] CHANGELOG.md updated with release entry
- [ ] Version in `package.json` matches version in `src/lib/scaffold-manifest.ts`

## Dependencies

- `@mariozechner/pi-coding-agent` — Pi extension API
- `@sinclair/typebox` — JSON schema for tool parameters
