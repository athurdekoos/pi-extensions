/**
 * Template files for the MCP-enabled ADK agent scaffold.
 * Extends the basic template with MCP toolset integration.
 */

export interface TemplateVars {
  name: string;
  model: string;
}

export function agentPy(v: TemplateVars): string {
  return `"""${v.name} - A Google ADK agent with MCP toolset integration."""

import google.adk as adk
from .mcp_config import get_mcp_toolsets


def get_greeting(name: str) -> str:
    """Return a greeting for the given name."""
    return f"Hello, {name}! I am ${v.name}."


# MCP toolsets are loaded from mcp_config.py
mcp_toolsets = get_mcp_toolsets()

root_agent = adk.LlmAgent(
    model="${v.model}",
    name="${v.name}",
    instruction="""You are a helpful assistant named ${v.name}.
You have access to tools provided via MCP servers.
Use them when relevant to the user's request.
Be concise and friendly.""",
    tools=[get_greeting, *mcp_toolsets],
)
`;
}

export function mcpConfigPy(v: TemplateVars): string {
  return `"""MCP toolset configuration for ${v.name}.

Edit this file to add or remove MCP server connections.
Each entry creates an MCPToolset that the agent can use.
"""

from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StdioServerParameters


def get_mcp_toolsets() -> list:
    """Return a list of MCPToolset instances for the agent.

    Add your MCP server configurations here. Example:

        MCPToolset(
            connection_params=StdioServerParameters(
                command="npx",
                args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            ),
        )
    """
    toolsets: list = [
        # Uncomment and edit to add an MCP server:
        #
        # MCPToolset(
        #     connection_params=StdioServerParameters(
        #         command="npx",
        #         args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        #     ),
        # ),
    ]
    return toolsets
`;
}

export function initPy(v: TemplateVars): string {
  return `"""${v.name} ADK agent package with MCP support."""

from .agent import root_agent

__all__ = ["root_agent"]
`;
}

export function envExample(): string {
  return `# Google API key for Gemini models
GOOGLE_API_KEY=

# Optional: Google Cloud project for Vertex AI
# GOOGLE_CLOUD_PROJECT=
# GOOGLE_CLOUD_LOCATION=us-central1
`;
}

export function projectReadme(v: TemplateVars): string {
  return `# ${v.name}

A Google ADK agent with MCP toolset integration, scaffolded with \`pi-google-adk\`.

## Setup

1. Create a Python virtual environment:

\`\`\`bash
python -m venv .venv
source .venv/bin/activate
\`\`\`

2. Install the Google ADK:

\`\`\`bash
pip install google-adk
\`\`\`

3. Copy the environment file and add your API key:

\`\`\`bash
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY
\`\`\`

## Running

\`\`\`bash
adk web .
\`\`\`

Or:

\`\`\`bash
adk run ${v.name}
\`\`\`

## Structure

- \`${v.name}/agent.py\` — Agent definition with MCP toolsets
- \`${v.name}/mcp_config.py\` — MCP server configuration
- \`${v.name}/__init__.py\` — Package entry point
- \`.env.example\` — Environment variable template

## Adding MCP Servers

Edit \`${v.name}/mcp_config.py\` to add MCP server connections.
Each MCPToolset wraps an MCP server and exposes its tools to the agent.

## ADK Docs MCP

If an example MCP config was generated at \`.pi/mcp/adk-docs.example.json\`,
you can use it to connect Pi to the ADK documentation via MCP.

See: https://google.github.io/adk-docs/
`;
}

export function adkScaffoldMarker(v: TemplateVars): string {
  return JSON.stringify(
    { name: v.name, template: "mcp", model: v.model, version: "0.1.0" },
    null,
    2
  ) + "\n";
}
