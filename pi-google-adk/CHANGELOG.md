# Changelog

## 1.0.0 — Breaking: Legacy compatibility removal

### Breaking changes

- **`scaffold-manifest.ts` deleted.** The `.adk-scaffold.json` manifest module is fully removed. No new manifests are created and no existing manifests are read.
- **`.adk-scaffold.json` no longer a detection signal.** Project detection, discovery, and resolution no longer recognize `.adk-scaffold.json`. Only `.pi-adk-metadata.json` and heuristic detection (`.env.example`, agent subdirectories) are supported.
- **Deprecated `stdout` / `stderr` aliases removed from `AdkRunResult`.** Only `raw_stdout` and `raw_stderr` remain. Callers using the deprecated aliases must migrate.
- **`capabilities` field removed from `DiscoveredAgent`.** The `capabilities` list was populated only from the legacy manifest; it has been removed from the discovery result type.
- **`source` field on `DiscoveredAgent` changed.** Now `"pi-metadata" | "heuristic"` instead of `"manifest" | "heuristic"`.
- **`add_adk_capability` no longer writes to `.adk-scaffold.json`.** Capability additions still work but do not update any manifest file.
- **`scripts/verify.ts` and `npm run verify` removed.** The legacy verification script referenced removed template-based scaffolding. Use `npm run typecheck` and `npm test` instead.
- **`scripts/` directory removed from package distribution.**

### What is NOT affected

- `native_app`, `native_config`, and `official_sample` creation modes work exactly as before
- Discovery via `.pi-adk-metadata.json` is unchanged
- Heuristic detection via `.env.example` and agent subdirectories is unchanged
- Runtime execution, drift detection, delegation, and tool planning are unchanged
- Legacy mode/template migration errors still work (Phase A behavior preserved)

### Migration guidance

| Old usage | Replacement |
|---|---|
| `result.stdout` / `result.stderr` | `result.raw_stdout` / `result.raw_stderr` |
| Detection via `.adk-scaffold.json` | Use `.pi-adk-metadata.json` or ensure heuristic signals exist |
| `agent.capabilities` from discovery | No replacement — capability tracking via manifest is removed |
| `npm run verify` | `npm run typecheck && npm test` |

### Tests

- 351 automated tests (down from 363; removed 8 scaffold-manifest tests, 4 legacy manifest integration tests, updated remaining tests)
- Added negative test proving `.adk-scaffold.json` alone is not a detection signal
- Added test proving `AdkRunResult` has no deprecated `stdout`/`stderr` aliases
- All discovery/detection/runtime/integration/veracity tests updated to use `.pi-adk-metadata.json`

## 0.9.1 — Phase C: Documentation and example cleanup

### Changes

- **Documentation fully migrated to post-legacy world.** All user-facing docs, examples, and contributor guidance now describe only the three supported creation modes: `native_app`, `native_config`, and `official_sample`.
- **Migration guide added to README.** Explicit mapping from old legacy modes/templates to modern equivalents, with clear explanation of what still works for existing projects and what has been removed.
- **Stale legacy wording removed.** Removed references to legacy templates as an active/available path from: root README, pi-google-adk README, AGENTS.md, index.ts comments, and repository layout.
- **Contributor architecture notes updated.** AGENTS.md and README now accurately reflect the current codebase: no template files, no scaffold generation code, scaffold-manifest.ts retained only for legacy project compatibility and test helpers.
- **Strikethrough template test row removed from test coverage table.** Deleted rather than carried as visual noise.
- **CHANGELOG Phase A entry corrected.** Fixed stale note that said "Legacy template files are still in the codebase" — they were removed in Phase B.

### What is NOT affected

- No code changes beyond comment fixes in `src/index.ts`
- No behavior changes to any tool
- No changes to tests
- Legacy project compatibility is fully preserved

## 0.9.0 — Phase B: Legacy scaffold implementation removal

### Removed

- **Legacy scaffold execution path removed from `create_adk_agent`.** The internal `executeLegacyCreate()` function, template scaffolding helpers (`scaffoldBasic`, `scaffoldMcp`, `scaffoldSequential`), `validateTargetPath()`, and the `CreateMode` union type have been deleted. No internal code path for Pi-owned scaffold generation remains.
- **Template files deleted.** `src/templates/` directory removed entirely: `python-basic/files.ts`, `python-mcp/files.ts`, `python-sequential/files.ts`, `shared.ts`. These were only used by the removed legacy creation path.
- **Template unit tests deleted.** `tests/unit/templates.test.ts` removed (tested the deleted template files).
- **Template imports removed from test fixtures.** Veracity and integration tests that previously imported template files for project fixture setup now use inline content.

### What is NOT affected

- `native_app`, `native_config`, and `official_sample` creation modes work exactly as before
- Legacy mode/template inputs still produce clear migration errors (Phase A behavior preserved)
- Existing legacy projects on disk remain discoverable and runnable — `.adk-scaffold.json` manifest reading, project detection, discovery, and resolution are unchanged
- `add_adk_capability` still works on legacy-created projects
- `scaffold-manifest.ts` is retained for reading existing manifests and tracking capabilities
- Discovery, runtime, drift detection, and delegation are unchanged
- 363 automated tests pass (12 removed with deleted template tests)

## 0.8.0 — Phase A: Legacy scaffolding removal from public API

### Breaking changes

- **`create_adk_agent` no longer accepts legacy Pi-owned scaffolding modes.** The `legacy_basic`, `legacy_mcp`, and `legacy_sequential` mode values are rejected with a clear migration error. Use `native_app`, `native_config`, or `official_sample` instead.
- **Deprecated `template` parameter removed from the public schema.** `template=basic`, `template=mcp`, and `template=sequential` are rejected with migration guidance pointing to the appropriate supported mode.
- **`install_adk_skills` parameter removed from the public schema.** It was a no-op future hook.
- **`add_adk_docs_mcp` parameter removed from the public schema.** It was only used by legacy scaffold modes.

### Migration guidance

| Old usage | New usage |
|---|---|
| `mode=legacy_basic` or `template=basic` | `mode=native_app` |
| `mode=legacy_mcp` or `template=mcp` | `mode=native_app` + `add_adk_capability` with `mcp_toolset` |
| `mode=legacy_sequential` or `template=sequential` | `mode=native_app` or `mode=official_sample` |

### What is NOT affected

- `native_app`, `native_config`, and `official_sample` modes work exactly as before
- Discovery, runtime, drift detection, and delegation are unchanged
- Existing legacy projects on disk remain discoverable and runnable
- Legacy template files were removed in Phase B (0.9.0)

### Tests

- 375 automated tests (up from 360)
- Added 17 migration error tests covering all legacy modes, template values, error quality, schema contract, and regression guards
- Updated existing tests: integration and veracity tests use direct scaffolding for fixtures instead of the removed public API path

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
