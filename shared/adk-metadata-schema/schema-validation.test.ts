/**
 * Canonical schema validation tests.
 *
 * These tests verify the shared contract that both pi-google-adk and
 * pi-subagents depend on. Any test failure here means one or both
 * packages may misinterpret metadata.
 *
 * Coverage:
 * A) Valid metadata passes cleanly
 * B) Missing optional sections normalize safely
 * C) Unknown additive fields are preserved
 * D) Malformed / pathological shapes fail clearly
 * E) Missing core fields degrade or fail as designed
 * F) Older schema_version is normalized
 * G) Newer schema_version is read in compatibility mode
 * H) Round-trip: write → validate → normalized matches
 */

import { describe, it, expect } from "vitest";
import {
  validateMetadata,
  CURRENT_SCHEMA_VERSION,
  METADATA_FILENAME,
  type NormalizedMetadata,
  type ValidationResult,
} from "./index.js";
import {
  validNativeAppMetadata,
  validNativeConfigMetadata,
  validOfficialSampleMetadata,
  validMetadataWithToolPlan,
  validMetadataWithDriftTracking,
  legacyMetadataNoToolPlan,
  legacyMetadataNoTracking,
  minimalMetadata,
  metadataMissingSourceType,
  metadataWithUnknownFields,
  metadataFromFutureVersion,
  metadataNoSchemaVersion,
  emptyObjectMetadata,
  nonObjectValues,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// A) Valid metadata passes
// ---------------------------------------------------------------------------

describe("valid current metadata", () => {
  it("native_app metadata passes with no errors", () => {
    const r = validateMetadata(validNativeAppMetadata());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.metadata).not.toBeNull();
    expect(r.metadata!.source_type).toBe("native_app");
    expect(r.metadata!.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("native_config metadata passes", () => {
    const r = validateMetadata(validNativeConfigMetadata());
    expect(r.ok).toBe(true);
    expect(r.metadata!.source_type).toBe("native_config");
  });

  it("official_sample metadata passes", () => {
    const r = validateMetadata(validOfficialSampleMetadata());
    expect(r.ok).toBe(true);
    expect(r.metadata!.source_type).toBe("official_sample");
    expect(r.metadata!.provenance.sample_import).toBeDefined();
    expect(r.metadata!.provenance.sample_import!.upstream_repo).toContain("google");
  });

  it("metadata with tool_plan passes and preserves plan", () => {
    const r = validateMetadata(validMetadataWithToolPlan());
    expect(r.ok).toBe(true);
    expect(r.metadata!.tool_plan).toBeDefined();
    expect(r.metadata!.tool_plan!.pi_mono_profile).toBe("coding");
    expect(r.metadata!.tool_plan!.required_safe_custom_tools).toContain("run_adk_agent");
  });

  it("metadata with drift tracking passes", () => {
    const r = validateMetadata(validMetadataWithDriftTracking());
    expect(r.ok).toBe(true);
    expect(r.metadata!.tracking.last_drift_status).toBe("up_to_date");
  });

  it("no unknown fields → empty _unknown_fields", () => {
    const r = validateMetadata(validNativeAppMetadata());
    expect(Object.keys(r.metadata!._unknown_fields)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B) Missing optional sections normalize safely
// ---------------------------------------------------------------------------

describe("missing optional sections", () => {
  it("no tool_plan → normalized metadata has no tool_plan", () => {
    const r = validateMetadata(legacyMetadataNoToolPlan());
    expect(r.ok).toBe(true);
    expect(r.metadata!.tool_plan).toBeUndefined();
  });

  it("empty tracking → normalized tracking is empty object", () => {
    const r = validateMetadata(legacyMetadataNoTracking());
    expect(r.ok).toBe(true);
    expect(r.metadata!.tracking).toEqual({});
  });

  it("minimal metadata normalizes with defaults", () => {
    const r = validateMetadata(minimalMetadata());
    expect(r.ok).toBe(true);
    expect(r.metadata!.source_type).toBe("native_app");
    expect(r.metadata!.agent_name).toBe("bare-agent");
    expect(r.metadata!.adk_cli.detected_version).toBeNull();
    expect(r.metadata!.provenance.created_at).toBe("");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("missing adk_cli section → defaults", () => {
    const m = { ...validNativeAppMetadata() } as Record<string, unknown>;
    delete m.adk_cli;
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.adk_cli.detected_version).toBeNull();
    expect(r.metadata!.adk_cli.command_used).toBe("");
  });

  it("missing pi_google_adk section → default extension_version", () => {
    const m = { ...validNativeAppMetadata() } as Record<string, unknown>;
    delete m.pi_google_adk;
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.pi_google_adk.extension_version).toBe("unknown");
  });

  it("missing provenance section → defaults", () => {
    const m = { ...validNativeAppMetadata() } as Record<string, unknown>;
    delete m.provenance;
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.provenance.created_at).toBe("");
    expect(r.metadata!.provenance.creation_args).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// C) Unknown additive fields preserved
// ---------------------------------------------------------------------------

describe("unknown additive fields", () => {
  it("unknown fields are captured in _unknown_fields", () => {
    const r = validateMetadata(metadataWithUnknownFields());
    expect(r.ok).toBe(true);
    expect(r.metadata!._unknown_fields).toHaveProperty("custom_experiment");
    expect(r.metadata!._unknown_fields).toHaveProperty("future_field");
  });

  it("diagnostics mention unknown fields", () => {
    const r = validateMetadata(metadataWithUnknownFields());
    expect(r.metadata!._schema_diagnostics.some((d) => d.includes("Unknown additive fields"))).toBe(true);
  });

  it("core fields are NOT in _unknown_fields", () => {
    const r = validateMetadata(metadataWithUnknownFields());
    expect(r.metadata!._unknown_fields).not.toHaveProperty("source_type");
    expect(r.metadata!._unknown_fields).not.toHaveProperty("agent_name");
  });
});

// ---------------------------------------------------------------------------
// D) Malformed / pathological shapes fail clearly
// ---------------------------------------------------------------------------

describe("malformed metadata", () => {
  for (const val of nonObjectValues) {
    it(`non-object value (${JSON.stringify(val)}) → ok: false`, () => {
      const r = validateMetadata(val);
      expect(r.ok).toBe(false);
      expect(r.metadata).toBeNull();
      expect(r.errors.length).toBeGreaterThan(0);
    });
  }

  it("empty object normalizes with warnings (not fatal)", () => {
    const r = validateMetadata(emptyObjectMetadata());
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    // Gets defaults
    expect(r.metadata!.source_type).toBe("native_app");
    expect(r.metadata!.agent_name).toBe("");
  });

  it("source_type as non-string → error, ok: false", () => {
    const r = validateMetadata({ source_type: 42 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("source_type"))).toBe(true);
  });

  it("tool_plan as non-object → ignored with warning", () => {
    const m = { ...validNativeAppMetadata(), tool_plan: "not an object" };
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.tool_plan).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("tool_plan"))).toBe(true);
  });

  it("adk_cli as non-object → defaults with warning", () => {
    const m = { ...validNativeAppMetadata(), adk_cli: "bad" };
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.adk_cli.detected_version).toBeNull();
    expect(r.warnings.some((w) => w.includes("adk_cli"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E) Missing core fields
// ---------------------------------------------------------------------------

describe("missing core fields", () => {
  it("missing source_type → defaults to native_app with warning", () => {
    const r = validateMetadata(metadataMissingSourceType());
    expect(r.ok).toBe(true);
    expect(r.metadata!.source_type).toBe("native_app");
    expect(r.warnings.some((w) => w.includes("source_type"))).toBe(true);
  });

  it("missing agent_name → empty string with warning", () => {
    const r = validateMetadata({ schema_version: "1", source_type: "native_app" });
    expect(r.ok).toBe(true);
    expect(r.metadata!.agent_name).toBe("");
    expect(r.warnings.some((w) => w.includes("agent_name"))).toBe(true);
  });

  it("unrecognized source_type string → defaults to native_app", () => {
    const r = validateMetadata({ ...validNativeAppMetadata(), source_type: "something_new" });
    expect(r.ok).toBe(true);
    expect(r.metadata!.source_type).toBe("native_app");
    expect(r.warnings.some((w) => w.includes("something_new"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F) Older schema_version handling
// ---------------------------------------------------------------------------

describe("schema version handling", () => {
  it("missing schema_version → assumes current with warning", () => {
    const r = validateMetadata(metadataNoSchemaVersion());
    expect(r.ok).toBe(true);
    expect(r.metadata!.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(r.warnings.some((w) => w.includes("schema_version"))).toBe(true);
    expect(r.metadata!._schema_diagnostics.some((d) => d.includes("assumed"))).toBe(true);
  });

  it("current schema_version passes without version warning", () => {
    const r = validateMetadata(validNativeAppMetadata());
    expect(r.warnings.filter((w) => w.includes("schema_version"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// G) Newer schema_version compatibility mode
// ---------------------------------------------------------------------------

describe("future schema_version", () => {
  it("newer schema_version → ok with compatibility warning", () => {
    const r = validateMetadata(metadataFromFutureVersion());
    expect(r.ok).toBe(true);
    expect(r.metadata!.schema_version).toBe("99");
    expect(r.warnings.some((w) => w.includes("newer than expected"))).toBe(true);
    expect(r.metadata!._schema_diagnostics.some((d) => d.includes("compatibility mode"))).toBe(true);
  });

  it("future metadata unknown fields are preserved", () => {
    const r = validateMetadata(metadataFromFutureVersion());
    expect(r.metadata!._unknown_fields).toHaveProperty("future_section");
  });
});

// ---------------------------------------------------------------------------
// H) Round-trip stability
// ---------------------------------------------------------------------------

describe("round-trip stability", () => {
  it("valid metadata survives validate → JSON → validate", () => {
    const original = validMetadataWithToolPlan();
    const r1 = validateMetadata(original);
    expect(r1.ok).toBe(true);

    // Serialize normalized (strip internal fields) and re-validate
    const serialized = { ...r1.metadata! } as Record<string, unknown>;
    delete serialized._unknown_fields;
    delete serialized._schema_diagnostics;

    const r2 = validateMetadata(serialized);
    expect(r2.ok).toBe(true);
    expect(r2.metadata!.source_type).toBe(r1.metadata!.source_type);
    expect(r2.metadata!.agent_name).toBe(r1.metadata!.agent_name);
    expect(r2.metadata!.tool_plan?.pi_mono_profile).toBe(r1.metadata!.tool_plan?.pi_mono_profile);
  });

  it("unknown fields survive round-trip", () => {
    const r1 = validateMetadata(metadataWithUnknownFields());
    expect(r1.ok).toBe(true);

    // Re-serialize including unknown fields
    const reserialized = {
      ...r1.metadata!,
      ...r1.metadata!._unknown_fields,
    } as Record<string, unknown>;
    delete reserialized._unknown_fields;
    delete reserialized._schema_diagnostics;

    const r2 = validateMetadata(reserialized);
    expect(r2.ok).toBe(true);
    expect(r2.metadata!._unknown_fields).toHaveProperty("custom_experiment");
  });
});

// ---------------------------------------------------------------------------
// I) Tool plan normalization
// ---------------------------------------------------------------------------

describe("tool plan normalization", () => {
  it("partial tool plan → missing arrays default to []", () => {
    const m = {
      ...validNativeAppMetadata(),
      tool_plan: { pi_mono_profile: "coding" },
    };
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.tool_plan!.adk_native_tools).toEqual([]);
    expect(r.metadata!.tool_plan!.required_safe_custom_tools).toEqual([]);
    expect(r.metadata!.tool_plan!.notes).toEqual([]);
  });

  it("null tool_plan → undefined (absent)", () => {
    const m = { ...validNativeAppMetadata(), tool_plan: null };
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.tool_plan).toBeUndefined();
  });

  it("tool_plan arrays with non-strings → filtered", () => {
    const m = {
      ...validNativeAppMetadata(),
      tool_plan: {
        adk_native_tools: ["mcp_toolset", 42, null],
        required_safe_custom_tools: [true, "run_adk_agent"],
        notes: [],
        caveats: [],
      },
    };
    const r = validateMetadata(m);
    expect(r.ok).toBe(true);
    expect(r.metadata!.tool_plan!.adk_native_tools).toEqual(["mcp_toolset"]);
    expect(r.metadata!.tool_plan!.required_safe_custom_tools).toEqual(["run_adk_agent"]);
  });
});
