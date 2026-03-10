import type {
  ExtensionAPI,
  ExtensionContext,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolDefinition,
  AgentSessionEvent,
  CreateAgentSessionOptions,
} from "@mariozechner/pi-coding-agent";
import {
  createAgentSession,
  readOnlyTools,
  codingTools,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

// Phase 4B: metadata-aware delegation advice
import {
  buildDelegationAdvice,
  formatAdviceForOutput,
  type DelegationAdvice,
} from "./src/lib/adk-delegation-advice.js";

// Phase 5B: delegation-time remediation UX
import {
  buildDelegationRemediation,
  buildRemediationPromptText,
  formatRemediationForOutput,
  type DelegationRemediation,
} from "./src/lib/adk-delegation-remediation.js";

// ---------------------------------------------------------------------------
// Recursion guard (secondary boundary)
//
// The primary boundary is that the child session is created with
// noExtensions: true on its ResourceLoader, so this extension (and all
// others) are never loaded into the child. The child therefore never has
// the delegate_to_subagent tool at all.
//
// This secondary guard exists as defense-in-depth: if someone later
// wires the extension into a child by mistake, it refuses to register
// or execute. It uses a module-scoped flag set per call frame rather
// than a process-global env var, so it is robust against concurrent
// parent sessions.
// ---------------------------------------------------------------------------

/**
 * Set of AbortSignals belonging to active child executions.
 * If the current execution's signal is in this set, we are inside a child.
 * This is session-local because each call gets its own signal.
 */
const activeChildSignals = new WeakSet<AbortSignal>();

/**
 * Simple counter: if > 0, we are inside a child execution context.
 * Used as an additional synchronous guard for the registration path.
 */
let childDepth = 0;

// ---------------------------------------------------------------------------
// Test-only accessors for internal state.
// These allow tests to inspect and manipulate the recursion guard without
// breaking encapsulation in production code paths.
// ---------------------------------------------------------------------------

/** Read the current child depth (test-only). */
export function _getChildDepth(): number {
  return childDepth;
}

/** Set the child depth (test-only, for setup/teardown). */
export function _setChildDepth(n: number): void {
  childDepth = n;
}

/** Add a signal to the active child set (test-only). */
export function _addChildSignal(signal: AbortSignal): void {
  activeChildSignals.add(signal);
}

/** Remove a signal from the active child set (test-only). */
export function _removeChildSignal(signal: AbortSignal): void {
  activeChildSignals.delete(signal);
}

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------

export const DelegateParamsSchema = Type.Object({
  task: Type.String({
    description: "Exact task description for the child subagent.",
  }),
  mode: Type.Optional(
    StringEnum(["read_only", "coding"] as const, {
      description:
        'Built-in tool set for the child. "read_only" gives read/grep/find/ls. "coding" adds bash/edit/write. Default: "read_only".',
    })
  ),
  successCriteria: Type.Optional(
    Type.String({
      description: "Explicit completion target so the child knows when it is done.",
    })
  ),
  outputStyle: Type.Optional(
    StringEnum(["summary", "patch_plan", "full_report"] as const, {
      description: 'Desired shape of the child answer. Default: "summary".',
    })
  ),
  files: Type.Optional(
    Type.Array(Type.String(), {
      description: "Files or directories the child should focus on.",
    })
  ),
  safeCustomTools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Names of custom tools from the parent session that the child is allowed to use. Only explicitly listed tools are exposed.",
    })
  ),
  modelOverride: Type.Optional(
    Type.String({
      description:
        "Optional model identifier (provider/model-id) for the child. Falls back to the parent model.",
    })
  ),
  agent: Type.Optional(
    Type.String({
      description:
        "Name or path of an ADK agent to delegate to. " +
        "Resolves via pi-google-adk discovery. " +
        "If provided, run_adk_agent is auto-allowlisted and the resolved project path " +
        "is injected into the child's instructions.",
    })
  ),
  agentProvider: Type.Optional(
    StringEnum(["auto", "adk"] as const, {
      description:
        'Agent provider for resolution. Currently only "adk" is supported. Default: "auto" (tries ADK).',
    })
  ),
  onMissingAgent: Type.Optional(
    StringEnum(["prompt", "cancel"] as const, {
      description:
        'What to do when the requested agent is not found. "prompt" shows a selection UI. "cancel" aborts. Default: "prompt".',
    })
  ),
  onAmbiguousAgent: Type.Optional(
    StringEnum(["prompt", "cancel"] as const, {
      description:
        'What to do when the requested agent matches multiple projects. "prompt" shows a selection UI. "cancel" aborts. Default: "prompt".',
    })
  ),
});

export type DelegateParams = Static<typeof DelegateParamsSchema>;

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ADK agent resolution types and helpers (Phase 2)
// ---------------------------------------------------------------------------

/** Resolved ADK agent metadata — matches DiscoveredAgent from pi-google-adk. */
export interface ResolvedAdkAgent {
  name: string;
  project_path: string;
  template: string | null;
  capabilities: string[];
  label: string;
  source: "manifest" | "heuristic";
}

/**
 * Structured resolution status (Phase 3).
 *
 * - found: unique match resolved
 * - ambiguous: multiple matches, needs disambiguation
 * - not_found: no matching agent discovered
 * - provider_unavailable: pi-google-adk not loaded or resolve_adk_agent not registered
 * - execution_unavailable: resolution works but run_adk_agent not registered
 * - interactive_selection_required: disambiguation needed but no interactive UI available
 */
export type AdkResolutionStatus =
  | "found"
  | "ambiguous"
  | "not_found"
  | "provider_unavailable"
  | "execution_unavailable"
  | "interactive_selection_required";

/** Result of the ADK agent resolution + prompt flow (Phase 3 structured). */
export interface AdkResolutionResult {
  status: AdkResolutionStatus;
  resolved: boolean;
  agent?: ResolvedAdkAgent;
  cancelled?: boolean;
  error?: string;
  /** Requested agent name/path for programmatic handling. */
  requestedAgent?: string;
  /** Available matches for programmatic handling. */
  availableMatches?: ResolvedAdkAgent[];
  /** Whether interactive UI was available at decision time. */
  uiAvailable?: boolean;
}

/**
 * Attempt to resolve an ADK agent by name/path using the safe tool registry.
 *
 * Calls resolve_adk_agent if registered, otherwise returns provider_unavailable.
 * This keeps pi-subagents generic: it delegates discovery to pi-google-adk
 * rather than importing ADK-specific logic.
 */
export async function resolveAdkAgentViaTool(
  safeToolRegistry: Map<string, ToolDefinition>,
  cwd: string,
  query: string
): Promise<{
  status: "found" | "not_found" | "ambiguous" | "provider_unavailable";
  agent?: ResolvedAdkAgent;
  matches?: ResolvedAdkAgent[];
  available: ResolvedAdkAgent[];
}> {
  const resolveTool = safeToolRegistry.get("resolve_adk_agent");
  if (!resolveTool) {
    // pi-google-adk not loaded — provider unavailable, not "not found"
    return { status: "provider_unavailable", available: [] };
  }

  const result = await resolveTool.execute(
    "internal-resolve",
    { query },
    undefined,
    undefined,
    { cwd } as never
  );

  // Parse the JSON result from the tool
  const content = result?.content;
  if (!Array.isArray(content) || content.length === 0) {
    return { status: "not_found", available: [] };
  }

  const textPart = content.find((c: { type: string }) => c.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  if (!textPart) {
    return { status: "not_found", available: [] };
  }

  try {
    return JSON.parse(textPart.text);
  } catch {
    return { status: "not_found", available: [] };
  }
}

/**
 * Check whether run_adk_agent is available for execution.
 * Separate from resolution: you can resolve an agent but not execute it
 * if run_adk_agent is not registered.
 */
export function checkAdkExecutionAvailable(
  safeToolRegistry: Map<string, ToolDefinition>
): boolean {
  return safeToolRegistry.has("run_adk_agent");
}

/**
 * Check whether interactive UI is available for agent selection.
 * Exported for testability.
 */
export function isInteractiveUIAvailable(
  ctx: { ui?: { select?: unknown }; hasUI?: boolean }
): boolean {
  return !!(ctx.hasUI && ctx.ui && typeof ctx.ui.select === "function");
}

/**
 * Run the prompt-or-cancel UX for agent selection.
 *
 * Uses ctx.ui.select when available (TUI context).
 * When no interactive UI is available, returns a structured
 * interactive_selection_required result instead of silently degrading.
 */
export async function promptAgentSelection(
  ctx: { ui: { select: (title: string, options: string[]) => Promise<string | undefined>; notify: (msg: string, level: string) => void }; hasUI: boolean },
  agents: ResolvedAdkAgent[],
  title: string,
  requestedAgent?: string
): Promise<AdkResolutionResult> {
  if (agents.length === 0) {
    return {
      status: "not_found",
      resolved: false,
      cancelled: true,
      error: "No ADK agents available.",
      requestedAgent,
      availableMatches: [],
      uiAvailable: isInteractiveUIAvailable(ctx),
    };
  }

  // Check for interactive UI availability BEFORE attempting select
  if (!isInteractiveUIAvailable(ctx)) {
    return {
      status: "interactive_selection_required",
      resolved: false,
      cancelled: false,
      error:
        "Interactive agent selection is required but no UI is available. " +
        "Provide an exact agent name, use onMissingAgent/onAmbiguousAgent: 'cancel', " +
        "or run in an interactive TUI session.",
      requestedAgent,
      availableMatches: agents,
      uiAvailable: false,
    };
  }

  // Build selection options — each agent's label, plus a cancel option
  const options = agents.map((a) => a.label);
  options.push("Cancel");

  const choice = await ctx.ui.select(title, options);

  if (!choice || choice === "Cancel") {
    return {
      status: "not_found",
      resolved: false,
      cancelled: true,
      requestedAgent,
      uiAvailable: true,
    };
  }

  const selected = agents.find((a) => a.label === choice);
  if (!selected) {
    return {
      status: "not_found",
      resolved: false,
      cancelled: true,
      error: "Selection did not match any agent.",
      requestedAgent,
      uiAvailable: true,
    };
  }

  return { status: "found", resolved: true, agent: selected, uiAvailable: true };
}

/**
 * Full ADK agent resolution flow: resolve → check provider → prompt if needed → check execution → return result.
 */
export async function resolveAdkAgentWithPrompt(
  safeToolRegistry: Map<string, ToolDefinition>,
  cwd: string,
  query: string,
  onMissing: "prompt" | "cancel",
  onAmbiguous: "prompt" | "cancel",
  ctx: { ui: { select: (title: string, options: string[]) => Promise<string | undefined>; notify: (msg: string, level: string) => void }; hasUI: boolean }
): Promise<AdkResolutionResult> {
  const resolution = await resolveAdkAgentViaTool(safeToolRegistry, cwd, query);

  // Phase 3 (A): Provider unavailable — explicit first-class state
  if (resolution.status === "provider_unavailable") {
    return {
      status: "provider_unavailable",
      resolved: false,
      cancelled: true,
      error:
        "ADK agent resolution is unavailable because pi-google-adk is not loaded. " +
        "Install and enable pi-google-adk to use ADK agent delegation.",
      requestedAgent: query,
      availableMatches: [],
      uiAvailable: isInteractiveUIAvailable(ctx),
    };
  }

  if (resolution.status === "found" && resolution.agent) {
    // Phase 3 (A): Check execution availability after resolution
    if (!checkAdkExecutionAvailable(safeToolRegistry)) {
      return {
        status: "execution_unavailable",
        resolved: false,
        cancelled: true,
        agent: resolution.agent,
        error:
          `ADK agent "${resolution.agent.name}" was resolved, but execution is unavailable ` +
          "because run_adk_agent is not registered. pi-google-adk may be partially loaded.",
        requestedAgent: query,
        uiAvailable: isInteractiveUIAvailable(ctx),
      };
    }
    return {
      status: "found",
      resolved: true,
      agent: resolution.agent,
      requestedAgent: query,
      uiAvailable: isInteractiveUIAvailable(ctx),
    };
  }

  if (resolution.status === "not_found") {
    if (onMissing === "cancel") {
      const names = resolution.available.map((a) => a.name).join(", ") || "none";
      return {
        status: "not_found",
        resolved: false,
        cancelled: true,
        error: `ADK agent "${query}" not found. Available: ${names}`,
        requestedAgent: query,
        availableMatches: resolution.available,
        uiAvailable: isInteractiveUIAvailable(ctx),
      };
    }
    // prompt
    const promptResult = await promptAgentSelection(
      ctx,
      resolution.available,
      `Agent "${query}" not found. Choose an ADK agent:`,
      query
    );
    // If resolved via prompt, still check execution availability
    if (promptResult.resolved && promptResult.agent && !checkAdkExecutionAvailable(safeToolRegistry)) {
      return {
        status: "execution_unavailable",
        resolved: false,
        cancelled: true,
        agent: promptResult.agent,
        error:
          `ADK agent "${promptResult.agent.name}" was selected, but execution is unavailable ` +
          "because run_adk_agent is not registered.",
        requestedAgent: query,
        uiAvailable: true,
      };
    }
    return promptResult;
  }

  if (resolution.status === "ambiguous") {
    if (onAmbiguous === "cancel") {
      const names = (resolution.matches ?? []).map((a) => a.name).join(", ");
      return {
        status: "ambiguous",
        resolved: false,
        cancelled: true,
        error: `ADK agent "${query}" is ambiguous. Matches: ${names}`,
        requestedAgent: query,
        availableMatches: resolution.matches ?? resolution.available,
        uiAvailable: isInteractiveUIAvailable(ctx),
      };
    }
    // prompt from matches
    const promptResult = await promptAgentSelection(
      ctx,
      resolution.matches ?? resolution.available,
      `Agent "${query}" matches multiple projects. Choose one:`,
      query
    );
    // If resolved via prompt, still check execution availability
    if (promptResult.resolved && promptResult.agent && !checkAdkExecutionAvailable(safeToolRegistry)) {
      return {
        status: "execution_unavailable",
        resolved: false,
        cancelled: true,
        agent: promptResult.agent,
        error:
          `ADK agent "${promptResult.agent.name}" was selected, but execution is unavailable ` +
          "because run_adk_agent is not registered.",
        requestedAgent: query,
        uiAvailable: true,
      };
    }
    return promptResult;
  }

  return {
    status: "not_found",
    resolved: false,
    cancelled: true,
    error: "Unexpected resolution state.",
    requestedAgent: query,
  };
}

/** Build the child system prompt with explicit behavioral constraints. */
export function buildChildSystemPrompt(params: DelegateParams): string {
  const outputInstruction =
    params.outputStyle === "patch_plan"
      ? "Return your result as a concise patch plan listing files and changes."
      : params.outputStyle === "full_report"
        ? "Return a full detailed report."
        : "Return a concise summary of findings and actions taken.";

  const filesNote =
    params.files && params.files.length > 0
      ? `\nFocus on these files/paths:\n${params.files.map((f) => `  - ${f}`).join("\n")}`
      : "";

  const criteriaNote = params.successCriteria
    ? `\nSuccess criteria: ${params.successCriteria}`
    : "";

  return [
    "You are a bounded worker subagent.",
    "Complete ONLY the assigned task below. Do not explore beyond it.",
    "Do NOT delegate to another agent or attempt to spawn subagents.",
    "Use only the tools available in this session.",
    "If a required tool is unavailable, state that clearly and stop.",
    outputInstruction,
    "",
    `TASK: ${params.task}`,
    criteriaNote,
    filesNote,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build an ADK-augmented child system prompt.
 *
 * When an ADK agent is resolved, the child needs instructions to use
 * run_adk_agent with the correct project path. This wraps the base
 * prompt with that context.
 */
export function buildAdkChildSystemPrompt(
  params: DelegateParams,
  agent: ResolvedAdkAgent
): string {
  const base = buildChildSystemPrompt(params);

  const adkSection = [
    "",
    "--- ADK Agent Delegation ---",
    `You have access to the run_adk_agent tool.`,
    `Use it to delegate work to the ADK agent "${agent.name}" at project path: ${agent.project_path}`,
    `Template: ${agent.template ?? "unknown"}`,
    agent.capabilities.length > 0
      ? `Capabilities: ${agent.capabilities.join(", ")}`
      : "",
    "",
    "To execute the task, call run_adk_agent with:",
    `  project_path: "${agent.project_path}"`,
    `  prompt: <your prompt for the ADK agent>`,
    "",
    "Pass the full task as the prompt. The ADK agent runs in a separate Python process.",
    "--- End ADK Agent Delegation ---",
  ]
    .filter(Boolean)
    .join("\n");

  return base + "\n" + adkSection;
}

/**
 * Resolve safe custom tools from the parent session by name allowlist.
 *
 * Only tools whose names appear in `allowedNames` AND exist in the parent
 * session are returned. The delegate_to_subagent tool is always excluded
 * regardless of the allowlist (defense-in-depth).
 */
export function resolveAllowedCustomTools(
  parentTools: Array<{ name: string; description: string; parameters: unknown }>,
  parentExtensionTools: ToolDefinition[],
  allowedNames: string[]
): ToolDefinition[] {
  if (allowedNames.length === 0) return [];

  const allowed = new Set(allowedNames);
  // Never allow the delegation tool in a child, even if explicitly listed.
  allowed.delete("delegate_to_subagent");

  return parentExtensionTools.filter((t) => allowed.has(t.name));
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function piSubagentsExtension(pi: ExtensionAPI): void {
  // --- Secondary guard: refuse to register inside a child context ---
  if (childDepth > 0) {
    // This extension was loaded inside a child session (should not happen
    // with the primary boundary, but guard anyway). Skip registration.
    return;
  }

  // We need a reference to the parent's registered custom tools so we can
  // resolve the allowlist at execution time. The extension API exposes
  // getAllTools() on the context, but the full ToolDefinition objects are
  // only available if we collect them ourselves. We store tools registered
  // by other extensions via a session_start hook reading getAllTools().
  //
  // For the allowlist we rely on ctx.getAllTools() at execute time which
  // returns ToolInfo (name + description + parameters). However, to pass
  // full ToolDefinition objects to the child we need the execute function.
  // The cleanest path is to accept that the child can only use tools we
  // can fully reconstruct. We expose a registration helper for that.

  // Storage for externally registered safe tool definitions.
  const safeToolRegistry = new Map<string, ToolDefinition>();

  /**
   * Register a tool definition that subagents are allowed to use.
   * Call this from other extensions that want to expose tools to children.
   * This is the canonical way to make a custom tool available to subagents.
   */
  (globalThis as Record<string, unknown>).__piSubagents_registerSafeTool = (
    tool: ToolDefinition
  ) => {
    if (tool.name === "delegate_to_subagent") return;
    safeToolRegistry.set(tool.name, tool);
  };

  // --- Drain pending safe tools registered before pi-subagents loaded ---
  // Other extensions (e.g. pi-google-adk) may push tools into
  // __piSubagents_pendingSafeTools if they load before this extension.
  const g = globalThis as Record<string, unknown>;
  const PENDING_KEY = "__piSubagents_pendingSafeTools";
  if (Array.isArray(g[PENDING_KEY])) {
    for (const tool of g[PENDING_KEY] as ToolDefinition[]) {
      if (tool.name !== "delegate_to_subagent") {
        safeToolRegistry.set(tool.name, tool);
      }
    }
    // Clear the pending array now that we've drained it
    g[PENDING_KEY] = [];
  }

  pi.registerTool<typeof DelegateParamsSchema>({
    name: "delegate_to_subagent",
    label: "Delegate to Subagent",
    description:
      "Delegate a bounded task to a child subagent that runs in-process. " +
      "The child has access to a selected set of built-in tools and an explicit " +
      "allowlist of safe custom tools. It cannot delegate further.",
    promptSnippet:
      "delegate_to_subagent - Delegate a bounded task to a child subagent with scoped tools.",
    promptGuidelines: [
      "Use delegate_to_subagent for self-contained subtasks that benefit from focused execution.",
      "Prefer read_only mode unless the child needs to modify files.",
      "Always provide a clear task description and success criteria.",
      "List only the custom tools the child actually needs in safeCustomTools.",
      'To delegate to a specific ADK agent, pass agent: "<name>". run_adk_agent is auto-allowlisted.',
    ],
    parameters: DelegateParamsSchema,

    async execute(
      toolCallId: string,
      params: DelegateParams,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
      ctx: ExtensionContext
    ): Promise<AgentToolResult<{ childMessages: number }>> {
      // --- Secondary recursion guard (execution-time) ---
      if (signal && activeChildSignals.has(signal)) {
        return {
          content: [{ type: "text", text: "ERROR: Recursive delegation blocked. This tool cannot be called from within a child subagent." }],
          details: { childMessages: 0 },
        };
      }
      if (childDepth > 0) {
        return {
          content: [{ type: "text", text: "ERROR: Recursive delegation blocked (depth guard)." }],
          details: { childMessages: 0 },
        };
      }

      const mode = params.mode ?? "read_only";
      const outputStyle = params.outputStyle ?? "summary";

      // -----------------------------------------------------------------
      // Phase 2: ADK agent resolution
      // -----------------------------------------------------------------
      let resolvedAdkAgent: ResolvedAdkAgent | undefined;

      if (params.agent) {
        const onMissing = params.onMissingAgent ?? "prompt";
        const onAmbiguous = params.onAmbiguousAgent ?? "prompt";

        const adkResult = await resolveAdkAgentWithPrompt(
          safeToolRegistry,
          ctx.cwd,
          params.agent,
          onMissing,
          onAmbiguous,
          ctx as { ui: { select: (title: string, options: string[]) => Promise<string | undefined>; notify: (msg: string, level: string) => void }; hasUI: boolean }
        );

        if (!adkResult.resolved || !adkResult.agent) {
          // Phase 3: structured error messages by status
          let errorMsg: string;
          switch (adkResult.status) {
            case "provider_unavailable":
              errorMsg = adkResult.error ?? "ADK agent resolution is unavailable because pi-google-adk is not loaded.";
              break;
            case "execution_unavailable":
              errorMsg = adkResult.error ?? "ADK agent execution is unavailable because run_adk_agent is not registered.";
              break;
            case "interactive_selection_required":
              errorMsg = adkResult.error ?? "Interactive agent selection is required but no UI is available.";
              if (adkResult.availableMatches && adkResult.availableMatches.length > 0) {
                errorMsg += ` Available agents: ${adkResult.availableMatches.map(a => a.name).join(", ")}`;
              }
              break;
            case "ambiguous":
              errorMsg = adkResult.error ?? `ADK agent "${params.agent}" is ambiguous.`;
              break;
            case "not_found":
              errorMsg = adkResult.error ?? `ADK agent "${params.agent}" not found.`;
              break;
            default:
              errorMsg = adkResult.cancelled
                ? adkResult.error ?? "ADK agent selection was cancelled."
                : adkResult.error ?? "Failed to resolve ADK agent.";
          }
          return {
            content: [{ type: "text", text: errorMsg }],
            details: { childMessages: 0 },
          };
        }

        resolvedAdkAgent = adkResult.agent;
      }

      // Select built-in tools based on mode.
      const builtinTools = mode === "coding" ? codingTools : readOnlyTools;

      // Resolve allowed custom tools for the child.
      // When an ADK agent is resolved, ensure run_adk_agent is allowlisted.
      // Phase 3: use a deduped Set to avoid mutation and duplicates.
      const allowedSet = new Set(params.safeCustomTools ?? []);
      if (resolvedAdkAgent) {
        allowedSet.add("run_adk_agent");
      }
      const childCustomTools = resolveAllowedCustomTools(
        [], // not used in current implementation
        Array.from(safeToolRegistry.values()),
        Array.from(allowedSet)
      );

      // -----------------------------------------------------------------
      // Phase 4B: Metadata-aware delegation advice
      // -----------------------------------------------------------------
      let delegationAdvice: DelegationAdvice | null = null;

      if (resolvedAdkAgent) {
        delegationAdvice = buildDelegationAdvice(
          ctx.cwd,
          resolvedAdkAgent.project_path,
          safeToolRegistry,
          params.safeCustomTools
        );
      }

      // -----------------------------------------------------------------
      // Phase 5B: Delegation-time remediation UX
      // -----------------------------------------------------------------
      let delegationRemediation: DelegationRemediation | null = null;

      if (delegationAdvice) {
        delegationRemediation = buildDelegationRemediation(
          delegationAdvice,
          params.safeCustomTools,
        );

        // Light interactive confirm/warn when UI is available and
        // there are meaningful mismatches worth surfacing.
        if (
          delegationRemediation.needs_attention &&
          delegationRemediation.ui_prompt_recommended
        ) {
          const uiCtx = ctx as {
            ui?: { confirm?: (title: string, message: string) => Promise<boolean> };
            hasUI?: boolean;
          };
          const hasConfirmUI = !!(uiCtx.hasUI && uiCtx.ui && typeof uiCtx.ui.confirm === "function");

          if (hasConfirmUI) {
            const { title, body } = buildRemediationPromptText(delegationRemediation);
            const confirmed = await uiCtx.ui!.confirm!(title, body);
            delegationRemediation.ui_prompt_shown = true;
            delegationRemediation.user_chose_to_continue = confirmed;

            if (!confirmed) {
              return {
                content: [
                  {
                    type: "text",
                    text:
                      "Delegation cancelled by user after remediation warning.\n\n" +
                      delegationRemediation.concise_user_message,
                  },
                ],
                details: {
                  childMessages: 0,
                  ...(delegationAdvice ? { adk_delegation_advice: delegationAdvice } : {}),
                  adk_delegation_remediation: delegationRemediation,
                },
              };
            }
          } else {
            // Non-interactive: structured remediation guidance only, no prompt.
            delegationRemediation.ui_prompt_shown = false;
          }
        }
      }

      // Build child system prompt (ADK-augmented if applicable).
      const childSystemPrompt = resolvedAdkAgent
        ? buildAdkChildSystemPrompt(params, resolvedAdkAgent)
        : buildChildSystemPrompt(params);

      // Resolve model: use override if provided, else fall back to parent model.
      let childModel = ctx.model;
      if (params.modelOverride && ctx.modelRegistry) {
        const parts = params.modelOverride.split("/");
        if (parts.length === 2) {
          const found = ctx.modelRegistry.find(parts[0], parts[1]);
          if (found) childModel = found;
        }
      }

      // Create an ephemeral resource loader with NO extensions loaded.
      // This is the PRIMARY recursion boundary: the child session has no
      // extensions at all, so delegate_to_subagent cannot exist in it.
      const childResourceLoader = new DefaultResourceLoader({
        cwd: ctx.cwd,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        systemPrompt: childSystemPrompt,
      });
      await childResourceLoader.reload();

      const childSessionManager = SessionManager.inMemory(ctx.cwd);

      const sessionOpts: CreateAgentSessionOptions = {
        cwd: ctx.cwd,
        tools: builtinTools,
        customTools: childCustomTools.length > 0 ? childCustomTools : undefined,
        resourceLoader: childResourceLoader,
        sessionManager: childSessionManager,
        model: childModel,
      };

      let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;

      // Mark that we are inside a child execution.
      childDepth++;
      const childSignal = signal ?? new AbortController().signal;
      activeChildSignals.add(childSignal);

      try {
        const result = await createAgentSession(sessionOpts);
        session = result.session;

        // Collect streamed text to return as final result.
        const chunks: string[] = [];

        // Subscribe to child events to stream output back to parent.
        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          if (event.type === "message_update") {
            const msg = event.message;
            // Extract text content from streaming assistant message.
            if (msg && "role" in msg && msg.role === "assistant" && Array.isArray(msg.content)) {
              const textParts = msg.content.filter(
                (c: { type: string }) => c.type === "text"
              );
              if (textParts.length > 0) {
                const latestText = (textParts[textParts.length - 1] as { type: "text"; text: string }).text;
                // Stream incremental updates to parent.
                if (onUpdate) {
                  onUpdate({
                    content: [{ type: "text", text: `[subagent] ${latestText}` }],
                    details: { childMessages: 0 },
                  });
                }
              }
            }
          }
        });

        // Send the task as the initial prompt.
        await session.prompt(params.task);

        // Wait for the agent to finish streaming.
        await session.agent.waitForIdle();

        unsubscribe();

        // Extract the final assistant response.
        const messages = session.state.messages;
        let finalText = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m && "role" in m && m.role === "assistant" && Array.isArray(m.content)) {
            const textParts = m.content.filter(
              (c: { type: string }) => c.type === "text"
            );
            finalText = textParts
              .map((c: { type: "text"; text: string }) => c.text)
              .join("\n");
            break;
          }
        }

        const totalMessages = messages.length;

        // Phase 4B: include advisory in output when present
        const advisoryBlock = delegationAdvice
          ? "\n\n" + formatAdviceForOutput(delegationAdvice)
          : "";

        // Phase 5B: include remediation guidance in output when present
        const remediationBlock = delegationRemediation
          ? "\n\n" + formatRemediationForOutput(delegationRemediation)
          : "";

        return {
          content: [
            {
              type: "text",
              text: [
                `--- Subagent Result (mode: ${mode}, output: ${outputStyle}) ---`,
                "",
                finalText || "(No output from subagent)",
                "",
                `--- End Subagent Result (${totalMessages} messages exchanged) ---`,
                advisoryBlock,
                remediationBlock,
              ].join("\n"),
            },
          ],
          details: {
            childMessages: totalMessages,
            ...(delegationAdvice ? { adk_delegation_advice: delegationAdvice } : {}),
            ...(delegationRemediation ? { adk_delegation_remediation: delegationRemediation } : {}),
          },
        };
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);

        // Check for cancellation.
        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Subagent task was cancelled." }],
            details: { childMessages: 0 },
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Subagent error: ${errorMessage}`,
            },
          ],
          details: { childMessages: 0 },
        };
      } finally {
        // Clean up child resources.
        activeChildSignals.delete(childSignal);
        childDepth--;

        if (session) {
          try {
            session.dispose();
          } catch {
            // Ignore disposal errors.
          }
        }
      }
    },
  });
}
