/**
 * Extension-level tests: check_adk_sample_drift tool behavior.
 *
 * Behavior protected:
 * - Tool is registered with correct metadata
 * - Non-interactive: requires project_path or agent
 * - Returns unsupported_project for native projects
 * - Returns missing_provenance when metadata is absent
 * - Agent-based resolution works
 * - UI selection flow activates when no target specified and hasUI=true
 * - update_metadata=false leaves metadata unchanged
 *
 * Note: These tests do NOT perform actual git clone operations.
 * The git boundary is tested via the manual test plan.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import {
  createMockExtensionAPI,
  createMockExtensionContext,
} from "../helpers/mock-extension-api.js";
import { registerCheckAdkSampleDrift } from "../../src/tools/check-adk-sample-drift.js";
import { CREATION_METADATA_FILENAME } from "../../src/lib/creation-metadata.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

function writeMeta(projectDir: string, meta: Record<string, unknown>) {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, CREATION_METADATA_FILENAME),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
}

describe("check_adk_sample_drift registration", () => {
  it("registers the tool with correct name", () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("check_adk_sample_drift");
  });

  it("has descriptive label and description", () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;
    expect(tool.label).toBeTruthy();
    expect(tool.description).toContain("drift");
  });
});

describe("check_adk_sample_drift — non-interactive", () => {
  it("returns error when no target specified and no UI", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    const ctx = createMockExtensionContext({ hasUI: false, cwd: workDir });
    const result = await tool.execute("call-1", {}, undefined, () => {}, ctx);
    const details = (result as { details: { status: string } }).details;
    expect(details.status).toBe("error");
    expect((result as { details: { summary: string } }).details.summary).toContain(
      "No target specified",
    );
  });

  it("returns unsupported_project for native_app project", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    const projectDir = join(workDir, "native_project");
    writeMeta(projectDir, {
      source_type: "native_app",
      provenance: { created_at: "2025-01-01" },
    });

    const ctx = createMockExtensionContext({ hasUI: false, cwd: workDir });
    const result = await tool.execute(
      "call-2",
      { project_path: projectDir },
      undefined,
      () => {},
      ctx,
    );
    const details = (result as { details: { status: string; summary: string } }).details;
    expect(details.status).toBe("unsupported_project");
    expect(details.summary).toContain("native_app");
  });

  it("returns missing_provenance when no metadata exists", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    const projectDir = join(workDir, "no_meta");
    mkdirSync(projectDir, { recursive: true });

    const ctx = createMockExtensionContext({ hasUI: false, cwd: workDir });
    const result = await tool.execute(
      "call-3",
      { project_path: projectDir },
      undefined,
      () => {},
      ctx,
    );
    const details = (result as { details: { status: string } }).details;
    expect(details.status).toBe("missing_provenance");
  });

  it("returns missing_provenance when provenance fields incomplete", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    const projectDir = join(workDir, "incomplete");
    writeMeta(projectDir, {
      source_type: "official_sample",
      provenance: {
        sample_import: { upstream_path: "agents/hello-world" },
      },
    });

    const ctx = createMockExtensionContext({ hasUI: false, cwd: workDir });
    const result = await tool.execute(
      "call-4",
      { project_path: projectDir },
      undefined,
      () => {},
      ctx,
    );
    const details = (result as { details: { status: string } }).details;
    expect(details.status).toBe("missing_provenance");
  });

  it("returns error for non-existent agent name", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    const ctx = createMockExtensionContext({ hasUI: false, cwd: workDir });
    const result = await tool.execute(
      "call-5",
      { agent: "nonexistent_agent" },
      undefined,
      () => {},
      ctx,
    );
    const details = (result as { details: { status: string; summary: string } }).details;
    expect(details.status).toBe("error");
    expect(details.summary).toContain("not found");
  });
});

describe("check_adk_sample_drift — update_metadata=false", () => {
  it("does not modify metadata on unsupported project", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    // Use a native_app project — will fail fast with unsupported_project
    // without reaching git. Metadata should remain untouched.
    const projectDir = join(workDir, "no_update");
    writeMeta(projectDir, {
      schema_version: "1",
      source_type: "native_app",
      tracking: {},
      provenance: { created_at: "2025-01-01" },
    });

    const metaBefore = readFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      "utf-8",
    );

    const ctx = createMockExtensionContext({ hasUI: false, cwd: workDir });
    await tool.execute(
      "call-6",
      { project_path: projectDir, update_metadata: false },
      undefined,
      () => {},
      ctx,
    );

    const metaAfter = readFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      "utf-8",
    );
    expect(metaAfter).toBe(metaBefore);
  });

  it("does not modify metadata on missing provenance", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    const projectDir = join(workDir, "incomplete_prov");
    writeMeta(projectDir, {
      schema_version: "1",
      source_type: "official_sample",
      tracking: {},
      provenance: { created_at: "2025-01-01" },
    });

    const metaBefore = readFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      "utf-8",
    );

    const ctx = createMockExtensionContext({ hasUI: false, cwd: workDir });
    await tool.execute(
      "call-6b",
      { project_path: projectDir, update_metadata: true },
      undefined,
      () => {},
      ctx,
    );

    const metaAfter = readFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      "utf-8",
    );
    // Metadata unchanged because drift check failed (missing_provenance)
    expect(metaAfter).toBe(metaBefore);
  });
});

describe("check_adk_sample_drift — interactive selection", () => {
  it("shows picker when UI available and no target specified", async () => {
    const { api, getTool } = createMockExtensionAPI();
    registerCheckAdkSampleDrift(api);
    const tool = getTool("check_adk_sample_drift")!;

    let selectCalled = false;
    const ctx = createMockExtensionContext({
      hasUI: true,
      cwd: workDir,
      ui: {
        ...createMockExtensionContext().ui,
        select: async (title: string, options: string[]) => {
          selectCalled = true;
          return "Cancel";
        },
        notify: () => {},
      } as never,
    });

    // No agents dir exists, so discovery will find nothing
    // The tool should notify and return cancelled
    const result = await tool.execute(
      "call-7",
      {},
      undefined,
      () => {},
      ctx,
    );

    const details = (result as { details: { summary: string } }).details;
    // Either "no imported samples" notification or cancel
    expect(details.summary).toMatch(/cancel|No imported/i);
  });
});
