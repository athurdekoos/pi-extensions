# Wizard Tool Planning — Full Visibility & Multi-Select

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make the `create_adk_agent` wizard show all available tools (built-ins, own tools, extension tools) and allow selecting none, one, many, or all via a multi-select UX.

**Done When:**
- `detectExtensionTools()` → renamed `detectAllTools()` returns every tool from `getAllTools()` without filtering
- Wizard tool step uses `ui.custom()` + `SettingsList` for multi-select toggle UX
- Three-step wizard (ADK-native → Pi profile → Extension tools) collapsed into single "select your tools" step
- `ToolPlan` model gains `all_session_tools_selected: string[]` field alongside existing fields (backward-compatible)
- Summary formatter updated to show the new unified selection
- Full test coverage for tool detection, wizard tool planning, tool plan, and summary changes
- All 357+ existing tests still pass
- Shared schema (`shared/adk-metadata-schema/`) updated to accept new field

**Architecture:**
Remove the filter sets in `tool-detect.ts` and return all tools with metadata (name + description). Replace the three-step tool wizard with a single `ui.custom()` `SettingsList` screen where every tool is toggleable. Keep backward compatibility by preserving existing `ToolPlan` fields and adding new ones additively. The shared schema already preserves unknown fields, but we'll explicitly add `all_session_tools_selected` to the canonical `ToolPlanSchema`.

**Tech Stack:** TypeScript, Vitest, Pi TUI (`SettingsList`, `Container`, `ui.custom()`), `@mariozechner/pi-coding-agent`

**Prerequisites:**
- Branch from `main`
- Working `npm test` baseline (357 tests pass)
- `npm run typecheck` passes

**Estimated Tasks:** 12 tasks, ~4 hours
**Complexity:** Medium

**Out of Scope:**
- Changing how `pi-subagents` reads the tool plan (it already handles unknown additive fields)
- Adding tool grouping/categorization UI (future enhancement)
- Changing the non-interactive (explicit params) code path in `buildToolPlanFromParams` beyond accepting the new field
- Changing `ToolPlan` persistence format (`.pi-adk-metadata.json`) in a breaking way

**Quality Gates:** Engineering Design → Implementation (TDD) → Integration Test → Code Review → Security Audit

---

## Phase 1: Engineering Design

### Architecture Decision

The change touches four layers:

1. **Detection layer** (`tool-detect.ts`) — Remove `PI_MONO_BUILTIN_TOOLS` and `OWN_TOOLS` filter sets. Return all tools from `getAllTools()` with name + description. Rename `detectExtensionTools` → `detectAllTools` (keep old name as deprecated re-export for any external callers). Change the return type to include descriptions.

2. **Wizard UX layer** (`wizard.ts`) — Replace the three-step tool planning sub-wizard (`collectAdkNativeTools` → `collectPiMonoProfile` → `collectExtensionTools`) with a single step that shows all tools via `ui.custom()` + `SettingsList`. Each tool is a toggle item (enabled/disabled). The user can toggle any combination and press Escape/Enter to confirm.

3. **Model layer** (`tool-plan.ts`) — Add `all_session_tools_selected: string[]` to `ToolPlan`. This is the authoritative list of what the user picked. Keep existing fields (`adk_native_tools`, `pi_mono_profile`, `pi_mono_builtin_tools`, `installed_extension_tools_detected`, `installed_extension_tools_selected`) populated for backward compatibility — derive them from the unified selection. The `buildToolPlan` function gets a new input field.

4. **Summary layer** (`tool-summary.ts`) — Update `buildToolAccessSummary` to show the unified selection. Group tools by source (built-in, own ADK, other extension) for readability, but the selection is flat.

### Data Model Changes

**`DetectedTool` (new interface in `tool-detect.ts`):**
```typescript
interface DetectedTool {
  name: string;
  description: string;
}
```

**`DetectAllToolsResult` (renamed from `DetectedExtensionTools`):**
```typescript
interface DetectAllToolsResult {
  tools: DetectedTool[];       // ALL tools, no filtering
  detected: boolean;
  error?: string;
}
```

**`ToolPlan` additions (backward-compatible):**
```typescript
// New field — the flat list the user actually selected
all_session_tools_selected?: string[];
```

**`ToolPlanSchema` addition (shared schema):**
```typescript
all_session_tools_selected?: string[];
```

### Trade-off Analysis

- **Why collapse three wizard steps into one?** The three-step flow (ADK-native, Pi profile, extension tools) was designed around the filtering model — each step handled a different tool category. With full visibility, categories become presentation-level grouping, not selection boundaries. One screen is simpler, faster, and matches the issue's UX goal.
- **Why keep old `ToolPlan` fields?** `pi-subagents` reads `required_safe_custom_tools`, `pi_mono_profile`, and `installed_extension_tools_selected`. Removing them would break cross-extension integration. We populate them from the unified selection for backward compat.
- **Why `SettingsList` over iterative `ui.select()`?** `SettingsList` gives toggle UX, supports many items, has search, and is the pattern Pi's own `/tools` command uses. Iterative select is clunkier for 10+ tools.

### Error Handling

- `getAllTools()` can throw before runtime init → graceful degradation (already handled, preserved).
- `ui.custom()` returns `undefined` if user cancels → treat as skip.
- Zero tools available → show info message and skip (already handled, preserved).

### Edge Cases

1. Zero tools available (runtime not bound yet)
2. Only built-in tools available (no extensions loaded)
3. 20+ tools (UI overflow — `SettingsList` handles scrolling)
4. User selects nothing → valid, empty selection
5. User selects all → valid
6. Tool names with special characters (unlikely but handle gracefully)
7. Backward compat: old metadata without `all_session_tools_selected` → normalization fills `undefined`

### Observability

No new logging needed — tool plan is persisted in `.pi-adk-metadata.json` and displayed via `buildToolAccessSummary`. The summary already shows selected vs detected counts.

---

## Phase 2: Implementation Tasks

### Task 1: Create feature branch and verify baseline

**Files:** None

**Step 1: Create branch**

```bash
cd /home/mia/dev/pi-extensions
git checkout -b issue-25-wizard-tool-full-visibility
```

**Step 2: Verify baseline tests pass**

```bash
cd pi-google-adk
npm test
```

Expected: 357 tests, all PASS

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: No errors

**Step 4: Commit**

No commit needed — just baseline verification.

---

### Task 2: Update `tool-detect.ts` — remove filters, return all tools with descriptions

**Depends on:** Task 1

**Files:**
- Modify: `pi-google-adk/src/lib/tool-detect.ts`
- Test: `pi-google-adk/tests/unit/tool-detect.test.ts`

**Step 1: Write the failing tests**

Add these tests to `tests/unit/tool-detect.test.ts`. They test that `detectAllTools` returns ALL tools (no filtering) with descriptions.

```typescript
// Add import for detectAllTools at top
import {
  detectExtensionTools,
  detectAllTools,
  captureExtensionApi,
  type DetectedTool,
  type DetectAllToolsResult,
} from "../../src/lib/tool-detect.js";

// Add new describe block after existing tests

describe("detectAllTools", () => {
  it("returns ALL tools including built-ins and own tools", () => {
    const api = buildMockApi([
      { name: "read", description: "Read files" },
      { name: "bash", description: "Execute bash" },
      { name: "create_adk_agent", description: "Create ADK agent" },
      { name: "gh_issue", description: "Manage issues" },
      { name: "my_custom_tool", description: "Custom tool" },
    ]);

    const result = detectAllTools(api);
    expect(result.detected).toBe(true);
    expect(result.tools).toHaveLength(5);
    expect(result.tools.map(t => t.name)).toEqual([
      "bash",
      "create_adk_agent",
      "gh_issue",
      "my_custom_tool",
      "read",
    ]);
  });

  it("includes descriptions for each tool", () => {
    const api = buildMockApi([
      { name: "read", description: "Read files" },
      { name: "gh_issue", description: "Manage GitHub issues" },
    ]);

    const result = detectAllTools(api);
    expect(result.tools[0]).toEqual({ name: "gh_issue", description: "Manage GitHub issues" });
    expect(result.tools[1]).toEqual({ name: "read", description: "Read files" });
  });

  it("returns detected: false when API is null", () => {
    const result = detectAllTools(null as unknown as ExtensionAPI);
    expect(result.detected).toBe(false);
    expect(result.tools).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("handles getAllTools() throwing", () => {
    const api = buildThrowingApi();
    const result = detectAllTools(api);
    expect(result.detected).toBe(false);
    expect(result.error).toContain("getAllTools() failed");
    expect(result.tools).toEqual([]);
  });

  it("returns sorted by name", () => {
    const api = buildMockApi([
      { name: "zebra", description: "Z" },
      { name: "alpha", description: "A" },
    ]);

    const result = detectAllTools(api);
    expect(result.tools.map(t => t.name)).toEqual(["alpha", "zebra"]);
  });

  it("returns empty array when no tools exist", () => {
    const api = buildMockApi([]);
    const result = detectAllTools(api);
    expect(result.detected).toBe(true);
    expect(result.tools).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/tool-detect.test.ts
```

Expected: FAIL — `detectAllTools` is not exported.

**Step 3: Write the implementation**

In `pi-google-adk/src/lib/tool-detect.ts`, add the new types and function. Keep `detectExtensionTools` as-is for backward compatibility (it will be removed in a later task after all callers are updated).

```typescript
// Add after DetectedExtensionTools interface:

// ---------------------------------------------------------------------------
// New: unfiltered detection result
// ---------------------------------------------------------------------------

export interface DetectedTool {
  name: string;
  description: string;
}

export interface DetectAllToolsResult {
  /** All tools in the session, sorted by name. No filtering. */
  tools: DetectedTool[];
  /** Whether detection was successful. */
  detected: boolean;
  /** Reason detection failed, if applicable. */
  error?: string;
}

// ---------------------------------------------------------------------------
// New: unfiltered detection
// ---------------------------------------------------------------------------

/**
 * Detect ALL tools in the current Pi session — built-ins, own tools,
 * and extension tools. No filtering.
 *
 * Returns tool name + description for each tool, sorted by name.
 */
export function detectAllTools(
  apiOverride?: ExtensionAPI
): DetectAllToolsResult {
  const api = apiOverride ?? _capturedApi;

  if (!api) {
    return {
      tools: [],
      detected: false,
      error: "ExtensionAPI not captured. Tool detection unavailable.",
    };
  }

  try {
    const allTools = api.getAllTools();
    const tools: DetectedTool[] = allTools
      .map((t) => ({ name: t.name, description: t.description ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      tools,
      detected: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      tools: [],
      detected: false,
      error: `getAllTools() failed: ${msg}`,
    };
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/tool-detect.test.ts
```

Expected: ALL PASS (both old `detectExtensionTools` tests and new `detectAllTools` tests)

**Step 5: Commit**

```bash
git add pi-google-adk/src/lib/tool-detect.ts pi-google-adk/tests/unit/tool-detect.test.ts
git commit -m "feat(tool-detect): add detectAllTools — unfiltered tool detection with descriptions"
```

---

### Task 3: Add `all_session_tools_selected` to `ToolPlan` model and `buildToolPlan`

**Depends on:** Task 1
**Parallelizable with:** Task 2

**Files:**
- Modify: `pi-google-adk/src/lib/tool-plan.ts`
- Test: `pi-google-adk/tests/unit/tool-plan.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/tool-plan.test.ts`:

```typescript
describe("all_session_tools_selected", () => {
  it("buildToolPlan stores all_session_tools_selected", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "bash", "gh_issue", "create_adk_agent"],
    });
    expect(plan.all_session_tools_selected).toEqual([
      "read", "bash", "gh_issue", "create_adk_agent",
    ]);
  });

  it("buildToolPlan defaults all_session_tools_selected to undefined when not provided", () => {
    const plan = buildToolPlan({});
    expect(plan.all_session_tools_selected).toBeUndefined();
  });

  it("buildToolPlan derives installed_extension_tools_selected from allSessionToolsSelected", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "bash", "gh_issue", "run_adk_agent"],
      extensionToolsDetected: ["gh_issue", "gh_pr", "delegate_to_subagent"],
    });
    // installed_extension_tools_selected = intersection of allSessionToolsSelected and extensionToolsDetected
    expect(plan.installed_extension_tools_selected).toEqual(["gh_issue"]);
  });

  it("buildToolPlan derives pi_mono_profile from selected built-ins", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "bash", "edit", "write", "gh_issue"],
    });
    // All coding tools selected → coding profile
    expect(plan.pi_mono_profile).toBe("coding");
    expect(plan.pi_mono_builtin_tools).toEqual(["read", "bash", "edit", "write"]);
  });

  it("buildToolPlan derives read_only profile when only read-only tools selected", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "grep", "find", "ls", "gh_issue"],
    });
    expect(plan.pi_mono_profile).toBe("read_only");
  });

  it("buildToolPlan uses unknown profile when mixed built-in subset", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "bash"],
    });
    expect(plan.pi_mono_profile).toBe("unknown");
  });

  it("emptyToolPlan has no all_session_tools_selected", () => {
    const plan = emptyToolPlan();
    expect(plan.all_session_tools_selected).toBeUndefined();
  });

  it("all_session_tools_selected is added to required_safe_custom_tools (non-built-in)", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "gh_issue", "create_adk_agent"],
    });
    expect(plan.required_safe_custom_tools).toContain("gh_issue");
    expect(plan.required_safe_custom_tools).toContain("create_adk_agent");
    expect(plan.required_safe_custom_tools).toContain("run_adk_agent");
    expect(plan.required_safe_custom_tools).toContain("resolve_adk_agent");
    // built-ins are NOT in required_safe_custom_tools
    expect(plan.required_safe_custom_tools).not.toContain("read");
  });

  it("buildToolPlanFromParams accepts all_session_tools_selected", () => {
    const plan = buildToolPlanFromParams({
      all_session_tools_selected: ["read", "gh_issue"],
    });
    expect(plan.all_session_tools_selected).toEqual(["read", "gh_issue"]);
  });

  it("is serializable as JSON", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "bash", "gh_issue"],
    });
    const json = JSON.stringify(plan);
    const parsed = JSON.parse(json) as ToolPlan;
    expect(parsed.all_session_tools_selected).toEqual(["read", "bash", "gh_issue"]);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/tool-plan.test.ts
```

Expected: FAIL — `allSessionToolsSelected` not in `ToolPlanInput`, `all_session_tools_selected` not on `ToolPlan`.

**Step 3: Write the implementation**

In `pi-google-adk/src/lib/tool-plan.ts`:

Add to `ToolPlan` interface:
```typescript
  /** Unified tool selection from the wizard. All tools the user selected, regardless of source. */
  all_session_tools_selected?: string[];
```

Add to `ToolPlanInput` interface:
```typescript
  allSessionToolsSelected?: string[];
```

Update `buildToolPlan` function. After the existing body, add derivation logic:

```typescript
export function buildToolPlan(input: ToolPlanInput): ToolPlan {
  // Determine profile: if allSessionToolsSelected is provided, derive from it
  let profile = input.piMonoProfile ?? "unknown";
  let builtinTools = profileTools(profile);

  if (input.allSessionToolsSelected !== undefined && input.piMonoProfile === undefined) {
    // Derive profile from selected built-in tools
    profile = deriveProfile(input.allSessionToolsSelected);
    builtinTools = profileTools(profile);
  }

  const requiredSafe = [...(input.requiredSafeCustomTools ?? [])];

  // Always recommend run_adk_agent and resolve_adk_agent
  if (!requiredSafe.includes("run_adk_agent")) {
    requiredSafe.push("run_adk_agent");
  }
  if (!requiredSafe.includes("resolve_adk_agent")) {
    requiredSafe.push("resolve_adk_agent");
  }

  // Derive installed_extension_tools_selected from allSessionToolsSelected if provided
  let extensionToolsSelected = input.extensionToolsSelected ?? [];
  if (input.allSessionToolsSelected !== undefined && !input.extensionToolsSelected) {
    const detected = new Set(input.extensionToolsDetected ?? []);
    extensionToolsSelected = input.allSessionToolsSelected.filter(t => detected.has(t));
  }

  // Add selected extension tools to required safe list
  for (const tool of extensionToolsSelected) {
    if (!requiredSafe.includes(tool)) {
      requiredSafe.push(tool);
    }
  }

  // Add non-built-in tools from allSessionToolsSelected to required safe
  if (input.allSessionToolsSelected) {
    const builtinSet = new Set(ALL_BUILTIN_TOOL_NAMES);
    for (const tool of input.allSessionToolsSelected) {
      if (!builtinSet.has(tool) && !requiredSafe.includes(tool)) {
        requiredSafe.push(tool);
      }
    }
  }

  const caveats = [...(input.caveats ?? [])];
  caveats.push(
    "This tool plan is advisory. Actual child-session access depends on mode, allowlisting, and loaded extensions."
  );

  return {
    adk_native_tools: input.adkNativeTools ?? [],
    adk_native_notes: input.adkNativeNotes,
    pi_mono_profile: profile,
    pi_mono_builtin_tools: builtinTools,
    installed_extension_tools_detected: input.extensionToolsDetected ?? [],
    installed_extension_tools_selected: extensionToolsSelected,
    required_safe_custom_tools: requiredSafe,
    ...(input.allSessionToolsSelected !== undefined
      ? { all_session_tools_selected: input.allSessionToolsSelected }
      : {}),
    notes: input.notes ?? [],
    caveats,
  };
}
```

Add helper constant and function:

```typescript
/** All Pi built-in tool names (union of all profiles). */
const ALL_BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** Derive a Pi Mono profile from selected tool names. */
function deriveProfile(selected: string[]): PiMonoProfile {
  const selectedSet = new Set(selected);
  const codingTools = PI_MONO_PROFILE_TOOLS.coding;
  const readOnlyTools = PI_MONO_PROFILE_TOOLS.read_only;

  const hasAllCoding = codingTools.every(t => selectedSet.has(t));
  const hasAllReadOnly = readOnlyTools.every(t => selectedSet.has(t));

  if (hasAllCoding) return "coding";
  if (hasAllReadOnly) return "read_only";
  return "unknown";
}
```

Update `buildToolPlanFromParams` to accept the new field:

```typescript
export function buildToolPlanFromParams(params: {
  adk_native_tools?: string[];
  pi_mono_profile?: string;
  extension_tools?: string[];
  required_safe_custom_tools?: string[];
  tool_notes?: string;
  detectedExtensionTools?: string[];
  all_session_tools_selected?: string[];  // NEW
}): ToolPlan {
  // ... existing validation ...

  return buildToolPlan({
    adkNativeTools: adkNative,
    piMonoProfile: profile,
    extensionToolsDetected: params.detectedExtensionTools ?? [],
    extensionToolsSelected: params.extension_tools ?? [],
    requiredSafeCustomTools: params.required_safe_custom_tools,
    notes: params.tool_notes ? [params.tool_notes] : [],
    allSessionToolsSelected: params.all_session_tools_selected,
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/tool-plan.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add pi-google-adk/src/lib/tool-plan.ts pi-google-adk/tests/unit/tool-plan.test.ts
git commit -m "feat(tool-plan): add all_session_tools_selected with profile derivation"
```

---

### Task 4: Update shared schema to accept `all_session_tools_selected`

**Depends on:** Task 3

**Files:**
- Modify: `shared/adk-metadata-schema/index.ts`
- Modify: `shared/adk-metadata-schema/fixtures.ts`
- Test: `shared/adk-metadata-schema/schema-validation.test.ts`
- Test: `pi-google-adk/tests/unit/metadata-schema-consistency.test.ts`

**Step 1: Write the failing test**

Add to `shared/adk-metadata-schema/schema-validation.test.ts` (or if that file doesn't have a relevant test, verify via the consistency tests in `pi-google-adk`):

In `pi-google-adk/tests/unit/metadata-schema-consistency.test.ts`, add:

```typescript
it("buildCreationMetadata with all_session_tools_selected passes validation", () => {
  const toolPlan = buildToolPlan({
    allSessionToolsSelected: ["read", "bash", "gh_issue", "run_adk_agent"],
    extensionToolsDetected: ["gh_issue"],
  });
  const meta = buildCreationMetadata({
    sourceType: "native_app",
    agentName: "full-tools-agent",
    projectPath: "./agents/full-tools-agent",
    adkVersion: "1.2.3",
    commandUsed: "adk create full-tools-agent",
    supportedModes: ["native_app"],
    creationArgs: {},
    toolPlan,
  });
  const result = validateMetadata(meta);
  expect(result.ok).toBe(true);
  expect(result.metadata!.tool_plan!.all_session_tools_selected).toEqual([
    "read", "bash", "gh_issue", "run_adk_agent",
  ]);
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/metadata-schema-consistency.test.ts
```

Expected: FAIL — `all_session_tools_selected` not on `ToolPlanSchema`, not handled by `normalizeToolPlan`.

**Step 3: Write the implementation**

In `shared/adk-metadata-schema/index.ts`:

Add to `ToolPlanSchema`:
```typescript
  /** Unified tool selection (all tools the user selected, regardless of source). */
  all_session_tools_selected?: string[];
```

Update `normalizeToolPlan` to include:
```typescript
    all_session_tools_selected: o.all_session_tools_selected !== undefined
      ? normalizeStringArray(o.all_session_tools_selected)
      : undefined,
```

Add a fixture in `shared/adk-metadata-schema/fixtures.ts` for a metadata with `all_session_tools_selected` in its tool plan.

**Step 4: Run tests**

```bash
cd /home/mia/dev/pi-extensions/pi-google-adk
npm test -- tests/unit/metadata-schema-consistency.test.ts
```

Expected: ALL PASS

Also run the shared schema tests:

```bash
cd /home/mia/dev/pi-extensions/shared/adk-metadata-schema
npx vitest run
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add shared/adk-metadata-schema/index.ts shared/adk-metadata-schema/fixtures.ts pi-google-adk/tests/unit/metadata-schema-consistency.test.ts
git commit -m "feat(schema): add all_session_tools_selected to ToolPlanSchema"
```

---

### Task 5: Update `tool-summary.ts` to show unified selection

**Depends on:** Task 3
**Parallelizable with:** Task 4

**Files:**
- Modify: `pi-google-adk/src/lib/tool-summary.ts`
- Test: `pi-google-adk/tests/unit/tool-summary.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/tool-summary.test.ts`:

```typescript
describe("unified tool selection summary", () => {
  it("shows all_session_tools_selected when present", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "bash", "edit", "write", "gh_issue", "run_adk_agent"],
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Selected Tools");
    expect(summary).toContain("read");
    expect(summary).toContain("gh_issue");
    expect(summary).toContain("run_adk_agent");
  });

  it("shows count of selected tools", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: ["read", "bash", "gh_issue"],
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("3");
  });

  it("shows 'none selected' when all_session_tools_selected is empty array", () => {
    const plan = buildToolPlan({
      allSessionToolsSelected: [],
    });
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("none selected");
  });

  it("falls back to legacy display when all_session_tools_selected is undefined", () => {
    const plan = buildToolPlan({
      piMonoProfile: "coding",
      extensionToolsDetected: ["gh_issue"],
      extensionToolsSelected: ["gh_issue"],
    });
    // No allSessionToolsSelected → legacy path
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Pi Subagent/Session Tools");
    expect(summary).toContain("Coding");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/tool-summary.test.ts
```

Expected: FAIL — summary doesn't contain "Selected Tools".

**Step 3: Write the implementation**

In `pi-google-adk/src/lib/tool-summary.ts`, update `buildToolAccessSummary`:

```typescript
export function buildToolAccessSummary(plan: ToolPlan): string {
  const sections: string[] = [];

  // Section 1: ADK project tools (unchanged)
  sections.push(formatAdkSection(plan));

  // Section 2: Tool selection — new unified path or legacy path
  if (plan.all_session_tools_selected !== undefined) {
    sections.push(formatUnifiedSelectionSection(plan));
  } else {
    sections.push(formatPiSessionSection(plan));
  }

  // Section 3: Required safe custom tools
  sections.push(formatSafeToolsSection(plan));

  // Section 4: Caveats
  sections.push(formatCaveatsSection(plan));

  return sections.filter(Boolean).join("\n\n");
}
```

Add `formatUnifiedSelectionSection`:

```typescript
function formatUnifiedSelectionSection(plan: ToolPlan): string {
  const lines: string[] = ["── Selected Tools ──"];
  const selected = plan.all_session_tools_selected ?? [];

  if (selected.length === 0) {
    lines.push("  (none selected)");
    return lines.join("\n");
  }

  lines.push(`  ${selected.length} tool(s) selected:`);
  for (const t of selected) {
    lines.push(`  • ${t}`);
  }

  return lines.join("\n");
}
```

**Step 4: Run tests**

```bash
npm test -- tests/unit/tool-summary.test.ts
```

Expected: ALL PASS (old tests still pass because they don't set `all_session_tools_selected`)

**Step 5: Commit**

```bash
git add pi-google-adk/src/lib/tool-summary.ts pi-google-adk/tests/unit/tool-summary.test.ts
git commit -m "feat(tool-summary): add unified selection display with legacy fallback"
```

---

### Task 6: Rewrite wizard tool planning step — replace three-step flow with single `SettingsList` screen

**Depends on:** Task 2, Task 3

**Files:**
- Modify: `pi-google-adk/src/lib/wizard.ts`
- Test: `pi-google-adk/tests/unit/wizard.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/wizard.test.ts`. The mock UI needs a `custom` handler. Update `buildMockUI` to support custom responses:

```typescript
interface MockUICallbacks {
  selectResponses: (string | undefined)[];
  inputResponses: (string | undefined)[];
  confirmResponses: boolean[];
  customResponses?: unknown[];  // NEW: results returned by ui.custom()
}

function buildMockUI(callbacks: MockUICallbacks): ExtensionUIContext {
  let selectIdx = 0;
  let inputIdx = 0;
  let confirmIdx = 0;
  let customIdx = 0;

  return {
    select: async () => callbacks.selectResponses[selectIdx++],
    input: async () => callbacks.inputResponses[inputIdx++],
    confirm: async () => callbacks.confirmResponses[confirmIdx++] ?? false,
    editor: async () => undefined,
    notify: () => {},
    setStatus: () => {},
    setWidget: () => {},
    setTitle: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    pasteToEditor: () => {},
    setToolsExpanded: () => {},
    getToolsExpanded: () => false,
    setFooter: () => {},
    setWorkingMessage: () => {},
    setEditorComponent: () => {},
    custom: async (factory: Function) => {
      // Return the pre-configured response
      return callbacks.customResponses?.[customIdx++] ?? undefined;
    },
    theme: {} as never,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: true }),
    setHeader: () => {},
  } as unknown as ExtensionUIContext;
}
```

Now add tool planning wizard tests:

```typescript
// Import runToolPlanningWizard
import { runCreationWizard, runToolPlanningWizard, type WizardChoice } from "../../src/lib/wizard.js";
// Import captureExtensionApi and buildMockApi-like helper for setting up tool detection
import { captureExtensionApi } from "../../src/lib/tool-detect.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function buildToolMockApi(tools: { name: string; description: string }[]): ExtensionAPI {
  return {
    getAllTools: () =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {},
      })),
  } as unknown as ExtensionAPI;
}

describe("runToolPlanningWizard", () => {
  it("returns undefined when user skips tool planning", async () => {
    const ui = buildMockUI({
      selectResponses: ["Skip — create agent without tools"],
      inputResponses: [],
      confirmResponses: [],
    });

    const plan = await runToolPlanningWizard(ui);
    expect(plan).toBeUndefined();
  });

  it("returns undefined when user cancels at tool selection", async () => {
    captureExtensionApi(buildToolMockApi([
      { name: "read", description: "Read files" },
      { name: "bash", description: "Execute bash" },
    ]));

    const ui = buildMockUI({
      selectResponses: ["Yes — configure tools now"],
      inputResponses: [],
      confirmResponses: [false],  // reject summary
      customResponses: [undefined],  // cancel from SettingsList
    });

    const plan = await runToolPlanningWizard(ui);
    expect(plan).toBeUndefined();
  });

  it("returns a tool plan with selected tools", async () => {
    captureExtensionApi(buildToolMockApi([
      { name: "read", description: "Read files" },
      { name: "bash", description: "Execute bash" },
      { name: "edit", description: "Edit files" },
      { name: "write", description: "Write files" },
      { name: "gh_issue", description: "Manage GitHub issues" },
      { name: "create_adk_agent", description: "Create ADK agent" },
    ]));

    // Simulate user selecting read, bash, gh_issue
    const ui = buildMockUI({
      selectResponses: ["Yes — configure tools now"],
      inputResponses: [],
      confirmResponses: [true],  // accept summary
      customResponses: [["read", "bash", "gh_issue"]],  // multi-select result
    });

    const plan = await runToolPlanningWizard(ui);
    expect(plan).toBeDefined();
    expect(plan!.all_session_tools_selected).toEqual(["read", "bash", "gh_issue"]);
    expect(plan!.required_safe_custom_tools).toContain("gh_issue");
    expect(plan!.required_safe_custom_tools).toContain("run_adk_agent");
  });

  it("returns a tool plan with empty selection when user selects none", async () => {
    captureExtensionApi(buildToolMockApi([
      { name: "read", description: "Read files" },
    ]));

    const ui = buildMockUI({
      selectResponses: ["Yes — configure tools now"],
      inputResponses: [],
      confirmResponses: [true],
      customResponses: [[]],  // empty selection
    });

    const plan = await runToolPlanningWizard(ui);
    expect(plan).toBeDefined();
    expect(plan!.all_session_tools_selected).toEqual([]);
  });

  it("handles zero tools gracefully", async () => {
    captureExtensionApi(buildToolMockApi([]));

    const ui = buildMockUI({
      selectResponses: ["Yes — configure tools now"],
      inputResponses: [],
      confirmResponses: [],
      customResponses: [],
    });

    const plan = await runToolPlanningWizard(ui);
    // When no tools are available, wizard should notify and return undefined
    expect(plan).toBeUndefined();
  });

  it("handles detection failure gracefully", async () => {
    captureExtensionApi({
      getAllTools: () => { throw new Error("Runtime not initialized"); },
    } as unknown as ExtensionAPI);

    const ui = buildMockUI({
      selectResponses: ["Yes — configure tools now"],
      inputResponses: [],
      confirmResponses: [],
      customResponses: [],
    });

    const plan = await runToolPlanningWizard(ui);
    expect(plan).toBeUndefined();
  });
});

describe("runCreationWizard with tool planning", () => {
  it("native_app with tool plan flows through to completion", async () => {
    captureExtensionApi(buildToolMockApi([
      { name: "read", description: "Read files" },
      { name: "gh_issue", description: "Manage issues" },
    ]));

    const ui = buildMockUI({
      selectResponses: [
        "Native ADK app",                      // mode
        "Yes — configure tools now",           // tool planning opt-in
      ],
      inputResponses: ["my_agent", "./agents/my_agent", "gemini-2.5-flash"],
      confirmResponses: [
        true,   // confirm creation
        true,   // confirm tool plan summary
      ],
      customResponses: [["read", "gh_issue"]],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("native_app");
    if (choice.kind === "native_app") {
      expect(choice.tool_plan).toBeDefined();
      expect(choice.tool_plan!.all_session_tools_selected).toEqual(["read", "gh_issue"]);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/wizard.test.ts
```

Expected: FAIL — wizard still uses three-step flow, `custom` mock isn't wired correctly, etc.

**Step 3: Write the implementation**

Rewrite `runToolPlanningWizard` and remove `collectAdkNativeTools`, `collectPiMonoProfile`, `collectExtensionTools` in `pi-google-adk/src/lib/wizard.ts`:

```typescript
// Update imports at top:
import { detectAllTools, type DetectedTool } from "./tool-detect.js";
// Remove old imports: detectExtensionTools
// Keep: buildToolPlan, emptyToolPlan, type ToolPlan
// Remove from imports: AdkNativeToolCategory, PiMonoProfile, ADK_NATIVE_TOOL_CATEGORIES, PI_MONO_PROFILE_TOOLS

/**
 * Run the optional tool-planning wizard.
 * Shows all available tools and lets the user toggle any combination.
 * Returns a ToolPlan if the user opts in, or undefined if skipped.
 */
export async function runToolPlanningWizard(
  ui: ExtensionUIContext
): Promise<ToolPlan | undefined> {
  const toolChoice = await ui.select(
    "Would you like to configure tools now?\nYou can always add tools later.",
    ["Yes — configure tools now", "Skip — create agent without tools"]
  );

  if (!toolChoice || toolChoice === "Skip — create agent without tools")
    return undefined;

  // Detect all tools
  const detection = detectAllTools();

  if (!detection.detected || detection.tools.length === 0) {
    const msg = !detection.detected
      ? `Tool detection is not available: ${detection.error ?? "unknown reason"}`
      : "No tools detected in the current environment.";
    ui.notify(msg, "info");
    return undefined;
  }

  // Show all tools in a multi-select SettingsList
  const selectedTools = await showToolSelector(ui, detection.tools);

  if (selectedTools === undefined) return undefined; // cancelled

  // Build the plan from unified selection
  const plan = buildToolPlan({
    allSessionToolsSelected: selectedTools,
  });

  // Show summary and confirm
  const summary = buildToolAccessSummary(plan);
  const accepted = await ui.confirm("Tool access plan", summary);

  if (!accepted) return undefined;

  return plan;
}

/**
 * Show a SettingsList-based tool selector.
 * Returns an array of selected tool names, or undefined if cancelled.
 */
async function showToolSelector(
  ui: ExtensionUIContext,
  tools: DetectedTool[]
): Promise<string[] | undefined> {
  const result = await ui.custom<string[] | undefined>((tui, theme, _kb, done) => {
    const { Container, SettingsList } = require("@mariozechner/pi-tui");
    const { getSettingsListTheme } = require("@mariozechner/pi-coding-agent");

    const enabled = new Set<string>();

    const items = tools.map((tool) => ({
      id: tool.name,
      label: tool.name,
      description: tool.description,
      currentValue: "off",
      values: ["on", "off"],
    }));

    const container = new Container();

    // Header
    container.addChild({
      render(_width: number) {
        return [
          theme.fg("accent", theme.bold(`Select tools (${tools.length} available)`)),
          theme.fg("muted", "Toggle: Enter/Space · Done: Escape"),
          "",
        ];
      },
      invalidate() {},
    });

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 20),
      getSettingsListTheme(),
      (id: string, newValue: string) => {
        if (newValue === "on") {
          enabled.add(id);
        } else {
          enabled.delete(id);
        }
      },
      () => {
        // Escape pressed — done
        done(Array.from(enabled));
      },
    );

    container.addChild(settingsList);

    return {
      render(width: number) { return container.render(width); },
      invalidate() { container.invalidate(); },
      handleInput(data: string) {
        settingsList.handleInput?.(data);
        tui.requestRender();
      },
    };
  });

  return result;
}
```

**Important note for the implementer:** The `require()` calls above are placeholder pseudo-code. In the actual implementation, use top-level static imports:

```typescript
import { Container, SettingsList, type SettingItem } from "@mariozechner/pi-tui";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
```

Then use them inside the `ui.custom` factory. Since `wizard.ts` already imports from `@mariozechner/pi-coding-agent`, this should work. Check that `@mariozechner/pi-tui` is in the package's dependencies — if not, add it.

**Step 4: Run tests**

```bash
npm test -- tests/unit/wizard.test.ts
```

Expected: ALL PASS (both old wizard tests and new tool planning tests)

**Step 5: Run full test suite**

```bash
npm test
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add pi-google-adk/src/lib/wizard.ts pi-google-adk/tests/unit/wizard.test.ts
git commit -m "feat(wizard): replace three-step tool flow with unified SettingsList multi-select"
```

---

### Task 7: Remove old three-step functions and unused imports from wizard.ts

**Depends on:** Task 6

**Files:**
- Modify: `pi-google-adk/src/lib/wizard.ts`

**Step 1: Remove dead code**

Remove the following functions from `wizard.ts` (they are no longer called):
- `collectAdkNativeTools`
- `collectPiMonoProfile`
- `collectExtensionTools`

Remove unused imports:
- `AdkNativeToolCategory`, `PiMonoProfile`, `ADK_NATIVE_TOOL_CATEGORIES`, `PI_MONO_PROFILE_TOOLS` from `tool-plan.js`
- `detectExtensionTools` from `tool-detect.js` (replaced by `detectAllTools`)

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors

**Step 3: Run full tests**

```bash
npm test
```

Expected: ALL PASS

**Step 4: Commit**

```bash
git add pi-google-adk/src/lib/wizard.ts
git commit -m "refactor(wizard): remove dead three-step tool collection functions"
```

---

### Task 8: Deprecate `detectExtensionTools` in tool-detect.ts

**Depends on:** Task 7

**Files:**
- Modify: `pi-google-adk/src/lib/tool-detect.ts`
- Test: `pi-google-adk/tests/unit/tool-detect.test.ts`

**Step 1: Add deprecation JSDoc**

Mark `detectExtensionTools` as `@deprecated` and add a comment pointing to `detectAllTools`. Do NOT remove it — other code or external callers may still reference it.

```typescript
/**
 * @deprecated Use `detectAllTools()` instead. This function filters out
 * built-in and own tools. Kept for backward compatibility.
 */
export function detectExtensionTools(
```

**Step 2: Verify all existing detectExtensionTools tests still pass**

```bash
npm test -- tests/unit/tool-detect.test.ts
```

Expected: ALL PASS

**Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors

**Step 4: Commit**

```bash
git add pi-google-adk/src/lib/tool-detect.ts
git commit -m "refactor(tool-detect): deprecate detectExtensionTools in favor of detectAllTools"
```

---

### Task 9: Check pi-google-adk dependencies for `@mariozechner/pi-tui`

**Depends on:** Task 1

**Files:**
- Possibly modify: `pi-google-adk/package.json`

**Step 1: Check if `@mariozechner/pi-tui` is already a dependency**

```bash
grep "pi-tui" pi-google-adk/package.json
```

**Step 2: If missing, add it**

```bash
cd pi-google-adk
npm install @mariozechner/pi-tui
```

Or add manually to `package.json` dependencies and run `npm install`.

**Step 3: Verify**

```bash
npm run typecheck
npm test
```

Expected: ALL PASS

**Step 4: Commit (if changed)**

```bash
git add pi-google-adk/package.json pi-google-adk/package-lock.json
git commit -m "chore: add @mariozechner/pi-tui dependency for SettingsList"
```

---

### Task 10: Integration Test

**Depends on:** Tasks 2-8

**Files:**
- Create: `pi-google-adk/tests/integration/wizard-tool-planning.test.ts`

**Step 1: Write integration test covering the full flow**

```typescript
/**
 * Integration test: wizard tool planning full flow.
 *
 * Validates that:
 * - detectAllTools returns all tools from a mock API
 * - buildToolPlan produces correct output from unified selection
 * - buildToolAccessSummary formats the plan correctly
 * - The round-trip (detect → select → build plan → summary → persist → validate) works
 *
 * Does NOT test live Pi TUI rendering (that requires manual validation).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { captureExtensionApi, detectAllTools } from "../../src/lib/tool-detect.js";
import { buildToolPlan } from "../../src/lib/tool-plan.js";
import { buildToolAccessSummary } from "../../src/lib/tool-summary.js";
import { buildCreationMetadata, validateMetadata } from "../../src/lib/creation-metadata.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function mockApi(tools: { name: string; description: string }[]): ExtensionAPI {
  return {
    getAllTools: () => tools.map(t => ({ name: t.name, description: t.description, parameters: {} })),
  } as unknown as ExtensionAPI;
}

describe("wizard tool planning integration", () => {
  const sessionTools = [
    { name: "read", description: "Read files" },
    { name: "bash", description: "Execute bash commands" },
    { name: "edit", description: "Edit files" },
    { name: "write", description: "Write files" },
    { name: "create_adk_agent", description: "Create an ADK agent" },
    { name: "run_adk_agent", description: "Run an ADK agent" },
    { name: "gh_issue", description: "Manage GitHub issues" },
    { name: "gh_pr", description: "Manage GitHub PRs" },
    { name: "delegate_to_subagent", description: "Delegate to subagent" },
  ];

  beforeEach(() => {
    captureExtensionApi(mockApi(sessionTools));
  });

  it("full detect → select → plan → summary → persist → validate round-trip", () => {
    // 1. Detect all tools
    const detection = detectAllTools();
    expect(detection.detected).toBe(true);
    expect(detection.tools).toHaveLength(9);
    expect(detection.tools.map(t => t.name)).toContain("read");
    expect(detection.tools.map(t => t.name)).toContain("create_adk_agent");
    expect(detection.tools.map(t => t.name)).toContain("gh_issue");

    // 2. Simulate user selecting a subset
    const userSelection = ["read", "bash", "edit", "write", "gh_issue", "run_adk_agent"];

    // 3. Build tool plan
    const plan = buildToolPlan({
      allSessionToolsSelected: userSelection,
    });
    expect(plan.all_session_tools_selected).toEqual(userSelection);
    expect(plan.pi_mono_profile).toBe("coding");
    expect(plan.required_safe_custom_tools).toContain("gh_issue");
    expect(plan.required_safe_custom_tools).toContain("run_adk_agent");
    expect(plan.required_safe_custom_tools).toContain("resolve_adk_agent");

    // 4. Build summary
    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("Selected Tools");
    expect(summary).toContain("6");

    // 5. Persist in metadata
    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "test-integration",
      projectPath: "./agents/test-integration",
      adkVersion: "1.0.0",
      commandUsed: "adk create test-integration",
      supportedModes: ["native_app"],
      creationArgs: {},
      toolPlan: plan,
    });

    // 6. Validate
    const result = validateMetadata(meta);
    expect(result.ok).toBe(true);
    expect(result.metadata!.tool_plan!.all_session_tools_selected).toEqual(userSelection);
  });

  it("empty selection round-trip", () => {
    const detection = detectAllTools();
    expect(detection.detected).toBe(true);

    const plan = buildToolPlan({
      allSessionToolsSelected: [],
    });
    expect(plan.all_session_tools_selected).toEqual([]);
    expect(plan.pi_mono_profile).toBe("unknown");

    const summary = buildToolAccessSummary(plan);
    expect(summary).toContain("none selected");

    const result = validateMetadata(
      buildCreationMetadata({
        sourceType: "native_app",
        agentName: "empty-tools",
        projectPath: "./agents/empty-tools",
        adkVersion: null,
        commandUsed: "",
        supportedModes: [],
        creationArgs: {},
        toolPlan: plan,
      })
    );
    expect(result.ok).toBe(true);
  });

  it("backward compat: plan without all_session_tools_selected validates", () => {
    // Simulate old-style plan
    const plan = buildToolPlan({
      piMonoProfile: "coding",
      extensionToolsDetected: ["gh_issue"],
      extensionToolsSelected: ["gh_issue"],
    });
    expect(plan.all_session_tools_selected).toBeUndefined();

    const summary = buildToolAccessSummary(plan);
    // Should use legacy display path
    expect(summary).toContain("Pi Subagent/Session Tools");

    const result = validateMetadata(
      buildCreationMetadata({
        sourceType: "native_app",
        agentName: "legacy-agent",
        projectPath: "./agents/legacy-agent",
        adkVersion: "1.0.0",
        commandUsed: "",
        supportedModes: [],
        creationArgs: {},
        toolPlan: plan,
      })
    );
    expect(result.ok).toBe(true);
  });
});
```

**Step 2: Run integration test**

```bash
npm test -- tests/integration/wizard-tool-planning.test.ts
```

Expected: ALL PASS

**Step 3: Commit**

```bash
git add pi-google-adk/tests/integration/wizard-tool-planning.test.ts
git commit -m "test: add integration tests for wizard tool planning full flow"
```

---

### Task 11: Code Review

**Run the code-review skill** against all files created/modified in this plan.

**Review dimensions (all required):**

**Security:**
- No shell interpolation in tool names
- No user input passed to eval/exec
- Tool names are strings from `getAllTools()` — no injection risk

**Performance:**
- `getAllTools()` is called once per wizard run — fine
- `SettingsList` handles scrolling for large tool sets

**Correctness:**
- Edge cases: zero tools, one tool, all tools selected, none selected
- Backward compatibility: old plans without `all_session_tools_selected` still work
- Profile derivation: coding vs read_only vs unknown

**Maintainability:**
- Old three-step functions removed
- `detectExtensionTools` deprecated but kept
- Clear separation: detection → selection → plan → summary

**Step 1:** Review all new/modified files against the dimensions above
**Step 2:** Fix any issues found
**Step 3:** Re-review fixed code
**Step 4:** Commit fixes

```bash
git commit -m "fix: address code review findings"
```

---

### Task 12: Security Audit

**Run the repo-security-review skill** scoped to the changes in this plan.

**Audit domains:**

1. **Secrets Detection** — Scan new files for hardcoded keys/tokens (unlikely but check)
2. **SAST** — Static analysis on new code for injection risks in tool name handling
3. **Input validation** — Tool names from `getAllTools()` are trusted Pi runtime data, but verify no string interpolation into shell commands

**Step 1:** Run targeted security review on all files from this plan
**Step 2:** Classify findings by severity
**Step 3:** Fix CRITICAL/HIGH findings
**Step 4:** Document accepted risks for MEDIUM/LOW
**Step 5:** Commit fixes

```bash
git commit -m "security: remediate audit findings"
```

---

### Task 13: Rollback Plan

**How to undo this change if it breaks something:**

1. **Revert method:** `git revert` the merge commit. All changes are additive — the `all_session_tools_selected` field is optional. Old metadata files work unchanged.
2. **Data implications:** New metadata files will have `all_session_tools_selected`. Old code ignores unknown fields (shared schema preserves them). Safe to revert.
3. **Dependent services:** `pi-subagents` reads the tool plan but handles unknown fields gracefully. No breakage on revert.
4. **Rollback verification:** Run `npm test` in both `pi-google-adk` and `shared/adk-metadata-schema`. Verify wizard uses old three-step flow.

---

## Manual Validation Path

After all tasks are complete, manually test with:

```bash
pi -e ./pi-google-adk/src/index.ts -e ./pi-gh/index.ts
```

Then run `create_adk_agent` in interactive mode and verify:
1. Tool planning step shows all tools (read, bash, edit, write, gh_repo, gh_issue, gh_pr, gh_actions, create_adk_agent, etc.)
2. Each tool shows name and description
3. You can toggle tools on/off with Enter/Space
4. Escape confirms selection
5. Summary shows selected tools
6. Metadata file contains `all_session_tools_selected`
