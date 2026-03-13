/**
 * mode-utils.ts — Pure utility functions for plan step tracking.
 *
 * Owns: TodoItem type, step extraction from Implementation Plan sections
 *       in current.md, [DONE:n] parsing, step completion tracking.
 *
 * Does NOT own: Pi API calls, state transitions, file writes, plan generation,
 *               archive lifecycle, harness-level interception.
 *
 * Invariants:
 *   - All functions are pure (no side effects, no Pi dependencies).
 *   - Step extraction reads from structured markdown (## Implementation Plan),
 *     not freeform chat output.
 */

// ---------------------------------------------------------------------------
// TodoItem type and step tracking
// ---------------------------------------------------------------------------

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

/**
 * Extract implementation steps from a plan markdown string.
 *
 * Supports two step formats:
 * - Numbered: "1. Step text" or "1) Step text"
 * - Checkbox: "- [ ] Step text" or "- [x] Step text"
 *
 * Looks for an "## Implementation Plan" or "## Steps" section and parses
 * items in either format. Stops at the next H2 heading or end of string.
 *
 * This extracts from the on-disk current.md (deterministic, template-controlled),
 * NOT from freeform agent chat output.
 */
export function extractStepsFromPlan(planMarkdown: string): TodoItem[] {
	const items: TodoItem[] = [];

	// Find the Implementation Plan or Steps section
	const sectionMatch = planMarkdown.match(/^##\s+(?:Implementation\s+Plan|Steps)\s*$/im);
	if (!sectionMatch || sectionMatch.index === undefined) return items;

	// Extract the section body (until next H2 or end of string)
	const sectionStart = sectionMatch.index + sectionMatch[0].length;
	const nextH2 = planMarkdown.slice(sectionStart).match(/^##\s+/m);
	const sectionEnd = nextH2?.index !== undefined
		? sectionStart + nextH2.index
		: planMarkdown.length;
	const sectionBody = planMarkdown.slice(sectionStart, sectionEnd);

	// Parse numbered items: "1. Step text" or "1) Step text"
	const numberedPattern = /^\s*(\d+)[.)]\s+(.+)/gm;
	// Parse checkbox items: "- [ ] Step text" or "- [x] Step text" or "* [ ] Step text"
	const checkboxPattern = /^\s*[-*]\s*\[([ xX])\]\s+(.+)/gm;

	const numberedMatches: Array<{ index: number; text: string; completed: boolean }> = [];
	const checkboxMatches: Array<{ index: number; text: string; completed: boolean }> = [];

	for (const match of sectionBody.matchAll(numberedPattern)) {
		const text = match[2].trim();
		if (text.startsWith("_") && text.endsWith("_")) continue;
		if (text.length < 4) continue;
		numberedMatches.push({ index: match.index!, text, completed: false });
	}

	for (const match of sectionBody.matchAll(checkboxPattern)) {
		const completed = match[1] !== " ";
		const text = match[2].trim();
		if (text.length < 4) continue;
		checkboxMatches.push({ index: match.index!, text, completed });
	}

	// Prefer whichever format has more matches; if equal, prefer checkbox
	const matches = checkboxMatches.length >= numberedMatches.length
		? checkboxMatches
		: numberedMatches;

	// Sort by position in document
	matches.sort((a, b) => a.index - b.index);

	for (const m of matches) {
		items.push({
			step: items.length + 1,
			text: m.text,
			completed: m.completed,
		});
	}

	return items;
}

// ---------------------------------------------------------------------------
// [DONE:n] marker tracking
// ---------------------------------------------------------------------------

/**
 * Extract step numbers from [DONE:n] markers in text.
 */
export function extractDoneSteps(text: string): number[] {
	const steps: number[] = [];
	for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

/**
 * Mark todo items as completed based on [DONE:n] markers found in text.
 * Returns the number of newly completed steps.
 */
export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	let count = 0;
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step && !t.completed);
		if (item) {
			item.completed = true;
			count++;
		}
	}
	return count;
}
