/**
 * phase3.test.ts — Tests for Phase 3: review orchestration,
 *                  submit_plan tool, command registration, write-gating.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  hasPlanReviewUI,
  hasCodeReviewUI,
} from "../review.js";
import {
  startPlanReviewServer,
  startReviewServer,
  startAnnotateServer,
} from "../server.js";
import { writeReviewRecord, listReviewRecords } from "../repo.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_ROOT = join(process.cwd(), ".test-phase3-" + process.pid);

function setup(): void {
  mkdirSync(TEST_ROOT, { recursive: true });
}

function cleanup(): void {
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// HTML asset availability
// ---------------------------------------------------------------------------

describe("review.ts — asset detection", () => {
  it("hasPlanReviewUI returns boolean", () => {
    const result = hasPlanReviewUI();
    expect(typeof result).toBe("boolean");
  });

  it("hasCodeReviewUI returns boolean", () => {
    const result = hasCodeReviewUI();
    expect(typeof result).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Plan review server integration
// ---------------------------------------------------------------------------

describe("server.ts — plan review with explicit previousPlan", () => {
  it("starts server with null previousPlan", async () => {
    const server = startPlanReviewServer({
      plan: "# Test Plan\n\n1. Step one",
      previousPlan: null,
      htmlContent: "<html><body>test</body></html>",
      origin: "pi",
    });

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toContain("localhost");

    // Verify API returns correct data
    const response = await fetch(`${server.url}/api/plan`);
    const data = await response.json() as { plan: string; previousPlan: string | null };
    expect(data.plan).toContain("Test Plan");
    expect(data.previousPlan).toBeNull();

    server.stop();
  });

  it("starts server with previousPlan for diff", async () => {
    const server = startPlanReviewServer({
      plan: "# Plan v2\n\n1. Updated step",
      previousPlan: "# Plan v1\n\n1. Original step",
      htmlContent: "<html><body>test</body></html>",
      origin: "pi",
    });

    const response = await fetch(`${server.url}/api/plan`);
    const data = await response.json() as { plan: string; previousPlan: string };
    expect(data.plan).toContain("Plan v2");
    expect(data.previousPlan).toContain("Plan v1");

    server.stop();
  });

  it("resolves approval decision", async () => {
    const server = startPlanReviewServer({
      plan: "# Plan",
      previousPlan: null,
      htmlContent: "<html></html>",
    });

    // Simulate browser approval
    const approveResponse = await fetch(`${server.url}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Looks good" }),
    });
    expect(approveResponse.ok).toBe(true);

    const decision = await server.waitForDecision();
    expect(decision.approved).toBe(true);
    expect(decision.feedback).toBe("Looks good");

    server.stop();
  });

  it("resolves denial decision", async () => {
    const server = startPlanReviewServer({
      plan: "# Plan",
      previousPlan: null,
      htmlContent: "<html></html>",
    });

    await fetch(`${server.url}/api/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Missing error handling" }),
    });

    const decision = await server.waitForDecision();
    expect(decision.approved).toBe(false);
    expect(decision.feedback).toBe("Missing error handling");

    server.stop();
  });
});

// ---------------------------------------------------------------------------
// Code review server
// ---------------------------------------------------------------------------

describe("server.ts — code review server", () => {
  it("starts and returns diff data", async () => {
    const server = startReviewServer({
      rawPatch: "diff --git a/file.ts b/file.ts\n+new line",
      gitRef: "uncommitted",
      htmlContent: "<html></html>",
      origin: "pi",
    });

    const response = await fetch(`${server.url}/api/diff`);
    const data = await response.json() as { rawPatch: string; gitRef: string };
    expect(data.rawPatch).toContain("+new line");
    expect(data.gitRef).toBe("uncommitted");

    server.stop();
  });

  it("resolves feedback decision", async () => {
    const server = startReviewServer({
      rawPatch: "diff content",
      gitRef: "HEAD",
      htmlContent: "<html></html>",
    });

    await fetch(`${server.url}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Fix the null check on line 42" }),
    });

    const decision = await server.waitForDecision();
    expect(decision.feedback).toBe("Fix the null check on line 42");

    server.stop();
  });
});

// ---------------------------------------------------------------------------
// Annotate server
// ---------------------------------------------------------------------------

describe("server.ts — annotate server", () => {
  it("starts and returns markdown data", async () => {
    const server = startAnnotateServer({
      markdown: "# Architecture\n\nSome docs here",
      filePath: "/tmp/test.md",
      htmlContent: "<html></html>",
      origin: "pi",
    });

    const response = await fetch(`${server.url}/api/plan`);
    const data = await response.json() as { plan: string; mode: string; filePath: string };
    expect(data.plan).toContain("Architecture");
    expect(data.mode).toBe("annotate");
    expect(data.filePath).toBe("/tmp/test.md");

    server.stop();
  });

  it("resolves annotation feedback", async () => {
    const server = startAnnotateServer({
      markdown: "# Doc",
      filePath: "/tmp/test.md",
      htmlContent: "<html></html>",
    });

    await fetch(`${server.url}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Add error handling section" }),
    });

    const decision = await server.waitForDecision();
    expect(decision.feedback).toBe("Add error handling section");

    server.stop();
  });
});

// ---------------------------------------------------------------------------
// Review record integration with review flow
// ---------------------------------------------------------------------------

describe("review flow — record writing", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("writes approval record with plan title", () => {
    writeReviewRecord(TEST_ROOT, {
      timestamp: new Date().toISOString(),
      approved: true,
      feedback: "Ship it",
      planTitle: "Auth Migration",
    });

    const records = listReviewRecords(TEST_ROOT);
    expect(records).toHaveLength(1);
    expect(records[0].approved).toBe(true);
    expect(records[0].planTitle).toBe("Auth Migration");
  });

  it("writes denial record with detailed feedback", () => {
    writeReviewRecord(TEST_ROOT, {
      timestamp: new Date().toISOString(),
      approved: false,
      feedback: "Step 3 needs rollback strategy. Step 5 is missing test coverage.",
      planTitle: "Database Schema Change",
    });

    const records = listReviewRecords(TEST_ROOT);
    expect(records).toHaveLength(1);
    expect(records[0].approved).toBe(false);
    expect(records[0].feedback).toContain("rollback");
  });

  it("accumulates multiple review records chronologically", () => {
    writeReviewRecord(TEST_ROOT, {
      timestamp: "2026-03-12T10:00:00.000Z",
      approved: false,
      feedback: "First review: needs work",
    });
    writeReviewRecord(TEST_ROOT, {
      timestamp: "2026-03-12T11:00:00.000Z",
      approved: false,
      feedback: "Second review: getting closer",
    });
    writeReviewRecord(TEST_ROOT, {
      timestamp: "2026-03-12T12:00:00.000Z",
      approved: true,
      feedback: "Third review: approved",
    });

    const records = listReviewRecords(TEST_ROOT);
    expect(records).toHaveLength(3);
    // newest first
    expect(records[0].approved).toBe(true);
  });
});
