/**
 * Unit tests: creation wizard.
 *
 * Behavior protected:
 * - Wizard cancel exits cleanly
 * - Native app selection returns correct kind
 * - Native config selection returns correct kind
 * - Official sample selection returns correct kind with slug
 * - Missing name results in cancel
 *
 * These tests use a mock UI context.
 */

import { describe, it, expect } from "vitest";
import { runCreationWizard, type WizardChoice } from "../../src/lib/wizard.js";
import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Mock UI builder
// ---------------------------------------------------------------------------

interface MockUICallbacks {
  selectResponses: (string | undefined)[];
  inputResponses: (string | undefined)[];
  confirmResponses: boolean[];
}

function buildMockUI(callbacks: MockUICallbacks): ExtensionUIContext {
  let selectIdx = 0;
  let inputIdx = 0;
  let confirmIdx = 0;

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
    custom: async () => undefined,
    theme: {} as never,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: true }),
    setHeader: () => {},
  } as unknown as ExtensionUIContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCreationWizard", () => {
  it("cancel exits cleanly", async () => {
    const ui = buildMockUI({
      selectResponses: ["Cancel"],
      inputResponses: [],
      confirmResponses: [],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("cancel");
  });

  it("undefined select exits cleanly", async () => {
    const ui = buildMockUI({
      selectResponses: [undefined],
      inputResponses: [],
      confirmResponses: [],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("cancel");
  });

  it("native_app selection collects name, path, model", async () => {
    const ui = buildMockUI({
      selectResponses: ["Native ADK app"],
      inputResponses: ["my_agent", "./agents/my_agent", "gemini-2.5-flash"],
      confirmResponses: [true],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("native_app");
    if (choice.kind === "native_app") {
      expect(choice.name).toBe("my_agent");
      expect(choice.path).toBe("./agents/my_agent");
      expect(choice.model).toBe("gemini-2.5-flash");
    }
  });

  it("native_config selection returns correct kind", async () => {
    const ui = buildMockUI({
      selectResponses: ["Native ADK config app"],
      inputResponses: ["config_bot", "", ""],
      confirmResponses: [true],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("native_config");
    if (choice.kind === "native_config") {
      expect(choice.name).toBe("config_bot");
    }
  });

  it("native creation cancelled at confirm", async () => {
    const ui = buildMockUI({
      selectResponses: ["Native ADK app"],
      inputResponses: ["my_agent", "", ""],
      confirmResponses: [false],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("cancel");
  });

  it("native creation cancelled at name input", async () => {
    const ui = buildMockUI({
      selectResponses: ["Native ADK app"],
      inputResponses: [undefined],
      confirmResponses: [],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("cancel");
  });

  it("official_sample selection goes through recommendation flow", async () => {
    const ui = buildMockUI({
      selectResponses: [
        "Import official ADK sample",      // mode
        "Research assistant",               // intent
        "Simple starter",                   // complexity
        "Mostly built-in ADK patterns",     // integrations
        // The first recommended sample option text
        "Brand Search Agent — Searches for brand-related information using Google Search tools.",
      ],
      inputResponses: [
        "my_research",                      // name
        "./agents/my_research",             // path
      ],
      confirmResponses: [true],             // confirm import
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("official_sample");
    if (choice.kind === "official_sample") {
      expect(choice.name).toBe("my_research");
      expect(choice.sample_slug).toBe("brand_search_agent");
    }
  });

  it("official_sample cancelled at intent selection", async () => {
    const ui = buildMockUI({
      selectResponses: [
        "Import official ADK sample",
        undefined,  // cancel at intent
      ],
      inputResponses: [],
      confirmResponses: [],
    });

    const choice = await runCreationWizard(ui);
    expect(choice.kind).toBe("cancel");
  });
});
