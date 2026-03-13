# Legacy / Historical Reference

Files in this directory are **not auto-loaded by Pi** and are **not part of the runtime**.

They are preserved for historical/design reference only.

## `planning-protocol.ts`

The original monolithic planning-protocol extension, developed through Phases 1–6 as a single `.ts` file in `.pi/extensions/`. It was the predecessor to the [`pi-plan/`](../../pi-plan/) package.

**Moved here from** `.pi/extensions/planning-protocol.ts` to prevent Pi's project-local auto-discovery from loading it alongside the canonical `pi-plan/` package. Pi auto-discovers `.pi/extensions/*.ts` — leaving the file there created a dual-loading risk.

**For new contributors:** The canonical planning extension is [`pi-plan/`](../../pi-plan/). Do not move this file back to `.pi/extensions/`.

## `planning-state.example.json`

The default shape for the runtime state file used by the legacy extension's `/plan-on` / `/plan-off` toggle system. Not used by `pi-plan/`, which uses filesystem-based state detection instead.

**Moved here from** `.pi/planning-state.example.json` during cleanup. The runtime `planning-state.json` (gitignored) was created by copying this file at startup.
