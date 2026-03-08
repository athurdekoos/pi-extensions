import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ClearMode = "drop" | "keep";

function parseArgs(args: string) {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((a) => a.toLowerCase());

  const flags = new Set(tokens);

  const mode: ClearMode =
    flags.has("keep") || flags.has("--keep") || flags.has("-k") ? "keep" : "drop";

  return {
    mode,
    skipConfirm: flags.has("--yes") || flags.has("-y"),
    openEditor: flags.has("--edit"),
  };
}

export default function clearExtension(pi: ExtensionAPI) {
  pi.registerCommand("clear", {
    description:
      "Start a fresh session. Use `/clear keep` to carry over current editor text.",

    handler: async (args, ctx) => {
      const { mode, skipConfirm, openEditor } = parseArgs(args);

      const existingEditorText = mode === "keep" ? ctx.ui.getEditorText() : "";
      const hasEditorText = existingEditorText.trim().length > 0;
      const carryText = mode === "keep" && hasEditorText;

      const title = carryText ? "Clear context and keep draft?" : "Clear context?";
      const message = carryText
        ? "This will start a new session with empty conversation history and carry your current editor text into the new session."
        : "This will start a new session with empty conversation history.";

      if (!skipConfirm) {
        const confirmed = await ctx.ui.confirm(title, message);
        if (!confirmed) {
          ctx.ui.notify("Clear cancelled.", "info");
          return;
        }
      }

      if (!ctx.isIdle()) {
        const stopStreaming = skipConfirm
          ? true
          : await ctx.ui.confirm(
            "Agent is still running",
            "Stop the current response and clear context now?"
          );

        if (!stopStreaming) {
          ctx.ui.notify("Clear cancelled because the agent is still running.", "info");
          return;
        }

        ctx.abort();
        await ctx.waitForIdle();
      }

      const result = await ctx.newSession();
      if (result.cancelled) {
        ctx.ui.notify("New session creation cancelled.", "warning");
        return;
      }

      if (carryText) {
        if (openEditor) {
          const edited = await ctx.ui.editor(
            "Draft to carry into new session",
            existingEditorText
          );
          ctx.ui.setEditorText(edited ?? existingEditorText);
        } else {
          ctx.ui.setEditorText(existingEditorText);
        }

        ctx.ui.notify("Started a fresh session and carried over your draft.", "info");
      } else {
        ctx.ui.notify("Started a fresh session.", "info");
      }
    },
  });
}
