/**
 * Deterministic nonce/canary generator for veracity trap tests.
 *
 * Uses a seeded counter to produce unique, unpredictable-looking tokens
 * that cannot be guessed without actually running the generator.
 */

let counter = 0;

/** Reset the counter (call in beforeEach). */
export function resetNonceCounter(): void {
  counter = 0;
}

/**
 * Generate a canary nonce. Each call returns a unique value within
 * the same test run. The format is designed to be unlikely to appear
 * in any prompt or context by accident.
 */
export function generateNonce(prefix = "CANARY"): string {
  counter++;
  // Use counter + timestamp-derived seed for uniqueness across runs
  const seed = counter * 7919 + 104729;
  return `${prefix}-${seed.toString(36).toUpperCase()}-${counter}`;
}

/**
 * Derive a transformed value from a canary nonce.
 * The transformation is deterministic but non-trivial: reverse + prefix swap.
 * This ensures tests cannot pass by echoing the raw nonce.
 */
export function deriveFromNonce(nonce: string): string {
  const reversed = nonce.split("").reverse().join("");
  return `DERIVED:${reversed}`;
}

/**
 * Generate a decoy nonce that looks similar but is provably different.
 */
export function generateDecoy(realNonce: string): string {
  return realNonce.replace(/CANARY/, "DECOY").replace(/-(\d+)$/, (_, n) => `-${Number(n) + 9999}`);
}
