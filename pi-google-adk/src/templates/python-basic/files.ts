/**
 * Template files for the basic ADK agent scaffold.
 */

export interface TemplateVars {
  name: string;
  model: string;
}

export function agentPy(v: TemplateVars): string {
  return `"""${v.name} - A basic Google ADK agent."""

from google.adk import Agent


def get_greeting(name: str) -> str:
    """Return a greeting for the given name."""
    return f"Hello, {name}! I am ${v.name}."


def get_current_time() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


root_agent = Agent(
    model="${v.model}",
    name="${v.name}",
    instruction="""You are a helpful assistant named ${v.name}.
You can greet users and tell them the current time.
Be concise and friendly.""",
    tools=[get_greeting, get_current_time],
)
`;
}

export function initPy(_v: TemplateVars): string {
  return `"""${_v.name} ADK agent package."""

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

A Google ADK agent scaffolded with the \`pi-google-adk\` extension.

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

Start the agent in the ADK dev server:

\`\`\`bash
adk web .
\`\`\`

Or run it from the CLI:

\`\`\`bash
adk run ${v.name}
\`\`\`

## Structure

- \`${v.name}/agent.py\` — Agent definition and tools
- \`${v.name}/__init__.py\` — Package entry point
- \`.env.example\` — Environment variable template

## ADK Docs MCP

If an example MCP config was generated at \`.pi/mcp/adk-docs.example.json\`,
you can use it to connect Pi to the ADK documentation via MCP:

1. Review the example config
2. Copy or adapt it into your Pi MCP settings
3. This gives your agent access to ADK docs via \`llms.txt\`

See: https://google.github.io/adk-docs/

## Editing

Start by editing \`${v.name}/agent.py\`:
- Add new tool functions above \`root_agent\`
- Add them to the \`tools=\` list
- Modify the instruction block
`;
}

export function adkScaffoldMarker(v: TemplateVars): string {
  return JSON.stringify(
    { name: v.name, template: "basic", model: v.model, version: "0.1.0" },
    null,
    2
  ) + "\n";
}
