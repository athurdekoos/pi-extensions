# pi-google-adk

## Purpose
This directory contains the `pi-google-adk` Pi extension.

This extension must remain compatible with **`@mariozechner/pi-coding-agent`** and should follow the repository-wide rules defined in the parent `AGENTS.md`.

This file defines **local rules for this extension only**. If there is a conflict, prefer the more specific rule in this file for work inside this directory.

## Scope
- Keep changes scoped to this extension.
- Do not modify sibling extensions unless explicitly asked.
- Do not introduce shared code or shared packages unless explicitly asked.

## Extension Goal

- Primary use case: scaffold, discover, resolve, and run Python-first Google ADK agent projects locally.
- Main user workflow: create ADK agents via `create_adk_agent`, add capabilities, discover with `list_adk_agents`, execute with `run_adk_agent`. Cross-extension: pi-subagents delegates to named ADK agents via `resolve_adk_agent`.
- Key Pi integration points: `registerTool` for 5 tools; `registerSafeToolForSubagents` for cross-extension integration via globalThis registry.
- Required external tools or services: Python 3.10+, `google-adk` pip package, and a Google API key (all for the generated projects and `run_adk_agent`, not for the extension itself).
- Main safety considerations: path traversal prevention, overwrite protection, subprocess timeout enforcement, no global config writes.

## Source of Truth
Read these files before making changes:
- `README.md`
- `CHANGELOG.md`
- `package.json`
- `src/index.ts`
- any tests in `tests/`

Preserve documented behavior unless explicitly asked to change it.

## Local Structure

```text
pi-google-adk/
  AGENTS.md
  CHANGELOG.md
  README.md
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    # extension entry: registers all 5 tools
    lib/
      adk-discovery.ts          # agent discovery and name/path resolution
      adk-runtime.ts            # ADK CLI execution, output parsing
      adk-docs-mcp.ts           # ADK docs MCP config generation
      fs-safe.ts                # path safety utilities
      project-detect.ts         # ADK project detection
      safe-tool-registration.ts # load-order-resilient safe tool registry
      scaffold-manifest.ts      # .adk-scaffold.json manifest handling
      temp-replay.ts            # temp replay file for adk run --replay
      validators.ts             # input validation
    tools/
      create-adk-agent.ts       # scaffold new projects
      add-adk-capability.ts     # add capabilities to existing projects
      run-adk-agent.ts          # execute ADK agents
      list-adk-agents.ts        # discover agents in workspace
      resolve-adk-agent.ts      # resolve name/path to specific agent
    templates/
      python-basic/files.ts
      python-mcp/files.ts
      python-sequential/files.ts
      shared.ts
  scripts/
    verify.ts
  tests/
    helpers/
    unit/
    extension/
    integration/
    veracity/
```

## Local Coding Rules
- Keep the extension focused on scaffolding, discovery, and execution of ADK projects.
- All generated Python code must be template-driven, not AI-generated at runtime.
- Path safety: all filesystem operations must use `safePath()` or `safeWriteFile()` to prevent traversal.
- Subprocess safety: all `adk run` invocations must have a timeout.
- Output parsing: always fall back safely to raw stdout if structured parsing fails.
- Keep shell usage explicit and auditable.
- Validate tool inputs with schemas.

## Key Invariants

1. All paths are validated to stay within the workspace root. Path traversal is blocked.
2. Files are never overwritten unless `overwrite: true` is explicitly set.
3. No global config, credentials, or files outside the workspace are read or written.
4. `run_adk_agent` always returns both `final_output` (parsed) and `raw_stdout`/`raw_stderr` (complete).
5. `extractFinalOutput` never throws; it falls back to trimmed stdout on any parsing uncertainty.
6. Discovery scans `./agents/` only, one level deep. No recursive traversal.
7. Resolution order: path first (if query contains `/` or starts with `.`), then exact name, case-insensitive, prefix. Ambiguity is never silently resolved.
8. `registerSafeToolForSubagents` works regardless of load order relative to pi-subagents.
9. Scaffold manifest is informational only; deleting it does not break the generated project.

## Cross-Extension Integration

This extension integrates with pi-subagents through the globalThis safe tool registry:

- `run_adk_agent` and `resolve_adk_agent` are registered as safe tools via `registerSafeToolForSubagents()`
- Load-order resilient: immediate registration if pi-subagents is loaded, otherwise queued in `__piSubagents_pendingSafeTools`
- pi-subagents calls `resolve_adk_agent` via the safe tool registry — no direct import

**Do not hard-import pi-subagents logic.** The integration must remain tool-mediated.

## Tool and Command Rules
For any tool or command added here:
- use clear, stable names
- document purpose and expected inputs
- return structured outputs where possible
- provide actionable error messages
- require confirmation for destructive actions

Document registered tools, commands, hooks, and widgets in `README.md`.

## Safety Rules
- Treat this extension as capable of full local system access.
- Be conservative around file writes, shell execution, secrets, and credentials.
- Do not write outside the intended working scope unless explicitly required.
- `run_adk_agent` spawns a subprocess — enforce timeout, capture all output, handle cancellation.
- Do not pass credentials in command-line arguments; ADK agents load from `.env` files.

## Testing Rules

150 automated tests across unit, extension, integration, and veracity layers.

### Running

```bash
npm test              # all tests (excludes LLM)
npm run verify        # typecheck + verification suite
```

### Layer summary

| Layer | Tests | Speed |
|---|---|---|
| Unit | 108 | fast |
| Extension | 16 | fast |
| Integration | 8 | fast |
| Veracity | 10 | fast |
| Behavioral (run-adk-agent) | 6 | ~4s (CLI check) |

### When to add tests

- Any change to discovery or resolution: update `adk-discovery.test.ts`
- Any change to output parsing: update `adk-runtime.test.ts`
- Any change to safe tool registration: update `safe-tool-registration.test.ts`
- Any change to scaffolding templates: update `templates.test.ts`
- Any change to tool registration: verify `registration.test.ts` passes

## Validation Checklist
Before finishing work in this extension:
1. verify package shape and imports
2. verify the Pi entrypoint is correct
3. verify all 5 tools register with correct metadata
4. verify no obvious unsafe shell interpolation or path handling bugs
5. update `README.md` if behavior or setup changed
6. update `CHANGELOG.md` for user-visible changes
7. run `npm test` and verify all 150 tests pass
8. provide a concrete manual test path using Pi

Preferred manual run path:

```bash
pi -e ./src/index.ts
```

## Change Policy
- Prefer the smallest change that solves the request.
- Do not rename or move files unless necessary.
- Do not change public behavior unless explicitly requested.
- Do not add dependencies unless justified.
- If a larger refactor would help, propose it separately before doing it.
- Do not break the cross-extension integration contract (safe tool registration).

## Definition of Done
A change in this extension is done when:
- behavior matches the request
- `npm test` passes (150 tests)
- new tests protect intended behavior
- documentation is updated if needed
- no obvious dead code or placeholder comments remain
- the final summary explains changes and remaining risks

## Notes Specific to This Extension

- Supported platforms: any platform supported by `@mariozechner/pi-coding-agent`.
- Required CLI tools: `adk` (from `pip install google-adk`) for `run_adk_agent` only.
- The generated projects require Python 3.10+ and a Google API key.
- The `agents/` directory at the workspace root is the default output and discovery target.
- The `stdout`/`stderr` fields on `AdkRunResult` are deprecated aliases for `raw_stdout`/`raw_stderr`. Callers should migrate.
