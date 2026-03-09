/**
 * Mock ExtensionAPI that captures tool registrations and event handlers.
 * Used by extension-level and veracity tests.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-coding-agent";

export interface RegisteredToolCapture {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: ToolDefinition["execute"];
}

export interface MockExtensionAPIResult {
  api: ExtensionAPI;
  /** All tools registered via registerTool(). */
  registeredTools: RegisteredToolCapture[];
  /** Event handlers registered via on(). */
  eventHandlers: Map<string, Function[]>;
  /** Find a registered tool by name. */
  getTool(name: string): RegisteredToolCapture | undefined;
}

export function createMockExtensionAPI(): MockExtensionAPIResult {
  const registeredTools: RegisteredToolCapture[] = [];
  const eventHandlers = new Map<string, Function[]>();

  const api = {
    on(event: string, handler: Function) {
      const handlers = eventHandlers.get(event) ?? [];
      handlers.push(handler);
      eventHandlers.set(event, handlers);
    },
    registerTool(tool: ToolDefinition) {
      registeredTools.push({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute.bind(tool),
      });
    },
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return undefined; },
    registerMessageRenderer() {},
    sendMessage() {},
    sendUserMessage() {},
    appendEntry() {},
  } as unknown as ExtensionAPI;

  return {
    api,
    registeredTools,
    eventHandlers,
    getTool(name: string) {
      return registeredTools.find((t) => t.name === name);
    },
  };
}

/**
 * Minimal mock ExtensionContext for tool execute() calls.
 */
export function createMockExtensionContext(
  overrides: Partial<ExtensionContext> = {}
): ExtensionContext {
  return {
    ui: {
      confirm: async () => true,
      select: async () => undefined,
      input: async () => undefined,
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
      custom: async () => undefined,
      theme: {} as never,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: true }),
      setHeader: () => {},
    },
    hasUI: false,
    cwd: "/tmp/pi-subagents-test",
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [],
      getLeafId: () => undefined,
      getSessionFile: () => undefined,
    },
    modelRegistry: {
      find: () => undefined,
    } as never,
    model: undefined,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    ...overrides,
  } as unknown as ExtensionContext;
}
