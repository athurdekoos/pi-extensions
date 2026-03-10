/**
 * Unit tests: adk-docs-mcp config generation.
 *
 * Behavior protected:
 * - Produces valid JSON
 * - Contains expected server name, command, and llms.txt URL
 */

import { describe, it, expect } from "vitest";
import { adkDocsMcpConfig } from "../../src/lib/adk-docs-mcp.js";

describe("adkDocsMcpConfig", () => {
  it("returns valid JSON", () => {
    const raw = adkDocsMcpConfig();
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("has mcpServers.adk-docs-mcp with command uvx", () => {
    const config = JSON.parse(adkDocsMcpConfig());
    expect(config.mcpServers["adk-docs-mcp"]).toBeDefined();
    expect(config.mcpServers["adk-docs-mcp"].command).toBe("uvx");
  });

  it("includes llms.txt URL in args", () => {
    const config = JSON.parse(adkDocsMcpConfig());
    const args: string[] = config.mcpServers["adk-docs-mcp"].args;
    expect(args.some((a: string) => a.includes("llms.txt"))).toBe(true);
  });
});
