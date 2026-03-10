/**
 * Curated local catalog of official Google ADK samples.
 *
 * Maps a subset of google/adk-samples into a recommendation-friendly
 * structure. This is intentionally curated and Python-only — we do NOT
 * dynamically discover from the upstream repo at runtime.
 *
 * Each entry contains enough metadata for:
 * - display in interactive selection
 * - recommendation scoring from wizard answers
 * - git-based selective import
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SampleCategory =
  | "research"
  | "customer_support"
  | "content_generation"
  | "coding"
  | "multimodal"
  | "workflow"
  | "demo"
  | "rag";

export type SampleComplexity = "starter" | "intermediate" | "advanced";

export interface CatalogEntry {
  /** Unique identifier — used as the sample_slug parameter. */
  slug: string;
  /** Human-readable display name. */
  display_name: string;
  /** Language. Always "python" for this phase. */
  language: "python";
  /** Path within google/adk-samples repo. */
  upstream_path: string;
  /** One-line description. */
  short_description: string;
  /** Categories for recommendation scoring. */
  categories: SampleCategory[];
  /** Complexity level. */
  complexity: SampleComplexity;
  /** User intent keywords for recommendation matching. */
  recommended_for: string[];
  /** Short explanation of why someone would pick this. */
  why_pick_this: string;
  /** Optional notes or warnings. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Curated catalog
// ---------------------------------------------------------------------------

/**
 * Upstream repo URL.
 */
export const UPSTREAM_REPO = "https://github.com/google/adk-samples.git";

/**
 * The curated catalog of official ADK samples.
 * Start small and expand as needed.
 */
export const SAMPLE_CATALOG: readonly CatalogEntry[] = [
  {
    slug: "brand_search_agent",
    display_name: "Brand Search Agent",
    language: "python",
    upstream_path: "agents/brand-search-agent",
    short_description:
      "Searches for brand-related information using Google Search tools.",
    categories: ["research"],
    complexity: "starter",
    recommended_for: ["research assistant", "search", "brand research"],
    why_pick_this:
      "Good starting point for building a research agent that uses Google Search.",
  },
  {
    slug: "customer_service",
    display_name: "Customer Service Agent",
    language: "python",
    upstream_path: "agents/customer-service",
    short_description:
      "Multi-turn customer service agent with tool-based lookup and escalation.",
    categories: ["customer_support"],
    complexity: "intermediate",
    recommended_for: ["customer support", "helpdesk", "service"],
    why_pick_this:
      "Production-oriented pattern for customer-facing support agents.",
  },
  {
    slug: "rag_agent",
    display_name: "RAG Agent",
    language: "python",
    upstream_path: "agents/rag-agent",
    short_description:
      "Retrieval-augmented generation agent that answers from a document corpus.",
    categories: ["research", "rag"],
    complexity: "intermediate",
    recommended_for: ["research assistant", "document search", "knowledge base", "rag"],
    why_pick_this:
      "Shows how to integrate document retrieval into an ADK agent.",
  },
  {
    slug: "code_agent",
    display_name: "Code Agent",
    language: "python",
    upstream_path: "agents/code-agent",
    short_description:
      "Agent that generates, explains, and debugs code using Gemini.",
    categories: ["coding"],
    complexity: "intermediate",
    recommended_for: ["coding", "debugging", "code generation", "developer tools"],
    why_pick_this:
      "Starting point for building coding assistants with the ADK.",
  },
  {
    slug: "content_writer",
    display_name: "Content Writer Agent",
    language: "python",
    upstream_path: "agents/content-writer",
    short_description:
      "Generates blog posts, summaries, and other written content.",
    categories: ["content_generation"],
    complexity: "starter",
    recommended_for: ["content generation", "writing", "blog", "summarization"],
    why_pick_this:
      "Simple template for content generation workflows.",
  },
  {
    slug: "multimodal_agent",
    display_name: "Multimodal Agent",
    language: "python",
    upstream_path: "agents/multimodal-agent",
    short_description:
      "Agent that handles text, images, and other media types.",
    categories: ["multimodal", "demo"],
    complexity: "intermediate",
    recommended_for: ["multimodal", "images", "vision", "demo"],
    why_pick_this:
      "Demonstrates multimodal capabilities (text + images) with the ADK.",
  },
  {
    slug: "workflow_agent",
    display_name: "Workflow Agent",
    language: "python",
    upstream_path: "agents/workflow-agent",
    short_description:
      "Multi-step workflow agent with sequential and parallel task execution.",
    categories: ["workflow"],
    complexity: "advanced",
    recommended_for: ["workflow", "orchestration", "multi-step", "advanced"],
    why_pick_this:
      "Shows advanced agent patterns: sequential steps, parallel execution, sub-agents.",
  },
  {
    slug: "hello_world",
    display_name: "Hello World Agent",
    language: "python",
    upstream_path: "agents/hello-world",
    short_description:
      "Minimal ADK agent — the simplest possible starting point.",
    categories: ["demo"],
    complexity: "starter",
    recommended_for: ["beginner", "starter", "hello world", "simple", "learning"],
    why_pick_this:
      "Safest beginner option. Minimal code, easy to understand.",
  },
] as const;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Find a catalog entry by slug.
 * Returns undefined if the slug is not in the curated catalog.
 */
export function findSampleBySlug(slug: string): CatalogEntry | undefined {
  return SAMPLE_CATALOG.find((e) => e.slug === slug);
}

/**
 * List all slugs in the catalog.
 */
export function allSampleSlugs(): string[] {
  return SAMPLE_CATALOG.map((e) => e.slug);
}

// ---------------------------------------------------------------------------
// Recommendation scoring
// ---------------------------------------------------------------------------

export interface RecommendationAnswers {
  /** What are you trying to build? */
  intent:
    | "research_assistant"
    | "customer_support"
    | "content_generation"
    | "coding"
    | "multimodal"
    | "other";
  /** Desired complexity. */
  complexity: "simple" | "advanced" | "beginner";
  /** Integration expectations. */
  integrations: "builtin" | "external" | "unsure";
}

interface ScoredEntry {
  entry: CatalogEntry;
  score: number;
}

/**
 * Score and rank catalog entries based on wizard answers.
 * Returns entries sorted by score (highest first), with at least
 * a minimum score threshold to be included.
 */
export function recommendSamples(
  answers: RecommendationAnswers,
  maxResults = 4
): CatalogEntry[] {
  const scored: ScoredEntry[] = SAMPLE_CATALOG.map((entry) => ({
    entry,
    score: scoreSample(entry, answers),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Filter out zero-score entries, return top N
  return scored
    .filter((s) => s.score > 0)
    .slice(0, maxResults)
    .map((s) => s.entry);
}

function scoreSample(entry: CatalogEntry, answers: RecommendationAnswers): number {
  let score = 0;

  // Intent matching (strongest signal)
  const intentCategoryMap: Record<string, SampleCategory[]> = {
    research_assistant: ["research", "rag"],
    customer_support: ["customer_support"],
    content_generation: ["content_generation"],
    coding: ["coding"],
    multimodal: ["multimodal"],
    other: [],
  };

  const targetCategories = intentCategoryMap[answers.intent] ?? [];
  for (const cat of targetCategories) {
    if (entry.categories.includes(cat)) {
      score += 3;
    }
  }

  // "other" intent: give a small base score to everything
  if (answers.intent === "other") {
    score += 1;
  }

  // Complexity matching
  const complexityMap: Record<string, SampleComplexity[]> = {
    simple: ["starter"],
    advanced: ["intermediate", "advanced"],
    beginner: ["starter"],
  };

  const targetComplexity = complexityMap[answers.complexity] ?? ["starter"];
  if (targetComplexity.includes(entry.complexity)) {
    score += 2;
  }

  // Beginner bonus for hello_world
  if (answers.complexity === "beginner" && entry.slug === "hello_world") {
    score += 2;
  }

  // Integration preference
  if (answers.integrations === "external") {
    // Prefer samples with external integration patterns
    if (entry.categories.includes("rag") || entry.categories.includes("workflow")) {
      score += 1;
    }
  } else if (answers.integrations === "builtin") {
    // Prefer simpler samples
    if (entry.complexity === "starter") {
      score += 1;
    }
  }
  // "unsure" gives no bonus — let intent and complexity dominate

  return score;
}
