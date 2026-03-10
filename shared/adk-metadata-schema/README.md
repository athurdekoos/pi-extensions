# adk-metadata-schema

Canonical schema contract for `.pi-adk-metadata.json` — the thin Pi-owned metadata file written alongside ADK projects.

## Purpose

This module is the **single source of truth** for the metadata schema used by:
- **pi-google-adk** (writer) — creates and updates metadata during project creation, sample import, and drift tracking
- **pi-subagents** (reader) — reads metadata for delegation advice

Before Phase 5A, pi-subagents maintained mirrored type definitions that could silently drift from pi-google-adk's writers. This shared contract eliminates that maintenance seam.

## Design Decisions

- **Pure TypeScript types + runtime validation** — no JSON Schema or external validation library dependency
- **Relative path imports** — both packages import via `../../../shared/adk-metadata-schema/index.js`, not an npm package. This is a development-time contract, not runtime coupling.
- **Explicit schema_version** — currently `"1"`, with forward/backward compatibility handling
- **Unknown fields preserved** — additive fields from future versions are captured in `_unknown_fields`, never stripped
- **Structured validation result** — returns `{ ok, metadata, issues, warnings, errors }`, never throws
- **Graceful degradation** — missing optional sections get defaults; only truly unusable input (non-object, non-string source_type) produces `ok: false`

## Schema Version Compatibility

| Scenario | Behavior |
|----------|----------|
| Current version (`"1"`) | Validates cleanly |
| Missing `schema_version` | Assumed `"1"` with warning |
| Newer version (`"99"`) | Read in compatibility mode with warning |
| Unrecognized version | Best-effort normalization with warning |

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Canonical types, constants, validation, normalization, disk reader |
| `fixtures.ts` | Shared test fixtures for cross-package consistency tests |
| `schema-validation.test.ts` | 37 tests covering validation, normalization, round-trip, edge cases |

## Test Coverage

```
37 tests covering:
- Valid metadata (all source types, with/without tool_plan, with drift tracking)
- Missing optional sections (normalize safely)
- Unknown additive fields (preserved)
- Malformed/pathological shapes (fail clearly)
- Missing core fields (degrade or fail as designed)
- Older schema_version (normalized)
- Newer schema_version (compatibility mode)
- Round-trip stability (validate → serialize → re-validate)
- Tool plan normalization (partial plans, non-string arrays)
```

## Usage

Both packages import like:

```typescript
import {
  validateMetadata,
  readAndValidateMetadata,
  CURRENT_SCHEMA_VERSION,
  METADATA_FILENAME,
  type AdkMetadataSchema,
  type NormalizedMetadata,
  type ValidationResult,
} from "../../../shared/adk-metadata-schema/index.js";
```

Test fixtures are imported similarly:

```typescript
import {
  validNativeAppMetadata,
  validMetadataWithToolPlan,
  legacyMetadataNoToolPlan,
  metadataFromFutureVersion,
} from "../../../shared/adk-metadata-schema/fixtures.js";
```
