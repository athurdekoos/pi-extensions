/**
 * Unit tests: parameter schema validation.
 *
 * Behavior protected:
 * - Required fields are enforced
 * - Optional fields accept valid values
 * - Schema structure has correct types and enum values
 *
 * Note: StringEnum uses Type.Unsafe which is not compatible with Value.Check.
 * Enum tests inspect the schema structure instead.
 */

import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { DelegateParamsSchema } from "../../index.js";

/** Extract enum values from a schema property. */
function getEnumValues(propName: string): string[] | undefined {
  const prop = (DelegateParamsSchema.properties as Record<string, { enum?: string[] }>)[propName];
  return prop?.enum;
}

/** Extract type from a schema property. */
function getPropType(propName: string): string | undefined {
  const prop = (DelegateParamsSchema.properties as Record<string, { type?: string }>)[propName];
  return prop?.type;
}

describe("DelegateParamsSchema", () => {
  it("accepts minimal valid params (task only)", () => {
    const valid = { task: "Do something" };
    expect(Value.Check(DelegateParamsSchema, valid)).toBe(true);
  });

  it("rejects missing task", () => {
    expect(Value.Check(DelegateParamsSchema, {})).toBe(false);
  });

  it("rejects non-string task", () => {
    expect(Value.Check(DelegateParamsSchema, { task: 42 })).toBe(false);
  });

  it("mode schema has correct enum values", () => {
    const enumValues = getEnumValues("mode");
    expect(enumValues).toBeDefined();
    expect(enumValues).toContain("read_only");
    expect(enumValues).toContain("coding");
    expect(enumValues).toHaveLength(2);
  });

  it("mode schema is typed as string", () => {
    expect(getPropType("mode")).toBe("string");
  });

  it("outputStyle schema has correct enum values", () => {
    const enumValues = getEnumValues("outputStyle");
    expect(enumValues).toBeDefined();
    expect(enumValues).toContain("summary");
    expect(enumValues).toContain("patch_plan");
    expect(enumValues).toContain("full_report");
    expect(enumValues).toHaveLength(3);
  });

  it("outputStyle schema is typed as string", () => {
    expect(getPropType("outputStyle")).toBe("string");
  });

  it("accepts files as string array", () => {
    expect(
      Value.Check(DelegateParamsSchema, { task: "t", files: ["a.ts", "b.ts"] })
    ).toBe(true);
  });

  it("rejects files as non-array", () => {
    expect(
      Value.Check(DelegateParamsSchema, { task: "t", files: "a.ts" })
    ).toBe(false);
  });

  it("accepts safeCustomTools as string array", () => {
    expect(
      Value.Check(DelegateParamsSchema, { task: "t", safeCustomTools: ["gh_issue"] })
    ).toBe(true);
  });

  it("has all expected properties", () => {
    const propNames = Object.keys(DelegateParamsSchema.properties);
    expect(propNames).toContain("task");
    expect(propNames).toContain("mode");
    expect(propNames).toContain("successCriteria");
    expect(propNames).toContain("outputStyle");
    expect(propNames).toContain("files");
    expect(propNames).toContain("safeCustomTools");
    expect(propNames).toContain("modelOverride");
  });

  it("task is the only required property", () => {
    const required = DelegateParamsSchema.required;
    expect(required).toContain("task");
    // All others should be optional (not in required)
    expect(required).not.toContain("mode");
    expect(required).not.toContain("successCriteria");
    expect(required).not.toContain("outputStyle");
    expect(required).not.toContain("files");
    expect(required).not.toContain("safeCustomTools");
    expect(required).not.toContain("modelOverride");
  });
});
