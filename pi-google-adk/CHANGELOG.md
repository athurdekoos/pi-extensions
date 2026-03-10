# Changelog

## 0.3.0 — Phase 3: UX hardening

### Improvements

- **Output parsing**: `extractFinalOutput` now parses ADK CLI `[speaker]: content` turn markers, extracting the last agent response. Multi-line responses preserved. Falls back safely to trimmed stdout when no markers are found.
- **Result fields**: `AdkRunResult` now includes `raw_stdout` and `raw_stderr` for debugging. Old `stdout`/`stderr` fields kept as deprecated aliases.
- **Richer labels**: Discovery labels now include capabilities summary (e.g., `researcher (mcp) [web_search, code_exec] — ./agents/researcher`).

### Tests

- 150 automated tests (up from 114)
- Added output parsing tests: turn extraction, multi-line, multi-agent, noise filtering, fallback
- Added label tests: capabilities in labels, omission when empty

## 0.2.0 — Phase 2: Discovery and resolution

### New tools

- **`run_adk_agent`** — Execute an on-disk ADK project via `adk run --replay` and return its output. Validates project structure, checks CLI availability, enforces timeout, supports cancellation.
- **`list_adk_agents`** — Discover all ADK agent projects under `./agents/`. Returns name, path, template, capabilities, source, and label.
- **`resolve_adk_agent`** — Resolve a name or path to a specific ADK project. Supports exact, case-insensitive, and prefix matching. Returns `found`, `not_found`, or `ambiguous`.

### New libraries

- **`adk-discovery.ts`** — ADK project scanning and resolution logic.
- **`adk-runtime.ts`** — ADK CLI execution, project validation, output extraction.
- **`safe-tool-registration.ts`** — Load-order-resilient registration into pi-subagents safe tool registry.
- **`temp-replay.ts`** — Temp replay file management for `adk run --replay`.

### Cross-extension integration

- `run_adk_agent` and `resolve_adk_agent` registered as safe tools for pi-subagents.
- Load-order resilient: works whether pi-subagents loads before or after pi-google-adk.

## 0.1.0 — Phase 1: Scaffolding

### Tools

- `create_adk_agent` — scaffold Python ADK projects from three templates: `basic`, `mcp`, `sequential`
- `add_adk_capability` — add six capability types to existing projects: `custom_tool`, `mcp_toolset`, `sequential_workflow`, `eval_stub`, `deploy_stub`, `observability_notes`

### Features

- Template-driven, deterministic scaffolding with no AI-generated code at runtime
- Path traversal prevention and overwrite protection
- Scaffold manifest (`.adk-scaffold.json`) tracks template, model, and applied capabilities
- Idempotent capability application with duplicate detection
- Optional ADK docs MCP example config (project-local, not globally installed)
- Python syntax validated across all generated code

### Known Limitations

- `install_adk_skills` is a no-op (future hook)
- `tools=[...]` patching is regex-based, targeting generated code patterns
- Scaffold manifest is informational, not load-bearing
- No custom Pi renderers; tool output is plain JSON
