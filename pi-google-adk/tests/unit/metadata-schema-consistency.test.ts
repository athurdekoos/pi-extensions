/**
 * Cross-package schema consistency tests (Phase 5A).
 *
 * These tests verify that pi-google-adk's metadata writers produce
 * output that the shared schema validator accepts. They also verify
 * that shared fixtures are interpreted correctly by the validation
 * and normalization logic used in this package.
 *
 * Coverage:
 * A) Writer output is schema-valid
 * B) Shared fixtures validate correctly
 * C) Legacy metadata normalizes without error
 * D) Malformed metadata fails gracefully
 * E) Round-trip: write → validate → normalized matches original
 * F) Drift protection: fixtures that catch type mirroring drift
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import {
  buildCreationMetadata,
  buildSampleImportMetadata,
  writeCreationMetadata,
  CREATION_METADATA_FILENAME,
  validateMetadata,
  readAndValidateMetadata,
} from "../../src/lib/creation-metadata.js";
import { buildToolPlan } from "../../src/lib/tool-plan.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import {
  validNativeAppMetadata,
  validOfficialSampleMetadata,
  validMetadataWithToolPlan,
  validMetadataWithDriftTracking,
  legacyMetadataNoToolPlan,
  legacyMetadataNoTracking,
  minimalMetadata,
  metadataWithUnknownFields,
  metadataFromFutureVersion,
  metadataNoSchemaVersion,
  emptyObjectMetadata,
  nonObjectValues,
} from "../../../shared/adk-metadata-schema/fixtures.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

// ---------------------------------------------------------------------------
// A) Writer output is schema-valid
// ---------------------------------------------------------------------------

describe("writer output validates against shared schema", () => {
  it("buildCreationMetadata output passes validation", () => {
    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "test-agent",
      projectPath: "./agents/test-agent",
      adkVersion: "1.2.3",
      commandUsed: "adk create test-agent",
      supportedModes: ["native_app", "native_config"],
      creationArgs: { mode: "native_app" },
    });
    const result = validateMetadata(meta);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.metadata!.source_type).toBe("native_app");
  });

  it("buildCreationMetadata with tool plan passes validation", () => {
    const toolPlan = buildToolPlan({
      adkNativeTools: ["mcp_toolset"],
      piMonoProfile: "coding",
      extensionToolsDetected: ["run_adk_agent"],
      extensionToolsSelected: [],
    });
    const meta = buildCreationMetadata({
      sourceType: "native_config",
      agentName: "cfg-agent",
      projectPath: "./agents/cfg-agent",
      adkVersion: null,
      commandUsed: "adk create --type=config cfg-agent",
      supportedModes: ["native_app"],
      creationArgs: {},
      toolPlan,
    });
    const result = validateMetadata(meta);
    expect(result.ok).toBe(true);
    expect(result.metadata!.tool_plan).toBeDefined();
    expect(result.metadata!.tool_plan!.pi_mono_profile).toBe("coding");
  });

  it("buildSampleImportMetadata output passes validation", () => {
    const meta = buildSampleImportMetadata({
      agentName: "sample-agent",
      projectPath: "./agents/sample-agent",
      importArgs: { mode: "official_sample" },
      sampleProvenance: {
        upstream_repo: "https://github.com/google/adk-samples.git",
        upstream_path: "agents/test-sample",
        upstream_ref: "main",
        commit: "abc123",
        imported_at: "2025-01-01T00:00:00.000Z",
        sample_slug: "test-sample",
      },
    });
    const result = validateMetadata(meta);
    expect(result.ok).toBe(true);
    expect(result.metadata!.source_type).toBe("official_sample");
    expect(result.metadata!.provenance.sample_import).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// B) Shared fixtures validate correctly
// ---------------------------------------------------------------------------

describe("shared fixtures consistency", () => {
  for (const [name, fixture] of [
    ["validNativeApp", validNativeAppMetadata()],
    ["validOfficialSample", validOfficialSampleMetadata()],
    ["validWithToolPlan", validMetadataWithToolPlan()],
    ["validWithDriftTracking", validMetadataWithDriftTracking()],
  ] as const) {
    it(`${name} fixture passes validation`, () => {
      const r = validateMetadata(fixture);
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// C) Legacy metadata normalizes without error
// ---------------------------------------------------------------------------

describe("legacy metadata normalization", () => {
  it("pre-Phase 3 metadata (no tool_plan) normalizes ok", () => {
    const r = validateMetadata(legacyMetadataNoToolPlan());
    expect(r.ok).toBe(true);
    expect(r.metadata!.tool_plan).toBeUndefined();
  });

  it("pre-Phase 4 metadata (no tracking) normalizes ok", () => {
    const r = validateMetadata(legacyMetadataNoTracking());
    expect(r.ok).toBe(true);
    expect(r.metadata!.tracking).toEqual({});
  });

  it("minimal metadata normalizes with warnings", () => {
    const r = validateMetadata(minimalMetadata());
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D) Malformed metadata handled gracefully
// ---------------------------------------------------------------------------

describe("malformed metadata handling", () => {
  for (const val of nonObjectValues) {
    it(`non-object (${JSON.stringify(val)}) → ok: false`, () => {
      const r = validateMetadata(val);
      expect(r.ok).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// E) Round-trip: write → read → validate
// ---------------------------------------------------------------------------

describe("write → read → validate round-trip", () => {
  it("written metadata re-reads to same normalized shape", () => {
    const projectPath = "agents/rt-test";
    mkdirSync(`${workDir}/${projectPath}`, { recursive: true });

    const toolPlan = buildToolPlan({
      adkNativeTools: ["mcp_toolset"],
      piMonoProfile: "coding",
    });

    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "rt-test",
      projectPath: `./${projectPath}`,
      adkVersion: "1.0.0",
      commandUsed: "adk create rt-test",
      supportedModes: ["native_app"],
      creationArgs: { mode: "native_app" },
      toolPlan,
    });

    writeCreationMetadata(workDir, projectPath, meta);

    const readResult = readAndValidateMetadata(`${workDir}/${projectPath}`);
    expect(readResult.ok).toBe(true);
    expect(readResult.metadata!.source_type).toBe("native_app");
    expect(readResult.metadata!.agent_name).toBe("rt-test");
    expect(readResult.metadata!.tool_plan!.pi_mono_profile).toBe("coding");
    expect(readResult.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F) Drift protection: fixtures catch mirroring drift
// ---------------------------------------------------------------------------

describe("drift protection", () => {
  it("future schema_version is handled conservatively", () => {
    const r = validateMetadata(metadataFromFutureVersion());
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("newer than expected"))).toBe(true);
  });

  it("unknown fields are preserved not stripped", () => {
    const r = validateMetadata(metadataWithUnknownFields());
    expect(r.ok).toBe(true);
    expect(r.metadata!._unknown_fields).toHaveProperty("custom_experiment");
  });

  it("missing schema_version assumes current", () => {
    const r = validateMetadata(metadataNoSchemaVersion());
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("schema_version"))).toBe(true);
  });
});
