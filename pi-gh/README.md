# pi-gh

A Pi extension that exposes structured GitHub CLI tools to the Pi Coding Agent. All operations target the current repository only.

## Requirements

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and in PATH
- `gh auth login` completed successfully
- Current working directory must be inside a GitHub-linked git repository
- Pi Coding Agent (`@mariozechner/pi-coding-agent`)

## Tools

### `gh_repo`

| Operation | Description |
|-----------|-------------|
| `info` | Repository metadata (name, description, visibility, stars, forks, URL) |

### `gh_issue`

| Operation | Description | Confirmation |
|-----------|-------------|:---:|
| `list` | List issues with optional state/limit filter | No |
| `get` | Get issue details by number | No |
| `create` | Create a new issue | No |
| `edit` | Edit issue title, body, labels, assignees | No |
| `comment` | Add a comment to an issue | No |
| `close` | Close an issue | Yes |
| `reopen` | Reopen an issue | Yes |

### `gh_pr`

| Operation | Description | Confirmation |
|-----------|-------------|:---:|
| `list` | List PRs with optional state/limit filter | No |
| `get` | Get PR details by number | No |
| `create` | Create a new PR | No |
| `comment` | Add a comment to a PR | No |
| `request_reviewers` | Request reviewers on a PR | Yes |
| `close` | Close a PR | Yes |
| `reopen` | Reopen a PR | Yes |
| `merge` | Merge a PR (merge/squash/rebase) | Yes |

### `gh_actions`

| Operation | Description | Confirmation |
|-----------|-------------|:---:|
| `list_workflows` | List repository workflows | No |
| `list_runs` | List workflow runs | No |
| `get_run` | Get details of a workflow run | No |
| `rerun` | Re-run a workflow run | No |
| `cancel` | Cancel a running workflow | Yes |
| `dispatch` | Dispatch a workflow | Yes |

## Scope

This extension operates on the **current repository only**. It does not support arbitrary `owner/repo` targeting. All `gh` commands are run with safe argument arrays (no shell string interpolation).

## Output Contract

All tool results return normalized JSON:

```json
{ "ok": true, "repo": "owner/repo", "operation": "issue.list", "data": [...] }
```

```json
{ "ok": false, "error": { "code": "GH_NOT_INSTALLED", "message": "...", "suggested_fix": "..." } }
```

Large outputs are truncated to prevent context blowup.

## Setup Errors

The extension detects setup problems before any operation:

| Code | Meaning | Fix |
|------|---------|-----|
| `GH_NOT_INSTALLED` | `gh` not found | Install gh: https://cli.github.com/ |
| `GH_NOT_AUTHENTICATED` | `gh auth status` failed | Run `gh auth login` |
| `GH_REPO_UNAVAILABLE` | Not inside a GitHub repo | Navigate to a repo with a GitHub remote |

## Installation

### Quick test

```bash
cd /path/to/your/repo
pi -e /path/to/pi-gh/index.ts
```

### Auto-discovery (project-local)

```bash
cp -r pi-gh/ /path/to/your/project/.pi/extensions/pi-gh/
```

### Auto-discovery (global)

```bash
cp -r pi-gh/ ~/.pi/agent/extensions/pi-gh/
```

### As a Pi package

```bash
cd pi-gh && npm install
pi install /path/to/pi-gh
```

After installing or modifying, reload with `/reload` inside Pi.

## Manual Validation

```bash
cd /path/to/github-repo
pi -e /path/to/pi-gh/index.ts
```

Then try these prompts:

```
Show me info about this repository.
List the open issues.
Get details for issue #1.
Create an issue titled "Test issue" with body "Created by pi-gh".
Add a comment to issue #1 saying "Automated comment".
Close issue #1.
List open PRs.
Get details for PR #2.
Create a PR from branch feature to main titled "My PR".
Request reviewers alice and bob on PR #2.
Merge PR #2 with squash.
List GitHub Actions workflows.
List recent workflow runs.
Get details for run 12345.
Cancel run 12345.
Dispatch workflow ci.yml on main.
```

## Security Notes

- This extension executes `gh` CLI commands with full user privileges.
- All arguments are passed as arrays, not interpolated into shell strings.
- No arbitrary shell passthrough or raw `gh` command execution.
- High-impact mutations (close, reopen, merge, cancel, dispatch, request reviewers) require user confirmation.
- The extension does not write files, modify credentials, or access secrets.
- Operations are restricted to the current repository.

## Running Tests

```bash
cd pi-gh
npm install
npm test
```
