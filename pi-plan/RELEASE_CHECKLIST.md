# pi-plan Release Checklist

Lightweight checklist for verifying `pi-plan/` before a release or significant change.

## Package metadata

- [ ] `package.json` has correct `name`, `version`, and `type: "module"`
- [ ] `pi.extensions` points to `["./index.ts"]`
- [ ] `keywords` includes `"pi-package"`
- [ ] Dependencies are current (`@mariozechner/pi-coding-agent`, `@sinclair/typebox`)

## Tests

- [ ] `npm test` passes (all 571 tests)
- [ ] No skipped or pending tests without explanation
- [ ] `tests/TESTING.md` accurately describes what is and is not covered

## Install and load

- [ ] `pi -e ~/dev/pi-extensions/pi-plan` loads without errors
- [ ] `/plan`, `/plan-debug`, `/todos`, `/tdd`, `/plan-review`, `/plan-annotate`, `/plan-finish` are registered
- [ ] `submit_plan` and `submit_spec` tools are registered
- [ ] `--plan` flag is recognized
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

## Browser review system

- [ ] `assets/plan-review.html` exists and is loadable
- [ ] `assets/review-editor.html` exists and is loadable
- [ ] `submit_plan` returns error when assets are missing (no auto-approve)
- [ ] Review records are written to `.pi/plans/reviews/`

## Enforcement

- [ ] `--plan` flag activates enforcement on session start
- [ ] `/plan` toggles enforcement on/off
- [ ] Step tracking extracts from `## Implementation Plan` / `## Steps`
- [ ] `[DONE:n]` markers update step completion
- [ ] Write-gating blocks writes outside `current.md` during `needs-plan` phase
- [ ] Context messages are injected and filtered correctly

## TDD, brainstorming, and worktree

- [ ] `/tdd` toggles TDD enforcement on/off
- [ ] TDD gating blocks production file writes before test files during executing phase
- [ ] TDD compliance is logged to `.pi/tdd/compliance-YYYY-MM-DD.json`
- [ ] `[DONE:n]` validation checks TDD compliance
- [ ] `submit_spec` tool is registered and transitions brainstorming → planning
- [ ] Brainstorm specs are written to `.pi/specs/` with correct filename format
- [ ] Specs are immutable after write
- [ ] Worktree is created at `.worktrees/<slug>/` with `plan/<slug>` branch
- [ ] `.worktrees/` is added to `.gitignore`
- [ ] Worktree state is persisted in `.pi/worktrees/active.json`
- [ ] Worktree cleanup removes worktree and state on plan completion

## Finishing workflow

- [ ] `/plan-finish` is registered and accessible
- [ ] Finishing menu shows merge/PR/keep/discard options
- [ ] `gh` unavailability hides PR option
- [ ] Write-gating blocks all writes during finishing phase
- [ ] `defaultFinishAction` config skips menu when set
- [ ] `prTemplate` substitution works with `{{BRANCH}}` and `{{PLAN_TITLE}}`
- [ ] Session interrupted during finishing degrades to has-plan on restore

## No regressions

- [ ] Generated plans do not contain the placeholder sentinel
- [ ] Config errors produce warnings, not crashes
- [ ] Cancellation at any confirmation step leaves files unchanged
- [ ] Template repair offer appears for missing/invalid templates
- [ ] Index reconciliation corrects manual file changes on next command
