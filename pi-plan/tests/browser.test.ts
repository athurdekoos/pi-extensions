/**
 * Tests for browser.ts — system browser launcher.
 *
 * What these tests prove:
 *   - openBrowser does not throw on any input
 *   - openBrowser handles empty and malformed URLs gracefully
 *
 * What these tests do NOT prove:
 *   - That a browser actually opens (platform-dependent, swallows errors)
 *   - That PI_PLAN_BROWSER / BROWSER env vars are correctly honored
 *     (would require mocking execSync per platform)
 *
 * The function is designed to silently fail, so these tests verify
 * the contract: "never throws, never blocks indefinitely."
 */

import { describe, it, expect } from "vitest";
import { openBrowser } from "../browser.js";

describe("openBrowser", () => {
  it("does not throw for a valid URL", () => {
    // This will attempt to open a browser (and likely fail silently in CI)
    expect(() => openBrowser("http://localhost:99999")).not.toThrow();
  });

  it("does not throw for an empty string", () => {
    expect(() => openBrowser("")).not.toThrow();
  });

  it("does not throw for a malformed URL", () => {
    expect(() => openBrowser("not-a-url")).not.toThrow();
  });
});
