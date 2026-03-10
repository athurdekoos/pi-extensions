# pi-extensions

A collection of extensions for [`@mariozechner/pi-coding-agent`](https://github.com/badlogic/pi-mono). Each extension is a self-contained package that adds tools, commands, or integrations to Pi.

## Extensions

| Extension | Description | Status |
|-----------|-------------|--------|
| [pi-clear](./pi-clear/) | `/clear` command to start a fresh session, optionally carrying over the editor draft | Ready |
| [pi-gh](./pi-gh/) | Structured GitHub CLI tools for issues, PRs, Actions, and repo info | Ready |
| [pi-google-adk](./pi-google-adk/) | Create, import, discover, resolve, and run Python-first Google ADK agent projects | Ready |
| [pi-subagents](./pi-subagents/) | Sub-agent orchestration with bounded child sessions and ADK agent delegation | Ready |
| [shared/adk-metadata-schema](./shared/adk-metadata-schema/) | Canonical metadata contract shared by pi-google-adk and pi-subagents | Internal |

## Cross-extension integration

**pi-google-adk** and **pi-subagents** integrate through a tool-mediated interface. No hard imports cross the extension boundary. The shared metadata contract lives in `shared/adk-metadata-schema/`.

When both extensions are loaded:

1. pi-google-adk registers `run_adk_agent` and `resolve_adk_agent` as safe tools for subagent sessions
2. pi-subagents can accept an `agent` parameter to delegate to a named ADK agent
3. Resolution uses pi-google-adk's discovery logic (scanning `./agents/` for ADK projects)
4. The resolved agent's project path is injected into the child's instructions
5. `run_adk_agent` is auto-allowlisted so the child can execute the ADK agent
6. pi-subagents reads `.pi-adk-metadata.json` from the target project and produces advisory delegation advice and remediation guidance

When only pi-subagents is loaded (without pi-google-adk), the `agent` parameter returns a clear `provider_unavailable` error instead of a misleading "not found".

### Loading both together

```bash
pi -e ./pi-subagents/index.ts -e ./pi-google-adk/src/index.ts
```

### Integration architecture

```
pi-subagents                          pi-google-adk
┌─────────────────────┐              ┌──────────────────────────┐
│ delegate_to_subagent │              │ create_adk_agent         │
│   agent: "researcher"│──resolves──→│ resolve_adk_agent        │
│                      │              │ list_adk_agents          │
│ child session        │──executes──→│ run_adk_agent            │
│   (run_adk_agent     │              │ check_adk_sample_drift   │
│    auto-allowlisted) │              │ add_adk_capability       │
│                      │              │                          │
│ delegation advice    │──reads────→│ .pi-adk-metadata.json    │
│ remediation guidance │              │                          │
└─────────────────────┘              └──────────────────────────┘
        ↕ globalThis safe tool registry (no hard imports)
        ↕ shared/adk-metadata-schema (development-time contract)
```

## Current workflow

This is the intended end-to-end workflow for using pi-google-adk with pi-subagents.

### 1. Load the extensions

```bash
# Both extensions for full delegation support
pi -e ./pi-google-adk/src/index.ts -e ./pi-subagents/index.ts

# Or just pi-google-adk for creation/discovery/execution
pi -e ./pi-google-adk/src/index.ts
```

### 2. Create or import an ADK project

**Native app** (default — uses installed ADK CLI):
```
Create an ADK agent called research_bot
```

**Native config app** (config-driven, no code):
```
Create a config-based ADK agent called my_config_bot
```

**Import an official sample** (from google/adk-samples):
```
Import the hello_world official ADK sample
```

All three paths write `.pi-adk-metadata.json` with provenance and source type (`native_app`, `native_config`, or `official_sample`).

### 3. Optionally configure tool planning

During creation (interactive wizard) or non-interactively:
```json
{
  "name": "my_agent",
  "mode": "native_app",
  "configure_tools_now": true,
  "adk_native_tools": ["mcp_toolset"],
  "pi_mono_profile": "coding",
  "extension_tools": ["delegate_to_subagent"],
  "required_safe_custom_tools": ["run_adk_agent", "resolve_adk_agent"]
}
```

Tool planning records intended tool access in metadata. This is advisory — it does not grant tools at runtime.

### 4. Inspect metadata and provenance

```
List all ADK agents
```

Agents show source type labels: `[native_app]`, `[native_config]`, `[official_sample]`.

### 5. Check drift on imported samples

```
Check drift on my imported hello_world sample
```

Drift statuses: `up_to_date`, `upstream_updated`, `local_modified`, `diverged`.

### 6. Delegate via pi-subagents

```json
{
  "task": "Research quantum computing developments",
  "agent": "research_bot",
  "mode": "read_only"
}
```

pi-subagents resolves the agent, reads its metadata, produces advisory delegation advice, and (if there are tool mismatches) offers remediation guidance.

### 7. Interpret delegation advice and remediation

If the project's tool plan recommends tools that are not in the current `safeCustomTools` or not loaded as extensions, the delegation result includes:

- **Delegation advice**: recommended vs effective tools, missing extensions, warnings
- **Remediation guidance**: exact `safeCustomTools` to pass, which extensions to load, concise next-step message
- **Interactive confirm/warn**: in TUI mode, a lightweight dialog when mismatches are significant

All advice is advisory. User-provided `safeCustomTools` are authoritative and never mutated.

## Quick start

Load any extension directly:

```bash
pi -e ./pi-clear/index.ts
pi -e ./pi-gh/index.ts
pi -e ./pi-subagents/index.ts
pi -e ./pi-google-adk/src/index.ts
```

Or install globally for auto-discovery:

```bash
cp -r pi-clear/ ~/.pi/agent/extensions/pi-clear/
cp -r pi-gh/ ~/.pi/agent/extensions/pi-gh/
```

Or use project-local auto-discovery:

```bash
cp -r pi-clear/ /path/to/project/.pi/extensions/pi-clear/
```

## Extension summaries

### pi-clear

Adds a `/clear` command that resets the session. Supports carrying over the current editor draft with the `keep` argument and an optional `--edit` flag to review the text before restoring it. Confirmation is required by default.

No external dependencies.

### pi-gh

Exposes GitHub operations as structured Pi tools: `gh_repo`, `gh_issue`, `gh_pr`, and `gh_actions`. All operations target the current repository. High-impact mutations (close, merge, cancel, dispatch) require user confirmation.

Requires the [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated.

### pi-google-adk

Registers six tools for the full ADK agent lifecycle:

| Tool | Purpose |
|------|---------|
| `create_adk_agent` | Create a new ADK project (native CLI, official sample import, or legacy template) |
| `add_adk_capability` | Add capabilities to an existing project |
| `run_adk_agent` | Execute an on-disk ADK project via `adk run --replay` |
| `list_adk_agents` | Discover all ADK projects under `./agents/` |
| `resolve_adk_agent` | Resolve a name or path to a specific ADK project |
| `check_adk_sample_drift` | Detect drift between an imported sample and its upstream source |

Primary creation uses the installed ADK CLI (`adk create`). Official samples can be imported from `google/adk-samples`. Legacy Pi-owned templates remain as a compatibility path.

360 automated tests. Requires `@mariozechner/pi-coding-agent` and `@sinclair/typebox`. Python 3.10+ and `google-adk` needed for the generated projects.

### pi-subagents

Adds a `delegate_to_subagent` tool that lets the primary agent delegate bounded tasks to ephemeral child sessions created in-process. Children run in `read_only` or `coding` mode with an explicit built-in tool set. Custom tools are only available if explicitly allowlisted via `safeCustomTools`. Recursive delegation is blocked by two layers of defense (no-extension child loader + depth counter).

**ADK integration:** When pi-google-adk is also loaded, the `agent` parameter enables name-based delegation to discovered ADK agents. Resolution supports exact, case-insensitive, and prefix matching with interactive disambiguation. Metadata-aware delegation advice and remediation guidance surface tool mismatches and suggest fixes.

268 automated tests across 8 layers. Requires `@mariozechner/pi-coding-agent` and `@sinclair/typebox`. No external CLIs.

### shared/adk-metadata-schema

Canonical schema contract for `.pi-adk-metadata.json`. Defines types, validation, and normalization used by both pi-google-adk (writer) and pi-subagents (reader). Development-time dependency via relative imports, not a published npm package.

37 automated tests.

## Contributor architecture notes

### Package responsibilities

| Package | Owns | Does NOT own |
|---------|------|-------------|
| **pi-google-adk** | Creation, import, discovery, runtime execution, provenance metadata, drift detection, tool planning | Delegation, orchestration, remediation UX |
| **pi-subagents** | Delegation, child session orchestration, delegation advice, remediation guidance | ADK project creation, discovery, metadata writing |
| **shared/adk-metadata-schema** | Canonical metadata types, validation, normalization | Business logic, tool registration, UI |

### Key design principles

- **Metadata is additive and advisory.** `.pi-adk-metadata.json` does not affect ADK project runnability. It enriches the delegation workflow.
- **Delegation advice is advisory-first.** pi-subagents never auto-grants tools, auto-loads extensions, or blocks delegation because of metadata mismatches. Warnings are preferred over refusal.
- **Extension detection is delegation-scope truth.** The safe tool registry reflects what extensions are loaded *in this Pi session*, not a universal environment truth. Missing tools might simply mean an extension is not loaded right now.
- **Cross-extension integration is tool-mediated.** pi-subagents calls `resolve_adk_agent` through the safe tool registry. No hard imports cross the boundary.
- **Schema versioning is forward-compatible.** Newer metadata versions are read in compatibility mode with warnings, not rejected.

### Metadata flow

```
create_adk_agent ──writes──→ .pi-adk-metadata.json
                              ↑ (with provenance, source_type, optional tool_plan)
                              │
check_adk_sample_drift ──updates tracking──→ (additive drift fields)
                              │
delegate_to_subagent ──reads──→ buildDelegationAdvice()
                              │     ↓
                              └── buildDelegationRemediation()
                                    ↓
                              advisory output + optional confirm/warn
```

## Repository layout

```text
pi-extensions/
  AGENTS.md                                # repository-wide coding and design rules
  README.md                                # this file
  templates-for-dir.md                     # AGENTS.md template for new extensions
  pi-cli-extension-testing-requirements.md # repository testing standard
  .gitignore
  pi-clear/
    AGENTS.md, package.json, index.ts, README.md
  pi-gh/
    AGENTS.md, package.json, index.ts, README.md, tests/
  pi-google-adk/
    AGENTS.md, CHANGELOG.md, README.md, package.json
    src/
      index.ts
      lib/    # discovery, runtime, metadata, drift, tool planning, wizard, etc.
      tools/  # create, add-capability, run, list, resolve, check-drift
      templates/
    scripts/, tests/
  pi-subagents/
    AGENTS.md, README.md, package.json
    index.ts
    src/lib/  # adk-delegation-advice, adk-delegation-remediation
    tests/
  shared/
    adk-metadata-schema/
      index.ts, fixtures.ts, schema-validation.test.ts
      README.md, package.json
  agents/                                  # default output dir for create_adk_agent
  sandbox/                                 # scratch area
```

Each extension is independent. Cross-extension integration uses the globalThis safe tool registry and the shared metadata schema contract.

## Adding a new extension

1. Create a new directory at the repo root with a short kebab-case name.
2. Copy the template from `templates-for-dir.md` into `<extension>/AGENTS.md` and fill in the placeholders.
3. Add a `package.json` with a `pi.extensions` entry pointing to the main file.
4. Add a `README.md` documenting purpose, installation, commands/tools, and security notes.
5. Add the extension entry to the table above.

## Design principles

- Extensions are small, focused, and composable.
- Prefer local/on-device workflows over hidden network dependencies.
- Use Pi's supported extension points: tools, commands, hooks, widgets, and confirmation flows.
- Require confirmation for destructive actions.
- Return structured, JSON-serializable outputs from tools.
- Keep side effects auditable.
- Cross-extension integration through tool registries, not hard imports.
- Metadata is additive and advisory — never load-bearing for core functionality.

## License

Private repository. See individual extensions for any specific terms.
