/**
 * Deterministic nonce/canary generator for veracity trap tests.
 */

let counter = 0;

export function resetNonceCounter(): void {
  counter = 0;
}

export function generateNonce(prefix = "CANARY"): string {
  counter++;
  const seed = counter * 7919 + 104729;
  return `${prefix}-${seed.toString(36).toUpperCase()}-${counter}`;
}

export function deriveFromNonce(nonce: string): string {
  const reversed = nonce.split("").reverse().join("");
  return `DERIVED:${reversed}`;
}

export function generateDecoy(realNonce: string): string {
  return realNonce.replace(/CANARY/, "DECOY").replace(/-(\d+)$/, (_, n) => `-${Number(n) + 9999}`);
}
