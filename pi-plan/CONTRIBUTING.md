# Contributing to pi-plan

## What is `pi-plan/`?

`pi-plan/` is the **canonical shareable package** for the Pi planning extension. It provides the `/plan`, `/plan-debug`, `/plan-finish`, and other commands as a properly packaged, tested, modular Pi extension.

If you want to change how the planning extension behaves for users, this is where you work.

## Package vs. workspace

| Location | Role |
|---|---|
| `pi-plan/` | Canonical shareable package — what users install and run |
| `.pi/` (repo root) | Repo-local workspace where this repo dogfoods `pi-plan` |
| `.pi/legacy/` | Historical predecessor (monolithic single-file extension, not loaded at runtime) |
| `.pi/docs/` | Historical documentation for the legacy extension (all files carry historical banners) |

**Rule:** Changes to packaged behavior belong in `pi-plan/`. Do not edit root `.pi/` files to change how the extension works for users.

The root `.pi/plans/` directory is actively used by `pi-plan` for this repository's own planning — it is a consumer of the package, not part of it.

## Loading and running locally

### Quick test (no install)

```bash
pi -e ~/dev/pi-extensions/pi-plan
```

This loads the extension from source. You can then use `/plan`, `/plan-debug`, `/todos`, `/tdd`, `/plan-review`, `/plan-annotate`, and `/plan-finish` in any git repository.

### Running tests

```bash
cd pi-plan && npm test
```

All 571 tests run via vitest against temp directories. No Pi runtime or real git repos required.

## Validating changes

### Automated tests

Run `npm test` in `pi-plan/`. Tests cover config, plan generation, archive lifecycle, orchestration flows, template system, diagnostics, and reconciliation.

See [`tests/TESTING.md`](tests/TESTING.md) for the full coverage strategy, what each test file proves, and what is not automated.

### Manual verification

The canonical manual verification steps live in the **[README.md § Manual verification](README.md#manual-verification)** section. Follow those steps after any behavior change.

The manual path covers: initialization, plan creation, inline args, resume/replace/revisit flows, archive labels, config, invalid config fallback, diagnostics, cancellation, template placeholders, legacy template fallback, and index reconciliation.

## Where to make changes

| What you want to change | Where to edit |
|---|---|
| Command behavior or UX flow | `orchestration.ts` |
| Plan generation or template substitution | `plangen.ts` |
| Template parsing or shared primitives | `template-core.ts` |
| Template mode classification | `template-analysis.ts` |
| Repo detection, state model, initialization | `repo.ts` |
| Archive lifecycle, index regeneration | `archive.ts` |
| Config options or validation | `config.ts` |
| Default file contents or sentinel | `defaults.ts` |
| Summary extraction, archive labels | `summary.ts` |
| Diagnostic snapshots | `diagnostics.ts` |
| Plan enforcement state machine | `auto-plan.ts` |
| Harness-level input interception | `harness.ts` |
| Step extraction and done-marker tracking | `mode-utils.ts` |
| TDD enforcement and compliance logging | `tdd.ts` |
| Brainstorming specs I/O | `brainstorm.ts` |
| Git worktree isolation | `worktree.ts` |
| Branch finishing workflow | `finish.ts` |
| Browser review orchestration | `review.ts` |
| Ephemeral HTTP review servers | `server.ts` |
| System browser launching | `browser.ts` |
| Command/tool/flag registration (thin bridge) | `index.ts` |

### What NOT to edit for packaged behavior

- **Root `.pi/` files** — These are repo-local workspace artifacts, not part of the package.
- **`.pi/legacy/`** — Historical reference only. Not loaded at runtime.
- **`.pi/docs/`** — Historical docs for the legacy extension. The canonical docs are in `pi-plan/`.

### v2.0 surface

The following were added in v2.0.0 and are part of the packaged extension surface:

- **`submit_plan` tool** — agent-callable browser-based plan review (registered in `index.ts`, orchestrated by `review.ts`)
- **`--plan` flag** — start with enforcement enabled (registered in `index.ts`, consumed by `auto-plan.ts`)
- **`/todos` command** — show step progress (registered in `index.ts`, uses `auto-plan.ts` state)
- **`/plan-review` command** — browser-based code review for git diffs (registered in `index.ts`, uses `review.ts` + `server.ts`)
- **`/plan-annotate` command** — browser-based markdown annotation (registered in `index.ts`, uses `review.ts` + `server.ts`)
- **Enforcement system** — `auto-plan.ts` (state machine), `harness.ts` (input interception), `mode-utils.ts` (step tracking)
- **Browser review system** — `review.ts` (orchestration), `server.ts` (HTTP servers), `browser.ts` (launcher), `assets/` (HTML UIs)

### v2.1 surface

The following were added in v2.1.0:

- **`/tdd` command** — toggle TDD enforcement, show compliance summary (registered in `index.ts`, uses `tdd.ts`)
- **`submit_spec` tool** — submit design spec during brainstorming (registered in `index.ts`, uses `brainstorm.ts`)
- **TDD enforcement** — `tdd.ts` (gate logic, compliance logging)
- **Brainstorming phase** — `brainstorm.ts` (spec I/O, filename generation)
- **Git worktree isolation** — `worktree.ts` (creation, cleanup, state persistence)
- **6 new config options** — `tddEnforcement`, `testFilePatterns`, `brainstormEnabled`, `worktreeEnabled`, `specDir`, `tddLogDir`, `worktreeStateDir`
- **3 new `.pi/` subdirectories** — `specs/`, `tdd/`, `worktrees/`

### v2.2 surface

The following were added in v2.2.0:

- **`/plan-finish` command** — manually trigger branch finishing workflow (registered in `index.ts`, logic in `finish.ts`)
- **`finish.ts`** — deterministic branch finishing with ExecFn seam (merge, PR, keep, discard)
- **`"finishing"` phase** — write-gated phase in `auto-plan.ts`, gated in `hooks.ts`
- **2 new config options** — `defaultFinishAction`, `prTemplate`
- **Hooks changes** — `handleAgentEnd` in `hooks.ts` now orchestrates finishing workflow; `HookContext.ui` extended with `select` and `input`
- **Worktree changes** — `cleanupWorktree` accepts `opts.deleteBranch` for conditional branch preservation

## Key invariants to preserve

These are documented in detail in [`AGENTS.md`](AGENTS.md) (30 invariants). The critical ones:

1. **One active `current.md`** — placeholder or real plan, never both.
2. **Archives are immutable** — once written, never modified by the extension.
3. **Destructive actions require confirmation** — replace, restore, init.
4. **Sentinel detection is deterministic** — generated plans must never contain the sentinel string.
5. **`index.md` is fully regenerated** — never patched.
6. **Config never throws** — always falls back to defaults.
7. **Template system has no circular imports** — `template-core.ts` → `template-analysis.ts` → `plangen.ts`.
8. **Enforcement is toggle-based** — `/plan` toggles on/off. When off, pi-plan is a document manager only.
9. **Harness-level interception never blocks** — the user's message always reaches the agent.
10. **No home-directory state** — all canonical state lives in repo-local files under `.pi/`.
11. **No auto-approve** — browser UI is required for plan review; missing assets return an error.
12. **TDD gate is pure** — `evaluateTddGate()` has no side effects.
13. **TDD compliance logs are append-only** — existing entries never modified.
14. **Specs are immutable** — brainstorm specs never modified after write.
15. **Worktrees are gitignored** — `.worktrees/` always in `.gitignore`.

See [`AGENTS.md`](AGENTS.md) for the full list of invariants, including enforcement, harness, TDD, brainstorm, worktree, and review system invariants.

## Internal documentation

| Document | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Maintainer overview: module ownership, invariants, extension points |
| [`docs/architecture.md`](docs/architecture.md) | Architecture, state model, command flows, template system |
| [`docs/file-contracts.md`](docs/file-contracts.md) | Repo-local file semantics and contracts |
| [`tests/TESTING.md`](tests/TESTING.md) | Test coverage strategy and evidence boundaries |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | This file — contributor guide |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Pre-release verification checklist |
| [`README.md`](README.md) | User-facing documentation and manual verification steps |

## Development notes

- **TypeScript, ESM.** The package uses `"type": "module"` and Pi loads `.ts` files directly.
- **No build step.** Pi runs TypeScript source files. There is no compilation or bundling.
- **`index.ts` should stay thin.** It is a bridge from Pi's `ExtensionAPI` to the `PlanUI` interface. Business logic belongs in `orchestration.ts` and the focused modules.
- **Test isolation.** All tests use unique temp directories and clean up after themselves. No test depends on another or on global state.
- **Dependencies.** Only `@mariozechner/pi-coding-agent` (Pi SDK), `@sinclair/typebox` (schema), and `vitest` (dev). Keep it minimal.
