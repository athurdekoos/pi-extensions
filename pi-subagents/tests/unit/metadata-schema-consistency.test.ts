/**
 * Cross-package schema consistency tests (Phase 5A).
 *
 * These tests verify that pi-subagents' metadata reader interprets
 * shared fixtures identically to the shared schema validator. They
 * also verify that delegation advice works correctly with normalized
 * metadata from all supported shapes.
 *
 * Coverage:
 * A) Shared fixtures read correctly by delegation advice
 * B) Legacy metadata handled gracefully in delegation
 * C) Malformed metadata → null advice (safe degradation)
 * D) Future/unknown metadata → compatible advice
 * E) Tool plan interpretation matches shared contract
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readAdkMetadata,
  readAdkMetadataValidated,
  buildDelegationAdvice,
} from "../../src/lib/adk-delegation-advice.js";
import { makeFakeTool } from "../helpers/fake-tool.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
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
} from "../../../shared/adk-metadata-schema/fixtures.js";
import {
  validateMetadata,
  CURRENT_SCHEMA_VERSION,
} from "../../../shared/adk-metadata-schema/index.js";

function makeRegistry(...tools: ToolDefinition[]): Map<string, ToolDefinition> {
  const m = new Map<string, ToolDefinition>();
  for (const t of tools) m.set(t.name, t);
  return m;
}

function writeMetadata(dir: string, projectRel: string, meta: object): void {
  const projectDir = join(dir, projectRel);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, ".pi-adk-metadata.json"),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "adk-schema-consistency-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A) Shared fixtures read correctly
// ---------------------------------------------------------------------------

describe("shared fixtures via readAdkMetadata", () => {
  it("validNativeApp reads source_type=native_app", () => {
    writeMetadata(tempDir, "agents/test", validNativeAppMetadata());
    const result = readAdkMetadata(tempDir, "agents/test");
    expect(result).not.toBeNull();
    expect(result!.source_type).toBe("native_app");
  });

  it("validOfficialSample reads source_type=official_sample", () => {
    writeMetadata(tempDir, "agents/sample", validOfficialSampleMetadata());
    const result = readAdkMetadata(tempDir, "agents/sample");
    expect(result).not.toBeNull();
    expect(result!.source_type).toBe("official_sample");
  });

  it("validWithToolPlan reads tool_plan correctly", () => {
    writeMetadata(tempDir, "agents/planned", validMetadataWithToolPlan());
    const result = readAdkMetadata(tempDir, "agents/planned");
    expect(result).not.toBeNull();
    expect(result!.tool_plan).toBeDefined();
    expect(result!.tool_plan!.pi_mono_profile).toBe("coding");
    expect(result!.tool_plan!.required_safe_custom_tools).toContain("run_adk_agent");
  });

  it("validWithDriftTracking reads tracking fields", () => {
    writeMetadata(tempDir, "agents/tracked", validMetadataWithDriftTracking());
    const result = readAdkMetadataValidated(tempDir, "agents/tracked");
    expect(result.ok).toBe(true);
    expect(result.metadata!.tracking.last_drift_status).toBe("up_to_date");
  });
});

// ---------------------------------------------------------------------------
// B) Legacy metadata → delegation advice works
// ---------------------------------------------------------------------------

describe("legacy metadata delegation", () => {
  it("pre-Phase 3 (no tool_plan) → advice with has_tool_plan: false", () => {
    writeMetadata(tempDir, "agents/legacy", legacyMetadataNoToolPlan());
    const advice = buildDelegationAdvice(tempDir, "agents/legacy", makeRegistry(), undefined);
    expect(advice).not.toBeNull();
    expect(advice!.has_tool_plan).toBe(false);
    expect(advice!.recommended_safe_custom_tools).toEqual([]);
  });

  it("pre-Phase 4 (no tracking) → advice still works", () => {
    writeMetadata(tempDir, "agents/notrack", legacyMetadataNoTracking());
    const advice = buildDelegationAdvice(tempDir, "agents/notrack", makeRegistry(), undefined);
    expect(advice).not.toBeNull();
    expect(advice!.source_type).toBe("official_sample");
  });

  it("minimal metadata → advice with defaults", () => {
    writeMetadata(tempDir, "agents/minimal", minimalMetadata());
    const advice = buildDelegationAdvice(tempDir, "agents/minimal", makeRegistry(), undefined);
    expect(advice).not.toBeNull();
    expect(advice!.source_type).toBe("native_app");
    expect(advice!.has_tool_plan).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C) Malformed metadata → safe degradation
// ---------------------------------------------------------------------------

describe("malformed metadata safety", () => {
  it("invalid JSON → null advice", () => {
    const projectDir = join(tempDir, "agents/bad");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".pi-adk-metadata.json"), "not json");
    const advice = buildDelegationAdvice(tempDir, "agents/bad", makeRegistry(), undefined);
    expect(advice).toBeNull();
  });

  it("non-object JSON → null advice", () => {
    const projectDir = join(tempDir, "agents/arr");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".pi-adk-metadata.json"), "[]");
    const advice = buildDelegationAdvice(tempDir, "agents/arr", makeRegistry(), undefined);
    expect(advice).toBeNull();
  });

  it("source_type as number → null advice (fatal)", () => {
    writeMetadata(tempDir, "agents/badtype", { source_type: 42 });
    const advice = buildDelegationAdvice(tempDir, "agents/badtype", makeRegistry(), undefined);
    expect(advice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D) Future/unknown metadata → compatible advice
// ---------------------------------------------------------------------------

describe("future metadata compatibility", () => {
  it("future schema_version → advice still built", () => {
    writeMetadata(tempDir, "agents/future", metadataFromFutureVersion());
    const advice = buildDelegationAdvice(tempDir, "agents/future", makeRegistry(), undefined);
    expect(advice).not.toBeNull();
    expect(advice!.source_type).toBe("native_app");
    // Notes should mention schema compatibility
    expect(advice!.notes.some((n) => n.includes("Schema:") && n.includes("compatibility"))).toBe(true);
  });

  it("unknown additive fields → advice still built", () => {
    writeMetadata(tempDir, "agents/extra", metadataWithUnknownFields());
    const advice = buildDelegationAdvice(tempDir, "agents/extra", makeRegistry(), undefined);
    expect(advice).not.toBeNull();
    expect(advice!.source_type).toBe("native_app");
  });

  it("missing schema_version → advice still built", () => {
    writeMetadata(tempDir, "agents/nover", metadataNoSchemaVersion());
    const advice = buildDelegationAdvice(tempDir, "agents/nover", makeRegistry(), undefined);
    expect(advice).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E) Tool plan interpretation consistency
// ---------------------------------------------------------------------------

describe("tool plan interpretation matches shared contract", () => {
  it("same fixture validates identically via shared and reader", () => {
    const fixture = validMetadataWithToolPlan();

    // Shared validator
    const shared = validateMetadata(fixture);
    expect(shared.ok).toBe(true);

    // pi-subagents reader
    writeMetadata(tempDir, "agents/plan", fixture);
    const subResult = readAdkMetadataValidated(tempDir, "agents/plan");
    expect(subResult.ok).toBe(true);

    // Core fields match
    expect(subResult.metadata!.source_type).toBe(shared.metadata!.source_type);
    expect(subResult.metadata!.agent_name).toBe(shared.metadata!.agent_name);
    expect(subResult.metadata!.tool_plan!.pi_mono_profile).toBe(shared.metadata!.tool_plan!.pi_mono_profile);
    expect(subResult.metadata!.tool_plan!.required_safe_custom_tools).toEqual(
      shared.metadata!.tool_plan!.required_safe_custom_tools
    );
  });

  it("source_type interpretation aligns across shared and reader", () => {
    for (const st of ["native_app", "native_config", "official_sample"] as const) {
      const fixture = { ...validNativeAppMetadata(), source_type: st };

      const shared = validateMetadata(fixture);
      writeMetadata(tempDir, `agents/${st}`, fixture);
      const reader = readAdkMetadataValidated(tempDir, `agents/${st}`);

      expect(shared.metadata!.source_type).toBe(st);
      expect(reader.metadata!.source_type).toBe(st);
    }
  });
});
