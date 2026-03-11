# Pi Extensions

## Purpose

This repository contains Pi extensions intended to work well with `@mariozechner/pi-coding-agent` and to follow Pi's extension model and philosophy.

The goal is to build small, composable, on-device extensions that integrate cleanly with Pi instead of forking or modifying Pi internals.

## Repository Layout

- The repo root is `pi-extensions`.
- Each extension lives in its own subfolder.
- Treat each subfolder as an independently runnable and testable unit.
- Prefer this shape:

```text
pi-extensions/
  AGENTS.md
  pi-cli-extension-testing-requirements.md
  <extension-name>/
    AGENTS.md
    package.json
    index.ts            # or src/index.ts as the main extension entry
    README.md
    assets/             # optional
    docs/               # optional
    scripts/            # optional
    tests/              # optional
```

If a package uses `src/`, keep the Pi entrypoint explicit in `package.json` under the `pi` manifest.

## Primary Design Constraints

- Build Pi extensions first, not Pi forks.
- Prefer TypeScript modules loaded by Pi.
- Keep extensions small, explicit, and composable.
- Prefer local/on-device workflows and direct shell/tool integration.
- Do not introduce hidden background processes unless the extension explicitly exists for that purpose.
- Do not recreate large built-in product features unless the user asks for them.
- Favor mechanisms Pi already supports well: tools, commands, event hooks, widgets, status lines, confirmation flows, and package manifests.

## What Pi Extensions Should Use

Prefer supported extension points over patching Pi internals:

- custom tools
- commands
- shortcuts and flags
- session / agent / tool lifecycle hooks
- context and compaction hooks
- TUI UI elements
- permission gates and path protection
- external CLI, service, or MCP integration through extension code

## Extension Packaging Rules

Each extension folder should be a valid Pi package or a clean local extension.

### Preferred package manifest

Each extension should include a `package.json` with:

- a package name
- runtime dependencies in `dependencies`
- `keywords` including `pi-package` when the extension is meant to be shared
- a `pi` manifest describing the extension entrypoint

Example:

```json
{
  "name": "pi-extension-example",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "@sinclair/typebox": "latest"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

If the extension uses `src/index.ts`, point `pi.extensions` there explicitly.

## Repository-Wide Coding Rules

- Use TypeScript.
- Export a default function that receives `ExtensionAPI`.
- Use top-level imports only.
- Do not use dynamic imports unless there is a strong runtime requirement.
- Avoid `any`; keep types explicit.
- Use schemas for tool parameters.
- Keep tool interfaces narrow and deterministic.
- Prefer clear names for tools, commands, widgets, and status keys.
- Keep side effects easy to audit.
- Minimize global mutable state.
- For persistent state, use Pi session mechanisms or clearly scoped local files.

## Repository-Wide UX Rules

- Keep the interaction model simple.
- Prefer concise tool descriptions and command help text.
- Use confirmation flows for destructive or high-risk actions.
- Surface important status via `ctx.ui.notify`, status lines, or widgets.
- Do not spam the user with notifications.
- If an extension blocks a tool call, return a clear technical reason.

## Safety and Permissions

- Treat extensions as having full system access.
- Be conservative around destructive shell commands, credential files, SSH keys, and secrets.
- Prefer explicit allowlists or denylists for protected paths.
- Add user confirmation before actions like:
  - deleting files
  - force-resetting git state
  - writing outside the project tree
  - running privileged commands
  - modifying environment or credential files

## Pi Philosophy Alignment

When designing features, stay aligned with Pi's model:

- Pi is intentionally minimal and aggressively extensible.
- Build workflow-specific behavior as extensions.
- Do not assume built-in plan mode, sub-agents, permission popups, MCP, or background bash.
- If a workflow needs those capabilities, implement them explicitly in the extension.
- Prefer observable, debuggable behavior over hidden automation.

## File Placement Rules

When adding a new extension:

- create a new subfolder at the repo root
- keep all code and docs for that extension inside that subfolder
- do not mix unrelated extensions in the same directory
- do not create cross-extension shared code unless explicitly asked for a shared package

Name each extension folder with a short kebab-case identifier.

## README Requirements

Each extension should have a `README.md` that documents:

- what the extension does
- when to use it
- installation method
- required dependencies or external CLIs
- commands, tools, and events it registers
- any security implications
- a minimal usage example

## Testing and Validation

For each extension, validate as much as possible locally.

Minimum validation:

1. verify package shape and imports
2. verify the Pi entrypoint is correct
3. verify schemas and command or tool registration compile logically
4. verify no obvious unsafe path handling or shell interpolation bugs
5. provide a concrete manual test procedure using Pi

Preferred manual run path:

```bash
pi -e ./index.ts
```

or from the package root if using a manifest-backed package.

If the extension is meant for auto-discovery, document placement under one of:

- `~/.pi/agent/extensions/`
- `.pi/extensions/`
- a package installed via `pi install`

### Repository testing standard

For extensions that register tools, wrap external CLIs, create child sessions, or perform non-trivial orchestration, follow `./pi-cli-extension-testing-requirements.md` as the repository testing standard.

That document is the source of truth for:

- required test layers
- veracity and anti-fabrication testing
- telemetry expectations
- mock vs live evidence boundaries
- cleanup, isolation, and determinism requirements
- what good coverage and good claims about coverage look like

### Automated testing expectations for non-trivial extensions

Manual validation is required but is not sufficient for extensions that:

- register tools
- wrap external CLIs or services
- create child sessions or subagents
- enforce allowlists, denylists, permissions, or confirmation gates
- perform non-trivial orchestration, policy enforcement, or tool mediation

Those extensions should normally include an automated test suite with layered coverage:

1. unit tests for pure logic, policy boundaries, and helpers
2. extension-level tests for registration, schemas, and tool behavior
3. integration tests for Pi session/tool/resource-loader wiring
4. veracity tests proving the agent actually used the tool and did not fabricate results

### CLI-backed extension testing rules

For extensions that expose CLI-backed tools or mediate access to external systems, tests should normally cover:

- allowed vs blocked operations
- explicit allowlist and denylist behavior
- safety boundaries and confirmation gates
- honest error reporting
- cleanup and cancellation
- tool configuration passed into child or wrapper contexts
- telemetry for actual tool usage
- positive and negative trap tests when tool-use honesty matters
- semantic dependence on tool-only information where feasible

Prefer structured tool interfaces over broad shell passthrough, and test accordingly.

### Coverage boundaries and non-overclaiming

Every test plan and test documentation file must explicitly state:

- what the tests prove
- what they do not prove
- whether parent telemetry, child telemetry, both, or neither are directly observed
- whether the tests validate a full live execution chain or only a controlled or mock path

Do not overclaim live coverage.

Real-LLM tests are valuable and encouraged where they add unique confidence, but they must not be described as full end-to-end proof unless the full chain is directly observed.

### Test maintenance expectations

When behavior, tool surfaces, policy boundaries, safety posture, or integration shape changes, update:

- automated tests
- test utilities and fixtures as needed
- test documentation describing scope and evidence boundaries
- the extension README if user-visible behavior changes

## Implementation Preferences

Prefer:

- focused tools over monolithic agents
- explicit commands over ambiguous magic
- small event handlers with narrow responsibilities
- local helper modules when complexity grows
- predictable JSON-serializable tool outputs

Avoid unless requested:

- hidden daemons
- broad shell passthrough as the primary interface
- large mutable singleton registries
- opaque side effects that are hard to audit

## When Working on a Request

When asked to create or modify an extension in this repo:

1. inspect the target extension folder first
2. preserve the existing package shape unless a change is needed
3. use Pi-native extension points instead of patching Pi internals
4. update the extension README when behavior changes
5. add or update automated tests and test documentation when behavior, tool surfaces, policy boundaries, or safety posture change
6. document required external dependencies or CLIs
7. provide a concrete manual validation path

## Issue Management

### Issue Templates

This repository uses GitHub issue templates in `.github/ISSUE_TEMPLATE/`. When creating issues, always use the appropriate template:

| Template | When to Use |
|---|---|
| **Bug Report** | Something is broken or behaving unexpectedly |
| **Feature Request** | Proposing a new feature or enhancement to an existing extension |
| **New Extension Proposal** | Proposing an entirely new extension for the repository |
| **Investigation / Spike** | Timeboxed research question or technical spike |
| **Refactoring / Tech Debt** | Cleanup, refactor, or tech debt paydown |

Do not create freeform issues without a template unless none of the above apply.

### Extension Labels

Every issue must be labeled with the extension it relates to. Use the following labels:

| Label | When to Apply |
|---|---|
| `pi-google-adk` | Issues related to the pi-google-adk extension |
| `pi-subagents` | Issues related to the pi-subagents extension |
| `pi-gh` | Issues related to the pi-gh extension |
| `upstream` | Issues that are Pi core bugs or feature requests, not specific to an extension in this repo |
| `new-extension` | Proposals for extensions that do not exist yet |

Rules:

- Apply exactly one extension label per issue, unless the issue spans multiple extensions (e.g. a coordinator integrating two extensions).
- When a new extension folder is added to the repo, create a matching GitHub label for it.
- New extension proposals use the `new-extension` label until the extension is created, at which point they should be relabeled to the new extension-specific label.
- Issues about Pi core behavior that are tracked here for visibility use `upstream`.
- If you are unsure which extension an issue belongs to, ask the user before labeling.

### Priority Labels

Use priority labels when known:

| Label | Meaning |
|---|---|
| `P0: critical` | Must fix immediately |
| `P1: high` | Address this cycle |
| `P2: medium` | Planned work |
| `P3: low` | Backlog |

### Other Labels

| Label | Meaning |
|---|---|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `investigation` | Research / spike / investigation |
| `tech-debt` | Cleanup or refactoring work |
| `documentation` | Documentation improvements |

## Review Checklist

Before considering work complete, check:

- package manifest and Pi entrypoint are correct
- imports resolve logically
- tools and commands have narrow schemas and clear descriptions
- destructive or high-risk actions have confirmation or policy gating
- unsafe shell interpolation is avoided
- README is updated
- automated tests and test documentation are updated when required
- claims about coverage match the actual evidence gathered
- a manual validation path is documented
