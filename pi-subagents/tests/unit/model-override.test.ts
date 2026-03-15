/**
 * Unit tests: model override validation (Issue 1).
 *
 * Behavior protected:
 * - Valid "provider/model-id" format resolves when model exists in registry
 * - Invalid format (no slash, empty parts) produces a warning and falls back
 * - Missing model registry produces a warning and falls back
 * - Model not found in registry produces a warning and falls back
 * - modelOverrideApplied flag reflects actual outcome
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// We test the model override logic extracted as a pure helper.
// The actual logic lives inline in the execute() body of index.ts, so we
// replicate the same algorithm here to unit-test it in isolation.
// ---------------------------------------------------------------------------

interface FakeModel {
  provider: string;
  id: string;
}

interface FakeModelRegistry {
  find(provider: string, modelId: string): FakeModel | undefined;
}

/**
 * Extracted model override resolution logic — mirrors index.ts ~line 821-845.
 */
function resolveModelOverride(
  modelOverride: string | undefined,
  parentModel: FakeModel,
  modelRegistry: FakeModelRegistry | undefined,
): { childModel: FakeModel; modelOverrideApplied: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let childModel = parentModel;
  let modelOverrideApplied = false;

  if (modelOverride) {
    if (!modelRegistry) {
      warnings.push(`Model override "${modelOverride}" ignored: no model registry available.`);
    } else {
      const parts = modelOverride.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        warnings.push(`Model override "${modelOverride}" ignored: expected "provider/model-id" format.`);
      } else {
        const found = modelRegistry.find(parts[0], parts[1]);
        if (found) {
          childModel = found;
          modelOverrideApplied = true;
        } else {
          warnings.push(`Model override "${modelOverride}" ignored: model not found in registry.`);
        }
      }
    }
  }

  return { childModel, modelOverrideApplied, warnings };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const parentModel: FakeModel = { provider: "default", id: "parent-model" };
const overrideModel: FakeModel = { provider: "openai", id: "gpt-4" };

function makeRegistry(models: FakeModel[]): FakeModelRegistry {
  return {
    find(provider: string, modelId: string) {
      return models.find((m) => m.provider === provider && m.id === modelId);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("model override resolution", () => {
  it("uses parent model when no override is provided", () => {
    const result = resolveModelOverride(undefined, parentModel, makeRegistry([]));
    expect(result.childModel).toBe(parentModel);
    expect(result.modelOverrideApplied).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("resolves valid provider/model-id format", () => {
    const registry = makeRegistry([overrideModel]);
    const result = resolveModelOverride("openai/gpt-4", parentModel, registry);
    expect(result.childModel).toBe(overrideModel);
    expect(result.modelOverrideApplied).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns and falls back when model registry is missing", () => {
    const result = resolveModelOverride("openai/gpt-4", parentModel, undefined);
    expect(result.childModel).toBe(parentModel);
    expect(result.modelOverrideApplied).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no model registry available");
  });

  it("warns and falls back for invalid format — no slash", () => {
    const registry = makeRegistry([overrideModel]);
    const result = resolveModelOverride("just-a-model", parentModel, registry);
    expect(result.childModel).toBe(parentModel);
    expect(result.modelOverrideApplied).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('expected "provider/model-id" format');
  });

  it("warns and falls back for invalid format — empty provider", () => {
    const registry = makeRegistry([overrideModel]);
    const result = resolveModelOverride("/gpt-4", parentModel, registry);
    expect(result.childModel).toBe(parentModel);
    expect(result.modelOverrideApplied).toBe(false);
    expect(result.warnings[0]).toContain('expected "provider/model-id" format');
  });

  it("warns and falls back for invalid format — empty model-id", () => {
    const registry = makeRegistry([overrideModel]);
    const result = resolveModelOverride("openai/", parentModel, registry);
    expect(result.childModel).toBe(parentModel);
    expect(result.modelOverrideApplied).toBe(false);
    expect(result.warnings[0]).toContain('expected "provider/model-id" format');
  });

  it("warns and falls back for invalid format — too many slashes", () => {
    const registry = makeRegistry([overrideModel]);
    const result = resolveModelOverride("a/b/c", parentModel, registry);
    expect(result.childModel).toBe(parentModel);
    expect(result.modelOverrideApplied).toBe(false);
    expect(result.warnings[0]).toContain('expected "provider/model-id" format');
  });

  it("warns and falls back when model not found in registry", () => {
    const registry = makeRegistry([overrideModel]);
    const result = resolveModelOverride("anthropic/claude-3", parentModel, registry);
    expect(result.childModel).toBe(parentModel);
    expect(result.modelOverrideApplied).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("model not found in registry");
  });
});
