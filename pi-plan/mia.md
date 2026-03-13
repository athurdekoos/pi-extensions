# Combined pi-plan + plan-mode Integration Plan

## 1. Resolve the `/plan` command conflict

Both extensions register `/plan`. In the combined extension, split them:
- **`/plan`** — remains the pi-plan document workflow (create/resume/replace/revisit plans on disk)
- **`/plan-mode`** — the plan-mode read-only toggle (was `/plan` in the example)
- **`/todos`** — stays as-is (show execution progress)
- **`/plan-debug`** — stays as-is (diagnostic snapshot)
- **`Ctrl+Alt+P`** — stays as-is (toggles plan-mode)
- **`--plan` flag** — stays as-is (start in plan-mode)

## 2. Define the complementary flow between the two features

The two features should chain naturally:

```
/plan-mode ON → agent explores code read-only → produces a plan
       ↓
  pi-plan captures the plan → writes current.md to disk (template-aware)
       ↓
  user chooses "Execute" → plan-mode OFF, execution mode ON
       ↓
  agent works through steps, [DONE:n] tracking, progress widget
       ↓
  all steps complete → plan archived, execution mode OFF
```

Specifically:
- When plan-mode is active and the agent produces a `Plan:` section, **also** offer to persist it as a pi-plan `current.md` (using the template and goal extraction)
- When `/plan` creates a new plan (from the document workflow), **also** extract numbered steps for execution tracking
- When execution completes all steps, **also** archive the current plan automatically (with confirmation)

## 3. Create a unified state model

Add a new module `mode.ts` that owns the combined state:

```typescript
interface PlanWorkflowState {
  // plan-mode state
  planModeEnabled: boolean;     // read-only exploration active?
  executionMode: boolean;       // executing with tracking?
  todoItems: TodoItem[];        // extracted steps
  
  // pi-plan state (already in repo.ts via detectPlanState)
  // Not duplicated — queried on demand from repo.ts
}
```

This module owns state transitions and the invariants between the two features (e.g., "you can't be in plan-mode AND execution-mode simultaneously").

## 4. Wire the Pi lifecycle hooks into `index.ts`

Currently `index.ts` is a thin bridge that only registers commands. It needs to grow (carefully) to register:
- The `--plan` flag
- The `Ctrl+Alt+P` shortcut
- Event handlers: `tool_call`, `context`, `before_agent_start`, `turn_end`, `agent_end`, `session_start`
- Status line and widget updates

Keep `index.ts` as a bridge — it maps Pi events to the mode/orchestration layer. No business logic in `index.ts`.

## 5. Move plan-mode utilities into the project

Copy `utils.ts` from the example into `mode-utils.ts` in pi-plan:
- `isSafeCommand()` — bash allowlist/blocklist
- `TodoItem` type
- `extractTodoItems()` — parse `Plan:` sections from chat
- `extractDoneSteps()` / `markCompletedSteps()` — `[DONE:n]` tracking
- `cleanStepText()` — step text normalization

These are pure functions, easily testable, no dependencies on Pi APIs.

## 6. Create `mode.ts` — the plan-mode orchestration module

This module owns:
- `togglePlanMode()` — enable/disable read-only mode
- `startExecution()` — transition from plan-mode to execution
- `trackProgress()` — update todo completion from `[DONE:n]` markers
- `handleAgentEnd()` — the post-agent flow (extract todos from chat, offer execute/stay/refine, optionally persist to `current.md`)
- `persistModeState()` / `restoreModeState()` — session persistence via `appendEntry`
- `getStatusDisplay()` / `getWidgetDisplay()` — pure functions returning what to show

Depends on `mode-utils.ts` (pure logic) and `orchestration.ts` (for plan persistence).

## 7. Integrate the bridge in `agent_end`

The critical integration point. After the agent finishes a turn in plan-mode:

1. Extract todo items from the assistant's `Plan:` output (existing plan-mode logic)
2. **New**: Also extract the goal text from the plan
3. Offer the user a menu:
   - **"Execute the plan"** — restore tools, enter execution mode, track progress
   - **"Save plan to disk & execute"** — generate `current.md` from the goal using pi-plan templates, then execute with tracking
   - **"Save plan to disk only"** — persist without executing (stay in plan-mode or exit)
   - **"Refine the plan"** — open editor, stay in plan-mode
   - **"Stay in plan mode"** — keep exploring
4. If saving to disk: check for existing `current.md`, offer to archive it first (existing pi-plan logic)

## 8. Integrate execution completion with archiving

When execution mode completes (all `[DONE:n]` markers hit):
1. Show completion message (existing plan-mode behavior)
2. **New**: If there's a `current.md` on disk for this plan, offer to archive it
3. Reset both plan-mode state and disk state cleanly

## 9. Make `/plan` aware of plan-mode state

When the user runs `/plan` (the document workflow):
- If plan-mode is currently ON and a `current.md` already exists: offer "Resume in plan-mode" as an option (read-only exploration of the existing plan)
- When `/plan` creates a new plan from the document workflow, extract its numbered Implementation Plan steps as todo items for potential execution tracking
- If the user says "Resume current plan" from `/plan`, optionally offer to enter execution mode with tracking

## 10. Update config with new options

Add to `PiPlanConfig`:
```typescript
{
  // Existing fields...
  
  /** Auto-persist chat plans to current.md when executing (default: true) */
  persistOnExecute: boolean;
  /** Auto-archive completed plans (default: false, asks for confirmation) */  
  autoArchiveOnComplete: boolean;
  /** Plan-mode shortcut key (default: "ctrl+alt+p") */
  planModeShortcut: string;
}
```

## 11. Update context injection

Merge the plan-mode system message injection (`before_agent_start`) with pi-plan's planning protocol awareness:
- In plan-mode: inject the read-only restrictions **and** reference the planning protocol/template if the repo is initialized
- In execution-mode: inject the remaining steps **and** reference `current.md` if it exists on disk
- In normal mode with an active `current.md`: inject a reminder to follow the plan (lightweight, not the full plan-mode restrictions)

## 12. Write tests

New test files:
- `tests/mode-utils.test.ts` — `isSafeCommand`, `extractTodoItems`, `extractDoneSteps`, `markCompletedSteps` (ported from plan-mode, adapted)
- `tests/mode.test.ts` — state transitions, toggle behavior, execution tracking, persistence serialization
- `tests/integration.test.ts` — the bridge flows: plan-mode → disk persistence, execution completion → archiving

Update existing:
- `tests/orchestration.test.ts` — new menu options when plan-mode is active

## 13. Update documentation

- `README.md` — document the full combined workflow, new commands, new config options
- `AGENTS.md` — add `mode.ts` and `mode-utils.ts` to the module ownership table, document the combined state model
- `docs/architecture.md` — add the combined flow diagram
- `docs/file-contracts.md` — no changes (disk format unchanged)
- `CHANGELOG.md` — document the merge

## 14. Handle edge cases

- **Session resume**: restore both plan-mode state (from `appendEntry`) and disk state (from `detectPlanState`) — they might be out of sync (e.g., user manually deleted `current.md`)
- **`/plan` during execution mode**: warn that execution is in progress, offer to abandon execution and enter the document workflow
- **`/plan-mode` during `/plan` create flow**: not possible (commands are sequential), but if plan-mode is on while `/plan` runs, the `/plan` command itself should still work (it uses `ui.*` not agent tools)
- **Multiple plans**: plan-mode extracts steps from chat; pi-plan has one `current.md`. If the chat plan and `current.md` diverge, the "Save to disk" option overwrites (with archive confirmation)
