import { describe, it, expect } from "vitest";
import {
  extractPlanSummary,
  formatArchiveTimestamp,
  formatArchiveLabel,
} from "../summary.js";

// ---------------------------------------------------------------------------
// extractPlanSummary
// ---------------------------------------------------------------------------

describe("extractPlanSummary", () => {
  it("extracts lines from the Goal section", () => {
    const content = [
      "# Plan: Auth Module",
      "",
      "## Goal",
      "",
      "Add JWT-based authentication to the API.",
      "Support refresh tokens.",
      "",
      "## Scope",
    ].join("\n");

    const summary = extractPlanSummary(content);
    expect(summary).toContain("Add JWT-based authentication");
    expect(summary).toContain("Support refresh tokens");
  });

  it("respects maxLines", () => {
    const content = [
      "## Goal",
      "",
      "Line one.",
      "Line two.",
      "Line three.",
      "Line four.",
    ].join("\n");

    const summary = extractPlanSummary(content, 2);
    expect(summary).toBe("Line one.\nLine two.");
  });

  it("skips placeholder italic lines", () => {
    const content = [
      "## Goal",
      "",
      "_placeholder text_",
      "Real goal here.",
    ].join("\n");

    const summary = extractPlanSummary(content);
    expect(summary).toBe("Real goal here.");
  });

  it("falls back to non-heading lines when no Goal section", () => {
    const content = "Some content without headings.\nMore text.";
    const summary = extractPlanSummary(content);
    expect(summary).toContain("Some content without headings");
  });

  it("returns fallback for empty content", () => {
    expect(extractPlanSummary("")).toBe("(no summary available)");
  });

  it("returns fallback for headings-only content", () => {
    expect(extractPlanSummary("# Title\n## Section")).toBe("(no summary available)");
  });

  it("stops at the next section heading", () => {
    const content = [
      "## Goal",
      "",
      "Build the thing.",
      "",
      "## Current State",
      "",
      "Nothing exists yet.",
    ].join("\n");

    const summary = extractPlanSummary(content, 5);
    expect(summary).toBe("Build the thing.");
    expect(summary).not.toContain("Nothing exists yet");
  });
});

// ---------------------------------------------------------------------------
// formatArchiveTimestamp
// ---------------------------------------------------------------------------

describe("formatArchiveTimestamp", () => {
  it("extracts human-readable timestamp from archive filename", () => {
    expect(formatArchiveTimestamp("2026-03-11-1730-auth-module.md")).toBe("2026-03-11 17:30");
  });

  it("works with date-only filenames", () => {
    expect(formatArchiveTimestamp("2026-03-11-1730.md")).toBe("2026-03-11 17:30");
  });

  it("returns null for non-matching filenames", () => {
    expect(formatArchiveTimestamp("readme.md")).toBeNull();
    expect(formatArchiveTimestamp("")).toBeNull();
  });

  it("pads correctly", () => {
    expect(formatArchiveTimestamp("2026-01-03-0204-test.md")).toBe("2026-01-03 02:04");
  });
});

// ---------------------------------------------------------------------------
// formatArchiveLabel
// ---------------------------------------------------------------------------

describe("formatArchiveLabel", () => {
  it("combines title and timestamp", () => {
    const label = formatArchiveLabel("Auth Module", "2026-03-11-1730-auth-module.md");
    expect(label).toBe("Auth Module  (2026-03-11 17:30)");
  });

  it("truncates long titles", () => {
    const longTitle = "A".repeat(60);
    const label = formatArchiveLabel(longTitle, "2026-03-11-1730-test.md", 50);
    expect(label.length).toBeLessThan(60 + 30); // title truncated + timestamp
    expect(label).toContain("…");
    expect(label).toContain("2026-03-11 17:30");
  });

  it("keeps short titles intact", () => {
    const label = formatArchiveLabel("Short", "2026-03-11-1730-short.md");
    expect(label).toBe("Short  (2026-03-11 17:30)");
  });

  it("falls back gracefully for non-matching filename", () => {
    const label = formatArchiveLabel("Title", "readme.md");
    expect(label).toBe("Title");
  });
});
