/**
 * Unit tests: curated sample catalog and recommendation scoring.
 *
 * Behavior protected:
 * - Catalog loads and contains entries
 * - findSampleBySlug returns correct entry
 * - findSampleBySlug returns undefined for unknown slug
 * - allSampleSlugs returns all slugs
 * - All entries are Python-only
 * - recommendSamples returns ranked results for representative intents
 * - Unknown/edge-case answers do not crash
 * - Beginner intent surfaces hello_world
 */

import { describe, it, expect } from "vitest";
import {
  SAMPLE_CATALOG,
  findSampleBySlug,
  allSampleSlugs,
  recommendSamples,
  type RecommendationAnswers,
} from "../../src/lib/sample-catalog.js";

describe("SAMPLE_CATALOG", () => {
  it("contains at least one entry", () => {
    expect(SAMPLE_CATALOG.length).toBeGreaterThan(0);
  });

  it("all entries are Python-only", () => {
    for (const entry of SAMPLE_CATALOG) {
      expect(entry.language).toBe("python");
    }
  });

  it("all entries have required fields", () => {
    for (const entry of SAMPLE_CATALOG) {
      expect(entry.slug).toBeTruthy();
      expect(entry.display_name).toBeTruthy();
      expect(entry.upstream_path).toBeTruthy();
      expect(entry.short_description).toBeTruthy();
      expect(entry.categories.length).toBeGreaterThan(0);
      expect(entry.complexity).toBeTruthy();
      expect(entry.recommended_for.length).toBeGreaterThan(0);
      expect(entry.why_pick_this).toBeTruthy();
    }
  });

  it("all slugs are unique", () => {
    const slugs = SAMPLE_CATALOG.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("findSampleBySlug", () => {
  it("returns entry for known slug", () => {
    const entry = findSampleBySlug("hello_world");
    expect(entry).toBeDefined();
    expect(entry!.slug).toBe("hello_world");
    expect(entry!.display_name).toBe("Hello World Agent");
  });

  it("returns undefined for unknown slug", () => {
    expect(findSampleBySlug("nonexistent_agent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(findSampleBySlug("")).toBeUndefined();
  });
});

describe("allSampleSlugs", () => {
  it("returns all slugs", () => {
    const slugs = allSampleSlugs();
    expect(slugs.length).toBe(SAMPLE_CATALOG.length);
    expect(slugs).toContain("hello_world");
  });
});

describe("recommendSamples", () => {
  it("returns results for research_assistant intent", () => {
    const answers: RecommendationAnswers = {
      intent: "research_assistant",
      complexity: "simple",
      integrations: "builtin",
    };
    const results = recommendSamples(answers);
    expect(results.length).toBeGreaterThan(0);
    // Should include research-related samples
    const slugs = results.map((r) => r.slug);
    expect(slugs.some((s) => s === "brand_search_agent" || s === "rag_agent")).toBe(true);
  });

  it("returns results for customer_support intent", () => {
    const answers: RecommendationAnswers = {
      intent: "customer_support",
      complexity: "advanced",
      integrations: "unsure",
    };
    const results = recommendSamples(answers);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slug).toBe("customer_service");
  });

  it("returns results for coding intent", () => {
    const answers: RecommendationAnswers = {
      intent: "coding",
      complexity: "advanced",
      integrations: "builtin",
    };
    const results = recommendSamples(answers);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.slug === "code_agent")).toBe(true);
  });

  it("beginner complexity surfaces hello_world prominently", () => {
    const answers: RecommendationAnswers = {
      intent: "other",
      complexity: "beginner",
      integrations: "unsure",
    };
    const results = recommendSamples(answers);
    expect(results.length).toBeGreaterThan(0);
    // hello_world should be in results (likely first)
    expect(results.some((r) => r.slug === "hello_world")).toBe(true);
  });

  it("respects maxResults", () => {
    const answers: RecommendationAnswers = {
      intent: "other",
      complexity: "simple",
      integrations: "unsure",
    };
    const results = recommendSamples(answers, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("does not crash on edge-case answers", () => {
    const answers: RecommendationAnswers = {
      intent: "other",
      complexity: "beginner",
      integrations: "unsure",
    };
    expect(() => recommendSamples(answers)).not.toThrow();
  });

  it("multimodal intent returns multimodal sample", () => {
    const answers: RecommendationAnswers = {
      intent: "multimodal",
      complexity: "advanced",
      integrations: "builtin",
    };
    const results = recommendSamples(answers);
    expect(results.some((r) => r.slug === "multimodal_agent")).toBe(true);
  });

  it("content_generation intent returns content writer", () => {
    const answers: RecommendationAnswers = {
      intent: "content_generation",
      complexity: "simple",
      integrations: "builtin",
    };
    const results = recommendSamples(answers);
    expect(results[0].slug).toBe("content_writer");
  });
});
