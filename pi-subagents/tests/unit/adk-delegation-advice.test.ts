/**
 * Unit tests: ADK delegation advice (Phase 4B).
 *
 * Behavior protected:
 *
 * A) Metadata reading / advice building
 * - no metadata → null advisory
 * - metadata without tool_plan → safe, has_tool_plan false
 * - metadata with tool_plan → advisory built correctly
 * - native_app/native_config/official_sample all handled
 * - older projects (no metadata) remain safe
 *
 * B) Recommendation logic
 * - recommended_safe_custom_tools read correctly from tool_plan
 * - user-provided safeCustomTools remains authoritative
 * - dedupe works
 * - arrays are not mutated in place
 * - effective tools are advisory-first (no silent auto-merge)
 *
 * C) Extension detection comparison
 * - expected tools detected → no missing warning
 * - expected tools missing → warning present
 * - detection with empty registry → honest caveat
 *
 * D) Delegation summary
 * - summary includes project expectations
 * - summary includes current availability
 * - summary includes recommended safe custom tools
 * - summary includes caveat that metadata is advisory
 *
 * E) Non-regression
 * - null advice for non-ADK projects
 * - null advice for missing metadata files
 * - no crashes on malformed metadata
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readAdkMetadata,
  buildDelegationAdvice,
  computeEffectiveSafeTools,
  detectCurrentExtensionTools,
  formatAdviceForOutput,
  type MetadataSnapshot,
  type DelegationAdvice,
} from "../../src/lib/adk-delegation-advice.js";
import { makeFakeTool } from "../helpers/fake-tool.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function sampleMetadata(overrides: Partial<MetadataSnapshot> = {}): MetadataSnapshot {
  return {
    schema_version: "1",
    source_type: "native_app",
    agent_name: "test-agent",
    project_path: "./agents/test-agent",
    tool_plan: {
      adk_native_tools: ["mcp_toolset"],
      pi_mono_profile: "coding",
      pi_mono_builtin_tools: ["read", "bash", "edit", "write"],
      installed_extension_tools_detected: ["run_adk_agent", "resolve_adk_agent", "some_ext_tool"],
      installed_extension_tools_selected: ["some_ext_tool"],
      required_safe_custom_tools: ["run_adk_agent", "resolve_adk_agent", "some_ext_tool"],
      notes: ["Created for testing."],
      caveats: ["This tool plan is advisory."],
    },
    ...overrides,
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "adk-advice-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A) Metadata reading / advice building
// ---------------------------------------------------------------------------

describe("readAdkMetadata", () => {
  it("returns null when metadata file does not exist", () => {
    mkdirSync(join(tempDir, "agents/empty"), { recursive: true });
    const result = readAdkMetadata(tempDir, "./agents/empty");
    expect(result).toBeNull();
  });

  it("returns null when project directory does not exist", () => {
    const result = readAdkMetadata(tempDir, "./agents/nonexistent");
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const projectDir = join(tempDir, "agents/bad");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".pi-adk-metadata.json"), "not json");
    const result = readAdkMetadata(tempDir, "./agents/bad");
    expect(result).toBeNull();
  });

  it("returns null for non-object JSON (array)", () => {
    const projectDir = join(tempDir, "agents/arr");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".pi-adk-metadata.json"), "[]");
    const result = readAdkMetadata(tempDir, "./agents/arr");
    expect(result).toBeNull();
  });

  it("reads valid metadata", () => {
    const meta = sampleMetadata();
    writeMetadata(tempDir, "agents/test-agent", meta);
    const result = readAdkMetadata(tempDir, "agents/test-agent");
    expect(result).not.toBeNull();
    expect(result!.source_type).toBe("native_app");
    expect(result!.tool_plan).toBeDefined();
  });

  it("reads metadata without tool_plan", () => {
    writeMetadata(tempDir, "agents/old", {
      schema_version: "1",
      source_type: "native_config",
      agent_name: "old-agent",
    });
    const result = readAdkMetadata(tempDir, "agents/old");
    expect(result).not.toBeNull();
    expect(result!.source_type).toBe("native_config");
    expect(result!.tool_plan).toBeUndefined();
  });
});

describe("buildDelegationAdvice", () => {
  it("returns null when no metadata exists", () => {
    mkdirSync(join(tempDir, "agents/empty"), { recursive: true });
    const registry = makeRegistry();
    const result = buildDelegationAdvice(tempDir, "./agents/empty", registry, undefined);
    expect(result).toBeNull();
  });

  it("returns advice with has_tool_plan: false when tool_plan absent", () => {
    writeMetadata(tempDir, "agents/old", {
      schema_version: "1",
      source_type: "native_app",
      agent_name: "old",
    });
    const registry = makeRegistry();
    const result = buildDelegationAdvice(tempDir, "agents/old", registry, undefined);
    expect(result).not.toBeNull();
    expect(result!.has_tool_plan).toBe(false);
    expect(result!.recommended_safe_custom_tools).toEqual([]);
    expect(result!.notes).toContainEqual(expect.stringContaining("No tool plan"));
  });

  it("returns full advice when tool_plan present", () => {
    const meta = sampleMetadata();
    writeMetadata(tempDir, "agents/test", meta);
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("resolve_adk_agent"),
      makeFakeTool("some_ext_tool")
    );
    const result = buildDelegationAdvice(tempDir, "agents/test", registry, undefined);
    expect(result).not.toBeNull();
    expect(result!.has_tool_plan).toBe(true);
    expect(result!.recommended_safe_custom_tools).toContain("run_adk_agent");
    expect(result!.recommended_safe_custom_tools).toContain("some_ext_tool");
    expect(result!.pi_mono_profile).toBe("coding");
    expect(result!.adk_native_tools).toContain("mcp_toolset");
  });

  it("handles native_app source type", () => {
    writeMetadata(tempDir, "agents/app", sampleMetadata({ source_type: "native_app" }));
    const result = buildDelegationAdvice(tempDir, "agents/app", makeRegistry(), undefined);
    expect(result!.source_type).toBe("native_app");
  });

  it("handles native_config source type", () => {
    writeMetadata(tempDir, "agents/cfg", sampleMetadata({ source_type: "native_config" }));
    const result = buildDelegationAdvice(tempDir, "agents/cfg", makeRegistry(), undefined);
    expect(result!.source_type).toBe("native_config");
  });

  it("handles official_sample source type", () => {
    writeMetadata(tempDir, "agents/samp", sampleMetadata({ source_type: "official_sample" }));
    const result = buildDelegationAdvice(tempDir, "agents/samp", makeRegistry(), undefined);
    expect(result!.source_type).toBe("official_sample");
  });
});

// ---------------------------------------------------------------------------
// B) Recommendation logic
// ---------------------------------------------------------------------------

describe("computeEffectiveSafeTools", () => {
  it("returns user-provided tools when present (deduped)", () => {
    const result = computeEffectiveSafeTools(
      ["tool_a", "tool_b", "tool_a"],
      ["tool_c"],
      makeRegistry()
    );
    expect(result).toEqual(["tool_a", "tool_b"]);
  });

  it("returns empty when no user-provided and no auto-merge", () => {
    const result = computeEffectiveSafeTools(
      undefined,
      ["recommended_tool"],
      makeRegistry()
    );
    expect(result).toEqual([]);
  });

  it("returns empty for empty user-provided array", () => {
    const result = computeEffectiveSafeTools(
      [],
      ["recommended_tool"],
      makeRegistry()
    );
    expect(result).toEqual([]);
  });

  it("does not mutate the user-provided array", () => {
    const original = ["tool_a", "tool_b"];
    const copy = [...original];
    computeEffectiveSafeTools(original, ["tool_c"], makeRegistry());
    expect(original).toEqual(copy);
  });

  it("preserves user-provided even when it differs from recommended", () => {
    const result = computeEffectiveSafeTools(
      ["only_this"],
      ["run_adk_agent", "some_ext_tool"],
      makeRegistry()
    );
    expect(result).toEqual(["only_this"]);
  });
});

describe("recommendation warnings", () => {
  it("warns when user-provided omits recommended tools", () => {
    const meta = sampleMetadata();
    writeMetadata(tempDir, "agents/test", meta);
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("resolve_adk_agent")
    );
    const result = buildDelegationAdvice(
      tempDir, "agents/test", registry,
      ["run_adk_agent"] // user only provides run_adk_agent, missing others
    );
    expect(result).not.toBeNull();
    const warnings = result!.warnings;
    // Should warn about recommended tools not in user list
    expect(warnings.some((w) => w.includes("Recommended safe custom tools not in your explicit list"))).toBe(true);
  });

  it("warns when recommended tools are not registered", () => {
    const meta = sampleMetadata();
    writeMetadata(tempDir, "agents/test", meta);
    // Empty registry — nothing registered
    const registry = makeRegistry();
    const result = buildDelegationAdvice(tempDir, "agents/test", registry, undefined);
    expect(result).not.toBeNull();
    expect(result!.warnings.some((w) => w.includes("not currently registered"))).toBe(true);
  });

  it("no registration warning when all recommended tools are registered", () => {
    const meta = sampleMetadata();
    writeMetadata(tempDir, "agents/test", meta);
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("resolve_adk_agent"),
      makeFakeTool("some_ext_tool")
    );
    const result = buildDelegationAdvice(tempDir, "agents/test", registry, undefined);
    expect(result).not.toBeNull();
    expect(result!.warnings.some((w) => w.includes("not currently registered"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C) Extension detection comparison
// ---------------------------------------------------------------------------

describe("detectCurrentExtensionTools", () => {
  it("returns empty for empty registry", () => {
    expect(detectCurrentExtensionTools(makeRegistry())).toEqual([]);
  });

  it("excludes built-in tools", () => {
    const registry = makeRegistry(
      makeFakeTool("read"),
      makeFakeTool("bash"),
      makeFakeTool("edit"),
      makeFakeTool("write"),
      makeFakeTool("custom_tool")
    );
    const result = detectCurrentExtensionTools(registry);
    expect(result).toEqual(["custom_tool"]);
  });

  it("excludes delegate_to_subagent", () => {
    const registry = makeRegistry(
      makeFakeTool("delegate_to_subagent"),
      makeFakeTool("other_tool")
    );
    const result = detectCurrentExtensionTools(registry);
    expect(result).toEqual(["other_tool"]);
  });

  it("returns sorted results", () => {
    const registry = makeRegistry(
      makeFakeTool("z_tool"),
      makeFakeTool("a_tool"),
      makeFakeTool("m_tool")
    );
    const result = detectCurrentExtensionTools(registry);
    expect(result).toEqual(["a_tool", "m_tool", "z_tool"]);
  });
});

describe("missing expected extension tools", () => {
  it("warns when expected tools are missing", () => {
    const meta = sampleMetadata(); // expects "some_ext_tool"
    writeMetadata(tempDir, "agents/test", meta);
    // Registry does NOT have some_ext_tool
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("resolve_adk_agent")
    );
    const result = buildDelegationAdvice(tempDir, "agents/test", registry, undefined);
    expect(result).not.toBeNull();
    expect(result!.missing_expected_extension_tools).toContain("some_ext_tool");
    expect(result!.warnings.some((w) => w.includes("not currently detected"))).toBe(true);
  });

  it("no missing warning when all expected tools are present", () => {
    const meta = sampleMetadata();
    writeMetadata(tempDir, "agents/test", meta);
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("resolve_adk_agent"),
      makeFakeTool("some_ext_tool")
    );
    const result = buildDelegationAdvice(tempDir, "agents/test", registry, undefined);
    expect(result).not.toBeNull();
    expect(result!.missing_expected_extension_tools).toEqual([]);
    expect(result!.warnings.some((w) => w.includes("not currently detected"))).toBe(false);
  });

  it("handles partial detection (some present, some missing)", () => {
    const meta = sampleMetadata({
      tool_plan: {
        ...sampleMetadata().tool_plan!,
        installed_extension_tools_selected: ["tool_a", "tool_b"],
      },
    });
    writeMetadata(tempDir, "agents/test", meta);
    const registry = makeRegistry(makeFakeTool("tool_a"));
    const result = buildDelegationAdvice(tempDir, "agents/test", registry, undefined);
    expect(result).not.toBeNull();
    expect(result!.missing_expected_extension_tools).toEqual(["tool_b"]);
    expect(result!.currently_detected_extension_tools).toContain("tool_a");
  });
});

// ---------------------------------------------------------------------------
// D) Delegation summary
// ---------------------------------------------------------------------------

describe("delegation summary", () => {
  it("includes project type", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    expect(result!.summary).toContain("native_app");
  });

  it("includes tool plan status", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    expect(result!.summary).toContain("present");
  });

  it("includes recommended safe custom tools", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    expect(result!.summary).toContain("run_adk_agent");
  });

  it("includes ADK-native tools", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    expect(result!.summary).toContain("mcp_toolset");
  });

  it("includes Pi Mono profile", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    expect(result!.summary).toContain("coding");
  });

  it("includes advisory caveat", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    expect(result!.summary).toContain("advisory");
  });

  it("summary for project without tool plan mentions no tool plan", () => {
    writeMetadata(tempDir, "agents/old", {
      schema_version: "1",
      source_type: "native_config",
      agent_name: "old",
    });
    const result = buildDelegationAdvice(tempDir, "agents/old", makeRegistry(), undefined);
    expect(result!.summary).toContain("absent");
  });
});

describe("formatAdviceForOutput", () => {
  it("returns the summary text", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const advice = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    const output = formatAdviceForOutput(advice!);
    expect(output).toBe(advice!.summary);
  });
});

// ---------------------------------------------------------------------------
// E) Non-regression / safety
// ---------------------------------------------------------------------------

describe("non-regression and safety", () => {
  it("returns null for non-existent project directory", () => {
    const result = buildDelegationAdvice(tempDir, "./agents/ghost", makeRegistry(), undefined);
    expect(result).toBeNull();
  });

  it("returns null for project without metadata file", () => {
    mkdirSync(join(tempDir, "agents/plain"), { recursive: true });
    const result = buildDelegationAdvice(tempDir, "agents/plain", makeRegistry(), undefined);
    expect(result).toBeNull();
  });

  it("does not crash on metadata with null tool_plan", () => {
    writeMetadata(tempDir, "agents/nullplan", {
      schema_version: "1",
      source_type: "native_app",
      agent_name: "nullplan",
      tool_plan: null,
    });
    const result = buildDelegationAdvice(tempDir, "agents/nullplan", makeRegistry(), undefined);
    expect(result).not.toBeNull();
    expect(result!.has_tool_plan).toBe(false);
  });

  it("does not crash on empty tool_plan object", () => {
    writeMetadata(tempDir, "agents/emptyplan", {
      schema_version: "1",
      source_type: "official_sample",
      agent_name: "emptyplan",
      tool_plan: {},
    });
    const result = buildDelegationAdvice(tempDir, "agents/emptyplan", makeRegistry(), undefined);
    // An empty object is truthy, so has_tool_plan should be true
    expect(result).not.toBeNull();
    expect(result!.has_tool_plan).toBe(true);
    // But defaults should be safe
    expect(result!.recommended_safe_custom_tools).toEqual([]);
    expect(result!.missing_expected_extension_tools).toEqual([]);
  });

  it("notes array always includes advisory caveat", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(tempDir, "agents/test", makeRegistry(), undefined);
    expect(result!.notes.some((n) => n.includes("advisory"))).toBe(true);
  });

  it("advice object is JSON-serializable", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const result = buildDelegationAdvice(
      tempDir, "agents/test",
      makeRegistry(makeFakeTool("run_adk_agent")),
      undefined
    );
    expect(() => JSON.stringify(result)).not.toThrow();
    const roundtrip = JSON.parse(JSON.stringify(result));
    expect(roundtrip.has_tool_plan).toBe(true);
    expect(roundtrip.source_type).toBe("native_app");
  });
});
