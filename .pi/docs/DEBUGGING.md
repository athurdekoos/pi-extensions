# Debugging

> **Historical document.** This describes the debug system of the **legacy planning-protocol extension** (`.pi/legacy/planning-protocol.ts`). The canonical planning extension [`pi-plan/`](../../pi-plan/) uses `/plan-debug` for diagnostics — see the [pi-plan README](../../pi-plan/README.md) for current behavior.

This document describes the debug system as implemented in the legacy planning protocol extension (Phase 3+).

## Purpose

Debug mode enables JSONL logging of all planning protocol events to disk. It is designed for diagnosing enforcement issues, state transitions, and command behavior — not for production use. Debug mode is opt-in and persists across restarts.

## Commands

### `/plan-debug-on`

Enables debug mode. Sets `debugMode: true` in `planning-state.json`. Logs begin immediately for all subsequent events.

### `/plan-debug-off`

Disables debug mode. Sets `debugMode: false` in `planning-state.json`. No further log entries are written.

### `/plan-debug`

Shows a diagnostic summary without mutating state. Output includes:

- Whether debug mode is on and whether logging is active
- Debug directory path, current log path, session log path, session ID
- Log format description
- Up to 5 recent session log filenames
- Complete list of logged event categories

## Log File Locations

All debug files live under `.pi/plans/debug/`. This directory is gitignored (contents only — `.gitkeep` is committed).

### `current.log`

Overwritten at each session start (when Pi starts or switches sessions). Contains only the current/last session's events. Useful for quick inspection of recent activity.

### `<timestamp>-session.log`

Append-only session-specific log file. Filename format: `YYYY-MM-DDTHH-MM-SS-session.log` (ISO-derived, sortable). One file per session. Persists across sessions for historical comparison.

Session logs are never automatically cleaned up. See [Limitations](#limitations).

## Log Format

JSONL — one JSON object per line. Each entry has this shape:

```json
{
  "ts": "2026-03-12T08:13:00.000Z",
  "event": "tool_call",
  "status": "plan-required",
  "planMode": true,
  "debugMode": true,
  "planPath": ".pi/plans/current.md",
  "details": {
    "toolName": "bash",
    "allowed": false,
    "reason": "Planning mode is active..."
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp of the event |
| `event` | string | Event name (see below) |
| `status` | string | System status at time of event (`off`, `plan-required`, `plan-ready`) |
| `planMode` | boolean | Whether planning mode was on |
| `debugMode` | boolean | Whether debug mode was on (always `true` in logs) |
| `planPath` | string | Current plan path (always `.pi/plans/current.md`) |
| `details` | object | Event-specific data |

## Logged Events

### Session lifecycle

| Event | When | Key details fields |
|-------|------|--------------------|
| `session_start` | Pi starts | `loadError`, `sessionId` |
| `session_switch` | Pi switches sessions | `sessionId` |
| `session_shutdown` | Pi exits | (none) |

### Agent lifecycle

| Event | When | Key details fields |
|-------|------|--------------------|
| `before_agent_start` | Before each agent turn | (none) |
| `context_prune` | Stale planning messages removed | `action` (`remove_all` or `keep_newest`), `removedCount` |

### Commands

All commands log as `command:<name>`. Details vary by command:

| Event | Key details fields |
|-------|--------------------|
| `command:plan-on` | `resultStatus` |
| `command:plan-off` | (none) |
| `command:plan` | (none) |
| `command:plan-status` | (none) |
| `command:plan-debug-on` | (none) |
| `command:plan-debug-off` | (none) |
| `command:plan-debug` | (none) |
| `command:plan-new` | `argsSlug`, or `outcome` if cancelled |
| `command:plan-complete` | (none) |
| `command:plan-archive` | (none) |
| `command:plan-list` | (none) |
| `command:plan-show` | `query` |
| `command:plan-restore` | `query` |
| `command:plan-resume` | `query` |

### Enforcement

| Event | When | Key details fields |
|-------|------|--------------------|
| `tool_call` | Every tool call during planning mode | `toolName`, `allowed`, `reason` |

### Plan validation

| Event | When | Key details fields |
|-------|------|--------------------|
| `plan_validated` | After `/plan` or `/plan-new` saves | `valid`, `planStatus`, `slug`, `reason`, `hasRequiredSections` |
| `reconcile` | System status changes | `previousStatus`, `newStatus`, `planValid`, `planStatus`, `reason` |

### Lifecycle operations

| Event | When | Key details fields |
|-------|------|--------------------|
| `archive_created` | Archive snapshot written | `trigger`, `filename`, `slug`, `previousStatus` |
| `index_updated` | `plans/index.md` rebuilt | `trigger` |
| `current_plan_reset` | `current.md` reset to template | `action` |
| `lifecycle_validation_failure` | Lifecycle command cannot proceed | `command`, `reason`, sometimes `detail` or `error` |

### Archive resolution and restore

| Event | When | Key details fields |
|-------|------|--------------------|
| `archive_resolution` | Archive target lookup | `query`, `resolved`, `reason`, `candidateCount` |
| `restore_confirmation` | User chose restore branch | `branch`, `currentSlug`, `currentStatus` |
| `restore_cancelled` | User cancelled restore | `reason`, `currentSlug` |
| `restored_metadata` | Metadata transformed for restore | `archiveFilename`, `originalStatus`, `restoredStatus`, `slug`, `archivedCurrentFirst` |
| `plan_shown` | Archive inspected via `/plan-show` | `filename`, `slug`, `status` |

## Diagnosing Common Issues

### Blocked tool calls

Look for `tool_call` events where `allowed` is `false`:

```bash
grep '"event":"tool_call"' .pi/plans/debug/current.log | grep '"allowed":false'
```

The `reason` field explains why the tool was blocked and which tools are available. If you see unexpected blocks, check:

1. Is `planMode` true? (It should be if enforcement is active.)
2. Is the tool name in the whitelist? (`read`, `grep`, `ls`, `find`)
3. Did you forget to run `/plan-off` before trying to implement?

### Plan validation failures

Look for `plan_validated` events where `valid` is `false`:

```bash
grep '"event":"plan_validated"' .pi/plans/debug/current.log | grep '"valid":false'
```

The `reason` field identifies the specific validation failure (missing sentinel, missing key, invalid status value, etc.).

### Archive resolution failures

Look for `archive_resolution` events where `resolved` is `false`:

```bash
grep '"event":"archive_resolution"' .pi/plans/debug/current.log
```

If `candidateCount` is greater than 1, the query matched multiple archives with the same slug — use the full filename instead. If `candidateCount` is 0, the query didn't match any archive.

### Restore/replace cancellation flows

Look for `restore_confirmation` and `restore_cancelled` events:

```bash
grep '"event":"restore_' .pi/plans/debug/current.log
```

The `branch` field in `restore_confirmation` shows which path the user chose: `archive_then_replace`, `replace_directly`, or cancellation.

### Runtime state reconciliation

Look for `reconcile` events to trace status transitions:

```bash
grep '"event":"reconcile"' .pi/plans/debug/current.log
```

Each entry shows `previousStatus` and `newStatus`. If the status is unexpectedly stuck at `plan-required`, check the accompanying `planValid` and `planStatus` fields.

### Lifecycle validation failures

Look for `lifecycle_validation_failure` events:

```bash
grep '"event":"lifecycle_validation_failure"' .pi/plans/debug/current.log
```

These indicate why a lifecycle command (`/plan-complete`, `/plan-archive`, `/plan-new`, `/plan-restore`, `/plan-resume`) could not proceed.

## What Debug Mode Does Not Do

- **No automatic log rotation or pruning.** Session logs accumulate indefinitely. Clean up manually if disk space is a concern.
- **No structured query or search.** Logs are flat JSONL files. Use `grep`, `jq`, or similar tools.
- **No performance profiling.** Timestamps are present but there is no duration tracking or bottleneck analysis.
- **No tool execution content logging.** Tool arguments and file contents are not captured — only tool names and allow/block decisions.
- **No automatic error recovery.** Debug mode is purely observational — it logs but does not repair state.

## Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| No log rotation | Session logs grow without bound | Manually delete old `*-session.log` files |
| No log pruning | `current.log` can grow large in debug-heavy sessions | Overwritten on next session start |
| Full archive scan on every `/plan-list`, `/plan-show`, `/plan-restore`, `/plan-resume` | Slow with many archives | Keep archive count reasonable; future phases may add caching |
| Best-effort writes | If `appendFileSync` fails, the entry is silently dropped | Check filesystem permissions on `.pi/plans/debug/` |
| JSONL not human-friendly | Raw log lines are dense | Use `jq` for pretty-printing: `cat current.log | jq .` |

## Quick Reference

```bash
# Enable debug mode
/plan-debug-on

# Check debug status and paths
/plan-debug

# View current session log (pretty-printed)
cat .pi/plans/debug/current.log | jq .

# Find all blocked tool calls
grep '"allowed":false' .pi/plans/debug/current.log | jq .

# Find all status transitions
grep '"event":"reconcile"' .pi/plans/debug/current.log | jq .

# List all session log files
ls -la .pi/plans/debug/*-session.log

# Clean up old session logs
rm .pi/plans/debug/*-session.log

# Disable debug mode
/plan-debug-off
```
