# Testing — pi-google-adk

## Test Layers

### Layer 1 — Unit tests (`tests/unit/`)

Fast, isolated tests for pure logic and helpers. No filesystem side effects beyond temp dirs.

| File | Behavior protected |
|------|-------------------|
| `validators.test.ts` | Agent/tool name validation, template/capability type guards |
| `fs-safe.test.ts` | Path traversal prevention, write/read/exists with overwrite semantics |
| `project-detect.test.ts` | Project detection from pi-metadata, heuristic fallback, legacy non-detection |
| `adk-docs-mcp.test.ts` | MCP config JSON validity, server name, command, and URL |

### Layer 2 — Extension tests (`tests/extension/`)

Tests that register the extension via mock API and exercise tool behavior.

| File | Behavior protected |
|------|-------------------|
| `registration.test.ts` | All 6 tools registered, correct names/labels/descriptions, schema required fields |
| `tool-behavior.test.ts` | create_adk_agent deprecated template rejection with migration errors, invalid name rejection, path traversal rejection; add_adk_capability path traversal and non-project rejection |
| `legacy-migration-errors.test.ts` | All legacy modes rejected with migration guidance, all deprecated templates rejected, error quality (mentions supported modes, specific input), schema contract (mode enum, removed params), regression guards for supported modes |

### Layer 3 — Integration tests (`tests/integration/`)

End-to-end workflows using real tool execute calls and real filesystem.

| File | Behavior protected |
|------|-------------------|
| `scaffold-workflow.test.ts` | Create then add capability (custom_tool, eval_stub, deploy_stub, observability_notes, sequential_workflow, mcp_toolset); idempotent capability re-add |

### Layer 4 — Veracity traps (`tests/veracity/`)

Prove tool results structurally depend on actual execution.

| File | Behavior protected |
|------|-------------------|
| `scaffold-traps.test.ts` | Positive traps (canary in files_created, pi-metadata, agent.py), multiple fresh nonces, negative traps (invalid input, path traversal, non-project), decoy trap (parameter name vs context name), capability canary in patched files |

## Running Tests

```bash
# All tests (excluding LLM)
npm test

# Typecheck only
npm run typecheck

# By layer
npm run test:unit
npm run test:extension
npm run test:integration
npm run test:veracity

# Watch mode
npm run test:watch
```

## What Each Layer Proves

### Unit tests
- Pure functions produce correct outputs for valid, invalid, and edge-case inputs.
- Path traversal is blocked deterministically.
- Pi metadata is written and validated correctly.

### Extension tests
- The extension registers exactly the expected tools with correct schemas.
- Tool execute() produces ok=true for valid inputs and ok=false for invalid inputs.
- Error results contain meaningful messages.
- Files are created on disk when the tool succeeds.

### Integration tests
- Multi-step workflows (create + add capability) produce correct file structures.
- Idempotent re-add does not create duplicates.
- All six capabilities (custom_tool, mcp_toolset, sequential_workflow, eval_stub, deploy_stub, observability_notes) produce the expected files.

### Veracity traps
- Tool results structurally depend on unique per-test canary inputs.
- Pi metadata and agent.py on disk contain the canary-derived values.
- Decoy names in context do not leak into results.
- Failed operations do not fabricate success or file paths.
- Multiple runs with fresh nonces produce distinct, correct results.

## What Each Layer Does NOT Prove

### Unit tests
- Do not prove tool registration or execution behavior.
- Do not prove model tool-selection behavior.

### Extension tests
- Use mock ExtensionAPI; do not prove real Pi session wiring.
- Do not prove model-driven tool selection.

### Integration tests
- Use mock ExtensionAPI; do not prove real Pi extension discovery or session lifecycle.
- Do not test streaming or cancellation (this extension does not stream).

### Veracity traps
- Prove tool execute() path correctness under controlled conditions.
- Do NOT prove live model tool-selection behavior. Real-LLM veracity tests would be needed to prove a model calls create_adk_agent instead of fabricating file listings.
- Do NOT prove parent-level delegation telemetry (this extension does not use child sessions).

## Canary/Decoy Design

- Canaries are generated via `generateNonce()` with a seeded counter.
- Agent names are derived from nonces via `canaryAgentName()` to produce valid Python identifiers.
- Derived canaries compare tool result metadata against actual files on disk.
- Decoys are structurally similar but provably different (DECOY prefix, offset suffix).
- Each test run produces fresh, unique canaries.

## Cleanup

All tests use `createTempDir()` / `removeTempDir()` in beforeEach/afterEach. No filesystem state leaks between tests.

## Helpers

| File | Purpose |
|------|---------|
| `helpers/mock-extension-api.ts` | Mock ExtensionAPI and ExtensionContext for tool registration/execution |
| `helpers/nonce.ts` | Deterministic canary/decoy generation |
| `helpers/temp-dir.ts` | Isolated temp directory lifecycle |
