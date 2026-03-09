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
// Parameter schema
// ---------------------------------------------------------------------------

const DelegateParamsSchema = Type.Object({
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
});

type DelegateParams = Static<typeof DelegateParamsSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the child system prompt with explicit behavioral constraints. */
function buildChildSystemPrompt(params: DelegateParams): string {
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
 * Resolve safe custom tools from the parent session by name allowlist.
 *
 * Only tools whose names appear in `allowedNames` AND exist in the parent
 * session are returned. The delegate_to_subagent tool is always excluded
 * regardless of the allowlist (defense-in-depth).
 */
function resolveAllowedCustomTools(
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

      // Select built-in tools based on mode.
      const builtinTools = mode === "coding" ? codingTools : readOnlyTools;

      // Resolve allowed custom tools for the child.
      const allowedNames = params.safeCustomTools ?? [];
      const childCustomTools = resolveAllowedCustomTools(
        [], // not used in current implementation
        Array.from(safeToolRegistry.values()),
        allowedNames
      );

      // Build child system prompt.
      const childSystemPrompt = buildChildSystemPrompt(params);

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
              ].join("\n"),
            },
          ],
          details: { childMessages: totalMessages },
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
