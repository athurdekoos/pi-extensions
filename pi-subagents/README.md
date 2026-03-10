# pi-subagents

A Pi extension that adds a `delegate_to_subagent` tool, allowing the primary agent to delegate bounded tasks to a child subagent created in-process.

## What it does

- Registers a `delegate_to_subagent` tool that the LLM can call
- Creates an ephemeral child `AgentSession` in-process (no shell-out)
- Configures the child with explicit built-in tools based on mode (`read_only` or `coding`)
- Supports an explicit allowlist of safe custom tools for the child
- Streams child output back to the parent as the child runs
- Returns the child's final result as structured text
- Prevents recursive delegation through two layers of defense

## When to use it

Use this extension when the primary agent needs to:

- Offload a focused subtask (e.g., "read these 5 files and summarize their structure")
- Run a scoped coding task without polluting the parent conversation context
- Execute a task with a restricted tool set for safety

## Installation

### Local extension

```bash
pi -e ./index.ts
```

### Auto-discovery

Place in `.pi/extensions/` or `~/.pi/agent/extensions/`:

```bash
cp -r pi-subagents ~/.pi/agent/extensions/
```

### Package install

```bash
pi install pi-subagents
```

## Tool schema

| Parameter | Type | Required | Description |
|---|---|---|---|
| `task` | string | yes | Exact task description for the child |
| `mode` | `"read_only"` \| `"coding"` | no | Built-in tool set. Default: `"read_only"` |
| `successCriteria` | string | no | Explicit completion target |
| `outputStyle` | `"summary"` \| `"patch_plan"` \| `"full_report"` | no | Desired answer shape. Default: `"summary"` |
| `files` | string[] | no | Files or directories to focus on |
| `safeCustomTools` | string[] | no | Names of custom tools the child may use |
| `modelOverride` | string | no | Model identifier (`provider/model-id`) for the child |

## Safe custom tool allowlist

By default, the child has **no custom tools**. Custom tools are only available if explicitly listed in `safeCustomTools`.

### How it works

1. Other extensions register tools they want to make available to subagents using the global helper:

```typescript
const register = (globalThis as any).__piSubagents_registerSafeTool;
if (register) {
  register(myToolDefinition);
}
```

2. When the parent calls `delegate_to_subagent` with `safeCustomTools: ["my_tool"]`, only `my_tool` is resolved from the registry and passed to the child.

3. The `delegate_to_subagent` tool itself is **always excluded** from the child, even if explicitly listed.

### Design principles

- **Explicit over implicit**: no tools are inherited automatically
- **Auditable**: the allowlist is visible in every tool call
- **Deny-by-default**: unlisted tools are unavailable to the child

## Recursion prevention

The child must never be able to call another subagent. This is enforced with two layers:

### Primary boundary

The child session is created with `DefaultResourceLoader({ noExtensions: true })`. This means:

- No extensions are loaded into the child session at all
- The `delegate_to_subagent` tool does not exist in the child
- No other extension tools are inherited unless explicitly allowed via `safeCustomTools`

### Secondary guard

A module-scoped depth counter and a `WeakSet` of active child signals provide defense-in-depth:

- If `childDepth > 0` when the extension loads, it refuses to register
- If `childDepth > 0` or the signal is in `activeChildSignals` when `execute` is called, it returns an error
- These guards are session-local (not process-global env vars) and safe for concurrent use

## Usage examples

### Read-only subagent

```
Read the files in src/core/ and summarize the module structure.
```

The LLM may call:

```json
{
  "task": "Read all files in src/core/ and describe the module structure, exports, and dependencies between modules.",
  "mode": "read_only",
  "outputStyle": "summary",
  "files": ["src/core/"]
}
```

### Coding subagent

```
Add JSDoc comments to all exported functions in src/utils.ts.
```

The LLM may call:

```json
{
  "task": "Add JSDoc comments to every exported function in src/utils.ts. Describe parameters, return types, and purpose.",
  "mode": "coding",
  "successCriteria": "Every exported function has a JSDoc comment.",
  "files": ["src/utils.ts"]
}
```

### Subagent with safe custom tools

```
Use the gh_issue tool to list open issues and summarize them.
```

The LLM may call:

```json
{
  "task": "List all open GitHub issues and provide a categorized summary.",
  "mode": "read_only",
  "outputStyle": "full_report",
  "safeCustomTools": ["gh_issue"]
}
```

## Testing

The extension has a 7-layer test suite with 122 tests. See [tests/TESTING.md](tests/TESTING.md) for full details.

### Running tests

```bash
npm test              # fast tests only (117 tests, ~4s)
npm run test:all      # all tests including real-LLM (122 tests, ~17s)
npm run test:llm      # real-LLM veracity tests only (5 tests, ~15s)
npm run test:unit     # unit tests
npm run test:extension # extension-level tests
npm run test:integration # integration tests
npm run test:veracity # mock veracity traps
npm run test:smoke    # extension discovery/loading smoke tests
```

### Test layers

| Layer | Location | Count | What it protects |
|---|---|---|---|
| Unit | `tests/unit/` | 36 | Child prompt construction, tool allowlist resolution, recursion guard logic, parameter schema |
| Extension | `tests/extension/` | 18 | Tool registration in parent/child mode, execute behavior with mocked sessions, streaming, disposal, error reporting |
| Integration | `tests/integration/` | 21 | Real SDK wiring: `DefaultResourceLoader`, `SessionManager`, built-in tool sets, child tool surface, parallel subagent execution, concurrency classification, isolation |
| Veracity (mock) | `tests/veracity/` | 23 | Canary-based proof that tool results flow through correctly and are not fabricated; parallel partial-failure honesty; derived canary traps |
| Smoke | `tests/smoke/` | 19 | Real pi loader discovers and loads the extension from configured paths, `.pi/extensions/` symlinks, and `pi.extensions` manifest; tool absent when extension not on path; tool metadata and schema correct after real loading; post-load invocation proves the full chain (discover → load → register → expose → invoke) with both `read_only` and `coding` modes |
| Veracity (LLM) | `tests/llm/` | 5 | Real model inference with SHA-256-derived canaries, decoy detection, honest failure reporting |

### Veracity trap tests

The veracity tests use hidden canary nonces to prove the agent truly uses the subagent tool rather than fabricating results.

**Positive traps**: A custom tool returns a SHA-256-derived canary. Tests assert both tool invocation telemetry and that the final answer contains the exact derived value. Includes a decoy variant where a fake token is planted in the prompt.

**Negative traps**: The tool is absent, broken, or blocked. Tests assert the canary does not appear and the agent reports failure honestly.

The real-LLM tests auto-skip when no API key is available.

## Exported test helpers

The following symbols are exported from `index.ts` with a `_` prefix for test use only:

- `_getChildDepth()`, `_setChildDepth()` -- recursion depth accessors
- `_addChildSignal()`, `_removeChildSignal()` -- signal set accessors

The following are exported for both testing and potential reuse:

- `buildChildSystemPrompt()` -- child system prompt construction
- `resolveAllowedCustomTools()` -- allowlist resolution
- `DelegateParamsSchema` -- parameter schema
- `DelegateParams` -- parameter type

## Security considerations

- The child has full filesystem access within the built-in tool capabilities of its mode
- `coding` mode children can modify files via bash, edit, and write
- The child inherits the parent's API key and model access
- Custom tools in the allowlist execute with full parent-level permissions
- Use `read_only` mode and minimal `safeCustomTools` for untrusted or exploratory tasks

## Dependencies

- `@mariozechner/pi-coding-agent` (core SDK)
- `@mariozechner/pi-ai` (StringEnum helper)
- `@sinclair/typebox` (parameter schemas)

### Dev dependencies

- `vitest` (test runner)
