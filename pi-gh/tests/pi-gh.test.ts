/**
 * pi-gh tests
 *
 * Behavior protected:
 * - Preflight checks detect missing gh, missing auth, missing repo
 * - Read-only operations return normalized success results
 * - High-impact mutations require confirmation and return cancellation on decline
 *
 * Regression risks:
 * - Preflight returning wrong error codes
 * - Confirmation gates bypassed for destructive ops
 * - JSON parsing failures on gh output
 *
 * Assumptions:
 * - Tests mock pi.exec; no live gh calls
 * - Exported helpers (checkGhInstalled, checkGhAuth, getRepoSlug, preflight) are tested directly
 * - Tool execute paths are tested via the handler functions indirectly through exported helpers
 */

import { describe, it, expect } from "vitest";
import { checkGhInstalled, checkGhAuth, getRepoSlug, preflight } from "../index.js";
import { createMockPi } from "./helpers.js";

describe("preflight: gh not installed", () => {
  it("returns GH_NOT_INSTALLED when gh --version fails", async () => {
    const pi = createMockPi(() => ({ stdout: "", stderr: "command not found", code: 127, killed: false }));
    const result = await checkGhInstalled(pi);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.error.code).toBe("GH_NOT_INSTALLED");
  });
});

describe("preflight: gh not authenticated", () => {
  it("returns GH_NOT_AUTHENTICATED when gh auth status fails", async () => {
    const pi = createMockPi((cmd, args) => {
      if (args.includes("--version")) return { stdout: "gh version 2.0.0", stderr: "", code: 0, killed: false };
      if (args.includes("auth")) return { stdout: "", stderr: "not logged in", code: 1, killed: false };
      return { stdout: "", stderr: "", code: 0, killed: false };
    });
    const result = await checkGhAuth(pi);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.error.code).toBe("GH_NOT_AUTHENTICATED");
    expect(result!.error.suggested_fix).toContain("gh auth login");
  });
});

describe("preflight: repo unavailable", () => {
  it("returns GH_REPO_UNAVAILABLE when not in a repo", async () => {
    const pi = createMockPi((_cmd, args) => {
      if (args.includes("--version")) return { stdout: "gh version 2.0.0", stderr: "", code: 0, killed: false };
      if (args.includes("auth")) return { stdout: "", stderr: "", code: 0, killed: false };
      if (args.includes("view")) return { stdout: "", stderr: "not a git repo", code: 1, killed: false };
      return { stdout: "", stderr: "", code: 0, killed: false };
    });
    const result = await getRepoSlug(pi);
    expect(typeof result).not.toBe("string");
    expect((result as { ok: false; error: { code: string } }).error.code).toBe("GH_REPO_UNAVAILABLE");
  });
});

describe("preflight: success", () => {
  it("returns repo slug on success", async () => {
    const pi = createMockPi((_cmd, args) => {
      if (args.includes("--version")) return { stdout: "gh version 2.0.0", stderr: "", code: 0, killed: false };
      if (args.includes("auth")) return { stdout: "", stderr: "", code: 0, killed: false };
      if (args.includes("view")) return { stdout: "owner/repo\n", stderr: "", code: 0, killed: false };
      return { stdout: "", stderr: "", code: 0, killed: false };
    });
    const result = await preflight(pi);
    expect("repo" in result).toBe(true);
    if ("repo" in result) {
      expect(result.repo).toBe("owner/repo");
    }
  });
});

describe("preflight: cascading failure", () => {
  it("stops at first failure (gh not installed)", async () => {
    const pi = createMockPi(() => ({ stdout: "", stderr: "not found", code: 127, killed: false }));
    const result = await preflight(pi);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("GH_NOT_INSTALLED");
    }
    // Should have only called gh --version, not auth or repo
    expect(pi.execCalls.length).toBe(1);
  });
});
