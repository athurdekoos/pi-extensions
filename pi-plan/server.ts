/**
 * server.ts — Ephemeral HTTP servers for browser-based plan review,
 *             code review, and markdown annotation.
 *
 * Owns: Server lifecycle for three UI modes (plan review, code review,
 *       markdown annotation). Each server binds to a random port, serves
 *       a single-file HTML UI, exposes minimal JSON API routes, and
 *       resolves a decision promise when the user acts in the browser.
 *
 * Does NOT own: Browser launching (browser.ts), plan file I/O (repo.ts /
 *               archive.ts), state detection, Pi API calls, or any
 *               persistent state. No home-directory writes.
 *
 * Invariants:
 *   - Servers are ephemeral: created on demand, stopped after decision.
 *   - No writes to any filesystem path — servers are read-only.
 *   - No state stored outside the server's in-memory closure.
 *   - previousPlan for diff is passed in explicitly (from archive layer).
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { execSync } from "node:child_process";

// ── Helpers ──────────────────────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res: import("node:http").ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function html(res: import("node:http").ServerResponse, content: string): void {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(content);
}

function listenOnRandomPort(server: Server): number {
  server.listen(0);
  const addr = server.address() as { port: number };
  return addr.port;
}

// ── Plan Review Server ──────────────────────────────────────────────────

export interface PlanServerResult {
  port: number;
  url: string;
  waitForDecision: () => Promise<{ approved: boolean; feedback?: string }>;
  stop: () => void;
}

/**
 * Start an ephemeral HTTP server for browser-based plan review.
 *
 * The browser UI shows the current plan, optionally with a diff against
 * the previous version. The user can approve, deny, or annotate the plan.
 *
 * @param options.plan - Current plan markdown content
 * @param options.previousPlan - Previous plan version for diff (from archive), or null
 * @param options.htmlContent - Single-file HTML for the review UI
 * @param options.origin - Origin identifier (default: "pi")
 */
export function startPlanReviewServer(options: {
  plan: string;
  previousPlan: string | null;
  htmlContent: string;
  origin?: string;
}): PlanServerResult {
  let resolveDecision!: (result: { approved: boolean; feedback?: string }) => void;
  const decisionPromise = new Promise<{ approved: boolean; feedback?: string }>((r) => {
    resolveDecision = r;
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost`);

    if (url.pathname === "/api/plan" && req.method === "GET") {
      json(res, {
        plan: options.plan,
        origin: options.origin ?? "pi",
        previousPlan: options.previousPlan,
      });
    } else if (url.pathname === "/api/approve" && req.method === "POST") {
      const body = await parseBody(req);
      resolveDecision({ approved: true, feedback: body.feedback as string | undefined });
      json(res, { ok: true });
    } else if (url.pathname === "/api/deny" && req.method === "POST") {
      const body = await parseBody(req);
      resolveDecision({ approved: false, feedback: (body.feedback as string) || "Plan rejected" });
      json(res, { ok: true });
    } else {
      html(res, options.htmlContent);
    }
  });

  const port = listenOnRandomPort(server);

  return {
    port,
    url: `http://localhost:${port}`,
    waitForDecision: () => decisionPromise,
    stop: () => server.close(),
  };
}

// ── Code Review Server ──────────────────────────────────────────────────

export type DiffType = "uncommitted" | "staged" | "unstaged" | "last-commit" | "branch";

export interface DiffOption {
  id: DiffType | "separator";
  label: string;
}

export interface GitContext {
  currentBranch: string;
  defaultBranch: string;
  diffOptions: DiffOption[];
}

export interface ReviewServerResult {
  port: number;
  url: string;
  waitForDecision: () => Promise<{ feedback: string }>;
  stop: () => void;
}

/** Run a git command and return stdout (empty string on error). */
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

/** Detect current branch, default branch, and available diff options. */
export function getGitContext(): GitContext {
  const currentBranch = git("rev-parse --abbrev-ref HEAD") || "HEAD";

  let defaultBranch = "";
  const symRef = git("symbolic-ref refs/remotes/origin/HEAD");
  if (symRef) {
    defaultBranch = symRef.replace("refs/remotes/origin/", "");
  }
  if (!defaultBranch) {
    const hasMain = git("show-ref --verify refs/heads/main");
    defaultBranch = hasMain ? "main" : "master";
  }

  const diffOptions: DiffOption[] = [
    { id: "uncommitted", label: "Uncommitted changes" },
    { id: "last-commit", label: "Last commit" },
  ];
  if (currentBranch !== defaultBranch) {
    diffOptions.push({ id: "branch", label: `vs ${defaultBranch}` });
  }

  return { currentBranch, defaultBranch, diffOptions };
}

/** Run a git diff of the specified type. */
export function runGitDiff(diffType: DiffType, defaultBranch = "main"): { patch: string; label: string } {
  switch (diffType) {
    case "uncommitted":
      return { patch: git("diff HEAD --src-prefix=a/ --dst-prefix=b/"), label: "Uncommitted changes" };
    case "staged":
      return { patch: git("diff --staged --src-prefix=a/ --dst-prefix=b/"), label: "Staged changes" };
    case "unstaged":
      return { patch: git("diff --src-prefix=a/ --dst-prefix=b/"), label: "Unstaged changes" };
    case "last-commit":
      return { patch: git("diff HEAD~1..HEAD --src-prefix=a/ --dst-prefix=b/"), label: "Last commit" };
    case "branch":
      return { patch: git(`diff ${defaultBranch}..HEAD --src-prefix=a/ --dst-prefix=b/`), label: `Changes vs ${defaultBranch}` };
    default:
      return { patch: "", label: "Unknown diff type" };
  }
}

/**
 * Start an ephemeral HTTP server for browser-based code review.
 *
 * Shows a git diff with annotation capabilities. The user submits
 * feedback which is returned via the decision promise.
 */
export function startReviewServer(options: {
  rawPatch: string;
  gitRef: string;
  htmlContent: string;
  origin?: string;
  diffType?: DiffType;
  gitContext?: GitContext;
}): ReviewServerResult {
  let currentPatch = options.rawPatch;
  let currentGitRef = options.gitRef;
  let currentDiffType: DiffType = options.diffType || "uncommitted";

  let resolveDecision!: (result: { feedback: string }) => void;
  const decisionPromise = new Promise<{ feedback: string }>((r) => {
    resolveDecision = r;
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost`);

    if (url.pathname === "/api/diff" && req.method === "GET") {
      json(res, {
        rawPatch: currentPatch,
        gitRef: currentGitRef,
        origin: options.origin ?? "pi",
        diffType: currentDiffType,
        gitContext: options.gitContext,
      });
    } else if (url.pathname === "/api/diff/switch" && req.method === "POST") {
      const body = await parseBody(req);
      const newType = body.diffType as DiffType;
      if (!newType) {
        json(res, { error: "Missing diffType" }, 400);
        return;
      }
      const defaultBranch = options.gitContext?.defaultBranch || "main";
      const result = runGitDiff(newType, defaultBranch);
      currentPatch = result.patch;
      currentGitRef = result.label;
      currentDiffType = newType;
      json(res, { rawPatch: currentPatch, gitRef: currentGitRef, diffType: currentDiffType });
    } else if (url.pathname === "/api/feedback" && req.method === "POST") {
      const body = await parseBody(req);
      resolveDecision({ feedback: (body.feedback as string) || "" });
      json(res, { ok: true });
    } else {
      html(res, options.htmlContent);
    }
  });

  const port = listenOnRandomPort(server);

  return {
    port,
    url: `http://localhost:${port}`,
    waitForDecision: () => decisionPromise,
    stop: () => server.close(),
  };
}

// ── Annotate Server ─────────────────────────────────────────────────────

export interface AnnotateServerResult {
  port: number;
  url: string;
  waitForDecision: () => Promise<{ feedback: string }>;
  stop: () => void;
}

/**
 * Start an ephemeral HTTP server for browser-based markdown annotation.
 *
 * Shows a markdown file with annotation capabilities. The user submits
 * feedback which is returned via the decision promise.
 */
export function startAnnotateServer(options: {
  markdown: string;
  filePath: string;
  htmlContent: string;
  origin?: string;
}): AnnotateServerResult {
  let resolveDecision!: (result: { feedback: string }) => void;
  const decisionPromise = new Promise<{ feedback: string }>((r) => {
    resolveDecision = r;
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost`);

    if (url.pathname === "/api/plan" && req.method === "GET") {
      json(res, {
        plan: options.markdown,
        origin: options.origin ?? "pi",
        mode: "annotate",
        filePath: options.filePath,
      });
    } else if (url.pathname === "/api/feedback" && req.method === "POST") {
      const body = await parseBody(req);
      resolveDecision({ feedback: (body.feedback as string) || "" });
      json(res, { ok: true });
    } else {
      html(res, options.htmlContent);
    }
  });

  const port = listenOnRandomPort(server);

  return {
    port,
    url: `http://localhost:${port}`,
    waitForDecision: () => decisionPromise,
    stop: () => server.close(),
  };
}
