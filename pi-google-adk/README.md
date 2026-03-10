# pi-google-adk

A Pi extension for creating, importing, discovering, resolving, and running Python-first Google ADK (Agent Development Kit) projects locally.

Registers six LLM-callable tools:

| Tool | Purpose |
|------|---------|
| **`create_adk_agent`** | Create a new ADK project (native CLI, official sample import, or legacy templates) |
| **`add_adk_capability`** | Add tools, MCP, workflows, evals, and docs to an existing project |
| **`run_adk_agent`** | Execute an on-disk ADK project and return its output |
| **`list_adk_agents`** | Discover all ADK projects in the workspace |
| **`resolve_adk_agent`** | Resolve a name or path to a specific ADK project |
| **`check_adk_sample_drift`** | Detect drift between an imported official sample and its upstream source |

Primary creation uses the installed Google ADK CLI (`adk create`). Official Google ADK samples can be imported from `google/adk-samples`. Legacy Pi-owned templates remain available as a compatibility path.

## Quick Start

```bash
git clone <repo-url> && cd pi-google-adk
npm install
pi -e ./src/index.ts
```

Then talk to Pi:

```
Create an ADK agent called research_bot
```

```
Create a config-based ADK agent called my_config_bot
```

```
Import the hello_world official ADK sample
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
- `git` (required for official sample import)

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

Create a new Google ADK agent project.

When UI is available and required parameters are missing, presents an interactive wizard with mode selection, recommendation questions (for sample import), and confirmation prompts. When UI is unavailable, requires explicit parameters and fails clearly on missing input.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | string | *(interactive or required)* | Agent name (lowercase, alphanumeric, underscores) |
| `mode` | string | `native_app` | Creation mode (see below) |
| `path` | string | `./agents/<name>` | Target directory (must be within the workspace) |
| `sample_slug` | string | — | Sample slug from the curated catalog (required for `official_sample` mode) |
| `template` | string | — | DEPRECATED: maps to legacy mode. Use `mode` instead |
| `model` | string | `gemini-2.5-flash` | Gemini model for the generated agent |
| `install_adk_skills` | boolean | `true` | Best-effort only; see Limitations |
| `add_adk_docs_mcp` | boolean | `true` | Emit a local ADK docs MCP example config (legacy modes only) |
| `overwrite` | boolean | `false` | Overwrite existing files |

**Creation modes:**

| Mode | Description |
|---|---|
| `native_app` | Creates via `adk create APP_NAME` (default, requires ADK CLI) |
| `native_config` | Creates via `adk create --type=config APP_NAME` (requires ADK CLI with config support) |
| `official_sample` | Imports an official sample from `google/adk-samples` (requires git) |
| `legacy_basic` | Pi-owned basic template (deprecated compatibility path) |
| `legacy_mcp` | Pi-owned MCP template (deprecated compatibility path) |
| `legacy_sequential` | Pi-owned sequential template (deprecated compatibility path) |

**Interactive wizard:** When UI is available and `name`/`mode` are not provided, the tool presents a guided flow:

1. Choose mode: Native ADK app / Native ADK config app / Import official ADK sample / Cancel
2. For native modes: collect agent name, destination path, model, and confirm
3. For sample import: answer recommendation questions, choose from scored recommendations, name the import, and confirm

**Native creation:** Uses the installed ADK CLI. Runs capability detection first. If `native_config` is requested but the installed ADK CLI does not support `--type=config`, the tool fails with a clear error including the detected ADK version and which help surface was checked.

**Official sample import:** Imports a curated official sample from `google/adk-samples`:

1. Validates the sample slug against the curated catalog
2. Shallow-clones the upstream repo to a temp directory
3. Copies only the selected sample into the target path
4. Writes provenance metadata (upstream repo, path, ref, commit hash)
5. Cleans up the temp clone

Requires `git` on PATH. If git is unavailable, fails clearly.

**Available sample slugs:**

| Slug | Description | Complexity |
|---|---|---|
| `hello_world` | Minimal ADK agent — simplest starting point | starter |
| `brand_search_agent` | Search for brand info using Google Search | starter |
| `content_writer` | Blog posts, summaries, written content | starter |
| `customer_service` | Multi-turn support with lookup and escalation | intermediate |
| `rag_agent` | Retrieval-augmented generation from documents | intermediate |
| `code_agent` | Code generation, explanation, and debugging | intermediate |
| `multimodal_agent` | Text + images multimodal handling | intermediate |
| `workflow_agent` | Multi-step sequential and parallel execution | advanced |

**Non-interactive sample import:**

```json
{
  "name": "my_sample",
  "mode": "official_sample",
  "sample_slug": "hello_world"
}
```

**Tool planning parameters (Phase 3):**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `configure_tools_now` | boolean | — | Include tool planning in creation. When true, builds a plan from the params below |
| `adk_native_tools` | string[] | — | ADK-native tool categories: `none`, `mcp_toolset`, `openapi_toolset`, `custom_function_tools`, `other` |
| `pi_mono_profile` | string | — | Pi Mono built-in session profile: `read_only`, `coding`, or `unknown` |
| `extension_tools` | string[] | — | Extension tool names to include in the tool plan |
| `required_safe_custom_tools` | string[] | — | Safe custom tools for pi-subagents delegation |
| `tool_notes` | string | — | Free-text note about the tool plan |

**Tool planning:** When UI is available the wizard offers an optional "Configure tool access?" step after project creation. This walks through three buckets:

1. **ADK-native tools** — MCP toolsets, OpenAPI toolsets, custom functions, or other patterns the ADK project uses natively
2. **Pi Mono built-in session profile** — what built-in tools a Pi subagent will have:
   - `read_only` → read, grep, find, ls
   - `coding` → read, bash, edit, write
3. **Installed Pi extension tools** — extension-provided tools currently detected in the active Pi environment

The tool plan is advisory metadata. It records intended access, not an execution guarantee. Actual child-session access depends on mode, allowlisting, and loaded extensions at runtime.

Non-interactive tool planning is available via explicit params:

```json
{
  "name": "my_agent",
  "mode": "native_app",
  "configure_tools_now": true,
  "adk_native_tools": ["mcp_toolset"],
  "pi_mono_profile": "coding",
  "extension_tools": ["delegate_to_subagent"],
  "tool_notes": "Uses weather MCP server"
}
```

**Pi metadata:** Native-created and imported projects get a `.pi-adk-metadata.json` file with provenance info. For imported samples, this includes upstream repo URL, path, ref, commit hash, and import timestamp. When tool planning is used, metadata also includes a `tool_plan` section. This file is additive — the project works without it.

**Legacy template structure (deprecated):**

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

### `check_adk_sample_drift`

Detect whether an imported official ADK sample has drifted relative to its upstream source. Reports drift but does not auto-update.

Works only on projects created via `official_sample` import (source_type = `official_sample`). Returns `unsupported_project` for `native_app` / `native_config` projects.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `project_path` | string | — | Path to the imported sample project |
| `agent` | string | — | Agent name to resolve via ADK discovery (alternative to project_path) |
| `update_metadata` | boolean | `false` | Write drift tracking fields to `.pi-adk-metadata.json` |
| `verbose` | boolean | `false` | Include changed_files detail in the result |

**Target resolution:** If neither `project_path` nor `agent` is provided and UI is available, shows an interactive picker listing imported official samples. If UI is unavailable, fails with guidance.

**Comparison model:** Compares three directory trees:

1. **Baseline** — the upstream sample at the recorded import commit/ref
2. **Current upstream** — the upstream sample at the current HEAD of the default branch
3. **Local** — the current local project directory

Files excluded from comparison (to avoid false drift): `.pi-adk-metadata.json`, `.adk-scaffold.json`, `.git/`, `.DS_Store`, `__pycache__/`, `*.pyc`, `Thumbs.db`.

**Drift statuses:**

| Status | Meaning |
|---|---|
| `up_to_date` | Local matches current upstream |
| `upstream_updated` | Upstream changed since import; local unchanged |
| `local_modified` | Local changed since import; upstream unchanged |
| `diverged` | Both local and upstream changed since import |
| `unsupported_project` | Not an imported official sample |
| `missing_provenance` | Required provenance fields missing |
| `git_unavailable` | git not on PATH |
| `upstream_unavailable` | Cannot fetch upstream repo or path |
| `error` | Unexpected failure |

**Metadata tracking:** When `update_metadata=true` and the check succeeds, the following fields are written additively to the `tracking` section of `.pi-adk-metadata.json`:

```json
{
  "tracking": {
    "last_drift_check_at": "2026-03-10T12:00:00.000Z",
    "last_drift_status": "up_to_date",
    "last_checked_upstream_commit": "abc123def456",
    "last_local_hash": "...",
    "last_upstream_hash": "..."
  }
}
```

**Provenance requirements:** The tool uses the `provenance.sample_import` fields written at import time: `upstream_repo`, `upstream_path`, `upstream_ref`, and `commit`. If the commit hash is missing, the tool falls back to using current upstream as the baseline (with a caveat note).

**Example usage:**

```
Check drift on my imported hello_world sample
```

```json
{
  "project_path": "./agents/my_sample",
  "update_metadata": true,
  "verbose": true
}
```

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

### `list_adk_agents`

Discover and list all ADK agent projects in the workspace.

No parameters. Returns an array of discovered agents with name, path, template, capabilities, source type, and display label.

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

### Provider availability

pi-subagents distinguishes these states:
- **`provider_unavailable`**: pi-google-adk not loaded (resolve_adk_agent not registered)
- **`execution_unavailable`**: resolution works but run_adk_agent not registered
- **`not_found`**: ADK provider loaded but no matching agent
- **`ambiguous`**: multiple matches requiring disambiguation
- **`interactive_selection_required`**: disambiguation needed but no UI available

## Discovery

ADK agents are discovered by scanning `./agents/` for subdirectories containing:
- `.adk-scaffold.json` manifest (legacy Pi-scaffolded projects)
- `.pi-adk-metadata.json` (native-created and imported projects)
- `.env.example` file (heuristic fallback)
- Subdirectory with `agent.py` or `__init__.py` (heuristic fallback)

Discovery is live — newly created agents are found on the next scan without restart.

### Display labels

Agent labels now include source type tags for clear visual distinction:

```
researcher [native_app] — ./agents/researcher
support-bot [native_config] — ./agents/support-bot
academic-research [official_sample] — ./agents/academic-research
legacy-agent (basic) [mcp_toolset] — ./agents/legacy-agent
```

The `source_type` field on discovered agents indicates provenance: `native_app`, `native_config`, or `official_sample`.

## Provenance Metadata

All created and imported projects include `.pi-adk-metadata.json`:

**Native-created project:**

```json
{
  "schema_version": "1",
  "source_type": "native_app",
  "agent_name": "research_bot",
  "provenance": {
    "created_at": "2025-01-15T10:00:00.000Z",
    "creation_args": { "mode": "native_app", "name": "research_bot" }
  },
  "tracking": {}
}
```

**Imported sample:**

```json
{
  "schema_version": "1",
  "source_type": "official_sample",
  "agent_name": "my_sample",
  "provenance": {
    "created_at": "2025-01-15T10:00:00.000Z",
    "creation_args": { "mode": "official_sample", "sample_slug": "hello_world" },
    "sample_import": {
      "upstream_repo": "https://github.com/google/adk-samples.git",
      "upstream_path": "agents/hello-world",
      "upstream_ref": "main",
      "commit": "abc123def456",
      "imported_at": "2025-01-15T10:00:00.000Z",
      "sample_slug": "hello_world"
    }
  },
  "tracking": {}
}
```

**Tool plan in metadata (Phase 3):**

When tool planning is used, metadata includes a `tool_plan` section:

```json
{
  "tool_plan": {
    "adk_native_tools": ["mcp_toolset"],
    "adk_native_notes": "Weather API via MCP",
    "pi_mono_profile": "coding",
    "pi_mono_builtin_tools": ["read", "bash", "edit", "write"],
    "installed_extension_tools_detected": ["delegate_to_subagent"],
    "installed_extension_tools_selected": ["delegate_to_subagent"],
    "required_safe_custom_tools": ["run_adk_agent", "resolve_adk_agent", "delegate_to_subagent"],
    "notes": [],
    "caveats": ["This tool plan is advisory. Actual child-session access depends on mode, allowlisting, and loaded extensions."]
  }
}
```

The tool plan is purely advisory. If planning is skipped, the `tool_plan` field is omitted from metadata. The `tracking` section is populated by `check_adk_sample_drift` when `update_metadata=true` is used (see drift detection docs above).

### Metadata Schema Versioning (Phase 5A)

`.pi-adk-metadata.json` uses explicit schema versioning via the `schema_version` field. Current version: `"1"`.

**Compatibility posture:**
- Older metadata without newer optional sections (`tool_plan`, drift tracking) is handled safely. Missing sections get default values during normalization.
- Unknown additive fields are preserved, not stripped — future extensions can add fields without breaking current readers.
- A newer `schema_version` than the reader expects is read in compatibility mode with a warning, not rejected outright.
- Completely malformed metadata (non-object, invalid JSON) fails gracefully with clear diagnostics rather than silent errors or crashes.

**Schema contract:**
The canonical metadata schema is defined in `shared/adk-metadata-schema/` at the repo root. Both `pi-google-adk` (writer) and `pi-subagents` (reader) import from this shared contract, eliminating the previous mirrored type definitions that were a maintenance seam. This is a development-time dependency via relative imports, not a published npm package.

**Validation behavior:**
All metadata reads now use structured validation that returns:
- `ok` — whether core fields are usable
- `metadata` — normalized output with safe defaults for missing optional fields
- `warnings` — non-fatal issues (missing schema_version, unknown source_type, future version)
- `errors` — fatal issues (non-object input, non-string source_type)

Metadata is additive and advisory — it does not affect ADK project runnability.

## Scaffold Manifest

Legacy generated projects include `.adk-scaffold.json`:

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

**Creating agents:**

```
Create an ADK agent called my_assistant
Create a config-based ADK agent called my_config_agent
Import the hello_world official ADK sample
Import the customer_service sample as support_bot
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
- **Curated sample catalog.** Only a subset of `google/adk-samples` is cataloged. The catalog does not dynamically discover upstream samples.
- **Sample import requires git.** If git is unavailable, import fails clearly.
- **Drift detection is read-only.** `check_adk_sample_drift` reports drift but does not auto-update or sync. Manual review is required for diverged samples.
- **Three templates, six capabilities.** No production deployment automation.
- **Regex-based `tools=[...]` patching.** Targets generated code patterns only.
- **Manifest is informational.** `.adk-scaffold.json` is not load-bearing.
- **No custom Pi renderers.** Tool output is plain JSON.
- **ADK docs MCP is an example.** The emitted config is project-local.
- **Output parsing is heuristic.** The `[speaker]: content` turn parser works with observed ADK CLI output.

## Safety

- All paths are validated to stay within the current workspace. Path traversal is blocked.
- Existing files are not overwritten unless `overwrite: true` is explicitly set.
- No global config, credentials, or files outside the workspace are read or written.
- No network requests from the extension itself. `run_adk_agent` spawns a subprocess that may make network calls. Sample import uses git to clone from GitHub.
- No background processes. ADK execution is synchronous with configurable timeout.
- Sample import clones to a temp directory and copies only the selected sample. The temp clone is always cleaned up.

## Testing

360 automated tests across unit, extension, integration, and veracity layers.

```bash
npm test              # all tests (excludes LLM)
npm run verify        # typecheck + verification suite
```

### Test coverage

| Layer | Tests | What it protects |
|---|---|---|
| Unit: adk-discovery | 21 | Discovery scanning, name/path/case/prefix resolution, labels, capabilities |
| Unit: adk-runtime | 18 | Project validation, output parsing (turn extraction, multi-line, fallback) |
| Unit: adk-cli-detect | 16 | ADK CLI version parsing, help parsing for create and config support |
| Unit: sample-catalog | 16 | Catalog loading, slug lookup, recommendation scoring, Python-only constraint |
| Unit: validators | 17 | Input validation for names, paths, templates, models |
| Unit: fs-safe | 14 | Path safety, file operations, traversal prevention |
| Unit: templates | 12 | Template file generation for basic, mcp, sequential |
| Unit: sample-discovery | 9 | Sample project detection, discovery, resolution, label distinction |
| Unit: scaffold-manifest | 8 | Manifest creation, serialization, reading |
| Unit: native-discovery-compat | 8 | Native-created projects discoverable via pi-metadata and heuristics |
| Unit: temp-replay | 8 | Replay file creation and cleanup |
| Unit: wizard | 8 | Wizard mode selection, cancel, native/sample flows |
| Unit: sample-metadata | 8 | Sample import metadata, provenance fields, native regression |
| Unit: tree-hash | 17 | Deterministic tree hashing, ignore rules, nested dirs, custom ignores |
| Unit: sample-drift | 18 | Drift classification, provenance extraction, tracking writes |
| Unit: sample-import | 5 | Pre-git validation: slug rejection, path traversal, destination check |
| Unit: creation-metadata | 4 | Pi metadata building, field validation, writing |
| Unit: project-detect | 4 | Project detection via manifest, pi-metadata, and heuristic |
| Unit: adk-docs-mcp | 3 | MCP config generation |
| Unit: tool-plan | 28 | Tool plan model, profiles, serialization, builder, params |
| Unit: tool-summary | 15 | Summary sections, caveats, labels, empty plan handling |
| Unit: tool-detect | 9 | Extension detection, filtering, error handling, API capture |
| Unit: safe-tool-registration | 3 | Load-order-resilient safe tool registration |
| Unit: adk-native-create | 2 | Native create command construction |
| Unit: metadata-schema-consistency | 20 | Shared schema contract, writer validation, round-trip, drift protection |
| Extension: registration | 10 | All 6 tools registered with correct metadata |
| Extension: check-drift-behavior | 10 | Drift tool registration, error statuses, interactive picker, metadata safety |
| Extension: native-create-behavior | 10 | Native mode dispatching, hard-failure, legacy compat, mode resolution |
| Extension: create-sample-behavior | 7 | Sample mode dispatch, slug validation, wizard activation |
| Extension: run-adk-agent | 6 | Runtime behavior, CLI availability, credential handling |
| Extension: tool-behavior | 8 | Legacy creation, validation, path safety |
| Integration: scaffold-workflow | 8 | End-to-end scaffold + capability workflows |
| Veracity: scaffold-traps | 10 | Canary-based proof of actual file creation |

## Release Checklist

Before tagging a release:

- [ ] `npm run verify` passes
- [ ] `npm test` passes (360 tests)
- [ ] Manual smoke test: `pi -e ./src/index.ts` loads all 6 tools
- [ ] Manual smoke test: native app creation works with installed ADK CLI
- [ ] Manual smoke test: native config creation fails clearly when unsupported
- [ ] Manual smoke test: legacy template modes still create projects
- [ ] Manual smoke test: interactive wizard presents mode selection
- [ ] Manual smoke test: official sample import via wizard works
- [ ] Manual smoke test: non-interactive sample import with `mode=official_sample` + `sample_slug` works
- [ ] Manual smoke test: missing git produces clear error
- [ ] Manual smoke test: `list_adk_agents` shows imported samples with `[official_sample]` label
- [ ] Manual smoke test: `resolve_adk_agent` resolves imported samples
- [ ] Manual smoke test: `run_adk_agent` executes a project (requires ADK CLI + API key)
- [ ] Manual smoke test: interactive tool planning wizard works after native create
- [ ] Manual smoke test: interactive tool planning wizard works after sample import
- [ ] Manual smoke test: skipping tool planning leaves metadata without tool_plan
- [ ] Manual smoke test: non-interactive `configure_tools_now=true` writes tool_plan to metadata
- [ ] Manual smoke test: tool access summary includes all three buckets
- [ ] Manual smoke test: `check_adk_sample_drift` on freshly imported sample returns `up_to_date`
- [ ] Manual smoke test: `check_adk_sample_drift` on locally modified sample returns `local_modified`
- [ ] Manual smoke test: `check_adk_sample_drift` on native_app returns `unsupported_project`
- [ ] Manual smoke test: `check_adk_sample_drift` with `update_metadata=true` writes tracking fields
- [ ] Manual smoke test: interactive drift picker works when UI is available
- [ ] CHANGELOG.md updated with release entry
- [ ] Version in `package.json` matches version in `src/lib/scaffold-manifest.ts`

## Dependencies

- `@mariozechner/pi-coding-agent` — Pi extension API
- `@sinclair/typebox` — JSON schema for tool parameters
