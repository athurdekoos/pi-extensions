/**
 * Interactive creation/import wizard for create_adk_agent.
 *
 * Uses a pi-clear-like interaction style when UI is available:
 * - short select flows
 * - confirms
 * - clean cancellation
 *
 * When UI is unavailable, the wizard is not used — the caller must
 * provide explicit parameters and the tool fails clearly on missing input.
 */

import type { ExtensionContext, ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import {
  SAMPLE_CATALOG,
  recommendSamples,
  type CatalogEntry,
  type RecommendationAnswers,
} from "./sample-catalog.js";
import {
  type ToolPlan,
  type AdkNativeToolCategory,
  type PiMonoProfile,
  ADK_NATIVE_TOOL_CATEGORIES,
  PI_MONO_PROFILE_TOOLS,
  buildToolPlan,
  emptyToolPlan,
} from "./tool-plan.js";
import { detectExtensionTools } from "./tool-detect.js";
import { buildToolAccessSummary } from "./tool-summary.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardChoice =
  | { kind: "native_app"; name: string; path: string; model: string; tool_plan?: ToolPlan }
  | { kind: "native_config"; name: string; path: string; model: string; tool_plan?: ToolPlan }
  | { kind: "official_sample"; name: string; path: string; sample_slug: string; tool_plan?: ToolPlan }
  | { kind: "cancel" };

// ---------------------------------------------------------------------------
// Top-level wizard
// ---------------------------------------------------------------------------

/**
 * Run the interactive creation wizard.
 * Returns the user's choice or cancel.
 *
 * Requires ctx.hasUI === true. Caller must check before invoking.
 */
export async function runCreationWizard(
  ui: ExtensionUIContext
): Promise<WizardChoice> {
  // Step 1: Mode selection
  const modeOptions = [
    "Native ADK app",
    "Native ADK config app",
    "Import official ADK sample",
    "Cancel",
  ];

  const modeChoice = await ui.select(
    "Create ADK Agent — choose a mode",
    modeOptions
  );

  if (!modeChoice || modeChoice === "Cancel") {
    return { kind: "cancel" };
  }

  // Step 2: Collect basics based on mode
  if (modeChoice === "Native ADK app" || modeChoice === "Native ADK config app") {
    return collectNativeBasics(
      ui,
      modeChoice === "Native ADK app" ? "native_app" : "native_config"
    );
  }

  if (modeChoice === "Import official ADK sample") {
    return collectSampleImport(ui);
  }

  return { kind: "cancel" };
}

// ---------------------------------------------------------------------------
// Native creation basics
// ---------------------------------------------------------------------------

async function collectNativeBasics(
  ui: ExtensionUIContext,
  kind: "native_app" | "native_config"
): Promise<WizardChoice> {
  const name = await ui.input("Agent name", "my_agent");
  if (!name) return { kind: "cancel" };

  const defaultPath = `./agents/${name}`;
  const pathInput = await ui.input("Destination path", defaultPath);
  const path = pathInput || defaultPath;

  const model = await ui.input("Gemini model", "gemini-2.5-flash");

  const confirmed = await ui.confirm(
    "Create agent?",
    `Mode: ${kind}\nName: ${name}\nPath: ${path}\nModel: ${model || "gemini-2.5-flash"}`
  );

  if (!confirmed) return { kind: "cancel" };

  // Tool planning (optional)
  const toolPlan = await runToolPlanningWizard(ui);

  return { kind, name, path, model: model || "gemini-2.5-flash", tool_plan: toolPlan };
}

// ---------------------------------------------------------------------------
// Sample import flow
// ---------------------------------------------------------------------------

async function collectSampleImport(
  ui: ExtensionUIContext
): Promise<WizardChoice> {
  // Step 1: Recommendation questions
  const intentOptions = [
    "Research assistant",
    "Customer support",
    "Content generation",
    "Coding / debugging",
    "Multimodal / demo",
    "Other / not sure",
  ];

  const intentChoice = await ui.select(
    "What are you trying to build?",
    intentOptions
  );
  if (!intentChoice) return { kind: "cancel" };

  const complexityOptions = [
    "Simple starter",
    "More advanced / workflow",
    "Safest beginner option",
  ];

  const complexityChoice = await ui.select(
    "How complex should it be?",
    complexityOptions
  );
  if (!complexityChoice) return { kind: "cancel" };

  const integrationOptions = [
    "Mostly built-in ADK patterns",
    "External APIs / MCP",
    "Not sure",
  ];

  const integrationChoice = await ui.select(
    "What kinds of integrations do you expect?",
    integrationOptions
  );
  if (!integrationChoice) return { kind: "cancel" };

  // Map user-facing strings to recommendation answers
  const answers: RecommendationAnswers = {
    intent: mapIntent(intentChoice),
    complexity: mapComplexity(complexityChoice),
    integrations: mapIntegrations(integrationChoice),
  };

  // Step 2: Get recommendations
  const recommendations = recommendSamples(answers, 5);

  if (recommendations.length === 0) {
    // Fallback: show entire catalog
    return selectFromCatalog(ui, [...SAMPLE_CATALOG]);
  }

  // Step 3: Present recommendations
  const sampleOptions = recommendations.map(
    (r) => `${r.display_name} — ${r.short_description}`
  );
  sampleOptions.push("Show all samples");
  sampleOptions.push("Cancel");

  const sampleChoice = await ui.select(
    "Recommended samples",
    sampleOptions
  );

  if (!sampleChoice || sampleChoice === "Cancel") return { kind: "cancel" };

  if (sampleChoice === "Show all samples") {
    return selectFromCatalog(ui, [...SAMPLE_CATALOG]);
  }

  // Find which entry was selected
  const selectedIdx = sampleOptions.indexOf(sampleChoice);
  const selectedEntry = recommendations[selectedIdx];
  if (!selectedEntry) return { kind: "cancel" };

  return finalizeSampleImport(ui, selectedEntry);
}

async function selectFromCatalog(
  ui: ExtensionUIContext,
  entries: CatalogEntry[]
): Promise<WizardChoice> {
  const options = entries.map(
    (e) => `${e.display_name} — ${e.short_description}`
  );
  options.push("Cancel");

  const choice = await ui.select("All available samples", options);
  if (!choice || choice === "Cancel") return { kind: "cancel" };

  const idx = options.indexOf(choice);
  const entry = entries[idx];
  if (!entry) return { kind: "cancel" };

  return finalizeSampleImport(ui, entry);
}

async function finalizeSampleImport(
  ui: ExtensionUIContext,
  entry: CatalogEntry
): Promise<WizardChoice> {
  const name = await ui.input("Agent name for imported sample", entry.slug);
  if (!name) return { kind: "cancel" };

  const defaultPath = `./agents/${name}`;
  const pathInput = await ui.input("Destination path", defaultPath);
  const path = pathInput || defaultPath;

  const confirmed = await ui.confirm(
    "Import sample?",
    `Sample: ${entry.display_name}\n` +
    `Slug: ${entry.slug}\n` +
    `From: ${entry.upstream_path}\n` +
    `Name: ${name}\n` +
    `Path: ${path}\n\n` +
    `${entry.why_pick_this}`
  );

  if (!confirmed) return { kind: "cancel" };

  // Tool planning (optional)
  const toolPlan = await runToolPlanningWizard(ui);

  return {
    kind: "official_sample",
    name,
    path,
    sample_slug: entry.slug,
    tool_plan: toolPlan,
  };
}

// ---------------------------------------------------------------------------
// Tool planning wizard
// ---------------------------------------------------------------------------

/**
 * Run the optional tool-planning wizard.
 * Returns a ToolPlan if the user opts in, or undefined if skipped.
 */
export async function runToolPlanningWizard(
  ui: ExtensionUIContext
): Promise<ToolPlan | undefined> {
  const configure = await ui.confirm(
    "Configure tool access?",
    "Plan which tools this agent/subagent will have access to.\nYou can skip this and configure later."
  );

  if (!configure) return undefined;

  // Step 1: ADK-native tools
  const adkNativeTools = await collectAdkNativeTools(ui);
  if (adkNativeTools === null) return undefined; // cancel

  // Step 2: Pi Mono profile
  const piProfile = await collectPiMonoProfile(ui);
  if (piProfile === null) return undefined;

  // Step 3: Extension tools
  const extensionSelection = await collectExtensionTools(ui);
  if (extensionSelection === null) return undefined;

  // Build the plan
  const plan = buildToolPlan({
    adkNativeTools: adkNativeTools.categories,
    adkNativeNotes: adkNativeTools.notes,
    piMonoProfile: piProfile,
    extensionToolsDetected: extensionSelection.detected,
    extensionToolsSelected: extensionSelection.selected,
  });

  // Step 4: Show summary and confirm
  const summary = buildToolAccessSummary(plan);
  const accepted = await ui.confirm("Tool access plan", summary);

  if (!accepted) return undefined;

  return plan;
}

async function collectAdkNativeTools(
  ui: ExtensionUIContext
): Promise<{ categories: AdkNativeToolCategory[]; notes?: string } | null> {
  const options = [
    "No extra ADK-native tools",
    "MCP toolset",
    "OpenAPI / API toolset",
    "Local custom function tools",
    "Other (note only)",
    "Cancel",
  ];

  const choice = await ui.select(
    "ADK-native tools — what does this project use?",
    options
  );

  if (!choice || choice === "Cancel") return null;

  const categoryMap: Record<string, AdkNativeToolCategory> = {
    "No extra ADK-native tools": "none",
    "MCP toolset": "mcp_toolset",
    "OpenAPI / API toolset": "openapi_toolset",
    "Local custom function tools": "custom_function_tools",
    "Other (note only)": "other",
  };

  const category = categoryMap[choice] ?? "none";
  let notes: string | undefined;

  if (category === "other" || category === "mcp_toolset" || category === "openapi_toolset") {
    notes = (await ui.input("Brief note about the tools", "")) || undefined;
  }

  return { categories: [category], notes };
}

async function collectPiMonoProfile(
  ui: ExtensionUIContext
): Promise<PiMonoProfile | null> {
  const readOnlyTools = PI_MONO_PROFILE_TOOLS.read_only.join(", ");
  const codingTools = PI_MONO_PROFILE_TOOLS.coding.join(", ");

  const options = [
    `Read-only (${readOnlyTools})`,
    `Coding (${codingTools})`,
    "No preference / not sure",
    "Cancel",
  ];

  const choice = await ui.select(
    "Pi Mono built-in session profile",
    options
  );

  if (!choice || choice === "Cancel") return null;

  if (choice.startsWith("Read-only")) return "read_only";
  if (choice.startsWith("Coding")) return "coding";
  return "unknown";
}

async function collectExtensionTools(
  ui: ExtensionUIContext
): Promise<{ detected: string[]; selected: string[] } | null> {
  const detection = detectExtensionTools();

  if (!detection.detected || detection.tools.length === 0) {
    const msg = !detection.detected
      ? `Extension tool detection is not available: ${detection.error ?? "unknown reason"}`
      : "No additional extension tools detected in the current environment.";

    ui.notify(msg, "info");
    return { detected: [], selected: [] };
  }

  // Show detected tools and let the user select relevant ones
  const options = [
    ...detection.tools,
    "None of these",
    "Cancel",
  ];

  const choice = await ui.select(
    `Detected extension tools (${detection.tools.length}) — select relevant ones`,
    options
  );

  if (!choice || choice === "Cancel") return null;
  if (choice === "None of these") {
    return { detected: detection.tools, selected: [] };
  }

  // Single selection for simplicity (UI select returns one item)
  return { detected: detection.tools, selected: [choice] };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapIntent(choice: string): RecommendationAnswers["intent"] {
  if (choice.startsWith("Research")) return "research_assistant";
  if (choice.startsWith("Customer")) return "customer_support";
  if (choice.startsWith("Content")) return "content_generation";
  if (choice.startsWith("Coding")) return "coding";
  if (choice.startsWith("Multimodal")) return "multimodal";
  return "other";
}

function mapComplexity(choice: string): RecommendationAnswers["complexity"] {
  if (choice.startsWith("Simple")) return "simple";
  if (choice.startsWith("More")) return "advanced";
  return "beginner";
}

function mapIntegrations(choice: string): RecommendationAnswers["integrations"] {
  if (choice.startsWith("Mostly")) return "builtin";
  if (choice.startsWith("External")) return "external";
  return "unsure";
}
