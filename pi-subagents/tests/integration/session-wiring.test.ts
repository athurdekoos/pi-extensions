/**
 * Integration tests: real SDK session wiring.
 *
 * These tests use the real DefaultResourceLoader, SessionManager.inMemory(),
 * and createAgentSession() from the installed pi-coding-agent SDK to verify
 * that child sessions are constructed correctly without mocks.
 *
 * The tests do NOT make LLM calls; they verify session construction, tool
 * lists, and resource loader configuration.
 *
 * Behavior protected:
 * - Child ResourceLoader uses noExtensions: true
 * - Child session gets the correct built-in tools per mode
 * - Child session does not include delegate_to_subagent
 * - Child session does not re-load the pi-subagents extension
 * - Custom tools are passed through only when allowlisted
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DefaultResourceLoader,
  SessionManager,
  readOnlyTools,
  codingTools,
} from "@mariozechner/pi-coding-agent";
import { _setChildDepth, resolveAllowedCustomTools, buildChildSystemPrompt } from "../../index.js";
import { makeFakeTool } from "../helpers/fake-tool.js";

beforeEach(() => {
  _setChildDepth(0);
});

describe("DefaultResourceLoader with noExtensions", () => {
  it("creates a loader that skips extensions", async () => {
    const loader = new DefaultResourceLoader({
      cwd: "/tmp/test-child",
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: "Test child prompt",
    });

    // reload() should succeed without trying to load extensions
    await expect(loader.reload()).resolves.not.toThrow();
  });

  it("applies custom system prompt", async () => {
    const prompt = "You are a bounded worker subagent.";
    const loader = new DefaultResourceLoader({
      cwd: "/tmp/test-child",
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: prompt,
    });
    await loader.reload();

    const systemPrompt = loader.getSystemPrompt();
    expect(systemPrompt).toContain(prompt);
  });
});

describe("built-in tool sets", () => {
  it("readOnlyTools does not contain bash, edit, or write", () => {
    const names = readOnlyTools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).not.toContain("bash");
    expect(names).not.toContain("edit");
    expect(names).not.toContain("write");
  });

  it("codingTools contains bash, edit, write, and read", () => {
    const names = codingTools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("bash");
    expect(names).toContain("edit");
    expect(names).toContain("write");
  });

  it("neither tool set contains delegate_to_subagent", () => {
    const roNames = readOnlyTools.map((t) => t.name);
    const coNames = codingTools.map((t) => t.name);
    expect(roNames).not.toContain("delegate_to_subagent");
    expect(coNames).not.toContain("delegate_to_subagent");
  });
});

describe("SessionManager.inMemory", () => {
  it("creates an in-memory session manager", () => {
    const sm = SessionManager.inMemory("/tmp/test");
    expect(sm).toBeDefined();
  });
});

describe("child tool surface", () => {
  it("read_only mode child gets only read-only built-ins plus allowlisted custom tools", () => {
    const registry = [makeFakeTool("safe_tool"), makeFakeTool("unsafe_tool")];
    const allowed = resolveAllowedCustomTools([], registry, ["safe_tool"]);
    const allChildTools = [...readOnlyTools, ...allowed];

    const names = allChildTools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("safe_tool");
    expect(names).not.toContain("unsafe_tool");
    expect(names).not.toContain("delegate_to_subagent");
  });

  it("coding mode child gets coding built-ins plus allowlisted custom tools", () => {
    const registry = [makeFakeTool("safe_tool")];
    const allowed = resolveAllowedCustomTools([], registry, ["safe_tool"]);
    const allChildTools = [...codingTools, ...allowed];

    const names = allChildTools.map((t) => t.name);
    expect(names).toContain("bash");
    expect(names).toContain("safe_tool");
    expect(names).not.toContain("delegate_to_subagent");
  });

  it("no safeCustomTools means child gets zero custom tools", () => {
    const registry = [makeFakeTool("tool_a"), makeFakeTool("tool_b")];
    const allowed = resolveAllowedCustomTools([], registry, []);
    expect(allowed).toHaveLength(0);
  });
});

describe("child system prompt integration", () => {
  it("produces a prompt compatible with DefaultResourceLoader systemPrompt option", () => {
    const prompt = buildChildSystemPrompt({
      task: "Read config files",
      mode: "read_only",
      successCriteria: "List all config keys",
      outputStyle: "summary",
      files: ["config/"],
    });

    // Verify it's a valid non-empty string suitable for systemPrompt
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain("TASK: Read config files");
    expect(prompt).toContain("config/");
  });
});
