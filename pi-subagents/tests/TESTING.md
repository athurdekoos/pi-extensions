# pi-subagents Test Suite

8-layer test suite (187 tests) for the `pi-subagents` extension.

## Running

```bash
cd pi-subagents
npm test              # fast tests only (excludes LLM)
npm run test:all      # all tests including real-LLM
npm run test:llm      # real-LLM tests only
npm run test:unit     # unit tests only
npm run test:extension # extension-level tests only
npm run test:integration # integration tests only
npm run test:veracity # mock veracity traps only
npm run test:smoke    # extension discovery/loading smoke tests
npm run test:watch    # vitest in watch mode
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
| `adk-agent-resolution.test.ts` | ADK resolution via tool registry, provider-unavailable vs not-found distinction, execution-unavailable detection, non-interactive selection-required behavior, prompt agent selection with/without UI, structured result fields, auto-allowlist dedup and non-mutation, Phase 3 status semantics |
| `pending-safe-tools.test.ts` | Load-order-resilient safe tool registration via pending queue |

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
| `safe-tool-traps.test.ts` | Safe custom tool allowlist enforcement: approved tool canary flows through, unapproved excluded, mixed/multi-tool isolation, anti-fabrication with decoys, tool failure reported honestly, unknown tool not resolved |

### 5. Smoke Tests (`tests/smoke/`)

Extension discovery and loading verification through the real pi loader.

| File | Protects |
|---|---|
| `extension-discovery.test.ts` | Pi discovers and loads `pi-subagents` through `discoverAndLoadExtensions`; `delegate_to_subagent` is available after real loading; tool is absent when extension path is not provided; `.pi/extensions` directory discovery works; symlinked packages are discoverable; `pi.extensions` manifest is respected; tool metadata and schema shape are correct after real loading |
| `post-load-invocation.test.ts` | The loaded tool can actually be invoked through the real-loaded runtime surface; invocation reaches the real tool body (not a stub or guard rejection); both `read_only` and `coding` modes reach distinct branches; separate loads produce independently invocable tools; tool metadata is non-trivial (guards against degenerate stubs) |

#### What these smoke tests prove

- The extension package is correctly shaped for pi's real loader (package.json manifest, entry point, export structure).
- `discoverAndLoadExtensions` can find and load the extension from a configured path, a `.pi/extensions` symlink, or a package root with `pi.extensions` manifest.
- The tool `delegate_to_subagent` is registered and has the correct schema when loaded through the real discovery path.
- The extension is NOT discovered when it is not on any configured or standard path.
- **Post-load invocation**: the registered tool's `execute()` can be called after real discovery/loading, reaches the real tool body, and returns a structured result (success or honest runtime error). This proves the full chain: discover → load → register → expose → invoke.

#### What they do NOT prove

- Behavioral correctness of the tool (covered by extension-level and veracity tests).
- Real LLM interaction (covered by LLM veracity tests).
- Child session construction details (covered by integration tests).

#### How they differ from direct-import tests

The existing extension and integration tests import the extension module directly (`from "../../index.js"`) and exercise the logic in-process. This is sufficient for behavioral testing but cannot detect packaging problems (wrong entry point, missing exports, broken manifest, loader incompatibility).

The smoke tests never import the extension source. They reference it only as a filesystem path target for `discoverAndLoadExtensions`. If the extension cannot be discovered and loaded by the real pi loader, these tests fail even if the direct-import tests pass.

The post-load invocation tests go one step further: they prove the loaded tool is not merely present but actually callable, and that the invocation reaches the real implementation body. If the tool can be discovered but not invoked, these tests fail.

A self-check guard in each smoke test file verifies at module load time that no direct import of the extension source is present in the test code (excluding comments).

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

### 6. Safe Custom Tool Veracity Tests

Tests that prove safe custom tool enforcement end-to-end through the `delegate_to_subagent` flow using hidden canary nonces.

#### Mock-level (`tests/veracity/safe-tool-traps.test.ts`)

| Scenario | Tests | What It Protects |
|---|---|---|
| 1. Approved tool positive trap | 2 | Canary flows from registered safe tool through child to parent result; derived canary present, raw nonce absent |
| 2. Unapproved tool negative trap | 2 | Registered but unallowed tool excluded from customTools; no canary in result; omitted allowlist yields no custom tools |
| 3. Mixed approved/blocked | 1 | Approved tool canary present, unapproved absent; config and invocation telemetry both correct |
| 4. Anti-fabrication with decoy | 1 | Real canary from tool used, decoy planted in task rejected; exactly one session created |
| 5. Multi-tool canary isolation | 2 | Allowed tools produce canaries, skipped tool does not; telemetry matches; each canary unique and derived |
| 6. Allowlisted tool fails honestly | 2 | Error reported honestly, no canary fabricated; invocation attempted but failed; child session crash surfaces error in parent |
| 7. Unknown safe tool | 3 | Unknown tool not resolved, customTools empty; wrong-name lookup fails; mixed known/unknown resolves only known |

Telemetry is asserted at two independent levels:
- **Configuration telemetry**: which tools were passed to `createAgentSession` via `customTools`
- **Invocation telemetry**: which `toolCall` blocks appear in mock session messages (simulated child behavior)

Both levels are asserted in mixed (scenario 3) and multi-tool (scenario 5) scenarios, ensuring that the final output depends on actual invocation results, not merely on configuration presence.

#### Real-LLM (`tests/llm/safe-tool-veracity.test.ts`)

| Scenario | Tests | What It Protects |
|---|---|---|
| Safe tool positive | 2 | Model calls safe tool and includes SHA-256-derived canary; decoy in prompt rejected in favor of real tool result |
| Safe tool negative | 2 | Tool absent: canary not fabricated, model reports inability; tool throws: error reported honestly, canary absent |

These tests create child-like sessions (noExtensions, readOnlyTools, custom tool) that mirror what `delegate_to_subagent` constructs. They verify live model behavior with safe tools through event telemetry and message-level telemetry.

#### Scope: mock vs live

Most scenarios (1-7) use mocked child sessions for deterministic coverage. They prove:
- Policy and configuration enforcement (correct tools wired, incorrect tools excluded)
- Anti-fabrication behavior under controlled conditions (canary isolation, decoy rejection, honest failure)
- Telemetry correctness at the mock boundary

The mock scenarios do **not** prove that a live model will behave correctly. They prove that the extension code correctly resolves, wires, and propagates safe tools.

The real-LLM scenarios prove that a real model will:
- Call an available safe tool and include its output
- Not fabricate output when the tool is absent
- Report errors honestly when the tool throws

The real-LLM scenarios do **not** test the full parent→child delegation flow (which would require two model calls). They test the child session directly, which is the session that `delegate_to_subagent` constructs.

Both layers are needed: mocks for exhaustive edge coverage, LLM for behavioral confidence.

### 7. Parallel Subagent Tests

Tests for concurrent and sequential multi-child execution, isolation, and honest concurrency classification.

#### Integration (`tests/integration/parallel-subagents.test.ts`)

| Scenario | Tests | What It Protects |
|---|---|---|
| Sequential success | 5 | All 3 tasks produce correct derived canaries; results are isolated; sessions disposed; childDepth restored; no delegate_to_subagent in child tools |
| Concurrency classification | 6 | Concurrent calls all succeed (depth guard is post-yield); overlapping timing classified as `proven_parallel`; sequential classified as `serial_observed`; isolation under concurrency; timing asymmetry handled correctly; classification stable across 5 repeated runs |

#### Veracity traps (`tests/veracity/parallel-subagents-traps.test.ts`)

| Scenario | Tests | What It Protects |
|---|---|---|
| Partial failure (A/B/C succeed, D fails) | 4 | D fails honestly; D's canary not fabricated; D's failure does not corrupt A/B/C; all sessions disposed even on failure |
| Derived canary traps | 4 | Each result contains unique derived canary (not raw nonce); decoys in context rejected; fresh nonces across repeated runs produce unique results; error results contain actual error not fabricated success |

#### How concurrency is classified

The `classifyConcurrency()` function in `tests/helpers/parallel-harness.ts` examines execution timing records:

- **proven_parallel**: at least two successful executions have overlapping time windows (one starts before another ends). This is observed evidence, not code intent.
- **serial_observed**: all successful executions are strictly non-overlapping (each starts after the previous ended).
- **inconclusive**: fewer than 2 successful executions; cannot determine overlap.

The tests assert specific classifications based on execution mode:
- `Promise.all` with delays: `proven_parallel` (overlapping observed)
- Sequential `await`: `serial_observed` (no overlap possible)

A false claim of `proven_parallel` when execution is serial is a test failure. The stability test runs the concurrent scenario 5 times to detect flaky scheduling.

#### How the negative trap proves honest failure

In Scenario 3, child D's mock session throws a controlled error. The test asserts:
1. D's canary (the derived value it would have returned on success) is absent from the result
2. D's raw nonce is absent from the result
3. The actual error message appears in the result
4. No success-like structure (e.g., "Subagent Result", mode header) appears
5. A/B/C results remain correct and isolated from D's failure

#### How veracity checks prove actual tool use

Each test generates a fresh nonce and derives a canary via a non-trivial transformation (reverse+suffix, lowercase+suffix, or numeric extraction). The mock child session returns the derived canary. The test verifies:
1. **Telemetry**: `createAgentSession` was called the expected number of times
2. **Semantic dependence**: the tool result contains the exact derived canary
3. **Anti-echo**: the raw nonce does NOT appear in the result (child returned derived form)
4. **Anti-decoy**: when decoy values are in the task text, only the real canary from the tool appears in results

Without actual tool invocation, the derived canary cannot appear in the output.

### 7. Real-LLM Veracity Tests (`tests/llm/`)

End-to-end tests that run against a live Anthropic model (claude-haiku-4-5).

| File | Protects |
|---|---|
| `real-veracity.test.ts` | 2 positive traps: agent calls tool and includes SHA-256-derived canary; agent uses real canary not decoy. 3 negative traps: tool absent yields honest failure; tool error reported honestly; decoy not confirmed as real. |
| `safe-tool-veracity.test.ts` | 2 positive traps: model calls safe custom tool and includes derived canary; model uses tool value not decoy. 2 negative traps: safe tool absent yields honest failure; safe tool error reported honestly. |

These tests use:
- `createAgentSession()` with real auth and model
- A custom `get_secret_token` tool that returns a cryptographic canary
- SHA-256 derivation so the token cannot be guessed
- Fresh random nonces per test run
- Both event telemetry (`tool_execution_start`) and message-level telemetry (`toolCall` content blocks)

They are excluded from `npm test` (fast path) and run via `npm run test:llm` or `npm run test:all`.

They auto-skip if no API key is available for the configured provider.

## Test Helpers

| File | Purpose |
|---|---|
| `helpers/mock-extension-api.ts` | Fake `ExtensionAPI` that captures registrations; mock `ExtensionContext` |
| `helpers/fake-tool.ts` | Factory for `ToolDefinition` objects: `makeFakeTool`, `makeFakeToolWithCanary`, `makeFakeToolThatThrows` |
| `helpers/nonce.ts` | Deterministic canary generator with derive and decoy functions |
| `helpers/parallel-harness.ts` | Timing recorder, concurrency classifier, isolation assertions, task-specific canary derivations |

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

- **Live LLM calls beyond veracity**: The LLM tests cover veracity traps only, not full delegate_to_subagent flows with a real model.
- **Real filesystem I/O by child tools**: Built-in tools (read, bash, etc.) are not exercised.
- **Concurrent parent sessions**: Parallel subagent tests cover concurrent tool-level execution within a single parent; separate parent sessions are not tested.
- **Model override resolution**: The `modelOverride` parameter path is not tested with a real `ModelRegistry`.
- **Full parent→child LLM flow with safe tools**: The LLM safe tool tests verify the child session directly; full delegate_to_subagent with two model calls is not tested.
- **Safe tool execution correctness**: The tool's own logic is the tool author's responsibility; veracity tests only verify the plumbing.
- **Safe tool resolution at scale**: Performance of the allowlist with large registries is not tested.
