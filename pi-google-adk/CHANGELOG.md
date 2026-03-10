# Changelog

## 0.7.0 — Release cleanup

### Improvements

- Documentation alignment across all packages — test counts, tool counts, terminology, examples
- Added current workflow guide to top-level README
- Added contributor architecture notes
- Updated AGENTS.md for both packages with accurate file listings and test counts
- Removed stale pre-redesign wording and counts
- Added release smoke-test notes

## 0.6.0 — Phase 5B: Delegation-time remediation UX

### New in pi-subagents

- **Delegation remediation guidance** — when tool mismatches are detected, produces actionable remediation: exact `safeCustomTools` suggestions, missing-extension next steps, concise user messaging
- **Interactive confirm/warn** — lightweight TUI dialog when meaningful mismatches are detected (not shown on happy-path delegations)
- **Structured remediation actions** — `add_safe_custom_tools`, `load_missing_extension`, `continue_with_limited_tools`, `review_project_tool_plan`
- **Non-interactive structured guidance** — remediation returned in result for SDK/CI use without prompts
- **User authority preserved** — user-provided `safeCustomTools` are never mutated; all suggestions are advisory

### Tests

- 34 new tests for remediation model, user authority, missing-extension guidance, output formatting, prompt text, JSON serializability, edge cases

## 0.5.0 — Phase 5A: Metadata schema hardening

### New shared package

- **`shared/adk-metadata-schema/`** — canonical metadata contract with types, validation, normalization, and disk reader
- Explicit `schema_version` field (current: `"1"`) with forward/backward compatibility
- Unknown additive fields preserved in `_unknown_fields`, never stripped
- Structured `ValidationResult` with `ok`/`warnings`/`errors`, never throws

### Changes

- Both pi-google-adk and pi-subagents now import types from the shared contract
- Eliminated mirrored type definitions that were a maintenance seam
- 37 tests in the shared package; cross-package consistency tests in both consumers

## 0.4.1 — Phase 4B: Metadata-aware delegation advice

### New in pi-subagents

- **Delegation advice** — when delegating to an ADK agent, reads `.pi-adk-metadata.json` and produces an advisory summary
- Surfaces recommended vs effective safe custom tools, detected vs missing extension tools, Pi Mono profile, ADK-native tool patterns
- Advisory-first: never auto-grants tools or blocks delegation; warnings preferred over refusal
- Graceful degradation: no metadata → no advice; malformed → safe defaults

### Tests

- Tests for metadata reading, recommendation logic, extension detection, summary formatting, non-regression

## 0.4.0 — Phase 4A: Sample drift detection

### New tools

- **`check_adk_sample_drift`** — detect whether an imported official sample has drifted relative to upstream. Reports `up_to_date`, `upstream_updated`, `local_modified`, or `diverged`. Does not auto-update.

### New libraries

- **`sample-drift.ts`** — drift classification logic using three-way tree hash comparison
- **`tree-hash.ts`** — deterministic directory tree hashing with configurable ignore patterns

### Features

- Interactive project picker when no target specified and UI is available
- Additive drift tracking metadata in `.pi-adk-metadata.json` (`tracking` section)
- Verbose mode with per-file change detail
- Supports graceful fallback when commit hash is missing from provenance

### Tests

- 360 automated tests (up from 150)
- Added tree hash, sample drift, drift behavior, creation metadata, project detect tests

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
