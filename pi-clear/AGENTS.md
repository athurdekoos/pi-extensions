# pi-clear

## Purpose

This directory contains the `pi-clear` Pi extension.

This extension must remain compatible with **`@mariozechner/pi-coding-agent`** and should follow the repository-wide rules defined in the parent `AGENTS.md`.

This file defines **local rules for this extension only**. If there is a conflict, prefer the more specific rule in this file for work inside this directory.

## Scope

- Keep changes scoped to this extension.
- Do not modify sibling extensions unless explicitly asked.
- Do not introduce shared code or shared packages unless explicitly asked.

## Extension Goal

- Primary use case: provide a `/clear` command that starts a fresh Pi session, similar to context clearing workflows in other coding agents.
- Main user workflow: the user runs `/clear`, confirms the action, and Pi creates a new session; optionally the current editor text is carried into the new session.
- Key Pi integration points: `pi.registerCommand(...)`, `ExtensionCommandContext.newSession()`, `ctx.ui.confirm(...)`, `ctx.ui.getEditorText()`, `ctx.ui.setEditorText()`, `ctx.abort()`, and `ctx.waitForIdle()`.
- Required external tools or services: none.
- Main safety considerations: clearing context is destructive to the active conversational state, so confirmation is required unless the user explicitly passes a force-style flag such as `--yes`.

## Source of Truth

Read these files before making changes:

- `README.md`
- `package.json`
- `index.ts` or `src/index.ts`
- any local docs in `docs/`
- any tests in `tests/`

Preserve documented behavior unless explicitly asked to change it.

## Local Structure Expectations

Prefer one of these layouts:

```text
pi-clear/
  AGENTS.md
  package.json
  README.md
  index.ts
  tests/
```

or

```text
pi-clear/
  AGENTS.md
  package.json
  README.md
  src/
    index.ts
  tests/
```

If using `src/index.ts`, ensure the `pi` manifest points to it explicitly.

## Local Coding Rules

- Keep the extension focused on `/clear` session reset behavior and closely related argument parsing only.
- Keep exported commands narrowly scoped; do not add unrelated commands, tools, hooks, or widgets without explicit request.
- Prefer deterministic behavior for argument parsing and confirmation flow.
- Avoid hidden state; do not persist extension-specific state across sessions unless explicitly requested.
- Keep shell usage explicit and auditable; avoid shelling out unless there is no Pi-native alternative.
- Validate command inputs with simple, explicit parsing rules.
- Avoid unnecessary dependencies; prefer no runtime dependencies beyond Pi.
- Prefer small helper functions over large abstractions.

## Tool and Command Rules

For any tool or command added here:

- use clear, stable names
- document purpose and expected inputs
- return structured outputs where possible
- provide actionable error messages
- require confirmation for destructive actions

Document registered tools, commands, hooks, and widgets in `README.md`.

For this extension specifically:

- the primary public command is `/clear`
- supported arguments must remain simple and explicit
- destructive behavior must be confirmed unless a deliberate bypass flag is present
- “clear” should mean “start a new Pi session,” not mutate historical session files in place, unless Pi adds a supported API for that and the behavior is intentionally changed

## Safety Rules

- Treat this extension as capable of full local system access.
- Be conservative around file writes, shell execution, secrets, and credentials.
- Do not write outside the intended working scope unless explicitly required.
- Require explicit confirmation before destructive or privileged actions.
- Call out security implications in the README when relevant.

For this extension specifically:

- do not delete files, edit session storage, or manually remove conversation artifacts to simulate clearing
- prefer Pi-native session APIs over filesystem manipulation
- if the agent is currently running, require an explicit stop/abort path before clearing
- do not capture, export, or log editor text beyond what is needed to carry it into the new session

## Testing Rules

Protect the highest-value behavior with the fewest useful tests.

Default test target:

1. main success path
2. one important edge case
3. one meaningful failure path

Before adding tests:

- summarize the behavior being protected
- identify the regression risks
- propose the minimal test set
- state assumptions

After adding tests:

- explain what is covered
- explain what is not covered
- call out brittleness or tradeoffs

Recommended minimum tests for this extension:

1. `/clear` with confirmation accepted starts a new session
2. `/clear keep` preserves editor text when present
3. malformed or empty argument input does not throw and falls back to default behavior

## Validation Checklist

Before finishing work in this extension:

1. verify package shape and imports
2. verify the Pi entrypoint is correct
3. verify tools, commands, and schemas are wired correctly
4. verify no obvious unsafe shell interpolation or path handling bugs
5. update `README.md` if behavior or setup changed
6. provide a concrete manual test path using Pi

Preferred manual run path:

```bash
pi -e ./index.ts
```

or the manifest-backed equivalent from this directory.

Manual validation for this extension should include:

```bash
/clear
/clear keep
/clear keep --edit
/clear --yes
```

Also verify behavior while the agent is actively streaming a response.

## Change Policy

- Prefer the smallest change that solves the request.
- Do not rename or move files unless necessary.
- Do not change public behavior unless explicitly requested.
- Do not add dependencies unless justified.
- If a larger refactor would help, propose it separately before doing it.

For this extension specifically:

- keep compatibility with current Pi extension APIs as the first priority
- do not replace Pi-native session creation with custom session management
- do not broaden the extension into a generic session-management package unless explicitly requested

## Definition of Done

A change in this extension is done when:

- behavior matches the request
- relevant tests pass
- new tests protect intended behavior
- documentation is updated if needed
- no obvious dead code or placeholder comments remain
- the final summary explains changes and remaining risks

For this extension specifically, done also means:

- `/clear` works from Pi without runtime type errors
- argument parsing matches Pi’s command handler input shape
- confirmation behavior is consistent
- carry-forward editor behavior is documented, including any RPC-mode limitations

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

- Supported platform: environments where Pi extensions written in TypeScript are supported by the installed Pi runtime.
- Required CLI tools: `pi` for manual validation; no additional external CLI tools should be required.
- Allowed working directories: keep all extension code and docs inside this extension directory unless explicitly asked otherwise.
- Expected config files: `package.json`, `README.md`, `index.ts` or `src/index.ts`, and optional tests.
- Output format constraints: user-facing command behavior should be concise, confirmation-driven, and predictable.
- Performance constraints: command execution should be near-instant except for Pi-native confirmation, abort, or session-creation waits.
- Integration boundaries: this extension should only integrate with public Pi extension APIs and should not depend on private internals, sibling extensions, or repository-wide shared code.
- Current intended command behavior:
  - `/clear` starts a fresh session after confirmation
  - `/clear keep` starts a fresh session and restores current editor text when available
  - `/clear keep --edit` allows the carried text to be edited before restoring it
  - `/clear --yes` skips confirmation
- RPC-mode note: if Pi does not provide live editor buffer access in RPC mode, carry-over of editor text may be unavailable or degrade to a no-op; preserve this behavior unless explicitly asked to change it.
