/**
 * Planning Protocol Extension — Phase 4 MVP
 *
 * Builds on Phase 3 with:
 * - Plan lifecycle commands: /plan-new, /plan-complete, /plan-archive, /plan-list
 * - Archive snapshot creation (deterministic, append-only)
 * - Deterministic plans/index.md automation
 * - current.md lifecycle semantics (reset to template after complete/archive)
 * - Extended debug logging for lifecycle operations
 *
 * Preserved from Phase 1/2/3:
 * - Runtime/system status enum: off, plan-required, plan-ready
 * - Plan-document status enum: template, draft, active, completed, archived
 * - `.pi/planning-state.json` as local runtime state
 * - `.pi/plans/current.md` metadata grammar
 * - All Phase 3 commands: /plan-on, /plan-off, /plan-status, /plan,
 *   /plan-debug-on, /plan-debug-off, /plan-debug
 * - Hard tool_call whitelist enforcement (read, grep, ls, find)
 * - Footer status and widget UI
 * - Compact context injection via before_agent_start
 * - Context pruning
 *
 * NOT implemented in this phase (deferred to Phase 5+):
 * - Package extraction / npm structure
 * - Prompt templates under `.pi/prompts/`
 * - Implementation-mode unlock while planning mode is still on
 * - Automatic index reconciliation from arbitrary external file edits
 * - Archive deletion/cleanup UI
 * - Archive restore/resume UI
 * - Log rotation/pruning
 * - Custom TUI components beyond normal status/widget/dialog use
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlanningState {
	version: number;
	planMode: boolean;
	debugMode: boolean;
	status: "off" | "plan-required" | "plan-ready";
	currentPlanPath: string;
	lastValidatedAt: string | null;
	lastKnownSlug: string | null;
}

interface PlanMeta {
	slug: string;
	status: string;
	updated_at: string;
}

type PlanValidationResult =
	| { valid: false; reason: string; meta: null }
	| { valid: true; reason: null; meta: PlanMeta; hasRequiredSections: boolean };

const VALID_PLAN_STATUSES = ["template", "draft", "active", "completed", "archived"] as const;

// ─── Whitelist Enforcement ──────────────────────────────────────────────────
//
// Phase 3: Hard whitelist. When planning mode is on (plan-required OR plan-ready),
// only these tools are allowed. All others are blocked via tool_call.
//
// /plan-on means inspect-and-plan mode.
// /plan-off returns the agent to normal implementation behavior.
// The whitelist stays active for BOTH plan-required and plan-ready until /plan-off.

const PLANNING_WHITELIST: ReadonlySet<string> = new Set(["read", "grep", "ls", "find"]);

/**
 * Determines whether a tool call should be allowed given the current planning state.
 *
 * Returns { allowed: true } when planning mode is off or the tool is whitelisted.
 * Returns { allowed: false, reason: string } when the tool is blocked.
 */
function checkToolAllowed(toolName: string, state: PlanningState): { allowed: true } | { allowed: false; reason: string } {
	// No enforcement when planning mode is off
	if (!state.planMode) return { allowed: true };

	// Whitelisted tools are always allowed during planning mode
	if (PLANNING_WHITELIST.has(toolName)) return { allowed: true };

	// Everything else is blocked
	const whitelistStr = Array.from(PLANNING_WHITELIST).join(", ");
	const reason =
		`Planning mode is active (status: ${state.status}). ` +
		`Tool "${toolName}" is blocked. ` +
		`Only read-only tools are allowed while planning mode is on: ${whitelistStr}. ` +
		`Use /plan to create or update your plan, or /plan-off to disable planning mode and restore normal operation.`;

	return { allowed: false, reason };
}

// ─── Debug Logging ──────────────────────────────────────────────────────────
//
// Phase 3: Real debug logging to `.pi/plans/debug/`.
// Uses JSONL format (one JSON object per line) for easy parsing.
// Writes to both current.log (overwritten per session) and a session-specific log.

interface DebugLogEntry {
	ts: string;
	event: string;
	status: PlanningState["status"];
	planMode: boolean;
	debugMode: boolean;
	planPath: string;
	details: Record<string, unknown>;
}

/**
 * Debug logger that writes JSONL to `.pi/plans/debug/`.
 * Only writes when debugMode is true.
 * Keeps file handles simple — append per event, no buffering.
 */
class DebugLogger {
	private debugDir: string;
	private currentLogPath: string;
	private sessionLogPath: string | null = null;
	private sessionId: string | null = null;

	constructor(cwd: string) {
		this.debugDir = resolve(cwd, ".pi/plans/debug");
		this.currentLogPath = resolve(this.debugDir, "current.log");
	}

	/** Start a new session log. Called on session_start. */
	startSession(): void {
		const now = new Date();
		// Deterministic session ID: timestamp-based for sortability
		this.sessionId = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
		this.sessionLogPath = resolve(this.debugDir, `${this.sessionId}-session.log`);

		// Overwrite current.log at session start
		this.ensureDir();
		writeFileSync(this.currentLogPath, "", "utf-8");
	}

	/** Write a debug log entry. No-op if debugMode is false. */
	log(state: PlanningState, event: string, details: Record<string, unknown> = {}): void {
		if (!state.debugMode) return;

		const entry: DebugLogEntry = {
			ts: new Date().toISOString(),
			event,
			status: state.status,
			planMode: state.planMode,
			debugMode: state.debugMode,
			planPath: state.currentPlanPath,
			details,
		};

		const line = JSON.stringify(entry) + "\n";

		this.ensureDir();

		try {
			appendFileSync(this.currentLogPath, line, "utf-8");
		} catch {
			// Best-effort logging — do not crash the extension
		}

		if (this.sessionLogPath) {
			try {
				appendFileSync(this.sessionLogPath, line, "utf-8");
			} catch {
				// Best-effort
			}
		}
	}

	getDebugDir(): string {
		return this.debugDir;
	}

	getCurrentLogPath(): string {
		return this.currentLogPath;
	}

	getSessionLogPath(): string | null {
		return this.sessionLogPath;
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	/** List recent session log files (up to n). */
	getRecentSessionLogs(n: number): string[] {
		try {
			if (!existsSync(this.debugDir)) return [];
			const files = readdirSync(this.debugDir)
				.filter((f) => f.endsWith("-session.log"))
				.sort()
				.reverse()
				.slice(0, n);
			return files;
		} catch {
			return [];
		}
	}

	private ensureDir(): void {
		mkdirSync(this.debugDir, { recursive: true });
	}
}

// ─── Paths (resolved relative to cwd) ───────────────────────────────────────

function paths(cwd: string) {
	return {
		stateFile: resolve(cwd, ".pi/planning-state.json"),
		exampleFile: resolve(cwd, ".pi/planning-state.example.json"),
		currentPlan: resolve(cwd, ".pi/plans/current.md"),
		plansDir: resolve(cwd, ".pi/plans"),
		archiveDir: resolve(cwd, ".pi/plans/archive"),
		indexFile: resolve(cwd, ".pi/plans/index.md"),
	};
}

// ─── Plan Metadata Parsing ──────────────────────────────────────────────────

const META_SENTINEL = "<!-- pi-plan-meta";

function parsePlanMeta(content: string): PlanValidationResult {
	const sentinelIdx = content.indexOf(META_SENTINEL);
	if (sentinelIdx === -1) {
		return { valid: false, reason: "No metadata block (missing `<!-- pi-plan-meta` sentinel)", meta: null };
	}

	const closeIdx = content.indexOf("-->", sentinelIdx);
	if (closeIdx === -1) {
		return { valid: false, reason: "Metadata block not closed (missing `-->`)", meta: null };
	}

	const metaBlock = content.slice(sentinelIdx + META_SENTINEL.length, closeIdx);
	const lines = metaBlock.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

	const kv: Record<string, string> = {};
	for (const line of lines) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();
		kv[key] = value;
	}

	const requiredKeys = ["slug", "status", "updated_at"] as const;
	for (const key of requiredKeys) {
		if (!(key in kv)) {
			return { valid: false, reason: `Missing required metadata key: ${key}`, meta: null };
		}
	}

	const slug = kv["slug"];
	const status = kv["status"];
	const updatedAt = kv["updated_at"];

	if (!VALID_PLAN_STATUSES.includes(status as typeof VALID_PLAN_STATUSES[number])) {
		return { valid: false, reason: `Invalid plan status: "${status}". Must be one of: ${VALID_PLAN_STATUSES.join(", ")}`, meta: null };
	}

	const meta: PlanMeta = { slug, status, updated_at: updatedAt };

	// Check for required H2 sections
	const hasGoal = /^## Goal/m.test(content);
	const hasImplPlan = /^## Implementation Plan/m.test(content);
	const hasRequiredSections = hasGoal && hasImplPlan;

	return { valid: true, reason: null, meta, hasRequiredSections };
}

function isPlanImplementationReady(result: PlanValidationResult): boolean {
	if (!result.valid) return false;
	return result.meta.status === "active" && result.meta.slug.length > 0 && result.meta.updated_at.length > 0;
}

function isPlaceholderPlan(result: PlanValidationResult): boolean {
	if (!result.valid) return false;
	return result.meta.status === "template";
}

/**
 * Determine whether a plan is "meaningful" — i.e. it has real content worth preserving.
 * A plan is meaningful if it is valid and its status is NOT "template".
 * Draft, active, completed plans all count as meaningful.
 */
function isMeaningfulPlan(result: PlanValidationResult): boolean {
	if (!result.valid) return false;
	return result.meta.status !== "template";
}

// ─── Plan Metadata Mutation ─────────────────────────────────────────────────

/**
 * Update a single metadata field in a plan's content string.
 * Returns the updated content or null if the metadata block was not found.
 */
function updatePlanMetaField(content: string, key: string, value: string): string | null {
	const sentinelIdx = content.indexOf(META_SENTINEL);
	if (sentinelIdx === -1) return null;

	const closeIdx = content.indexOf("-->", sentinelIdx);
	if (closeIdx === -1) return null;

	const before = content.slice(0, sentinelIdx + META_SENTINEL.length);
	const metaBlock = content.slice(sentinelIdx + META_SENTINEL.length, closeIdx);
	const after = content.slice(closeIdx);

	const lines = metaBlock.split("\n");
	let found = false;
	const updatedLines = lines.map((line) => {
		const trimmed = line.trim();
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) return line;
		const k = trimmed.slice(0, colonIdx).trim();
		if (k === key) {
			found = true;
			// Preserve leading whitespace from the original line
			const leadingWs = line.match(/^(\s*)/)?.[1] ?? "";
			return `${leadingWs}${key}: ${value}`;
		}
		return line;
	});

	if (!found) return null;

	return before + updatedLines.join("\n") + after;
}

/**
 * Update both status and updated_at in a plan's content string.
 */
function updatePlanStatus(content: string, newStatus: string): string | null {
	const now = new Date().toISOString();
	let updated = updatePlanMetaField(content, "status", newStatus);
	if (updated === null) return null;
	updated = updatePlanMetaField(updated, "updated_at", now);
	return updated;
}

// ─── Plan Template ──────────────────────────────────────────────────────────

function planTemplate(slug: string, title: string): string {
	const now = new Date().toISOString();
	return `# Plan: ${title}

<!-- pi-plan-meta
slug: ${slug}
status: draft
updated_at: ${now}
-->

## Goal

_What is the objective of this task?_

## Current State

_Describe what exists today. What is the starting point?_

## Locked Decisions

- _List constraints and non-negotiable choices._

## Scope

- _What is in scope for this task?_

## Non-Goals

- _What is explicitly out of scope?_

## Files to Inspect

- _Which files should be read before implementation?_

## Implementation Plan

1. _First step_
2. _Second step_
3. _Third step_

## Acceptance Criteria

- [ ] _How do we know this task is done?_

## Tests

- _What tests should be added or updated?_

## Manual Verification

- _How to verify the result manually?_

## Risks / Notes

- _Any risks, open questions, or notes?_
`;
}

/** Generate the default empty template (status: template, no slug). */
function emptyPlanTemplate(): string {
	return `# Plan: [TITLE]

<!-- pi-plan-meta
slug:
status: template
updated_at:
-->

## Goal

_What is the objective of this task?_

## Current State

_Describe what exists today. What is the starting point?_

## Locked Decisions

- _List constraints and non-negotiable choices._

## Scope

- _What is in scope for this task?_

## Non-Goals

- _What is explicitly out of scope?_

## Files to Inspect

- _Which files should be read before implementation?_

## Implementation Plan

1. _First step_
2. _Second step_
3. _Third step_

## Acceptance Criteria

- [ ] _How do we know this task is done?_

## Tests

- _What tests should be added or updated?_

## Manual Verification

- _How to verify the result manually?_

## Risks / Notes

- _Any risks, open questions, or notes?_
`;
}

// ─── Archive Helpers ────────────────────────────────────────────────────────

/**
 * Archive naming convention (from PLANNING_PROTOCOL.md):
 *   YYYY-MM-DD-HHMM-<slug>.md
 *
 * If a collision exists, append -2, -3, etc.
 * Archives are immutable once written — never overwrite.
 */
function generateArchiveFilename(archiveDir: string, slug: string): string {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");

	const safeSlug = slug || "unnamed";
	const base = `${yyyy}-${mm}-${dd}-${hh}${min}-${safeSlug}`;

	let candidate = `${base}.md`;
	let counter = 1;
	while (existsSync(resolve(archiveDir, candidate))) {
		counter++;
		candidate = `${base}-${counter}.md`;
	}

	return candidate;
}

/**
 * Create an archive snapshot from the current plan content.
 * Returns the archive filename on success, or null on failure.
 *
 * The archived file has its status set to the specified archiveStatus
 * (typically "archived" or "completed" depending on context).
 */
function createArchiveSnapshot(
	cwd: string,
	content: string,
	meta: PlanMeta,
	archiveStatus: string,
): { filename: string; path: string } | { error: string } {
	const p = paths(cwd);
	mkdirSync(p.archiveDir, { recursive: true });

	const filename = generateArchiveFilename(p.archiveDir, meta.slug);
	const archivePath = resolve(p.archiveDir, filename);

	// Set the status in the archived copy
	const updatedContent = updatePlanStatus(content, archiveStatus);
	if (updatedContent === null) {
		return { error: "Failed to update metadata in archive copy" };
	}

	try {
		writeFileSync(archivePath, updatedContent, "utf-8");
		return { filename, path: archivePath };
	} catch (err) {
		return { error: `Failed to write archive file: ${err}` };
	}
}

// ─── Index Automation ───────────────────────────────────────────────────────

interface IndexEntry {
	slug: string;
	filename: string;
	status: string;
	timestamp: string;
}

/**
 * Rebuild plans/index.md deterministically.
 *
 * Structure:
 *   # Plan Index
 *   ## Current
 *   - [current.md](current.md) — <summary or "No active plan">
 *   ## Archived Plans
 *   | Slug | File | Status | Archived |
 *   |------|------|--------|----------|
 *   | ... | ... | ... | ... |
 *   ## Notes
 *   Archived plans are stored in `archive/` with filenames: `YYYY-MM-DD-HHMM-<slug>.md`
 */
function rebuildIndex(cwd: string, currentPlanResult: PlanValidationResult): void {
	const p = paths(cwd);

	// Scan archive directory for entries
	const archiveEntries: IndexEntry[] = [];
	if (existsSync(p.archiveDir)) {
		try {
			const files = readdirSync(p.archiveDir)
				.filter((f) => f.endsWith(".md"))
				.sort()
				.reverse(); // newest first

			for (const file of files) {
				const filePath = resolve(p.archiveDir, file);
				try {
					const content = readFileSync(filePath, "utf-8");
					const result = parsePlanMeta(content);
					if (result.valid) {
						archiveEntries.push({
							slug: result.meta.slug || "(no slug)",
							filename: file,
							status: result.meta.status,
							timestamp: result.meta.updated_at || "(unknown)",
						});
					} else {
						// Malformed archive file — still list it
						archiveEntries.push({
							slug: "(invalid)",
							filename: file,
							status: "unknown",
							timestamp: "(unknown)",
						});
					}
				} catch {
					archiveEntries.push({
						slug: "(unreadable)",
						filename: file,
						status: "unknown",
						timestamp: "(unknown)",
					});
				}
			}
		} catch {
			// Cannot read archive dir — proceed with empty list
		}
	}

	// Build current plan summary
	let currentSummary: string;
	if (currentPlanResult.valid) {
		const m = currentPlanResult.meta;
		if (m.status === "template") {
			currentSummary = "_No active plan (template placeholder)_";
		} else {
			currentSummary = `**${m.slug || "(no slug)"}** — status: \`${m.status}\` — updated: ${m.updated_at || "(unknown)"}`;
		}
	} else {
		currentSummary = `_No valid plan — ${currentPlanResult.reason}_`;
	}

	// Render index
	const lines: string[] = [];
	lines.push("# Plan Index");
	lines.push("");
	lines.push("## Current");
	lines.push("");
	lines.push(`- [current.md](current.md) — ${currentSummary}`);
	lines.push("");
	lines.push("## Archived Plans");
	lines.push("");

	if (archiveEntries.length === 0) {
		lines.push("_No archived plans._");
	} else {
		lines.push("| Slug | File | Status | Archived |");
		lines.push("|------|------|--------|----------|");
		for (const entry of archiveEntries) {
			lines.push(`| ${entry.slug} | [${entry.filename}](archive/${entry.filename}) | ${entry.status} | ${entry.timestamp} |`);
		}
	}

	lines.push("");
	lines.push("## Notes");
	lines.push("");
	lines.push("Archived plans are stored in `archive/` with filenames: `YYYY-MM-DD-HHMM-<slug>.md`");
	lines.push("");

	mkdirSync(dirname(p.indexFile), { recursive: true });
	writeFileSync(p.indexFile, lines.join("\n"), "utf-8");
}

// ─── State Management ────────────────────────────────────────────────────────

function loadState(cwd: string): PlanningState & { _loadError?: boolean } {
	const p = paths(cwd);

	if (!existsSync(p.stateFile)) {
		if (existsSync(p.exampleFile)) {
			const example = readFileSync(p.exampleFile, "utf-8");
			const parsed = JSON.parse(example) as PlanningState;
			writeFileSync(p.stateFile, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
			return parsed;
		}
		return defaultState();
	}

	try {
		const raw = readFileSync(p.stateFile, "utf-8");
		const parsed = JSON.parse(raw) as PlanningState;
		if (typeof parsed.version !== "number" || typeof parsed.planMode !== "boolean") {
			throw new Error("Invalid state shape");
		}
		return parsed;
	} catch {
		return { ...defaultState(), _loadError: true };
	}
}

function defaultState(): PlanningState {
	return {
		version: 1,
		planMode: false,
		debugMode: false,
		status: "off",
		currentPlanPath: ".pi/plans/current.md",
		lastValidatedAt: null,
		lastKnownSlug: null,
	};
}

function saveState(cwd: string, state: PlanningState): void {
	const p = paths(cwd);
	mkdirSync(dirname(p.stateFile), { recursive: true });
	writeFileSync(p.stateFile, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// ─── Status Reconciliation ──────────────────────────────────────────────────

function reconcileStatus(state: PlanningState, planResult: PlanValidationResult): "off" | "plan-required" | "plan-ready" {
	if (!state.planMode) return "off";
	if (isPlanImplementationReady(planResult)) return "plan-ready";
	return "plan-required";
}

function validateCurrentPlan(cwd: string): PlanValidationResult {
	const p = paths(cwd);
	if (!existsSync(p.currentPlan)) {
		return { valid: false, reason: "current.md does not exist", meta: null };
	}
	const content = readFileSync(p.currentPlan, "utf-8");
	if (content.trim().length === 0) {
		return { valid: false, reason: "current.md is empty", meta: null };
	}
	return parsePlanMeta(content);
}

// ─── Extension ──────────────────────────────────────────────────────────────

export default function planningProtocolExtension(pi: ExtensionAPI): void {
	let state: PlanningState = defaultState();
	let lastPlanResult: PlanValidationResult = { valid: false, reason: "Not yet validated", meta: null };
	let loadError = false;
	let cwd = ".";
	let logger: DebugLogger;

	// ── UI Helpers ────────────────────────────────────────────────────────

	function updateUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;

		// Footer status
		let statusText: string;
		if (!state.planMode) {
			statusText = theme.fg("dim", "plan:off");
		} else {
			const stateColor = state.status === "plan-ready" ? "success" : "warning";
			statusText = theme.fg("accent", "plan:on") + theme.fg("dim", " | ") + theme.fg(stateColor, `state:${state.status}`);
			if (state.debugMode) {
				statusText += theme.fg("dim", " | ") + theme.fg("warning", "debug:on");
			}
		}
		ctx.ui.setStatus("planning-protocol", statusText);

		// Widget
		if (state.planMode) {
			const lines: string[] = [];
			lines.push(theme.fg("accent", "Planning Protocol"));
			lines.push(theme.fg("dim", "─".repeat(24)));
			lines.push(`${theme.fg("dim", "mode:")}  ${theme.fg("accent", "on")}`);
			lines.push(`${theme.fg("dim", "debug:")} ${state.debugMode ? theme.fg("warning", "on") : theme.fg("dim", "off")}`);

			const stateColor = state.status === "plan-ready" ? "success" : "warning";
			lines.push(`${theme.fg("dim", "state:")} ${theme.fg(stateColor, state.status)}`);

			lines.push(`${theme.fg("dim", "plan:")}  ${theme.fg("dim", state.currentPlanPath)}`);

			if (lastPlanResult.valid) {
				lines.push(`${theme.fg("dim", "slug:")}  ${theme.fg("muted", lastPlanResult.meta.slug || "(empty)")}`);
				const planStatusColor = lastPlanResult.meta.status === "active" ? "success" : "muted";
				lines.push(`${theme.fg("dim", "pstat:")} ${theme.fg(planStatusColor, lastPlanResult.meta.status)}`);
			} else {
				lines.push(`${theme.fg("dim", "valid:")} ${theme.fg("error", "no")} — ${theme.fg("dim", lastPlanResult.reason)}`);
			}

			if (state.lastValidatedAt) {
				lines.push(`${theme.fg("dim", "checked:")} ${theme.fg("dim", state.lastValidatedAt)}`);
			}

			// Phase 3: Show enforcement status in widget
			lines.push(theme.fg("dim", "─".repeat(24)));
			const whitelistStr = Array.from(PLANNING_WHITELIST).join(", ");
			lines.push(`${theme.fg("dim", "enforce:")} ${theme.fg("warning", "active")}`);
			lines.push(`${theme.fg("dim", "allowed:")} ${theme.fg("muted", whitelistStr)}`);

			ctx.ui.setWidget("planning-protocol", lines);
		} else {
			ctx.ui.setWidget("planning-protocol", undefined);
		}
	}

	function refreshAndReconcile(ctx: ExtensionContext): void {
		const previousStatus = state.status;
		lastPlanResult = validateCurrentPlan(cwd);
		const newStatus = reconcileStatus(state, lastPlanResult);
		state.status = newStatus;
		state.lastValidatedAt = new Date().toISOString();
		if (lastPlanResult.valid && lastPlanResult.meta.slug) {
			state.lastKnownSlug = lastPlanResult.meta.slug;
		}
		saveState(cwd, state);
		updateUI(ctx);

		// Log reconciliation if status changed
		if (previousStatus !== newStatus) {
			logger.log(state, "reconcile", {
				previousStatus,
				newStatus,
				planValid: lastPlanResult.valid,
				planStatus: lastPlanResult.valid ? lastPlanResult.meta.status : null,
				reason: lastPlanResult.valid ? null : lastPlanResult.reason,
			});
		}
	}

	/** Reset current.md to the empty template and reconcile. */
	function resetCurrentPlan(ctx: ExtensionContext): void {
		const p = paths(cwd);
		mkdirSync(dirname(p.currentPlan), { recursive: true });
		writeFileSync(p.currentPlan, emptyPlanTemplate(), "utf-8");
		logger.log(state, "current_plan_reset", { action: "reset_to_template" });
		refreshAndReconcile(ctx);
	}

	// ── Guided /plan flow ─────────────────────────────────────────────────

	async function guidedPlanFlow(ctx: ExtensionContext): Promise<void> {
		const p = paths(cwd);
		let content: string;

		if (existsSync(p.currentPlan)) {
			content = readFileSync(p.currentPlan, "utf-8");
		} else {
			const slug = await ctx.ui.input("Plan slug (kebab-case):", "my-plan");
			if (!slug?.trim()) {
				ctx.ui.notify("Plan creation cancelled.", "info");
				return;
			}
			const title = await ctx.ui.input("Plan title:", slug.trim());
			content = planTemplate(slug.trim(), title?.trim() || slug.trim());
		}

		const edited = await ctx.ui.editor("Edit plan (save to apply):", content);
		if (edited === undefined || edited === null) {
			ctx.ui.notify("Plan editing cancelled.", "info");
			return;
		}

		// Write the plan
		mkdirSync(dirname(p.currentPlan), { recursive: true });
		writeFileSync(p.currentPlan, edited, "utf-8");

		// Validate and reconcile
		refreshAndReconcile(ctx);

		// Update index
		rebuildIndex(cwd, lastPlanResult);
		logger.log(state, "index_updated", { trigger: "plan_edit" });

		// Log plan validation result
		logger.log(state, "plan_validated", {
			valid: lastPlanResult.valid,
			planStatus: lastPlanResult.valid ? lastPlanResult.meta.status : null,
			slug: lastPlanResult.valid ? lastPlanResult.meta.slug : null,
			reason: lastPlanResult.valid ? null : lastPlanResult.reason,
			hasRequiredSections: lastPlanResult.valid ? lastPlanResult.hasRequiredSections : false,
		});

		if (lastPlanResult.valid) {
			ctx.ui.notify(`Plan saved. Status: ${lastPlanResult.meta.status}, Slug: ${lastPlanResult.meta.slug || "(empty)"}`, "info");
			if (lastPlanResult.meta.status === "draft") {
				ctx.ui.notify("Plan is in draft. Set status to 'active' when ready for implementation.", "info");
			} else if (lastPlanResult.meta.status === "active") {
				ctx.ui.notify("Plan is active and implementation-ready.", "success");
			}
		} else {
			ctx.ui.notify(`Plan saved but has validation issues: ${lastPlanResult.reason}`, "warning");
		}
	}

	// ── Phase 3 Commands (unchanged) ─────────────────────────────────────

	pi.registerCommand("plan-on", {
		description: "Enable planning mode — restrict agent to read-only tools until /plan-off",
		handler: async (_args, ctx) => {
			state.planMode = true;
			refreshAndReconcile(ctx);

			logger.log(state, "command:plan-on", { resultStatus: state.status });

			if (state.status === "plan-required") {
				ctx.ui.notify("Planning mode ON. Status: plan-required — no valid active plan found.", "warning");
				const create = await ctx.ui.confirm("Create/edit plan?", "You need an active plan to proceed. Open the plan editor now?");
				if (create) {
					await guidedPlanFlow(ctx);
				}
			} else {
				ctx.ui.notify("Planning mode ON. Status: plan-ready.", "success");
			}
		},
	});

	pi.registerCommand("plan-off", {
		description: "Disable planning mode — return to normal operation with all tools",
		handler: async (_args, ctx) => {
			state.planMode = false;
			state.status = "off";
			saveState(cwd, state);
			updateUI(ctx);

			logger.log(state, "command:plan-off", {});

			ctx.ui.notify("Planning mode OFF. Normal operation restored.", "info");
		},
	});

	pi.registerCommand("plan-status", {
		description: "Show current planning protocol status",
		handler: async (_args, ctx) => {
			refreshAndReconcile(ctx);

			logger.log(state, "command:plan-status", {});

			const whitelistStr = Array.from(PLANNING_WHITELIST).join(", ");
			const lines: string[] = [];
			lines.push("Planning Protocol Status");
			lines.push("────────────────────────");
			lines.push(`Plan mode:    ${state.planMode ? "ON" : "OFF"}`);
			lines.push(`Debug mode:   ${state.debugMode ? "ON" : "OFF"}`);
			lines.push(`System state: ${state.status}`);
			lines.push(`Plan path:    ${state.currentPlanPath}`);

			const p = paths(cwd);
			const planExists = existsSync(p.currentPlan);
			lines.push(`Plan exists:  ${planExists ? "yes" : "no"}`);

			if (lastPlanResult.valid) {
				lines.push(`Plan valid:   yes`);
				lines.push(`Plan status:  ${lastPlanResult.meta.status}`);
				lines.push(`Plan slug:    ${lastPlanResult.meta.slug || "(empty)"}`);
				lines.push(`Updated at:   ${lastPlanResult.meta.updated_at || "(empty)"}`);
				lines.push(`Has sections: ${lastPlanResult.hasRequiredSections ? "yes (Goal + Implementation Plan)" : "no"}`);
				lines.push(`Impl-ready:   ${isPlanImplementationReady(lastPlanResult) ? "yes" : "no"}`);
			} else {
				lines.push(`Plan valid:   no`);
				lines.push(`Reason:       ${lastPlanResult.reason}`);
			}

			if (state.lastValidatedAt) {
				lines.push(`Last checked: ${state.lastValidatedAt}`);
			}
			if (state.lastKnownSlug) {
				lines.push(`Last slug:    ${state.lastKnownSlug}`);
			}

			// Phase 3: Show enforcement info
			lines.push("");
			lines.push("Enforcement");
			lines.push("────────────────────────");
			if (state.planMode) {
				lines.push(`Whitelist:    ACTIVE — only: ${whitelistStr}`);
				lines.push(`All other tools are blocked until /plan-off.`);
			} else {
				lines.push(`Whitelist:    inactive — all tools available`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("plan", {
		description: "Create or edit the current plan (.pi/plans/current.md)",
		handler: async (_args, ctx) => {
			logger.log(state, "command:plan", {});
			await guidedPlanFlow(ctx);
		},
	});

	pi.registerCommand("plan-debug-on", {
		description: "Enable debug mode for the planning protocol",
		handler: async (_args, ctx) => {
			state.debugMode = true;
			saveState(cwd, state);
			updateUI(ctx);

			logger.log(state, "command:plan-debug-on", {});

			ctx.ui.notify("Planning debug mode ON. Logs will be written to .pi/plans/debug/", "info");
		},
	});

	pi.registerCommand("plan-debug-off", {
		description: "Disable debug mode for the planning protocol",
		handler: async (_args, ctx) => {
			logger.log(state, "command:plan-debug-off", {});

			state.debugMode = false;
			saveState(cwd, state);
			updateUI(ctx);
			ctx.ui.notify("Planning debug mode OFF.", "info");
		},
	});

	pi.registerCommand("plan-debug", {
		description: "Show debug mode status, log paths, and recent log info",
		handler: async (_args, ctx) => {
			logger.log(state, "command:plan-debug", {});

			const lines: string[] = [];
			lines.push("Planning Debug Info");
			lines.push("───────────────────");
			lines.push(`Debug mode:      ${state.debugMode ? "ON" : "OFF"}`);
			lines.push(`Logging active:  ${state.debugMode ? "YES — events are being logged" : "NO — enable with /plan-debug-on"}`);
			lines.push("");
			lines.push("Paths");
			lines.push("───────────────────");
			lines.push(`Debug dir:       ${logger.getDebugDir()}`);
			lines.push(`Current log:     ${logger.getCurrentLogPath()}`);
			const sessionLog = logger.getSessionLogPath();
			lines.push(`Session log:     ${sessionLog ?? "(no session started)"}`);
			lines.push(`Session ID:      ${logger.getSessionId() ?? "(none)"}`);
			lines.push("");
			lines.push("Log Format");
			lines.push("───────────────────");
			lines.push("Format: JSONL (one JSON object per line)");
			lines.push("current.log is overwritten each session start.");
			lines.push("Session logs are append-only and persist across sessions.");
			lines.push("");

			// Show recent session logs
			const recentLogs = logger.getRecentSessionLogs(5);
			if (recentLogs.length > 0) {
				lines.push("Recent Session Logs");
				lines.push("───────────────────");
				for (const f of recentLogs) {
					lines.push(`  ${f}`);
				}
			} else {
				lines.push("No session logs found yet.");
			}

			lines.push("");
			lines.push("Logged Events");
			lines.push("───────────────────");
			lines.push("  session_start, session_switch, session_shutdown");
			lines.push("  before_agent_start, context (pruning)");
			lines.push("  command: plan-on, plan-off, plan, plan-status,");
			lines.push("           plan-debug-on, plan-debug-off, plan-debug");
			lines.push("  command: plan-new, plan-complete, plan-archive, plan-list");
			lines.push("  tool_call: allowed/blocked decisions with tool name + reason");
			lines.push("  plan_validated: after /plan saves");
			lines.push("  reconcile: status transitions");
			lines.push("  archive_created, index_updated, current_plan_reset");
			lines.push("  lifecycle_validation_failure");

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── Phase 4: Plan Lifecycle Commands ─────────────────────────────────

	pi.registerCommand("plan-new", {
		description: "Start a new plan — archives the current one if meaningful",
		handler: async (args, ctx) => {
			logger.log(state, "command:plan-new", { argsSlug: args?.trim() || null });

			const p = paths(cwd);

			// Check existing current plan
			const existingResult = validateCurrentPlan(cwd);

			if (isMeaningfulPlan(existingResult)) {
				// Existing plan has real content — prompt user
				const existingMeta = existingResult.meta!;
				const proceed = await ctx.ui.confirm(
					"Existing plan found",
					`Current plan "${existingMeta.slug || "(no slug)"}" has status "${existingMeta.status}".\n` +
					`Starting a new plan will replace it. Archive the existing plan first?`,
				);

				if (proceed) {
					// Archive the existing plan
					const content = readFileSync(p.currentPlan, "utf-8");
					const archiveResult = createArchiveSnapshot(cwd, content, existingMeta, "archived");

					if ("error" in archiveResult) {
						ctx.ui.notify(`Failed to archive existing plan: ${archiveResult.error}`, "error");
						logger.log(state, "lifecycle_validation_failure", {
							command: "plan-new",
							reason: "archive_failed",
							error: archiveResult.error,
						});
						return;
					}

					ctx.ui.notify(`Archived existing plan as ${archiveResult.filename}`, "success");
					logger.log(state, "archive_created", {
						trigger: "plan-new",
						filename: archiveResult.filename,
						slug: existingMeta.slug,
						previousStatus: existingMeta.status,
					});
				} else {
					// User declined archival — ask if they still want to proceed
					const forceReplace = await ctx.ui.confirm(
						"Replace without archiving?",
						"The existing plan will be permanently overwritten. Continue?",
					);
					if (!forceReplace) {
						ctx.ui.notify("Plan creation cancelled.", "info");
						logger.log(state, "command:plan-new", { outcome: "cancelled_by_user" });
						return;
					}
				}
			}

			// Collect slug
			let slug = args?.trim() || "";
			if (!slug) {
				const inputSlug = await ctx.ui.input("Plan slug (kebab-case):", "my-plan");
				if (!inputSlug?.trim()) {
					ctx.ui.notify("Plan creation cancelled.", "info");
					return;
				}
				slug = inputSlug.trim();
			}

			// Collect title
			const title = await ctx.ui.input("Plan title:", slug);

			// Create fresh plan from template
			const freshContent = planTemplate(slug, title?.trim() || slug);

			// Open editor for the new plan
			const edited = await ctx.ui.editor("Edit your new plan (save to apply):", freshContent);
			if (edited === undefined || edited === null) {
				ctx.ui.notify("Plan creation cancelled.", "info");
				logger.log(state, "command:plan-new", { outcome: "cancelled_in_editor" });
				return;
			}

			// Write the plan
			mkdirSync(dirname(p.currentPlan), { recursive: true });
			writeFileSync(p.currentPlan, edited, "utf-8");

			// Validate, reconcile, update index
			refreshAndReconcile(ctx);
			rebuildIndex(cwd, lastPlanResult);
			logger.log(state, "index_updated", { trigger: "plan-new" });

			logger.log(state, "plan_validated", {
				valid: lastPlanResult.valid,
				planStatus: lastPlanResult.valid ? lastPlanResult.meta.status : null,
				slug: lastPlanResult.valid ? lastPlanResult.meta.slug : null,
				reason: lastPlanResult.valid ? null : lastPlanResult.reason,
				hasRequiredSections: lastPlanResult.valid ? lastPlanResult.hasRequiredSections : false,
			});

			if (lastPlanResult.valid) {
				ctx.ui.notify(
					`New plan created. Status: ${lastPlanResult.meta.status}, Slug: ${lastPlanResult.meta.slug || "(empty)"}`,
					"success",
				);
			} else {
				ctx.ui.notify(`New plan saved but has validation issues: ${lastPlanResult.reason}`, "warning");
			}
		},
	});

	pi.registerCommand("plan-complete", {
		description: "Mark the current active plan as completed and archive it",
		handler: async (_args, ctx) => {
			logger.log(state, "command:plan-complete", {});

			const p = paths(cwd);
			const planResult = validateCurrentPlan(cwd);

			// Verify current plan is meaningful
			if (!planResult.valid) {
				ctx.ui.notify(`Cannot complete: current plan is invalid — ${planResult.reason}`, "error");
				logger.log(state, "lifecycle_validation_failure", {
					command: "plan-complete",
					reason: "invalid_plan",
					detail: planResult.reason,
				});
				return;
			}

			if (!isMeaningfulPlan(planResult)) {
				ctx.ui.notify("Cannot complete: current plan is only a template placeholder. Nothing to complete.", "error");
				logger.log(state, "lifecycle_validation_failure", {
					command: "plan-complete",
					reason: "template_only",
				});
				return;
			}

			const meta = planResult.meta;

			// Read current content
			const content = readFileSync(p.currentPlan, "utf-8");

			// Update status to completed in current.md before archiving
			const completedContent = updatePlanStatus(content, "completed");
			if (completedContent === null) {
				ctx.ui.notify("Cannot complete: failed to update metadata in current.md.", "error");
				logger.log(state, "lifecycle_validation_failure", {
					command: "plan-complete",
					reason: "metadata_mutation_failed",
				});
				return;
			}

			// Write completed status to current.md first (per write order: plan content first)
			writeFileSync(p.currentPlan, completedContent, "utf-8");

			// Create archive snapshot with status "completed"
			const archiveResult = createArchiveSnapshot(cwd, completedContent, { ...meta, status: "completed" }, "completed");

			if ("error" in archiveResult) {
				ctx.ui.notify(`Plan marked completed but archive failed: ${archiveResult.error}`, "error");
				logger.log(state, "lifecycle_validation_failure", {
					command: "plan-complete",
					reason: "archive_failed",
					error: archiveResult.error,
				});
				// Don't leave current.md in completed state without archive — revert is complex,
				// so notify user and leave the completed file for manual recovery.
				return;
			}

			ctx.ui.notify(`Plan "${meta.slug}" completed and archived as ${archiveResult.filename}`, "success");
			logger.log(state, "archive_created", {
				trigger: "plan-complete",
				filename: archiveResult.filename,
				slug: meta.slug,
				previousStatus: meta.status,
			});

			// Reset current.md to template
			resetCurrentPlan(ctx);

			// Update index
			rebuildIndex(cwd, lastPlanResult);
			logger.log(state, "index_updated", { trigger: "plan-complete" });

			ctx.ui.notify("current.md has been reset to the empty template.", "info");
		},
	});

	pi.registerCommand("plan-archive", {
		description: "Archive the current plan and reset current.md to template",
		handler: async (_args, ctx) => {
			logger.log(state, "command:plan-archive", {});

			const p = paths(cwd);
			const planResult = validateCurrentPlan(cwd);

			// Do not archive template placeholders
			if (!planResult.valid) {
				ctx.ui.notify(`Cannot archive: current plan is invalid — ${planResult.reason}`, "error");
				logger.log(state, "lifecycle_validation_failure", {
					command: "plan-archive",
					reason: "invalid_plan",
					detail: planResult.reason,
				});
				return;
			}

			if (!isMeaningfulPlan(planResult)) {
				ctx.ui.notify("Cannot archive: current plan is only a template placeholder. Nothing to archive.", "info");
				logger.log(state, "lifecycle_validation_failure", {
					command: "plan-archive",
					reason: "template_only",
				});
				return;
			}

			const meta = planResult.meta;
			const content = readFileSync(p.currentPlan, "utf-8");

			// Create archive snapshot with status "archived"
			const archiveResult = createArchiveSnapshot(cwd, content, meta, "archived");

			if ("error" in archiveResult) {
				ctx.ui.notify(`Archive failed: ${archiveResult.error}`, "error");
				logger.log(state, "lifecycle_validation_failure", {
					command: "plan-archive",
					reason: "archive_failed",
					error: archiveResult.error,
				});
				return;
			}

			ctx.ui.notify(`Plan "${meta.slug}" archived as ${archiveResult.filename}`, "success");
			logger.log(state, "archive_created", {
				trigger: "plan-archive",
				filename: archiveResult.filename,
				slug: meta.slug,
				previousStatus: meta.status,
			});

			// Reset current.md to template
			resetCurrentPlan(ctx);

			// Update index
			rebuildIndex(cwd, lastPlanResult);
			logger.log(state, "index_updated", { trigger: "plan-archive" });

			ctx.ui.notify("current.md has been reset to the empty template.", "info");
		},
	});

	pi.registerCommand("plan-list", {
		description: "Show a summary of current and archived plans",
		handler: async (_args, ctx) => {
			logger.log(state, "command:plan-list", {});

			const p = paths(cwd);

			// Refresh current plan state
			refreshAndReconcile(ctx);

			const lines: string[] = [];
			lines.push("Plan Summary");
			lines.push("════════════════════════════════");
			lines.push("");

			// Current plan
			lines.push("Current Plan");
			lines.push("────────────────────────────────");
			if (lastPlanResult.valid) {
				const m = lastPlanResult.meta;
				if (m.status === "template") {
					lines.push("  (empty template — no active plan)");
				} else {
					lines.push(`  Slug:      ${m.slug || "(empty)"}`);
					lines.push(`  Status:    ${m.status}`);
					lines.push(`  Updated:   ${m.updated_at || "(unknown)"}`);
					lines.push(`  Impl-ready: ${isPlanImplementationReady(lastPlanResult) ? "yes" : "no"}`);
				}
			} else {
				lines.push(`  Invalid: ${lastPlanResult.reason}`);
			}

			lines.push("");

			// Read index.md if it exists
			if (!existsSync(p.indexFile)) {
				lines.push("Archived Plans");
				lines.push("────────────────────────────────");
				lines.push("  index.md not found. Run a lifecycle command to generate it.");
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			// Scan archive directory directly for a reliable listing
			const archiveEntries: { slug: string; filename: string; status: string; timestamp: string }[] = [];
			if (existsSync(p.archiveDir)) {
				try {
					const files = readdirSync(p.archiveDir)
						.filter((f) => f.endsWith(".md"))
						.sort()
						.reverse();

					for (const file of files) {
						try {
							const content = readFileSync(resolve(p.archiveDir, file), "utf-8");
							const result = parsePlanMeta(content);
							if (result.valid) {
								archiveEntries.push({
									slug: result.meta.slug || "(no slug)",
									filename: file,
									status: result.meta.status,
									timestamp: result.meta.updated_at || "(unknown)",
								});
							} else {
								archiveEntries.push({
									slug: "(invalid)",
									filename: file,
									status: "unknown",
									timestamp: "(unknown)",
								});
							}
						} catch {
							archiveEntries.push({
								slug: "(unreadable)",
								filename: file,
								status: "unknown",
								timestamp: "(unknown)",
							});
						}
					}
				} catch {
					// Cannot read archive dir
				}
			}

			lines.push("Archived Plans");
			lines.push("────────────────────────────────");
			if (archiveEntries.length === 0) {
				lines.push("  (none)");
			} else {
				// Show up to 20 most recent
				const shown = archiveEntries.slice(0, 20);
				for (const entry of shown) {
					lines.push(`  ${entry.slug}  [${entry.status}]  ${entry.filename}`);
					lines.push(`    archived: ${entry.timestamp}`);
				}
				if (archiveEntries.length > 20) {
					lines.push(`  ... and ${archiveEntries.length - 20} more (see plans/index.md)`);
				}
			}

			lines.push("");
			lines.push(`Total archived: ${archiveEntries.length}`);

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── Lifecycle Events ──────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		logger = new DebugLogger(cwd);
		logger.startSession();

		const loaded = loadState(cwd);
		if (loaded._loadError) {
			loadError = true;
			state = defaultState();
			ctx.ui.notify(
				"⚠ .pi/planning-state.json contains invalid JSON.\n" +
				"The file was NOT overwritten. Planning state is using defaults (planMode: false).\n" +
				"Fix or delete .pi/planning-state.json to resolve.",
				"error"
			);
		} else {
			loadError = false;
			state = loaded;
		}

		// Always validate and reconcile on startup
		refreshAndReconcile(ctx);

		logger.log(state, "session_start", {
			loadError,
			sessionId: logger.getSessionId(),
		});
	});

	pi.on("session_switch", async (_event, ctx) => {
		cwd = ctx.cwd;
		logger = new DebugLogger(cwd);
		logger.startSession();

		const loaded = loadState(cwd);
		if (!loaded._loadError) {
			state = loaded;
			loadError = false;
		}
		refreshAndReconcile(ctx);

		logger.log(state, "session_switch", {
			sessionId: logger.getSessionId(),
		});
	});

	pi.on("session_shutdown", async () => {
		logger.log(state, "session_shutdown", {});
	});

	// ── tool_call — Hard Whitelist Enforcement (Phase 3) ──────────────────

	pi.on("tool_call", async (event) => {
		const decision = checkToolAllowed(event.toolName, state);

		// Log every tool_call decision when debug mode is on
		logger.log(state, "tool_call", {
			toolName: event.toolName,
			allowed: decision.allowed,
			reason: decision.allowed ? null : decision.reason,
		});

		if (!decision.allowed) {
			return { block: true, reason: decision.reason };
		}

		// Allowed — do not interfere
		return undefined;
	});

	// ── before_agent_start — compact context injection ────────────────────

	pi.on("before_agent_start", async (_event, _ctx) => {
		logger.log(state, "before_agent_start", {});

		if (!state.planMode) return;

		const whitelistStr = Array.from(PLANNING_WHITELIST).join(", ");
		const statusLine = `Planning mode is ON. System status: ${state.status}.`;
		const planLine = `Current plan: ${state.currentPlanPath}`;
		const enforcementLine = `Tool enforcement is active. Only these tools are available: ${whitelistStr}. All other tools will be blocked.`;

		let validityLine: string;
		if (isPlanImplementationReady(lastPlanResult)) {
			validityLine = `Plan is valid and active (slug: ${lastPlanResult.meta!.slug}). However, implementation tools are blocked while planning mode is on. Use /plan-off to restore normal operation.`;
		} else if (state.status === "plan-required") {
			validityLine = "No valid active plan exists. The user should use /plan to create or update a plan.";
		} else {
			validityLine = `Plan status: ${lastPlanResult.valid ? lastPlanResult.meta!.status : "invalid"}.`;
		}

		const content = `[PLANNING PROTOCOL]\n${statusLine}\n${planLine}\n${enforcementLine}\n${validityLine}`;

		return {
			message: {
				customType: "planning-protocol-context",
				content,
				display: false,
			},
		};
	});

	// ── context — Prune stale planning messages ───────────────────────────
	//
	// Phase 3: Prevent planning-protocol custom messages from accumulating.
	// When planning mode is ON:  keep only the newest planning-protocol-context message.
	// When planning mode is OFF: remove all planning-protocol-context messages.

	pi.on("context", async (event) => {
		const msgs = event.messages;

		// Find all planning-protocol-context message indices
		const planningMsgIndices: number[] = [];
		for (let i = 0; i < msgs.length; i++) {
			const msg = msgs[i] as typeof msgs[number] & { customType?: string };
			if (msg.customType === "planning-protocol-context") {
				planningMsgIndices.push(i);
			}
		}

		if (planningMsgIndices.length === 0) return;

		if (!state.planMode) {
			// Remove all planning-protocol-context messages when planning is off
			const filtered = msgs.filter((m) => {
				const msg = m as typeof m & { customType?: string };
				return msg.customType !== "planning-protocol-context";
			});

			if (filtered.length !== msgs.length) {
				logger.log(state, "context_prune", {
					action: "remove_all",
					removedCount: msgs.length - filtered.length,
				});
			}

			return { messages: filtered };
		}

		// Planning mode is on — keep only the newest planning-protocol-context message
		if (planningMsgIndices.length <= 1) return;

		// Remove all but the last one
		const keepIndex = planningMsgIndices[planningMsgIndices.length - 1];
		const removeSet = new Set(planningMsgIndices.slice(0, -1));
		const filtered = msgs.filter((_, i) => !removeSet.has(i));

		logger.log(state, "context_prune", {
			action: "keep_newest",
			removedCount: removeSet.size,
			keptIndex: keepIndex,
		});

		return { messages: filtered };
	});
}
