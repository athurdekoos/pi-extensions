/**
 * Template files for the sequential workflow ADK agent scaffold.
 * Generates a multi-agent workflow with a coordinator and subagents.
 */

export interface TemplateVars {
  name: string;
  model: string;
}

export function agentPy(v: TemplateVars): string {
  return `"""${v.name} - A sequential workflow Google ADK agent.

This agent coordinates a pipeline of subagents that run in sequence.
Each subagent handles one step of the workflow.
"""

import google.adk as adk
from .steps import research_agent, draft_agent, review_agent


root_agent = adk.SequentialAgent(
    name="${v.name}",
    sub_agents=[research_agent, draft_agent, review_agent],
    description="A sequential workflow that researches, drafts, and reviews.",
)
`;
}

export function stepsPy(v: TemplateVars): string {
  return `"""Subagents for the ${v.name} sequential workflow.

Each agent handles one step. Edit these or add new steps as needed.
The sequential agent runs them in order from top to bottom.
"""

import google.adk as adk


def search_web(query: str) -> str:
    """Placeholder: search the web for information."""
    return f"[Search results for: {query}]"


research_agent = adk.LlmAgent(
    model="${v.model}",
    name="researcher",
    instruction="""You are a research assistant.
Given a topic, use your tools to gather relevant information.
Summarize your findings clearly.""",
    tools=[search_web],
)

draft_agent = adk.LlmAgent(
    model="${v.model}",
    name="drafter",
    instruction="""You are a writing assistant.
Using the research provided by the previous step, draft a clear and concise document.
Focus on accuracy and readability.""",
    tools=[],
)

review_agent = adk.LlmAgent(
    model="${v.model}",
    name="reviewer",
    instruction="""You are a review assistant.
Review the draft from the previous step for:
- Factual accuracy
- Clarity and readability
- Completeness
Provide the final polished version.""",
    tools=[],
)
`;
}

export function initPy(v: TemplateVars): string {
  return `"""${v.name} ADK sequential workflow package."""

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

A Google ADK sequential workflow agent scaffolded with \`pi-google-adk\`.

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

- \`${v.name}/agent.py\` — Sequential agent coordinator
- \`${v.name}/steps.py\` — Subagent definitions (research, draft, review)
- \`${v.name}/__init__.py\` — Package entry point
- \`.env.example\` — Environment variable template

## Editing

The workflow runs three subagents in sequence:

1. **researcher** — Gathers information on a topic
2. **drafter** — Writes a document from the research
3. **reviewer** — Reviews and polishes the draft

Edit \`${v.name}/steps.py\` to:
- Change subagent instructions
- Add or remove steps
- Add tools to any step

## ADK Docs MCP

If an example MCP config was generated at \`.pi/mcp/adk-docs.example.json\`,
you can use it to connect Pi to the ADK documentation via MCP.

See: https://google.github.io/adk-docs/
`;
}

export function adkScaffoldMarker(v: TemplateVars): string {
  return JSON.stringify(
    { name: v.name, template: "sequential", model: v.model, version: "0.1.0" },
    null,
    2
  ) + "\n";
}
