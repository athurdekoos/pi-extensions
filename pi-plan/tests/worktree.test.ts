/**
 * Tests for worktree.ts — Git worktree isolation module.
 *
 * What these tests prove:
 *   - deriveWorktreeBranch generates plan/<slug> branch names
 *   - detectSetupCommands identifies project setup needs
 *   - writeWorktreeState/readWorktreeState round-trip correctly
 *   - State file cleanup works
 *   - Branch derivation handles edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deriveWorktreeBranch,
  detectSetupCommands,
  writeWorktreeState,
  readWorktreeState,
  addWorktreeDirToGitignore,
  type WorktreeInfo,
} from "../worktree.js";

// ---------------------------------------------------------------------------
// Shared temp directory
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `pi-plan-worktree-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// deriveWorktreeBranch
// ---------------------------------------------------------------------------

describe("deriveWorktreeBranch", () => {
  it("generates plan/<slug> from title", () => {
    expect(deriveWorktreeBranch("Auth Flow Design")).toBe("plan/auth-flow-design");
  });

  it("handles special characters", () => {
    expect(deriveWorktreeBranch("API v2.0 — Breaking Changes!")).toBe("plan/api-v2-0-breaking-changes");
  });

  it("handles empty title", () => {
    expect(deriveWorktreeBranch("")).toBe("plan/work");
  });

  it("truncates long titles", () => {
    const longTitle = "A very long plan title that exceeds the maximum slug length limit";
    const branch = deriveWorktreeBranch(longTitle);
    expect(branch.startsWith("plan/")).toBe(true);
    // "plan/" is 5 chars, slug is max 40
    expect(branch.length).toBeLessThanOrEqual(45);
  });

  it("removes leading and trailing hyphens from slug", () => {
    expect(deriveWorktreeBranch("---test---")).toBe("plan/test");
  });
});

// ---------------------------------------------------------------------------
// detectSetupCommands
// ---------------------------------------------------------------------------

describe("detectSetupCommands", () => {
  it("detects npm ci for package-lock.json", () => {
    writeFileSync(join(tmp, "package-lock.json"), "{}", "utf-8");
    const commands = detectSetupCommands(tmp);
    expect(commands).toContain("npm ci");
  });

  it("detects npm install for package.json without lock", () => {
    writeFileSync(join(tmp, "package.json"), "{}", "utf-8");
    const commands = detectSetupCommands(tmp);
    expect(commands).toContain("npm install");
  });

  it("detects yarn install for yarn.lock", () => {
    writeFileSync(join(tmp, "yarn.lock"), "", "utf-8");
    const commands = detectSetupCommands(tmp);
    expect(commands).toContain("yarn install");
  });

  it("detects bundle install for Gemfile", () => {
    writeFileSync(join(tmp, "Gemfile"), "", "utf-8");
    const commands = detectSetupCommands(tmp);
    expect(commands).toContain("bundle install");
  });

  it("detects pip install for requirements.txt", () => {
    writeFileSync(join(tmp, "requirements.txt"), "", "utf-8");
    const commands = detectSetupCommands(tmp);
    expect(commands).toContain("pip install -r requirements.txt");
  });

  it("detects go mod download for go.mod", () => {
    writeFileSync(join(tmp, "go.mod"), "", "utf-8");
    const commands = detectSetupCommands(tmp);
    expect(commands).toContain("go mod download");
  });

  it("returns empty array for empty directory", () => {
    expect(detectSetupCommands(tmp)).toEqual([]);
  });

  it("detects multiple setup commands", () => {
    writeFileSync(join(tmp, "package.json"), "{}", "utf-8");
    writeFileSync(join(tmp, "Gemfile"), "", "utf-8");
    const commands = detectSetupCommands(tmp);
    expect(commands.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// writeWorktreeState / readWorktreeState
// ---------------------------------------------------------------------------

describe("worktree state I/O", () => {
  const sampleInfo: WorktreeInfo = {
    path: "/repo/.worktrees/auth-flow",
    branch: "plan/auth-flow",
    createdAt: "2026-03-15T14:30:00.000Z",
    planTitle: "Auth Flow Design",
  };

  it("round-trips state through write/read", () => {
    writeWorktreeState(tmp, sampleInfo, ".pi/worktrees");
    const restored = readWorktreeState(tmp, ".pi/worktrees");
    expect(restored).toEqual(sampleInfo);
  });

  it("creates state directory if needed", () => {
    writeWorktreeState(tmp, sampleInfo, ".pi/worktrees");
    expect(existsSync(join(tmp, ".pi/worktrees"))).toBe(true);
  });

  it("returns null when no state file exists", () => {
    expect(readWorktreeState(tmp, ".pi/worktrees")).toBeNull();
  });

  it("returns null for malformed state file", () => {
    mkdirSync(join(tmp, ".pi/worktrees"), { recursive: true });
    writeFileSync(join(tmp, ".pi/worktrees/active.json"), "not json", "utf-8");
    expect(readWorktreeState(tmp, ".pi/worktrees")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addWorktreeDirToGitignore
// ---------------------------------------------------------------------------

describe("addWorktreeDirToGitignore", () => {
  it("creates .gitignore with .worktrees/ entry", () => {
    addWorktreeDirToGitignore(tmp);
    const content = require("node:fs").readFileSync(join(tmp, ".gitignore"), "utf-8");
    expect(content).toContain(".worktrees/");
  });

  it("appends to existing .gitignore", () => {
    writeFileSync(join(tmp, ".gitignore"), "node_modules/\n", "utf-8");
    addWorktreeDirToGitignore(tmp);
    const content = require("node:fs").readFileSync(join(tmp, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".worktrees/");
  });

  it("does not duplicate entry", () => {
    writeFileSync(join(tmp, ".gitignore"), ".worktrees/\n", "utf-8");
    addWorktreeDirToGitignore(tmp);
    const content = require("node:fs").readFileSync(join(tmp, ".gitignore"), "utf-8");
    const count = (content.match(/\.worktrees/g) || []).length;
    expect(count).toBe(1);
  });
});
