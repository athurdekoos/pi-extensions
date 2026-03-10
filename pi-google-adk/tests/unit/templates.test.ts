/**
 * Unit tests: template rendering.
 *
 * Behavior protected:
 * - Each template produces correct Python imports and patterns
 * - No unresolved JS template variables (${...}) in output
 * - Agent name and model are interpolated correctly
 * - .gitignore includes essential entries
 */

import { describe, it, expect } from "vitest";
import * as basicTemplate from "../../src/templates/python-basic/files.js";
import * as mcpTemplate from "../../src/templates/python-mcp/files.js";
import * as sequentialTemplate from "../../src/templates/python-sequential/files.js";
import { gitignore } from "../../src/templates/shared.js";

const vars = { name: "test_agent", model: "gemini-2.5-flash" };

describe("basic template", () => {
  it("agent.py has correct imports and structure", () => {
    const src = basicTemplate.agentPy(vars);
    expect(src).toContain("from google.adk import Agent");
    expect(src).toContain('name="test_agent"');
    expect(src).toContain('model="gemini-2.5-flash"');
    expect(src).toContain("root_agent = Agent(");
    expect(src).toContain("tools=[get_greeting, get_current_time]");
  });

  it("agent.py has no unresolved JS template vars", () => {
    const src = basicTemplate.agentPy(vars);
    // JS template literals use ${...} but Python f-strings also use {name}.
    // We only check for ${ which is JS-specific.
    expect(src).not.toMatch(/\$\{(?!v\.)/);
  });

  it("__init__.py imports root_agent", () => {
    const src = basicTemplate.initPy(vars);
    expect(src).toContain("from .agent import root_agent");
  });

  it("envExample contains GOOGLE_API_KEY", () => {
    expect(basicTemplate.envExample()).toContain("GOOGLE_API_KEY");
  });
});

describe("mcp template", () => {
  it("agent.py imports mcp_config", () => {
    const src = mcpTemplate.agentPy(vars);
    expect(src).toContain("from .mcp_config import get_mcp_toolsets");
    expect(src).toContain("mcp_toolsets = get_mcp_toolsets()");
    expect(src).toContain("*mcp_toolsets");
  });

  it("mcp_config.py references MCPToolset and StdioServerParameters", () => {
    const src = mcpTemplate.mcpConfigPy(vars);
    expect(src).toContain("MCPToolset");
    expect(src).toContain("StdioServerParameters");
  });

  it("no unresolved JS template vars", () => {
    expect(mcpTemplate.agentPy(vars)).not.toMatch(/\$\{(?!v\.)/);
    expect(mcpTemplate.mcpConfigPy(vars)).not.toMatch(/\$\{(?!v\.)/);
  });
});

describe("sequential template", () => {
  it("agent.py imports SequentialAgent", () => {
    const src = sequentialTemplate.agentPy(vars);
    expect(src).toContain("from google.adk.agents import SequentialAgent");
    expect(src).toContain("root_agent = SequentialAgent(");
  });

  it("agent.py imports steps", () => {
    const src = sequentialTemplate.agentPy(vars);
    expect(src).toContain("from .steps import research_agent, draft_agent, review_agent");
  });

  it("steps.py defines subagents with Agent()", () => {
    const src = sequentialTemplate.stepsPy(vars);
    expect(src).toContain("from google.adk import Agent");
    expect(src).toContain("research_agent = Agent(");
    expect(src).toContain("draft_agent = Agent(");
    expect(src).toContain("review_agent = Agent(");
  });

  it("no deprecated adk namespace usage", () => {
    const agentSrc = sequentialTemplate.agentPy(vars);
    const stepsSrc = sequentialTemplate.stepsPy(vars);
    expect(agentSrc).not.toContain("adk.SequentialAgent");
    expect(stepsSrc).not.toContain("adk.LlmAgent");
  });
});

describe("gitignore", () => {
  it("includes essential entries", () => {
    const gi = gitignore();
    expect(gi).toContain(".env");
    expect(gi).toContain(".venv/");
    expect(gi).toContain("__pycache__/");
    expect(gi).toContain("*.py[cod]");
  });
});
