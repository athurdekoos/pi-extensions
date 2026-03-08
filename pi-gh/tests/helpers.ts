import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface MockExecCall {
  command: string;
  args: string[];
}

interface MockExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

type ExecHandler = (command: string, args: string[], opts?: Record<string, unknown>) => MockExecResult;

export function createMockPi(execHandler: ExecHandler): ExtensionAPI & { execCalls: MockExecCall[] } {
  const execCalls: MockExecCall[] = [];

  const mockPi = {
    execCalls,
    exec: async (command: string, args: string[], opts?: Record<string, unknown>): Promise<MockExecResult> => {
      execCalls.push({ command, args });
      return execHandler(command, args, opts);
    },
    on: () => {},
    registerTool: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    setModel: async () => true,
    getThinkingLevel: () => "off" as const,
    setThinkingLevel: () => {},
    events: { on: () => {}, emit: () => {} },
    getFlag: () => undefined,
    registerProvider: () => {},
    unregisterProvider: () => {},
    getCommands: () => [],
  } as unknown as ExtensionAPI & { execCalls: MockExecCall[] };

  return mockPi;
}

export function createMockCtx(opts: { hasUI?: boolean; confirmResult?: boolean } = {}): ExtensionContext {
  return {
    hasUI: opts.hasUI ?? true,
    ui: {
      confirm: async () => opts.confirmResult ?? true,
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
    cwd: "/tmp/test",
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [],
      getLeafId: () => undefined,
      getSessionFile: () => undefined,
    },
    modelRegistry: {} as never,
    model: {} as never,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  } as unknown as ExtensionContext;
}
