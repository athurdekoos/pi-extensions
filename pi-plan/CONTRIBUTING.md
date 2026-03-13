# Contributing to pi-plan

## What is `pi-plan/`?

`pi-plan/` is the **canonical shareable package** for the Pi planning extension. It provides the `/plan` and `/plan-debug` commands as a properly packaged, tested, modular Pi extension.

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

This loads the extension from source. You can then use `/plan` and `/plan-debug` in any git repository.

### Running tests

```bash
cd pi-plan && npm test
```

All 308 tests run via vitest against temp directories. No Pi runtime or real git repos required.

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
| Command registration (thin bridge) | `index.ts` |

### What NOT to edit for packaged behavior

- **Root `.pi/` files** — These are repo-local workspace artifacts, not part of the package.
- **`.pi/legacy/`** — Historical reference only. Not loaded at runtime.
- **`.pi/docs/`** — Historical docs for the legacy extension. The canonical docs are in `pi-plan/`.

## Key invariants to preserve

These are documented in detail in [`AGENTS.md`](AGENTS.md). The critical ones:

1. **One active `current.md`** — placeholder or real plan, never both.
2. **Archives are immutable** — once written, never modified by the extension.
3. **Destructive actions require confirmation** — replace, restore, init.
4. **Sentinel detection is deterministic** — generated plans must never contain the sentinel string.
5. **`index.md` is fully regenerated** — never patched.
6. **Config never throws** — always falls back to defaults.
7. **Template system has no circular imports** — `template-core.ts` → `template-analysis.ts` → `plangen.ts`.

## Internal documentation

| Document | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Maintainer overview: module ownership, invariants, extension points |
| [`docs/architecture.md`](docs/architecture.md) | Architecture, state model, command flows, template system |
| [`docs/file-contracts.md`](docs/file-contracts.md) | Repo-local file semantics and contracts |
| [`tests/TESTING.md`](tests/TESTING.md) | Test coverage strategy and evidence boundaries |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |
| [`README.md`](README.md) | User-facing documentation and manual verification steps |

## Development notes

- **TypeScript, ESM.** The package uses `"type": "module"` and Pi loads `.ts` files directly.
- **No build step.** Pi runs TypeScript source files. There is no compilation or bundling.
- **`index.ts` should stay thin.** It is a bridge from Pi's `ExtensionAPI` to the `PlanUI` interface. Business logic belongs in `orchestration.ts` and the focused modules.
- **Test isolation.** All tests use unique temp directories and clean up after themselves. No test depends on another or on global state.
- **Dependencies.** Only `@mariozechner/pi-coding-agent` (Pi SDK), `@sinclair/typebox` (schema), and `vitest` (dev). Keep it minimal.
