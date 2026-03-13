/**
 * Tests for server.ts — ephemeral HTTP servers for browser-based review UIs.
 *
 * What these tests prove:
 *   - startPlanReviewServer serves HTML on /, plan data on /api/plan,
 *     and resolves approve/deny decisions correctly
 *   - previousPlan is passed through (null or string)
 *   - startReviewServer serves diff data and resolves feedback
 *   - startAnnotateServer serves markdown and resolves feedback
 *   - All servers bind to random ports and stop cleanly
 *
 * What these tests do NOT prove:
 *   - That the browser UI HTML is correct (it's a pre-built artifact)
 *   - That openBrowser works on all platforms (browser.test.ts)
 *   - That git commands produce valid output (depends on git state)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  startPlanReviewServer,
  startReviewServer,
  startAnnotateServer,
  type PlanServerResult,
  type ReviewServerResult,
  type AnnotateServerResult,
} from "../server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_HTML = "<html><body>test</body></html>";
const TEST_PLAN = "# Plan\n\n## Goal\n\nBuild something.";
const TEST_PREVIOUS = "# Plan\n\n## Goal\n\nOld version.";

/** Simple HTTP fetch helper for test requests. */
async function fetchJSON(url: string, method = "GET", body?: unknown): Promise<unknown> {
  const resp = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url);
  return resp.text();
}

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

const servers: Array<{ stop: () => void }> = [];

afterEach(() => {
  for (const s of servers) {
    try { s.stop(); } catch { /* ignore */ }
  }
  servers.length = 0;
});

// ---------------------------------------------------------------------------
// startPlanReviewServer
// ---------------------------------------------------------------------------

describe("startPlanReviewServer", () => {
  it("serves HTML on /", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const html = await fetchText(s.url);
    expect(html).toBe(TEST_HTML);
  });

  it("returns plan data on GET /api/plan", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: TEST_PREVIOUS,
      htmlContent: TEST_HTML,
      origin: "test",
    });
    servers.push(s);

    const data = await fetchJSON(`${s.url}/api/plan`) as Record<string, unknown>;
    expect(data.plan).toBe(TEST_PLAN);
    expect(data.previousPlan).toBe(TEST_PREVIOUS);
    expect(data.origin).toBe("test");
  });

  it("returns null previousPlan when no previous version", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const data = await fetchJSON(`${s.url}/api/plan`) as Record<string, unknown>;
    expect(data.previousPlan).toBeNull();
  });

  it("resolves approved decision on POST /api/approve", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const decisionPromise = s.waitForDecision();
    await fetchJSON(`${s.url}/api/approve`, "POST", { feedback: "looks good" });
    const decision = await decisionPromise;

    expect(decision.approved).toBe(true);
    expect(decision.feedback).toBe("looks good");
  });

  it("resolves approved without feedback", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const decisionPromise = s.waitForDecision();
    await fetchJSON(`${s.url}/api/approve`, "POST", {});
    const decision = await decisionPromise;

    expect(decision.approved).toBe(true);
    expect(decision.feedback).toBeUndefined();
  });

  it("resolves denied decision on POST /api/deny", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const decisionPromise = s.waitForDecision();
    await fetchJSON(`${s.url}/api/deny`, "POST", { feedback: "needs work" });
    const decision = await decisionPromise;

    expect(decision.approved).toBe(false);
    expect(decision.feedback).toBe("needs work");
  });

  it("uses default rejection message when no feedback on deny", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const decisionPromise = s.waitForDecision();
    await fetchJSON(`${s.url}/api/deny`, "POST", {});
    const decision = await decisionPromise;

    expect(decision.approved).toBe(false);
    expect(decision.feedback).toBe("Plan rejected");
  });

  it("defaults origin to pi", async () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const data = await fetchJSON(`${s.url}/api/plan`) as Record<string, unknown>;
    expect(data.origin).toBe("pi");
  });

  it("binds to a random port", () => {
    const s = startPlanReviewServer({
      plan: TEST_PLAN,
      previousPlan: null,
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    expect(s.port).toBeGreaterThan(0);
    expect(s.url).toBe(`http://localhost:${s.port}`);
  });
});

// ---------------------------------------------------------------------------
// startReviewServer
// ---------------------------------------------------------------------------

describe("startReviewServer", () => {
  it("serves HTML on /", async () => {
    const s = startReviewServer({
      rawPatch: "diff --git a/f b/f",
      gitRef: "HEAD",
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const html = await fetchText(s.url);
    expect(html).toBe(TEST_HTML);
  });

  it("returns diff data on GET /api/diff", async () => {
    const s = startReviewServer({
      rawPatch: "patch-content",
      gitRef: "Uncommitted changes",
      htmlContent: TEST_HTML,
      origin: "test",
      diffType: "staged",
    });
    servers.push(s);

    const data = await fetchJSON(`${s.url}/api/diff`) as Record<string, unknown>;
    expect(data.rawPatch).toBe("patch-content");
    expect(data.gitRef).toBe("Uncommitted changes");
    expect(data.origin).toBe("test");
    expect(data.diffType).toBe("staged");
  });

  it("resolves feedback on POST /api/feedback", async () => {
    const s = startReviewServer({
      rawPatch: "",
      gitRef: "HEAD",
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const decisionPromise = s.waitForDecision();
    await fetchJSON(`${s.url}/api/feedback`, "POST", { feedback: "fix line 42" });
    const decision = await decisionPromise;

    expect(decision.feedback).toBe("fix line 42");
  });

  it("returns empty feedback when none provided", async () => {
    const s = startReviewServer({
      rawPatch: "",
      gitRef: "HEAD",
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const decisionPromise = s.waitForDecision();
    await fetchJSON(`${s.url}/api/feedback`, "POST", {});
    const decision = await decisionPromise;

    expect(decision.feedback).toBe("");
  });
});

// ---------------------------------------------------------------------------
// startAnnotateServer
// ---------------------------------------------------------------------------

describe("startAnnotateServer", () => {
  it("serves HTML on /", async () => {
    const s = startAnnotateServer({
      markdown: "# Doc",
      filePath: "/tmp/doc.md",
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const html = await fetchText(s.url);
    expect(html).toBe(TEST_HTML);
  });

  it("returns markdown data on GET /api/plan", async () => {
    const s = startAnnotateServer({
      markdown: "# My Doc",
      filePath: "/tmp/doc.md",
      htmlContent: TEST_HTML,
      origin: "test",
    });
    servers.push(s);

    const data = await fetchJSON(`${s.url}/api/plan`) as Record<string, unknown>;
    expect(data.plan).toBe("# My Doc");
    expect(data.mode).toBe("annotate");
    expect(data.filePath).toBe("/tmp/doc.md");
    expect(data.origin).toBe("test");
  });

  it("resolves feedback on POST /api/feedback", async () => {
    const s = startAnnotateServer({
      markdown: "# Doc",
      filePath: "/tmp/doc.md",
      htmlContent: TEST_HTML,
    });
    servers.push(s);

    const decisionPromise = s.waitForDecision();
    await fetchJSON(`${s.url}/api/feedback`, "POST", { feedback: "update section 3" });
    const decision = await decisionPromise;

    expect(decision.feedback).toBe("update section 3");
  });
});
