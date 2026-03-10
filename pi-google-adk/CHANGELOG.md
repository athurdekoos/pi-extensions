# Changelog

## 0.1.0

Initial release.

### Tools

- `create_adk_agent` — scaffold Python ADK projects from three templates: `basic`, `mcp`, `sequential`
- `add_adk_capability` — add six capability types to existing projects: `custom_tool`, `mcp_toolset`, `sequential_workflow`, `eval_stub`, `deploy_stub`, `observability_notes`

### Features

- Template-driven, deterministic scaffolding with no AI-generated code at runtime
- Path traversal prevention and overwrite protection
- Scaffold manifest (`.adk-scaffold.json`) tracks template, model, and applied capabilities
- Idempotent capability application with duplicate detection
- Optional ADK docs MCP example config (project-local, not globally installed)
- Python syntax validated across all generated code
- 114 automated verification checks

### Known Limitations

- `install_adk_skills` is a no-op (future hook)
- `tools=[...]` patching is regex-based, targeting generated code patterns
- Scaffold manifest is informational, not load-bearing
- No custom Pi renderers; tool output is plain JSON
