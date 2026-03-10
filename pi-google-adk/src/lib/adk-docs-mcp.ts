/**
 * Generate the project-local example MCP config for ADK docs.
 */

export function adkDocsMcpConfig(): string {
  const config = {
    mcpServers: {
      "adk-docs-mcp": {
        command: "uvx",
        args: [
          "--from",
          "mcpdoc",
          "mcpdoc",
          "--urls",
          "AgentDevelopmentKit:https://google.github.io/adk-docs/llms.txt",
          "--transport",
          "stdio",
        ],
      },
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}
