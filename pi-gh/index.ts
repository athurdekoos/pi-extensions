import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuccessResult {
  ok: true;
  repo: string;
  operation: string;
  data: unknown;
}

interface ErrorResult {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: string;
    suggested_fix?: string;
  };
}

type GhResult = SuccessResult | ErrorResult;

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

export async function checkGhInstalled(pi: ExtensionAPI): Promise<ErrorResult | null> {
  const result = await pi.exec("gh", ["--version"], { timeout: 5000 });
  if (result.code !== 0) {
    return {
      ok: false,
      error: {
        code: "GH_NOT_INSTALLED",
        message: "GitHub CLI (gh) is not installed or not in PATH.",
        suggested_fix: "Install gh: https://cli.github.com/",
      },
    };
  }
  return null;
}

export async function checkGhAuth(pi: ExtensionAPI): Promise<ErrorResult | null> {
  const result = await pi.exec("gh", ["auth", "status"], { timeout: 10000 });
  if (result.code !== 0) {
    return {
      ok: false,
      error: {
        code: "GH_NOT_AUTHENTICATED",
        message: "GitHub CLI is not authenticated.",
        detail: result.stderr,
        suggested_fix: "Run: gh auth login",
      },
    };
  }
  return null;
}

export async function getRepoSlug(pi: ExtensionAPI): Promise<string | ErrorResult> {
  const result = await pi.exec(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { timeout: 10000 },
  );
  if (result.code !== 0) {
    return {
      ok: false,
      error: {
        code: "GH_REPO_UNAVAILABLE",
        message: "Could not resolve current repository.",
        detail: result.stderr,
        suggested_fix: "Ensure you are inside a git repository with a GitHub remote.",
      },
    };
  }
  return result.stdout.trim();
}

export async function preflight(pi: ExtensionAPI): Promise<{ repo: string } | ErrorResult> {
  const installErr = await checkGhInstalled(pi);
  if (installErr) return installErr;

  const authErr = await checkGhAuth(pi);
  if (authErr) return authErr;

  const repoOrErr = await getRepoSlug(pi);
  if (typeof repoOrErr !== "string") return repoOrErr;

  return { repo: repoOrErr };
}

function ok(repo: string, operation: string, data: unknown): SuccessResult {
  return { ok: true, repo, operation, data };
}

function fail(code: string, message: string, detail?: string, suggested_fix?: string): ErrorResult {
  return { ok: false, error: { code, message, detail, suggested_fix } };
}

function cancelled(operation: string): ErrorResult {
  return fail("USER_CANCELLED", `User declined confirmation for: ${operation}`);
}

async function ghJson(
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<{ data: unknown } | ErrorResult> {
  const result = await pi.exec("gh", args, { signal, timeout: 30000 });
  if (result.code !== 0) {
    return fail("GH_COMMAND_FAILED", `gh ${args[0]} failed`, result.stderr);
  }
  const stdout = result.stdout.trim();
  if (!stdout) return { data: null };
  try {
    return { data: JSON.parse(stdout) };
  } catch {
    return { data: stdout };
  }
}

async function ghExec(
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<ExecResult> {
  return pi.exec("gh", args, { signal, timeout: 30000 });
}

function truncateResult(result: GhResult): string {
  const raw = JSON.stringify(result, null, 2);
  const truncation = truncateHead(raw, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (truncation.truncated) {
    return truncation.content + `\n\n[Output truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}]`;
  }
  return truncation.content;
}

async function confirm(ctx: ExtensionContext, operation: string, detail: string): Promise<boolean> {
  if (!ctx.hasUI) return true;
  return ctx.ui.confirm(`gh: ${operation}`, detail);
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GhRepoParams = Type.Object({
  operation: StringEnum(["info"] as const, { description: "Repo operation" }),
});

const GhIssueParams = Type.Object({
  operation: StringEnum(
    ["list", "get", "create", "edit", "comment", "close", "reopen"] as const,
    { description: "Issue operation" },
  ),
  number: Type.Optional(Type.Number({ description: "Issue number (required for get/edit/comment/close/reopen)" })),
  state: Type.Optional(StringEnum(["open", "closed", "all"] as const, { description: "Filter by state (list)" })),
  limit: Type.Optional(Type.Number({ description: "Max results (list, default 30)" })),
  title: Type.Optional(Type.String({ description: "Issue title (create)" })),
  body: Type.Optional(Type.String({ description: "Issue body (create/edit/comment)" })),
  addLabels: Type.Optional(Type.Array(Type.String(), { description: "Labels to add (edit)" })),
  removeLabels: Type.Optional(Type.Array(Type.String(), { description: "Labels to remove (edit)" })),
  addAssignees: Type.Optional(Type.Array(Type.String(), { description: "Assignees to add (edit)" })),
  removeAssignees: Type.Optional(Type.Array(Type.String(), { description: "Assignees to remove (edit)" })),
  labels: Type.Optional(Type.Array(Type.String(), { description: "Labels (create)" })),
  assignees: Type.Optional(Type.Array(Type.String(), { description: "Assignees (create)" })),
  comment: Type.Optional(Type.String({ description: "Comment body (comment)" })),
});

const GhPrParams = Type.Object({
  operation: StringEnum(
    ["list", "get", "create", "comment", "request_reviewers", "close", "reopen", "merge"] as const,
    { description: "PR operation" },
  ),
  number: Type.Optional(Type.Number({ description: "PR number (required for get/comment/request_reviewers/close/reopen/merge)" })),
  state: Type.Optional(StringEnum(["open", "closed", "merged", "all"] as const, { description: "Filter by state (list)" })),
  limit: Type.Optional(Type.Number({ description: "Max results (list, default 30)" })),
  title: Type.Optional(Type.String({ description: "PR title (create)" })),
  body: Type.Optional(Type.String({ description: "PR body (create)" })),
  base: Type.Optional(Type.String({ description: "Base branch (create)" })),
  head: Type.Optional(Type.String({ description: "Head branch (create)" })),
  draft: Type.Optional(Type.Boolean({ description: "Create as draft (create)" })),
  comment: Type.Optional(Type.String({ description: "Comment body (comment)" })),
  reviewers: Type.Optional(Type.Array(Type.String(), { description: "Reviewers to request (request_reviewers)" })),
  mergeMethod: Type.Optional(StringEnum(["merge", "squash", "rebase"] as const, { description: "Merge method (merge)" })),
  deleteBranch: Type.Optional(Type.Boolean({ description: "Delete branch after merge (merge)" })),
  admin: Type.Optional(Type.Boolean({ description: "Use admin privileges to merge (merge)" })),
});

const GhActionsParams = Type.Object({
  operation: StringEnum(
    ["list_workflows", "list_runs", "get_run", "rerun", "cancel", "dispatch"] as const,
    { description: "Actions operation" },
  ),
  workflowId: Type.Optional(Type.String({ description: "Workflow ID or filename (list_runs/dispatch)" })),
  runId: Type.Optional(Type.Number({ description: "Run ID (get_run/rerun/cancel)" })),
  limit: Type.Optional(Type.Number({ description: "Max results (list_runs, default 20)" })),
  ref: Type.Optional(Type.String({ description: "Git ref for dispatch (dispatch)" })),
  inputs: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Workflow inputs (dispatch)" })),
});

export type GhRepoInput = Static<typeof GhRepoParams>;
export type GhIssueInput = Static<typeof GhIssueParams>;
export type GhPrInput = Static<typeof GhPrParams>;
export type GhActionsInput = Static<typeof GhActionsParams>;

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

async function handleRepo(
  pi: ExtensionAPI,
  repo: string,
  params: GhRepoInput,
  signal?: AbortSignal,
): Promise<GhResult> {
  const r = await ghJson(pi, [
    "repo", "view", "--json",
    "name,nameWithOwner,description,url,defaultBranchRef,isPrivate,stargazerCount,forkCount,issues,pullRequests",
  ], signal);
  if ("error" in r) return r as ErrorResult;
  return ok(repo, "info", r.data);
}

async function handleIssue(
  pi: ExtensionAPI,
  repo: string,
  params: GhIssueInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<GhResult> {
  const op = params.operation;

  if (op === "list") {
    const args = ["issue", "list", "--json", "number,title,state,author,labels,assignees,createdAt,updatedAt"];
    if (params.state) args.push("--state", params.state);
    args.push("--limit", String(params.limit ?? 30));
    const r = await ghJson(pi, args, signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "issue.list", r.data);
  }

  if (op === "get") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for issue get");
    const r = await ghJson(pi, [
      "issue", "view", String(params.number), "--json",
      "number,title,state,body,author,labels,assignees,comments,createdAt,updatedAt,closedAt",
    ], signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "issue.get", r.data);
  }

  if (op === "create") {
    if (!params.title) return fail("MISSING_PARAM", "title is required for issue create");
    const args = ["issue", "create", "--title", params.title];
    if (params.body) args.push("--body", params.body);
    if (params.labels?.length) args.push("--label", params.labels.join(","));
    if (params.assignees?.length) args.push("--assignee", params.assignees.join(","));
    const r = await ghJson(pi, args, signal);
    if ("error" in r) return r as ErrorResult;
    // gh issue create outputs a URL, not JSON by default
    return ok(repo, "issue.create", r.data);
  }

  if (op === "edit") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for issue edit");
    const args = ["issue", "edit", String(params.number)];
    if (params.title) args.push("--title", params.title);
    if (params.body) args.push("--body", params.body);
    if (params.addLabels?.length) args.push("--add-label", params.addLabels.join(","));
    if (params.removeLabels?.length) args.push("--remove-label", params.removeLabels.join(","));
    if (params.addAssignees?.length) args.push("--add-assignee", params.addAssignees.join(","));
    if (params.removeAssignees?.length) args.push("--remove-assignee", params.removeAssignees.join(","));
    const result = await ghExec(pi, args, signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "issue edit failed", result.stderr);
    return ok(repo, "issue.edit", { number: params.number, updated: true });
  }

  if (op === "comment") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for issue comment");
    const body = params.comment ?? params.body;
    if (!body) return fail("MISSING_PARAM", "comment or body is required for issue comment");
    const result = await ghExec(pi, ["issue", "comment", String(params.number), "--body", body], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "issue comment failed", result.stderr);
    return ok(repo, "issue.comment", { number: params.number, commented: true });
  }

  if (op === "close") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for issue close");
    const confirmed = await confirm(ctx, "issue close", `Close issue #${params.number}?`);
    if (!confirmed) return cancelled("issue.close");
    const result = await ghExec(pi, ["issue", "close", String(params.number)], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "issue close failed", result.stderr);
    return ok(repo, "issue.close", { number: params.number, closed: true });
  }

  if (op === "reopen") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for issue reopen");
    const confirmed = await confirm(ctx, "issue reopen", `Reopen issue #${params.number}?`);
    if (!confirmed) return cancelled("issue.reopen");
    const result = await ghExec(pi, ["issue", "reopen", String(params.number)], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "issue reopen failed", result.stderr);
    return ok(repo, "issue.reopen", { number: params.number, reopened: true });
  }

  return fail("UNKNOWN_OPERATION", `Unknown issue operation: ${op}`);
}

async function handlePr(
  pi: ExtensionAPI,
  repo: string,
  params: GhPrInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<GhResult> {
  const op = params.operation;

  if (op === "list") {
    const args = ["pr", "list", "--json", "number,title,state,author,labels,reviewRequests,createdAt,updatedAt,headRefName,baseRefName,isDraft"];
    if (params.state) args.push("--state", params.state);
    args.push("--limit", String(params.limit ?? 30));
    const r = await ghJson(pi, args, signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "pr.list", r.data);
  }

  if (op === "get") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for pr get");
    const r = await ghJson(pi, [
      "pr", "view", String(params.number), "--json",
      "number,title,state,body,author,labels,reviewRequests,reviews,comments,commits,files,additions,deletions,createdAt,updatedAt,mergedAt,closedAt,headRefName,baseRefName,isDraft,mergeable",
    ], signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "pr.get", r.data);
  }

  if (op === "create") {
    if (!params.title) return fail("MISSING_PARAM", "title is required for pr create");
    if (!params.head) return fail("MISSING_PARAM", "head branch is required for pr create");
    const args = ["pr", "create", "--title", params.title, "--head", params.head];
    if (params.body) args.push("--body", params.body);
    if (params.base) args.push("--base", params.base);
    if (params.draft) args.push("--draft");
    const r = await ghJson(pi, args, signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "pr.create", r.data);
  }

  if (op === "comment") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for pr comment");
    const body = params.comment ?? params.body;
    if (!body) return fail("MISSING_PARAM", "comment or body is required for pr comment");
    const result = await ghExec(pi, ["pr", "comment", String(params.number), "--body", body], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "pr comment failed", result.stderr);
    return ok(repo, "pr.comment", { number: params.number, commented: true });
  }

  if (op === "request_reviewers") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for pr request_reviewers");
    if (!params.reviewers?.length) return fail("MISSING_PARAM", "reviewers is required for pr request_reviewers");
    const confirmed = await confirm(ctx, "request reviewers", `Request reviewers ${params.reviewers.join(", ")} on PR #${params.number}?`);
    if (!confirmed) return cancelled("pr.request_reviewers");
    const args = ["pr", "edit", String(params.number), "--add-reviewer", params.reviewers.join(",")];
    const result = await ghExec(pi, args, signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "pr request_reviewers failed", result.stderr);
    return ok(repo, "pr.request_reviewers", { number: params.number, reviewers: params.reviewers });
  }

  if (op === "close") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for pr close");
    const confirmed = await confirm(ctx, "PR close", `Close PR #${params.number}?`);
    if (!confirmed) return cancelled("pr.close");
    const result = await ghExec(pi, ["pr", "close", String(params.number)], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "pr close failed", result.stderr);
    return ok(repo, "pr.close", { number: params.number, closed: true });
  }

  if (op === "reopen") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for pr reopen");
    const confirmed = await confirm(ctx, "PR reopen", `Reopen PR #${params.number}?`);
    if (!confirmed) return cancelled("pr.reopen");
    const result = await ghExec(pi, ["pr", "reopen", String(params.number)], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "pr reopen failed", result.stderr);
    return ok(repo, "pr.reopen", { number: params.number, reopened: true });
  }

  if (op === "merge") {
    if (!params.number) return fail("MISSING_PARAM", "number is required for pr merge");
    const method = params.mergeMethod ?? "merge";
    const confirmed = await confirm(ctx, "PR merge", `Merge PR #${params.number} via ${method}?`);
    if (!confirmed) return cancelled("pr.merge");
    const args = ["pr", "merge", String(params.number), `--${method}`];
    if (params.deleteBranch) args.push("--delete-branch");
    if (params.admin) args.push("--admin");
    const result = await ghExec(pi, args, signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "pr merge failed", result.stderr);
    return ok(repo, "pr.merge", { number: params.number, merged: true, method });
  }

  return fail("UNKNOWN_OPERATION", `Unknown pr operation: ${op}`);
}

async function handleActions(
  pi: ExtensionAPI,
  repo: string,
  params: GhActionsInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<GhResult> {
  const op = params.operation;

  if (op === "list_workflows") {
    const r = await ghJson(pi, ["workflow", "list", "--json", "id,name,state,path"], signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "actions.list_workflows", r.data);
  }

  if (op === "list_runs") {
    const args = ["run", "list", "--json", "databaseId,displayTitle,status,conclusion,event,headBranch,createdAt,updatedAt,url"];
    if (params.workflowId) args.push("--workflow", params.workflowId);
    args.push("--limit", String(params.limit ?? 20));
    const r = await ghJson(pi, args, signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "actions.list_runs", r.data);
  }

  if (op === "get_run") {
    if (!params.runId) return fail("MISSING_PARAM", "runId is required for get_run");
    const r = await ghJson(pi, [
      "run", "view", String(params.runId), "--json",
      "databaseId,displayTitle,status,conclusion,event,headBranch,jobs,createdAt,updatedAt,url",
    ], signal);
    if ("error" in r) return r as ErrorResult;
    return ok(repo, "actions.get_run", r.data);
  }

  if (op === "rerun") {
    if (!params.runId) return fail("MISSING_PARAM", "runId is required for rerun");
    const result = await ghExec(pi, ["run", "rerun", String(params.runId)], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "run rerun failed", result.stderr);
    return ok(repo, "actions.rerun", { runId: params.runId, rerun: true });
  }

  if (op === "cancel") {
    if (!params.runId) return fail("MISSING_PARAM", "runId is required for cancel");
    const confirmed = await confirm(ctx, "cancel workflow run", `Cancel run #${params.runId}?`);
    if (!confirmed) return cancelled("actions.cancel");
    const result = await ghExec(pi, ["run", "cancel", String(params.runId)], signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "run cancel failed", result.stderr);
    return ok(repo, "actions.cancel", { runId: params.runId, cancelled: true });
  }

  if (op === "dispatch") {
    if (!params.workflowId) return fail("MISSING_PARAM", "workflowId is required for dispatch");
    const ref = params.ref ?? "main";
    const confirmed = await confirm(ctx, "dispatch workflow", `Dispatch workflow ${params.workflowId} on ref ${ref}?`);
    if (!confirmed) return cancelled("actions.dispatch");
    const args = ["workflow", "run", params.workflowId, "--ref", ref];
    if (params.inputs) {
      for (const [k, v] of Object.entries(params.inputs)) {
        args.push("--field", `${k}=${v}`);
      }
    }
    const result = await ghExec(pi, args, signal);
    if (result.code !== 0) return fail("GH_COMMAND_FAILED", "workflow dispatch failed", result.stderr);
    return ok(repo, "actions.dispatch", { workflowId: params.workflowId, ref, dispatched: true });
  }

  return fail("UNKNOWN_OPERATION", `Unknown actions operation: ${op}`);
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "gh_repo",
    label: "GitHub Repo",
    description: "Get information about the current GitHub repository.",
    parameters: GhRepoParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pf = await preflight(pi);
      if ("error" in pf) return { content: [{ type: "text", text: truncateResult(pf) }] };
      const result = await handleRepo(pi, pf.repo, params as GhRepoInput, signal);
      return { content: [{ type: "text", text: truncateResult(result) }] };
    },
  });

  pi.registerTool({
    name: "gh_issue",
    label: "GitHub Issue",
    description: "Manage issues in the current GitHub repository. Supports: list, get, create, edit, comment, close, reopen.",
    parameters: GhIssueParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pf = await preflight(pi);
      if ("error" in pf) return { content: [{ type: "text", text: truncateResult(pf) }] };
      const result = await handleIssue(pi, pf.repo, params as GhIssueInput, signal, ctx);
      return { content: [{ type: "text", text: truncateResult(result) }] };
    },
  });

  pi.registerTool({
    name: "gh_pr",
    label: "GitHub PR",
    description: "Manage pull requests in the current GitHub repository. Supports: list, get, create, comment, request_reviewers, close, reopen, merge.",
    parameters: GhPrParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pf = await preflight(pi);
      if ("error" in pf) return { content: [{ type: "text", text: truncateResult(pf) }] };
      const result = await handlePr(pi, pf.repo, params as GhPrInput, signal, ctx);
      return { content: [{ type: "text", text: truncateResult(result) }] };
    },
  });

  pi.registerTool({
    name: "gh_actions",
    label: "GitHub Actions",
    description: "Manage GitHub Actions workflows and runs in the current repository. Supports: list_workflows, list_runs, get_run, rerun, cancel, dispatch.",
    parameters: GhActionsParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pf = await preflight(pi);
      if ("error" in pf) return { content: [{ type: "text", text: truncateResult(pf) }] };
      const result = await handleActions(pi, pf.repo, params as GhActionsInput, signal, ctx);
      return { content: [{ type: "text", text: truncateResult(result) }] };
    },
  });
}
