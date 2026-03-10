# pi-subagents

A Pi extension that adds a `delegate_to_subagent` tool, allowing the primary agent to delegate bounded tasks to a child subagent created in-process. Supports ADK agent delegation when pi-google-adk is also loaded.

## What it does

- Registers a `delegate_to_subagent` tool that the LLM can call
- Creates an ephemeral child `AgentSession` in-process (no shell-out)
- Configures the child with explicit built-in tools based on mode (`read_only` or `coding`)
- Supports an explicit allowlist of safe custom tools for the child
- Streams child output back to the parent as the child runs
- Returns the child's final result as structured text
- Prevents recursive delegation through two layers of defense
- Resolves and delegates to ADK agents by name (when pi-google-adk is loaded)

## When to use it

Use this extension when the primary agent needs to:

- Offload a focused subtask (e.g., "read these 5 files and summarize their structure")
- Run a scoped coding task without polluting the parent conversation context
- Execute a task with a restricted tool set for safety
- Delegate to a specific ADK agent by name

## Installation

### Local extension

```bash
pi -e ./index.ts
```

### With ADK integration

```bash
pi -e ./index.ts -e ../pi-google-adk/src/index.ts
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
| `agent` | string | no | Name or path of an ADK agent to delegate to |
| `agentProvider` | `"auto"` \| `"adk"` | no | Agent provider for resolution. Default: `"auto"` |
| `onMissingAgent` | `"prompt"` \| `"cancel"` | no | What to do when agent not found. Default: `"prompt"` |
| `onAmbiguousAgent` | `"prompt"` \| `"cancel"` | no | What to do when agent matches multiple. Default: `"prompt"` |

## ADK agent delegation

When the `agent` parameter is provided and pi-google-adk is loaded:

1. The agent name is resolved via `resolve_adk_agent` (registered by pi-google-adk)
2. Resolution follows: path → exact name → case-insensitive → prefix matching
3. If not found or ambiguous, the behavior depends on `onMissingAgent`/`onAmbiguousAgent`
4. `run_adk_agent` is automatically allowlisted in the child session
5. The child's system prompt includes the resolved agent's project path

### Resolution statuses (Phase 3)

The resolution flow returns structured results with explicit statuses:

| Status | Meaning |
|---|---|
| `found` | Unique match resolved successfully |
| `not_found` | No matching agent discovered |
| `ambiguous` | Multiple matches, needs disambiguation |
| `provider_unavailable` | pi-google-adk not loaded (resolve_adk_agent not registered) |
| `execution_unavailable` | Resolution works but run_adk_agent not registered |
| `interactive_selection_required` | Disambiguation needed but no interactive UI available |

Each result includes `requestedAgent`, `availableMatches`, and `uiAvailable` for programmatic handling.

### Non-interactive behavior

When running headless (SDK, CI, or when `hasUI` is false):

- Selection prompts are not attempted
- A structured `interactive_selection_required` result is returned
- The result includes the available matches so callers can handle programmatically
- Exact-match and unique case-insensitive matches still resolve without interaction

### Example: delegate to ADK agent

```json
{
  "task": "Research the current state of quantum computing",
  "agent": "researcher",
  "mode": "read_only"
}
```

### Example: explicit cancellation for ambiguous

```json
{
  "task": "Analyze the data",
  "agent": "res",
  "onAmbiguousAgent": "cancel"
}
```

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

4. When `agent` is provided, `run_adk_agent` is auto-allowlisted using a deduped Set (no mutation of the caller's array).

### Design principles

- **Explicit over implicit**: no tools are inherited automatically
- **Auditable**: the allowlist is visible in every tool call
- **Deny-by-default**: unlisted tools are unavailable to the child
- **Non-mutating**: the caller's `safeCustomTools` array is never modified

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

```json
{
  "task": "Read all files in src/core/ and describe the module structure.",
  "mode": "read_only",
  "outputStyle": "summary",
  "files": ["src/core/"]
}
```

### Coding subagent

```json
{
  "task": "Add JSDoc comments to every exported function in src/utils.ts.",
  "mode": "coding",
  "successCriteria": "Every exported function has a JSDoc comment.",
  "files": ["src/utils.ts"]
}
```

### Subagent with safe custom tools

```json
{
  "task": "List all open GitHub issues and provide a categorized summary.",
  "mode": "read_only",
  "outputStyle": "full_report",
  "safeCustomTools": ["gh_issue"]
}
```

### ADK agent delegation

```json
{
  "task": "Research and summarize the latest developments in AI safety.",
  "agent": "researcher",
  "mode": "read_only",
  "outputStyle": "full_report"
}
```

## Testing

187 automated tests across 8 layers. See [tests/TESTING.md](tests/TESTING.md) for full details.

### Running tests

```bash
npm test              # fast tests only (excludes LLM, ~4s)
npm run test:all      # all tests including real-LLM (~20s)
npm run test:llm      # real-LLM veracity tests only (~15s)
npm run test:unit     # unit tests
npm run test:extension # extension-level tests
npm run test:integration # integration tests
npm run test:veracity # mock veracity traps
npm run test:smoke    # extension discovery/loading smoke tests
```

### Test layers

| Layer | Location | Count | What it protects |
|---|---|---|---|
| Unit | `tests/unit/` | 55 | Child prompt construction, tool allowlist resolution, recursion guard logic, parameter schema, ADK resolution, pending safe tools |
| Extension | `tests/extension/` | 18 | Tool registration in parent/child mode, execute behavior with mocked sessions |
| Integration | `tests/integration/` | 21 | Real SDK wiring: DefaultResourceLoader, SessionManager, built-in tool sets, parallel execution |
| Veracity (mock) | `tests/veracity/` | 23 | Canary-based proof that tool results flow through correctly and are not fabricated |
| Smoke | `tests/smoke/` | 19 | Real pi loader discovers and loads the extension; post-load invocation |
| Safe tool veracity | `tests/llm/` | 9 | Real-LLM veracity with safe custom tools and derived canaries |

### Phase 3 test additions

| Test | What it protects |
|---|---|
| provider_unavailable vs not_found | Empty registry → `provider_unavailable`, not misleading `not_found` |
| execution_unavailable | Resolve works but run_adk_agent missing → distinct error |
| interactive_selection_required | No UI + ambiguous → structured result with matches, not silent failure |
| Dedup and non-mutation | Set-based allowlist prevents duplicates; caller array not modified |
| Structured result fields | `requestedAgent`, `availableMatches`, `uiAvailable` present in all results |

## Exported internals

The following symbols are exported from `index.ts`:

### For testing and reuse

- `buildChildSystemPrompt()` — child system prompt construction
- `buildAdkChildSystemPrompt()` — ADK-augmented child prompt
- `resolveAllowedCustomTools()` — allowlist resolution
- `resolveAdkAgentViaTool()` — tool-mediated ADK resolution
- `resolveAdkAgentWithPrompt()` — full resolution + prompt flow
- `promptAgentSelection()` — interactive agent selection
- `checkAdkExecutionAvailable()` — run_adk_agent availability check
- `isInteractiveUIAvailable()` — UI availability check
- `DelegateParamsSchema` — parameter schema
- `DelegateParams` — parameter type
- `ResolvedAdkAgent` — resolved agent interface
- `AdkResolutionResult` — structured resolution result
- `AdkResolutionStatus` — resolution status union type

### Test-only (prefixed with `_`)

- `_getChildDepth()`, `_setChildDepth()` — recursion depth accessors
- `_addChildSignal()`, `_removeChildSignal()` — signal set accessors

## Security considerations

- The child has full filesystem access within the built-in tool capabilities of its mode
- `coding` mode children can modify files via bash, edit, and write
- The child inherits the parent's API key and model access
- Custom tools in the allowlist execute with full parent-level permissions
- ADK agent execution spawns a subprocess that may make network calls
- Use `read_only` mode and minimal `safeCustomTools` for untrusted or exploratory tasks

## Dependencies

- `@mariozechner/pi-coding-agent` (core SDK)
- `@mariozechner/pi-ai` (StringEnum helper)
- `@sinclair/typebox` (parameter schemas)

### Dev dependencies

- `vitest` (test runner)
