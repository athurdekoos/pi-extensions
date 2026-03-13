# pi-plan Release Checklist

Lightweight checklist for verifying `pi-plan/` before a release or significant change.

## Package metadata

- [ ] `package.json` has correct `name`, `version`, and `type: "module"`
- [ ] `pi.extensions` points to `["./index.ts"]`
- [ ] `keywords` includes `"pi-package"`
- [ ] Dependencies are current (`@mariozechner/pi-coding-agent`, `@sinclair/typebox`)

## Tests

- [ ] `npm test` passes (all 308 tests)
- [ ] No skipped or pending tests without explanation
- [ ] `tests/TESTING.md` accurately describes what is and is not covered

## Install and load

- [ ] `pi -e ~/dev/pi-extensions/pi-plan` loads without errors
- [ ] `/plan` and `/plan-debug` are registered and appear in command list
- [ ] `pi install /path/to/pi-plan` works for global install

## Manual verification

- [ ] Walk through the manual verification steps in [README.md § Manual verification](README.md#manual-verification)
- [ ] At minimum: init flow, plan creation, resume, replace, archive browse, `/plan-debug`, cancellation

## Documentation accuracy

- [ ] `README.md` matches current behavior (commands, config options, file structure)
- [ ] `AGENTS.md` module ownership table is current
- [ ] `docs/architecture.md` reflects current module graph and state model
- [ ] `docs/file-contracts.md` reflects current file semantics
- [ ] `CHANGELOG.md` has an entry for this version
- [ ] `CONTRIBUTING.md` is current

## Package boundary

- [ ] No references to root `.pi/` paths as the package runtime
- [ ] Install instructions point to `pi-plan/`, not root `.pi/` legacy files
- [ ] Config examples use `.pi/pi-plan.json` (repo-local, created by user), not legacy state files
- [ ] User-facing command examples show `/plan` and `/plan-debug` only (not legacy commands)

## No regressions

- [ ] Generated plans do not contain the placeholder sentinel
- [ ] Config errors produce warnings, not crashes
- [ ] Cancellation at any confirmation step leaves files unchanged
- [ ] Template repair offer appears for missing/invalid templates
- [ ] Index reconciliation corrects manual file changes on next command
