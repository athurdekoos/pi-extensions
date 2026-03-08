# Pi Extensions

## Purpose

This repository contains **Pi extensions** intended to work well with **`@mariozechner/pi-coding-agent`** and to follow Pi's extension model and philosophy.

The goal is to build small, composable, on-device extensions that integrate cleanly with Pi instead of forking or modifying Pi internals.

## Repository Layout

- The repo root is `pi-extensions`.
- Each extension lives in its own subfolder.
- Treat each subfolder as an independently runnable and testable unit.
- Prefer this shape:

```text
pi-extensions/
  AGENTS.md
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

- Build **Pi extensions first**, not Pi forks.
- Prefer **TypeScript** modules loaded by Pi.
- Keep extensions **small, explicit, and composable**.
- Prefer **local/on-device workflows** and direct shell/tool integration.
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

- Use **TypeScript**.
- Export a **default function** that receives `ExtensionAPI`.
- Use **top-level imports** only.
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

## Implementation Preferences

Prefer:

- focused tools over monolithic agents
- explicit commands over ambiguous magic
- small event handlers with narrow responsibilities
- local helper modules when complexity grows
- predictable JSON-serializable tool outputs

Avoid unless requested:

- opaque autonomous loops
- large framework abstractions
- hidden network dependencies
- silent mutation of user files outside the stated scope
- tightly coupling one extension to another

## When Working on a Request

When asked to add or modify an extension:

1. identify the target extension subfolder
2. read that extension's `AGENTS.md`, `README.md`, and `package.json` first, if present
3. preserve the extension's public behavior unless explicitly asked to change it
4. keep changes scoped to the target extension
5. update its README if behavior, commands, setup, or security posture changed
6. describe how to run or load it in Pi

## Deliverable Expectations

Unless explicitly told otherwise, produce:

- the extension code
- any required `package.json` updates
- a `README.md`
- brief manual test instructions

## Decision Rule

When several implementation options exist, choose the one that:

1. fits Pi's extension API cleanly
2. is easiest to inspect and maintain
3. keeps execution local and observable
4. avoids modifying Pi core behavior unless necessary
5. is simplest for on-device use

## GitHub Project

- Default project: `@pi-extensions-project`
- Project number: `2`
- Owner: `athurdekoos`

## Test Generation

Goal:
Protect real user and business behavior with minimal maintenance burden.

Rules:

- Test behavior, not implementation details.
- Prefer a small number of high-value tests.
- Default to 3 tests unless more are clearly justified.
- Cover the main success path, one important edge case, and one meaningful failure path.
- Prefer integration tests when they give better signal.
- Avoid brittle mocks unless necessary.
- Do not test framework defaults.
- Avoid snapshots unless there is no better assertion.
- Reuse existing test patterns in the repo.
- If code is hard to test cleanly, propose a small refactor instead of writing brittle tests.

Before writing tests:

1. summarize the behavior to protect
2. rank behaviors by regression risk
3. propose the minimal useful test set
4. state assumptions

After writing tests:

- explain what is covered
- explain what is intentionally not covered
- call out brittleness or tradeoffs

## Definition of Done

A change is done when:

- behavior matches the request
- relevant tests pass
- new tests protect the intended behavior
- no obvious dead code or placeholder comments remain
- the final summary explains what changed and any risks left

## Change Policy

- Prefer the smallest change that solves the problem.
- Do not rename or move files unless necessary.
- Do not introduce new dependencies unless justified.
- Preserve public interfaces unless the task requires changing them.
- Do not make schema or migration changes unless explicitly asked.
- If a larger refactor would help, propose it separately before doing it.

## Communication

Before coding:

- summarize the problem
- state assumptions
- propose the minimal plan

After coding:

- summarize what changed
- list tests run
- note anything not covered
- call out risks or follow-up work

## Conventions

- Use existing naming conventions.
- Keep functions small and direct.
- Prefer explicit code over clever abstractions.
- Add comments only when they explain non-obvious intent.
- Do not leave TODOs unless requested.

## Boundaries

- Do not modify CI, deployment, or secrets-related files unless explicitly asked.
- Do not change lockfiles unless dependency changes are required.

## Git Rules

- Only commit files changed in this session.
- Always use `git add <specific-file-paths>`.
- Never use `git add .` or `git add -A`.
- Before committing, run `git status` and verify only intended files are staged.
- Never use `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or `git commit --no-verify`.
- If rebase conflicts occur in files not modified for the task, stop and ask.

## Style

- Keep answers short and concise.
- No emojis in commits, code, or technical prose.
- No fluff or filler text.
- Technical prose only.
- Comments should explain **why**, not **what**.
