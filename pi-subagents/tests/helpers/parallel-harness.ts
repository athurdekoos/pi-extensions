/**
 * Timing, isolation, and concurrency classification utilities
 * for parallel subagent tests.
 *
 * These helpers support honest classification of execution behavior:
 * - "proven_parallel": overlapping execution windows observed
 * - "serial_observed": strictly non-overlapping, ordered execution
 * - "inconclusive": evidence is insufficient to classify
 *
 * The classification is based solely on observed timing, not code intent.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionRecord {
  /** Identifier for this execution (e.g., "A", "B", "C"). */
  id: string;
  /** High-resolution start timestamp (ms). */
  startMs: number;
  /** High-resolution end timestamp (ms). */
  endMs: number;
  /** Whether the execution completed successfully (not blocked by guard). */
  success: boolean;
  /** Whether the execution was blocked by the recursion depth guard. */
  blockedByGuard: boolean;
  /** The raw text extracted from the tool result. */
  resultText: string;
}

export type ConcurrencyClassification =
  | "proven_parallel"
  | "serial_observed"
  | "inconclusive";

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify concurrency based on observed execution timing.
 *
 * Only successful (non-blocked) executions are considered.
 * If fewer than 2 succeeded, classification is "inconclusive" because
 * parallelism cannot be proved or disproved with a single execution.
 *
 * Overlap check: if any execution's start time falls strictly before
 * another execution's end time AND after its start time, they overlap.
 *
 * Serial check: if every execution starts at or after the previous one
 * ended, the sequence is strictly non-overlapping.
 *
 * Inconclusive: fewer than 2 successes, or ambiguous edge cases.
 */
export function classifyConcurrency(
  records: ExecutionRecord[]
): ConcurrencyClassification {
  const successful = records.filter((r) => r.success && !r.blockedByGuard);

  if (successful.length < 2) {
    // Cannot determine concurrency with fewer than 2 successful runs.
    return "inconclusive";
  }

  const sorted = [...successful].sort((a, b) => a.startMs - b.startMs);

  // Check for overlapping windows.
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].startMs < sorted[i].endMs) {
        return "proven_parallel";
      }
    }
  }

  // All non-overlapping: each execution starts at or after the previous ended.
  return "serial_observed";
}

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

/**
 * Verify result isolation: each result contains only its own canary,
 * no other result's canary, and no duplicate result texts exist.
 *
 * Returns an array of violation descriptions. Empty array means isolated.
 */
export function assertIsolation(
  results: Array<{ id: string; text: string; canary: string }>
): string[] {
  const violations: string[] = [];

  for (const r of results) {
    // Own canary must be present.
    if (!r.text.includes(r.canary)) {
      violations.push(`${r.id}: missing own canary "${r.canary}"`);
    }

    // Other canaries must be absent.
    for (const other of results) {
      if (other.id === r.id) continue;
      if (r.text.includes(other.canary)) {
        violations.push(
          `${r.id}: contaminated with ${other.id}'s canary "${other.canary}"`
        );
      }
    }
  }

  // Check for duplicated result texts.
  const texts = results.map((r) => r.text);
  if (new Set(texts).size < texts.length) {
    violations.push("duplicate result texts detected");
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Derived canary helpers (task-specific transformations)
// ---------------------------------------------------------------------------

/**
 * Derive a canary for task A: reverse the nonce and append "::A".
 * Models the "reverse ALPHA-731Q and append ::A" business rule.
 */
export function deriveCanaryA(nonce: string): string {
  return nonce.split("").reverse().join("") + "::A";
}

/**
 * Derive a canary for task B: lowercase the nonce and append "::b-ready".
 * Models the "lowercase BRAVO-19XZ and append ::b-ready" business rule.
 */
export function deriveCanaryB(nonce: string): string {
  return nonce.toLowerCase() + "::b-ready";
}

/**
 * Derive a canary for task C: extract digits, parse first 3, multiply by 2,
 * return "C=" + result.
 * Models the "extract 555 from CHARLIE-555K, multiply by 2" business rule.
 */
export function deriveCanaryC(nonce: string): string {
  const digits = nonce.replace(/\D/g, "");
  const num = parseInt(digits.slice(0, 3) || "100", 10);
  return `C=${num * 2}`;
}

// ---------------------------------------------------------------------------
// Result extraction
// ---------------------------------------------------------------------------

/** Extract the text from an AgentToolResult content block. */
export function extractResultText(
  result: { content: Array<{ type: string; text?: string }> }
): string {
  const textBlock = result.content.find((c) => c.type === "text");
  return (textBlock as { text: string } | undefined)?.text ?? "";
}

/**
 * Determine whether a tool result was blocked by the recursion guard.
 * Checks for the canonical error message.
 */
export function isBlockedByGuard(resultText: string): boolean {
  return /recursive delegation blocked/i.test(resultText);
}
