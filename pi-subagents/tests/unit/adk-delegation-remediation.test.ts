/**
 * Unit tests: ADK delegation remediation UX (Phase 5B).
 *
 * Behavior protected:
 *
 * A) Remediation model
 * - suggested_safe_custom_tools computed correctly from advice
 * - omitted_recommended_safe_custom_tools computed correctly
 * - remediation_actions are appropriate for each scenario
 * - can_continue_safely is always true (advisory-first)
 * - needs_attention is true only when there are real mismatches
 * - ui_prompt_recommended reflects needs_attention + actions
 *
 * B) User authority
 * - user-provided safeCustomTools preserved exactly
 * - arrays are never mutated in place
 * - no silent auto-merge occurs
 *
 * C) Missing-extension guidance
 * - missing expected tools produce warnings + remediation actions
 * - detected tools produce no false warning
 * - partial detection yields honest guidance
 *
 * D) Concise user message
 * - populated for mismatches
 * - clean for happy path
 * - distinguishes user-provided vs no-tools-provided
 *
 * E) Output/result enrichment
 * - formatRemediationForOutput returns empty for no-attention case
 * - formatRemediationForOutput returns structured text for mismatches
 * - buildRemediationPromptText produces title and body
 *
 * F) JSON serializability
 * - remediation object is serializable
 * - roundtrip preserves structure
 *
 * G) Edge cases
 * - empty advice (no tool plan) still produces safe remediation
 * - all tools present → no remediation needed
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildDelegationRemediation,
  buildRemediationPromptText,
  formatRemediationForOutput,
  type DelegationRemediation,
} from "../../src/lib/adk-delegation-remediation.js";
import {
  buildDelegationAdvice,
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

function sampleMetadata() {
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
      required_safe_custom_tools: ["run_adk_agent", "some_ext_tool"],
      notes: ["Created for testing."],
      caveats: ["This tool plan is advisory."],
    },
  };
}

/** Build advice from disk, then derive remediation. */
function buildAdviceAndRemediation(
  tempDir: string,
  projectRel: string,
  registry: Map<string, ToolDefinition>,
  userProvidedSafeTools: string[] | undefined,
): { advice: DelegationAdvice; remediation: DelegationRemediation } {
  const advice = buildDelegationAdvice(tempDir, projectRel, registry, userProvidedSafeTools);
  if (!advice) throw new Error("Expected advice but got null");
  const remediation = buildDelegationRemediation(advice, userProvidedSafeTools);
  return { advice, remediation };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "adk-remediation-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A) Remediation model
// ---------------------------------------------------------------------------

describe("remediation model", () => {
  it("computes suggested_safe_custom_tools from advice", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    expect(remediation.suggested_safe_custom_tools).toEqual(["run_adk_agent", "some_ext_tool"]);
  });

  it("computes omitted_recommended when user provides partial list", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    expect(remediation.omitted_recommended_safe_custom_tools).toEqual(["some_ext_tool"]);
  });

  it("omitted is empty when user provides all recommended tools", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.omitted_recommended_safe_custom_tools).toEqual([]);
  });

  it("omitted includes all recommended when no user tools provided", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    // effective is [] when no user tools provided, so all recommended are omitted
    expect(remediation.omitted_recommended_safe_custom_tools).toEqual(["run_adk_agent", "some_ext_tool"]);
  });

  it("remediation_actions include add_safe_custom_tools when omitted", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    expect(remediation.remediation_actions.some((a) => a.kind === "add_safe_custom_tools")).toBe(true);
  });

  it("remediation_actions include load_missing_extension when tools missing", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    // some_ext_tool not in registry → missing
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.remediation_actions.some((a) => a.kind === "load_missing_extension")).toBe(true);
  });

  it("can_continue_safely is always true (advisory-first)", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(); // nothing registered
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    expect(remediation.can_continue_safely).toBe(true);
  });

  it("needs_attention is true when there are omitted or missing tools", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    expect(remediation.needs_attention).toBe(true);
  });

  it("needs_attention is false when everything is satisfied", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.needs_attention).toBe(false);
  });

  it("ui_prompt_recommended is true only when needs_attention and actions exist", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    expect(remediation.ui_prompt_recommended).toBe(true);
  });

  it("ui_prompt_recommended is false on happy path", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.ui_prompt_recommended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B) User authority
// ---------------------------------------------------------------------------

describe("user authority", () => {
  it("user-provided safeCustomTools are reflected in effective", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
      makeFakeTool("my_special_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "my_special_tool"],
    );
    // effective mirrors what the advice computed from user input
    expect(remediation.effective_safe_custom_tools).toContain("run_adk_agent");
    expect(remediation.effective_safe_custom_tools).toContain("my_special_tool");
  });

  it("does not mutate the user-provided array", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const userTools = ["run_adk_agent"];
    const copy = [...userTools];
    buildAdviceAndRemediation(tempDir, "agents/test", registry, userTools);
    expect(userTools).toEqual(copy);
  });

  it("suggested_safe_custom_tools is a copy, not a reference to internal array", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    // Mutating the output should not affect internal state
    remediation.suggested_safe_custom_tools.push("injected");
    const { remediation: fresh } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    expect(fresh.suggested_safe_custom_tools).not.toContain("injected");
  });
});

// ---------------------------------------------------------------------------
// C) Missing-extension guidance
// ---------------------------------------------------------------------------

describe("missing-extension guidance", () => {
  it("missing expected tools produce load_missing_extension action", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    // some_ext_tool not in registry
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    const loadAction = remediation.remediation_actions.find(
      (a) => a.kind === "load_missing_extension",
    );
    expect(loadAction).toBeDefined();
    expect(loadAction!.tools).toContain("some_ext_tool");
    expect(loadAction!.description).toContain("some_ext_tool");
  });

  it("all tools detected → no load_missing_extension action", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("resolve_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.remediation_actions.some((a) => a.kind === "load_missing_extension")).toBe(false);
  });

  it("partial detection: only missing tools listed in remediation", () => {
    const meta = {
      ...sampleMetadata(),
      tool_plan: {
        ...sampleMetadata().tool_plan,
        installed_extension_tools_selected: ["tool_a", "tool_b"],
        required_safe_custom_tools: ["tool_a", "tool_b"],
      },
    };
    writeMetadata(tempDir, "agents/test", meta);
    const registry = makeRegistry(makeFakeTool("tool_a")); // tool_b missing
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    expect(remediation.missing_expected_extension_tools).toEqual(["tool_b"]);
    expect(remediation.missing_expected_extension_tools).not.toContain("tool_a");
  });
});

// ---------------------------------------------------------------------------
// D) Concise user message
// ---------------------------------------------------------------------------

describe("concise user message", () => {
  it("clean message on happy path", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.concise_user_message).toContain("No remediation needed");
  });

  it("mentions omitted tools when user provided partial list", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    expect(remediation.concise_user_message).toContain("some_ext_tool");
    expect(remediation.concise_user_message).toContain("Missing");
  });

  it("mentions missing extension tools", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.concise_user_message).toContain("not currently detected");
  });

  it("handles no user-provided tools gracefully", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    expect(remediation.concise_user_message).toContain("None were provided");
  });
});

// ---------------------------------------------------------------------------
// E) Output/result enrichment
// ---------------------------------------------------------------------------

describe("formatRemediationForOutput", () => {
  it("returns empty string when no attention needed", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(formatRemediationForOutput(remediation)).toBe("");
  });

  it("returns structured text when mismatches exist", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    const output = formatRemediationForOutput(remediation);
    expect(output).toContain("Delegation Remediation");
    expect(output).toContain("some_ext_tool");
    expect(output).toContain("advisory");
  });

  it("includes full suggested list when tools are omitted", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    const output = formatRemediationForOutput(remediation);
    expect(output).toContain('"run_adk_agent"');
    expect(output).toContain('"some_ext_tool"');
  });
});

describe("buildRemediationPromptText", () => {
  it("produces title and body", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    const { title, body } = buildRemediationPromptText(remediation);
    expect(title).toBe("Delegation mismatch detected");
    expect(body).toContain("some_ext_tool");
    expect(body).toContain("Continue?");
  });

  it("mentions omitted tools when present", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    const { body } = buildRemediationPromptText(remediation);
    expect(body).toContain("not included");
  });

  it("mentions missing extension tools when present", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    const { body } = buildRemediationPromptText(remediation);
    expect(body).toContain("not detected");
  });
});

// ---------------------------------------------------------------------------
// F) JSON serializability
// ---------------------------------------------------------------------------

describe("JSON serializability", () => {
  it("remediation object is JSON-serializable", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    expect(() => JSON.stringify(remediation)).not.toThrow();
  });

  it("roundtrip preserves structure", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent"],
    );
    const roundtrip = JSON.parse(JSON.stringify(remediation));
    expect(roundtrip.suggested_safe_custom_tools).toEqual(remediation.suggested_safe_custom_tools);
    expect(roundtrip.omitted_recommended_safe_custom_tools).toEqual(remediation.omitted_recommended_safe_custom_tools);
    expect(roundtrip.needs_attention).toBe(remediation.needs_attention);
    expect(roundtrip.can_continue_safely).toBe(remediation.can_continue_safely);
    expect(roundtrip.remediation_actions.length).toBe(remediation.remediation_actions.length);
  });
});

// ---------------------------------------------------------------------------
// G) Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("advice without tool_plan produces safe no-attention remediation", () => {
    writeMetadata(tempDir, "agents/old", {
      schema_version: "1",
      source_type: "native_app",
      agent_name: "old-agent",
    });
    const registry = makeRegistry();
    const advice = buildDelegationAdvice(tempDir, "agents/old", registry, undefined);
    expect(advice).not.toBeNull();
    const remediation = buildDelegationRemediation(advice!, undefined);
    expect(remediation.needs_attention).toBe(false);
    expect(remediation.suggested_safe_custom_tools).toEqual([]);
    expect(remediation.omitted_recommended_safe_custom_tools).toEqual([]);
    expect(remediation.remediation_actions).toEqual([]);
  });

  it("empty tool_plan produces safe remediation", () => {
    writeMetadata(tempDir, "agents/empty", {
      schema_version: "1",
      source_type: "native_app",
      agent_name: "empty",
      tool_plan: {},
    });
    const registry = makeRegistry();
    const advice = buildDelegationAdvice(tempDir, "agents/empty", registry, undefined);
    expect(advice).not.toBeNull();
    const remediation = buildDelegationRemediation(advice!, undefined);
    expect(remediation.needs_attention).toBe(false);
  });

  it("all tools present and all safe tools provided → clean happy path", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(
      makeFakeTool("run_adk_agent"),
      makeFakeTool("some_ext_tool"),
    );
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, ["run_adk_agent", "some_ext_tool"],
    );
    expect(remediation.needs_attention).toBe(false);
    expect(remediation.ui_prompt_recommended).toBe(false);
    expect(remediation.omitted_recommended_safe_custom_tools).toEqual([]);
    expect(remediation.missing_expected_extension_tools).toEqual([]);
    expect(remediation.concise_user_message).toContain("No remediation needed");
  });

  it("ui_prompt_shown and user_chose_to_continue are undefined by default", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    expect(remediation.ui_prompt_shown).toBeUndefined();
    expect(remediation.user_chose_to_continue).toBeUndefined();
  });

  it("ui_prompt_shown can be set by caller", () => {
    writeMetadata(tempDir, "agents/test", sampleMetadata());
    const registry = makeRegistry(makeFakeTool("run_adk_agent"));
    const { remediation } = buildAdviceAndRemediation(
      tempDir, "agents/test", registry, undefined,
    );
    remediation.ui_prompt_shown = true;
    remediation.user_chose_to_continue = true;
    expect(remediation.ui_prompt_shown).toBe(true);
    expect(remediation.user_chose_to_continue).toBe(true);
  });
});
