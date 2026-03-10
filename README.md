# pi-extensions

A collection of extensions for [`@mariozechner/pi-coding-agent`](https://github.com/badlogic/pi-mono). Each extension is a self-contained package that adds tools, commands, or integrations to Pi.

## Extensions

| Extension | Description | Status |
|-----------|-------------|--------|
| [pi-clear](./pi-clear/) | `/clear` command to start a fresh session, optionally carrying over the editor draft | Ready |
| [pi-gh](./pi-gh/) | Structured GitHub CLI tools for issues, PRs, Actions, and repo info | Ready |
| [pi-subagents](./pi-subagents/) | Sub-agent orchestration with bounded child sessions and ADK agent delegation | In Progress |
| [pi-google-adk](./pi-google-adk/) | Scaffold, discover, resolve, and run Python-first Google ADK agent projects | In Progress |

## Cross-extension integration

**pi-google-adk** and **pi-subagents** integrate through a tool-mediated interface. No hard imports cross the extension boundary.

When both extensions are loaded:

1. pi-google-adk registers `run_adk_agent` and `resolve_adk_agent` as safe tools for subagent sessions
2. pi-subagents can accept an `agent` parameter to delegate to a named ADK agent
3. Resolution uses pi-google-adk's discovery logic (scanning `./agents/` for ADK projects)
4. The resolved agent's project path is injected into the child's instructions
5. `run_adk_agent` is auto-allowlisted so the child can execute the ADK agent

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
│   (run_adk_agent     │              │                          │
│    auto-allowlisted) │              │ adk-discovery (scanning) │
└─────────────────────┘              └──────────────────────────┘
        ↕ globalThis safe tool registry (no hard imports)
```

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

### pi-subagents

Adds a `delegate_to_subagent` tool that lets the primary agent delegate bounded tasks to ephemeral child sessions created in-process. Children run in `read_only` or `coding` mode with an explicit built-in tool set. Custom tools are only available if explicitly allowlisted via `safeCustomTools`. Recursive delegation is blocked by two layers of defense (no-extension child loader + depth counter).

**ADK integration (Phase 2+3):** When pi-google-adk is also loaded, the `agent` parameter enables name-based delegation to discovered ADK agents. Resolution supports exact, case-insensitive, and prefix matching with interactive disambiguation. Structured error handling distinguishes provider-unavailable, execution-unavailable, not-found, ambiguous, and interactive-selection-required states.

187 automated tests across 8 layers.

Requires `@mariozechner/pi-coding-agent` and `@sinclair/typebox`. No external CLIs.

### pi-google-adk

Registers five tools for the full ADK agent lifecycle:

| Tool | Purpose |
|------|---------|
| `create_adk_agent` | Scaffold a new ADK project from a template (basic, mcp, sequential) |
| `add_adk_capability` | Add capabilities to an existing project (custom_tool, mcp_toolset, etc.) |
| `run_adk_agent` | Execute an on-disk ADK project via `adk run --replay` and return its output |
| `list_adk_agents` | Discover all ADK projects under `./agents/` |
| `resolve_adk_agent` | Resolve a name or path to a specific ADK project |

All scaffolding output is deterministic and template-driven. No AI-generated code at runtime. ADK runtime execution parses CLI output into a clean `final_output` with `raw_stdout`/`raw_stderr` preserved for debugging.

150 automated tests.

Requires `@mariozechner/pi-coding-agent` and `@sinclair/typebox`. Python 3.10+ and `google-adk` are needed to run the generated projects, not the extension itself.

## Repository layout

```text
pi-extensions/
  AGENTS.md                                # repository-wide coding and design rules
  README.md                                # this file
  templates-for-dir.md                     # AGENTS.md template for new extensions
  pi-cli-extension-testing-requirements.md # repository testing standard
  .gitignore
  pi-clear/
    AGENTS.md
    package.json
    index.ts
    README.md
  pi-gh/
    AGENTS.md
    package.json
    index.ts
    README.md
    tests/
  pi-subagents/
    AGENTS.md
    package.json
    index.ts
    README.md
    vitest.config.ts
    tests/
      TESTING.md
      helpers/
      unit/
      extension/
      integration/
      veracity/
      smoke/
      llm/
  pi-google-adk/
    AGENTS.md
    CHANGELOG.md
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts
      lib/
        adk-discovery.ts
        adk-runtime.ts
        fs-safe.ts
        project-detect.ts
        safe-tool-registration.ts
        scaffold-manifest.ts
        temp-replay.ts
        validators.ts
      tools/
        create-adk-agent.ts
        add-adk-capability.ts
        run-adk-agent.ts
        list-adk-agents.ts
        resolve-adk-agent.ts
      templates/
    scripts/
    tests/
    README.md
  agents/                                  # default output dir for create_adk_agent
  sandbox/                                 # scratch area
```

Each extension is independent. Cross-extension integration uses the globalThis safe tool registry — no shared code or hard imports.

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

## License

Private repository. See individual extensions for any specific terms.
