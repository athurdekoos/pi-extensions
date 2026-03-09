# pi-gh

## Purpose
This directory contains the `pi-gh` Pi extension.

This extension provides structured GitHub CLI tools to the Pi Coding Agent. It wraps `gh` CLI operations as typed Pi tools with normalized JSON outputs and confirmation gates for destructive actions.

This extension must remain compatible with `@mariozechner/pi-coding-agent` and follows the repository-wide rules defined in the parent `AGENTS.md`.

## Scope
- Keep changes scoped to this extension.
- Do not modify sibling extensions.
- Do not introduce shared code or shared packages.
- All operations target the current repository only.
- No arbitrary `owner/repo` targeting.

## Extension Goal
- Primary use case: expose GitHub CLI operations as structured Pi tools.
- Main user workflow: issue, PR, and Actions management from within Pi.
- Key Pi integration points: `pi.registerTool`, `pi.exec`, `ctx.ui.confirm`.
- Required external tools: `gh` CLI, authenticated via `gh auth login`.
- Main safety considerations: confirmation required for destructive mutations; no shell interpolation; no arbitrary command passthrough.

## Source of Truth
Read these files before making changes:
- `README.md`
- `package.json`
- `index.ts`
- `tests/pi-gh.test.ts`
- `tests/helpers.ts`
- `tests/test-agent-routing.sh`
- `tests/test-agent-routing2.sh`
- `tests/run-all.sh`

Preserve documented behavior unless explicitly asked to change it.

## Local Structure

```
pi-gh/
  AGENTS.md
  README.md
  package.json
  index.ts
  tests/
    pi-gh.test.ts
    helpers.ts
    test-agent-routing.sh
    test-agent-routing2.sh
    run-all.sh
```

## Local Coding Rules
- Structured GitHub CLI operations only.
- No arbitrary shell passthrough.
- No raw free-form `gh` arguments from the model.
- Current repo only.
- Normalized JSON outputs (`ok/error` contract).
- Use safe argument arrays for all `gh` calls.
- Use `StringEnum` for operation enums.
- Use `pi.exec` for all shell execution.
- Keep helpers exported for testability.
- Truncate large outputs to prevent context blowup.

## Tool and Command Rules
- Tools: `gh_repo`, `gh_issue`, `gh_pr`, `gh_actions`.
- Each tool accepts a typed `operation` parameter.
- Operations are explicitly allowlisted in the schema.
- Return structured JSON with `ok: true/false`.
- Provide actionable error messages with `suggested_fix`.

## Safety Rules
- High-impact actions require confirmation via `ctx.ui.confirm`:
  - issue close, reopen
  - PR close, reopen, merge, request_reviewers
  - workflow cancel, dispatch
- No confirmation for read operations, create, edit, comment, rerun.
- If user declines, return `USER_CANCELLED` error, do not throw.
- No shell string interpolation.
- No writes outside this extension directory.

## Testing Rules
Protect:
1. Preflight detection (gh missing, auth missing, repo missing).
2. Confirmation gating for destructive operations.
3. Normalized output contract.
4. Agent tool routing (extension tools invoked, not bypassed).

Two test tiers:
- **Unit tests** (`tests/pi-gh.test.ts`): Mock `pi.exec`, no live `gh` calls. Run via `npx vitest run`.
- **Agent-routing e2e** (`tests/test-agent-routing.sh`, `tests/test-agent-routing2.sh`): External bash harnesses with fake `gh` binaries. Launch Pi in non-interactive mode with only the pi-gh extension loaded and all built-in tools disabled. Assert canary markers in agent output and fake-gh invocation logs. Include negative tests for auth failure and missing gh. Run individually or via `bash tests/run-all.sh`.

Run all tests:
```bash
bash tests/run-all.sh
```

## Validation Checklist
Before finishing work:
1. Verify package shape and imports.
2. Verify Pi entrypoint is correct (`pi.extensions: ["./index.ts"]`).
3. Verify tools, schemas, and operations are wired correctly.
4. Verify no unsafe shell interpolation.
5. Run all tests: `bash tests/run-all.sh`.
6. Update `README.md` if behavior or setup changed.
7. Manual test: `pi -e ./index.ts` from a GitHub repo directory.

## Change Policy
- Prefer the smallest change that solves the request.
- Do not rename or move files unless necessary.
- Do not change public tool names or output contract unless explicitly requested.
- Do not add dependencies unless justified.

## Definition of Done
- Behavior matches the request.
- Tests pass.
- New tests protect intended behavior.
- README is updated if behavior changed.
- No dead code or placeholder comments.
- Summary explains changes and remaining risks.

## Notes Specific to This Extension
- Requires `gh` CLI installed and authenticated.
- Supported platforms: any platform where `gh` runs.
- Output format: JSON with `ok/error` contract.
- All `gh` commands use `--json` or `--jq` flags where available.
- Performance: each tool call runs preflight (3 exec calls), then the operation.
