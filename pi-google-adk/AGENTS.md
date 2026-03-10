# <extension-name>

## Purpose
This directory contains the `<extension-name>` Pi extension.

This extension must remain compatible with **`@mariozechner/pi-coding-agent`** and should follow the repository-wide rules defined in the parent `AGENTS.md`.

This file defines **local rules for this extension only**. If there is a conflict, prefer the more specific rule in this file for work inside this directory.

## Scope
- Keep changes scoped to this extension.
- Do not modify sibling extensions unless explicitly asked.
- Do not introduce shared code or shared packages unless explicitly asked.

## Extension Goal
Document the extension's intended behavior here in 2–6 bullets. Replace the placeholders below.

- Primary use case:
- Main user workflow:
- Key Pi integration points:
- Required external tools or services:
- Main safety considerations:

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
<extension-name>/
  AGENTS.md
  package.json
  README.md
  index.ts
  tests/
```

or

```text
<extension-name>/
  AGENTS.md
  package.json
  README.md
  src/
    index.ts
  tests/
```

If using `src/index.ts`, ensure the `pi` manifest points to it explicitly.

## Local Coding Rules
- Keep the extension focused on a single clear responsibility.
- Keep exported tools and commands narrowly scoped.
- Prefer deterministic outputs.
- Avoid hidden state or surprising side effects.
- Keep shell usage explicit and auditable.
- Validate tool inputs with schemas.
- Avoid unnecessary dependencies.
- Prefer small helper modules over large abstractions.

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

## Change Policy
- Prefer the smallest change that solves the request.
- Do not rename or move files unless necessary.
- Do not change public behavior unless explicitly requested.
- Do not add dependencies unless justified.
- If a larger refactor would help, propose it separately before doing it.

## Definition of Done
A change in this extension is done when:
- behavior matches the request
- relevant tests pass
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
Replace this section with concrete extension-specific rules, for example:
- supported platforms
- required CLI tools
- allowed working directories
- expected config files
- output format constraints
- performance constraints
- integration boundaries
