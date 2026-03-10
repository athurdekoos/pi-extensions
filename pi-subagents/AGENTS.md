# pi-subagents

## Purpose
This directory contains the `pi-subagents` Pi extension.

This extension must remain compatible with **`@mariozechner/pi-coding-agent`** and should follow the repository-wide rules defined in the parent `AGENTS.md`.

This file defines **local rules for this extension only**. If there is a conflict, prefer the more specific rule in this file for work inside this directory.

## Scope
- Keep changes scoped to this extension.
- Do not modify sibling extensions unless explicitly asked.
- Do not introduce shared code or shared packages unless explicitly asked.

## Extension Goal

- Primary use case: delegate bounded subtasks to an in-process child agent session with scoped tools.
- Main user workflow: the parent LLM calls `delegate_to_subagent` with a task, mode, and optional tool allowlist; the child runs and returns a result.
- Key Pi integration points: `registerTool`, `createAgentSession`, `DefaultResourceLoader`, `SessionManager`, `readOnlyTools`/`codingTools`.
- Required external tools or services: none beyond the Pi SDK and a configured LLM provider.
- Main safety considerations: recursive delegation prevention (two-layer guard), explicit tool allowlisting, child cannot inherit parent extensions.

## Source of Truth
Read these files before making changes:
- `README.md`
- `package.json`
- `index.ts`
- `tests/TESTING.md`
- any tests in `tests/`

Preserve documented behavior unless explicitly asked to change it.

## Local Structure

```text
pi-subagents/
  AGENTS.md
  README.md
  package.json
  index.ts
  vitest.config.ts
  tests/
    TESTING.md
    helpers/
      mock-extension-api.ts
      fake-tool.ts
      nonce.ts
      parallel-harness.ts
    unit/
      child-prompt.test.ts
      tool-resolution.test.ts
      recursion-guard.test.ts
      schema-validation.test.ts
    extension/
      registration.test.ts
      tool-behavior.test.ts
    integration/
      session-wiring.test.ts
      parallel-subagents.test.ts
    veracity/
      trap-positive.test.ts
      trap-negative.test.ts
      parallel-subagents-traps.test.ts
    smoke/
      extension-discovery.test.ts
      post-load-invocation.test.ts
    llm/
      real-veracity.test.ts
```

## Local Coding Rules
- Keep the extension focused on a single clear responsibility.
- Keep exported tools and commands narrowly scoped.
- Prefer deterministic outputs.
- Avoid hidden state or surprising side effects.
- Keep shell usage explicit and auditable.
- Validate tool inputs with schemas.
- Avoid unnecessary dependencies.
- Prefer small helper modules over large abstractions.

## Exported Internals

The following are exported from `index.ts` for testability and potential reuse:

- `buildChildSystemPrompt(params)` -- constructs the child system prompt.
- `resolveAllowedCustomTools(parentTools, registry, allowedNames)` -- filters the safe tool registry by allowlist, always excludes `delegate_to_subagent`.
- `DelegateParamsSchema` -- TypeBox parameter schema.
- `DelegateParams` -- TypeScript type for the parameters.
- `_getChildDepth()`, `_setChildDepth(n)` -- test-only accessors for the recursion depth counter.
- `_addChildSignal(signal)`, `_removeChildSignal(signal)` -- test-only accessors for the active child signal set.

Test-only exports are prefixed with `_`. Do not use them in production code paths.

## Key Invariants

These properties must hold at all times. Tests enforce them.

1. The child session never has `delegate_to_subagent` in its tool set.
2. The child session is created with `noExtensions: true` -- no extensions load into the child.
3. `delegate_to_subagent` is always excluded from `resolveAllowedCustomTools`, even if explicitly listed.
4. An empty `safeCustomTools` array (or omitted) means the child gets zero custom tools.
5. Unknown tool names in the allowlist are silently ignored.
6. The child system prompt always forbids delegation and instructs the child to report when a tool is unavailable.
7. `childDepth` is incremented before child execution and decremented in the `finally` block.
8. The child session is always disposed in the `finally` block (success, error, or cancellation).
9. Errors from the child are surfaced honestly in the tool result, not hidden.
10. Cancellation (aborted signal) is reported as cancellation, not as an error or success.

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
- Require explicit confirmation before destructive or privileged actions.
- Call out security implications in the README when relevant.

## Testing Rules

The test suite has 7 layers (118 tests). See `tests/TESTING.md` for full documentation.

### Running

```bash
npm test              # fast tests only (excludes LLM, ~4s)
npm run test:all      # all tests including real-LLM (~17s)
npm run test:llm      # real-LLM veracity tests only (~15s)
npm run test:smoke    # extension discovery/loading smoke tests
```

### Layer summary

| Layer | Dir | Tests | Speed |
|---|---|---|---|
| Unit | `tests/unit/` | 36 | fast |
| Extension | `tests/extension/` | 18 | fast |
| Integration | `tests/integration/` | 21 | fast |
| Veracity (mock) | `tests/veracity/` | 23 | fast |
| Smoke | `tests/smoke/` | 19 | fast |
| Veracity (LLM) | `tests/llm/` | 5 | slow (~15s, requires API key) |

### When to add tests

- Any change to `buildChildSystemPrompt` or `resolveAllowedCustomTools`: add or update unit tests.
- Any change to the `execute` function: add or update extension-level tests.
- Any change to session construction or tool wiring: add or update integration tests.
- Any change to error handling or result propagation: verify veracity trap coverage.
- Any change to `package.json` pi manifest, entry point, or export structure: verify smoke tests pass.

### Veracity test design

Veracity tests use hidden canary nonces to prove tool results flow through correctly and are not fabricated.

- **Positive traps**: tool returns a SHA-256-derived canary; test asserts invocation telemetry AND that the final answer contains the exact derived value.
- **Negative traps**: tool is absent/broken/blocked; test asserts the canary does not appear and failure is reported honestly.
- **LLM traps**: same pattern but with real model inference (claude-haiku-4-5). Auto-skip when no API key is available.

Do not weaken the veracity tests. If a change breaks them, the change is suspect.

## Validation Checklist
Before finishing work in this extension:
1. verify package shape and imports
2. verify the Pi entrypoint is correct
3. verify tools, commands, and schemas are wired correctly
4. verify no obvious unsafe shell interpolation or path handling bugs
5. update `README.md` if behavior or setup changed
6. run `npm test` (fast) and `npm run test:all` (full) and verify all pass
7. provide a concrete manual test path using Pi

Preferred manual run path:

```bash
pi -e ./index.ts
```

## Change Policy
- Prefer the smallest change that solves the request.
- Do not rename or move files unless necessary.
- Do not change public behavior unless explicitly requested.
- Do not add dependencies unless justified.
- If a larger refactor would help, propose it separately before doing it.
- Do not weaken or remove veracity trap tests without explicit justification.

## Definition of Done
A change in this extension is done when:
- behavior matches the request
- `npm run test:all` passes (122 tests)
- new tests protect intended behavior
- documentation is updated if needed
- no obvious dead code or placeholder comments remain
- the final summary explains changes and remaining risks

## Communication
Before coding:
- summarize the local problem
- state assumptions
- propose the minimal plan

After coding:
- summarize what changed in this extension
- list tests run
- note what was not covered
- call out risks or follow-up work

## Notes Specific to This Extension

- Supported platforms: any platform supported by `@mariozechner/pi-coding-agent`.
- Required CLI tools: none.
- The `__piSubagents_registerSafeTool` global is the only cross-extension integration point.
- The child session inherits the parent's API key and model; there is no separate auth for children.
- The real-LLM tests use `claude-haiku-4-5` via Anthropic OAuth. They auto-skip if no key is available. To change the model, edit `MODEL_ID` in `tests/llm/real-veracity.test.ts`.
