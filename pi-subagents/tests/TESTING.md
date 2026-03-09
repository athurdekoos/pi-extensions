# pi-subagents Test Suite

4-layer test suite for the `pi-subagents` extension.

## Running

```bash
cd pi-subagents
npm test          # vitest run (all tests)
npm run test:watch  # vitest in watch mode
```

## Test Layers

### 1. Unit Tests (`tests/unit/`)

Fast, pure-logic tests with no mocks or I/O.

| File | Protects |
|---|---|
| `child-prompt.test.ts` | Child system prompt always contains the task, forbids delegation, applies output style, includes files and success criteria when provided |
| `tool-resolution.test.ts` | Allowlist returns only named tools, always excludes `delegate_to_subagent`, empty allowlist yields nothing, unknown names are silently ignored |
| `recursion-guard.test.ts` | `childDepth` accessors work correctly, extension refuses to register when `childDepth > 0` |
| `schema-validation.test.ts` | Required `task` field enforced, optional fields validated, mode/outputStyle enums reject invalid values |

### 2. Extension-Level Tests (`tests/extension/`)

Tests around the registered tool behavior using mocked `createAgentSession`.

| File | Protects |
|---|---|
| `registration.test.ts` | Parent mode registers exactly `delegate_to_subagent`; child mode registers nothing |
| `tool-behavior.test.ts` | Recursion guard blocks (depth and signal), streaming updates forwarded, child session disposed on success/error/cancellation, errors surfaced honestly, mode defaults applied |

### 3. Integration Tests (`tests/integration/`)

Real SDK wiring without LLM calls.

| File | Protects |
|---|---|
| `session-wiring.test.ts` | `DefaultResourceLoader` with `noExtensions: true` works, `readOnlyTools`/`codingTools` have correct members, neither built-in set includes `delegate_to_subagent`, `SessionManager.inMemory` creates a valid manager, child tool surface matches mode + allowlist |

### 4. Veracity Trap Tests (`tests/veracity/`)

Proves actual tool use vs bluffing through hidden canary/nonce patterns.

| File | Protects |
|---|---|
| `trap-positive.test.ts` | Tool was called, result contains exact canary from child, derived canary works, decoy vs real canary distinguished, multiple runs with fresh nonces each produce unique results |
| `trap-negative.test.ts` | Tool absent/blocked/failed: no canary fabricated, error reported honestly, decoy in task not echoed as answer, empty child output reported truthfully |

## How Trap Tests Prove Real Tool Use

### Positive traps

1. A unique canary nonce is generated per test (e.g., `CANARY-1XY2Z-1`).
2. The mock child session returns text containing this canary.
3. The test asserts **both**:
   - `createAgentSession` was called exactly once (invocation telemetry)
   - The tool result text contains the exact canary string (semantic dependence)
4. Stronger variants use a **derived** canary (`DERIVED:...reversed...`) so the test cannot pass by echoing the raw input.
5. A **decoy** canary appears in the task prompt; the test asserts the result contains the real canary (from the tool), not the decoy.

### Negative traps

1. The same canary nonce is generated, but the tool is made to fail.
2. The test asserts **both**:
   - `createAgentSession` was not called, or it failed as expected
   - The result does **not** contain the canary or any derived form
   - The result contains an honest error message
3. A decoy-in-task variant confirms the error path does not leak the decoy into the answer.

### Gold standard

- Tool call occurred (or provably did not)
- Final answer depends on hidden tool-only information
- Without the tool, the answer cannot be correct
- Derived canary results make accidental pass impossible

## Test Helpers

| File | Purpose |
|---|---|
| `helpers/mock-extension-api.ts` | Fake `ExtensionAPI` that captures registrations; mock `ExtensionContext` |
| `helpers/fake-tool.ts` | Factory for `ToolDefinition` objects used in allowlist tests |
| `helpers/nonce.ts` | Deterministic canary generator with derive and decoy functions |

## Minimal Refactors Made

The following were exported from `index.ts` to enable direct unit testing:

- `buildChildSystemPrompt()` — child prompt construction
- `resolveAllowedCustomTools()` — allowlist resolution
- `DelegateParamsSchema` — parameter schema
- `DelegateParams` — parameter type
- `_getChildDepth()`, `_setChildDepth()` — test-only depth accessors
- `_addChildSignal()`, `_removeChildSignal()` — test-only signal accessors

All test-only exports are prefixed with `_` and documented as test-only in the source.

## What Is Not Covered

- **Live LLM calls**: No tests invoke a real model. Veracity is proven structurally.
- **Real filesystem I/O by child tools**: Built-in tools (read, bash, etc.) are not exercised.
- **Concurrent parent sessions**: The recursion guard design supports concurrency, but tests are sequential.
- **Model override resolution**: The `modelOverride` parameter path is not tested with a real `ModelRegistry`.
- **globalThis safe tool registration**: The `__piSubagents_registerSafeTool` global is tested indirectly through `resolveAllowedCustomTools`.
