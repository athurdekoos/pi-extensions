# pi-extensions

A collection of extensions for [`@mariozechner/pi-coding-agent`](https://github.com/badlogic/pi-mono). Each extension is a self-contained package that adds tools, commands, or integrations to Pi.

## Extensions

| Extension | Description | Status |
|-----------|-------------|--------|
| [pi-clear](./pi-clear/) | `/clear` command to start a fresh session, optionally carrying over the editor draft | Ready |
| [pi-gh](./pi-gh/) | Structured GitHub CLI tools for issues, PRs, Actions, and repo info | Ready |
| [pi-subagents](./pi-subagents/) | Sub-agent orchestration with bounded child sessions | Ready |
| [pi-google-adk](./pi-google-adk/) | Scaffold Python-first Google ADK projects locally | Ready |

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

Requires `@mariozechner/pi-coding-agent` and `@sinclair/typebox`. No external CLIs.

### pi-google-adk

Registers two tools — `create_adk_agent` and `add_adk_capability` — for scaffolding Python-first Google ADK projects. Supports three templates (`basic`, `mcp`, `sequential`) and six add-on capabilities (`custom_tool`, `mcp_toolset`, `sequential_workflow`, `eval_stub`, `deploy_stub`, `observability_notes`). All output is deterministic and template-driven with no AI-generated code at runtime. Paths are validated to stay within the workspace.

Requires `@mariozechner/pi-coding-agent` and `@sinclair/typebox`. Python 3.11+ and `google-adk` are needed to run the generated projects, not the extension itself.

## Repository layout

```text
pi-extensions/
  AGENTS.md                                # repository-wide coding and design rules
  README.md                                # this file
  templates-for-dir.md                     # AGENTS.md template for new extensions
  pi-cli-extension-testing-requirements.md # repository testing standard
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
  pi-google-adk/
    AGENTS.md
    CHANGELOG.md
    package.json
    tsconfig.json
    vitest.config.ts
    src/
    scripts/
    tests/
    README.md
```

Each extension is independent. There is no shared code between extensions.

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

## License

Private repository. See individual extensions for any specific terms.
