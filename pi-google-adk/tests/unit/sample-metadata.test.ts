/**
 * Unit tests: metadata for imported samples.
 *
 * Behavior protected:
 * - buildSampleImportMetadata produces correct structure
 * - source_type is "official_sample"
 * - provenance.sample_import contains all provenance fields
 * - Native metadata builder still works (regression)
 * - Written metadata is valid JSON
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildCreationMetadata,
  buildSampleImportMetadata,
  writeCreationMetadata,
  CREATION_METADATA_FILENAME,
} from "../../src/lib/creation-metadata.js";
import type { SampleProvenance } from "../../src/lib/sample-import.js";
import { safeReadFile } from "../../src/lib/fs-safe.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import { mkdirSync } from "node:fs";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

describe("buildSampleImportMetadata", () => {
  const sampleProvenance: SampleProvenance = {
    upstream_repo: "https://github.com/google/adk-samples.git",
    upstream_path: "agents/hello-world",
    upstream_ref: "main",
    commit: "abc123def456",
    imported_at: "2025-01-15T10:00:00.000Z",
    sample_slug: "hello_world",
  };

  it("sets source_type to official_sample", () => {
    const meta = buildSampleImportMetadata({
      agentName: "my_sample",
      projectPath: "./agents/my_sample",
      importArgs: { mode: "official_sample", name: "my_sample", sample_slug: "hello_world" },
      sampleProvenance,
    });

    expect(meta.source_type).toBe("official_sample");
  });

  it("includes sample_import in provenance", () => {
    const meta = buildSampleImportMetadata({
      agentName: "my_sample",
      projectPath: "./agents/my_sample",
      importArgs: {},
      sampleProvenance,
    });

    expect(meta.provenance.sample_import).toBeDefined();
    expect(meta.provenance.sample_import!.upstream_repo).toBe(sampleProvenance.upstream_repo);
    expect(meta.provenance.sample_import!.upstream_path).toBe(sampleProvenance.upstream_path);
    expect(meta.provenance.sample_import!.upstream_ref).toBe("main");
    expect(meta.provenance.sample_import!.commit).toBe("abc123def456");
    expect(meta.provenance.sample_import!.sample_slug).toBe("hello_world");
    expect(meta.provenance.sample_import!.imported_at).toBe("2025-01-15T10:00:00.000Z");
  });

  it("sets schema_version", () => {
    const meta = buildSampleImportMetadata({
      agentName: "my_sample",
      projectPath: "./agents/my_sample",
      importArgs: {},
      sampleProvenance,
    });
    expect(meta.schema_version).toBe("1");
  });

  it("includes tracking placeholder", () => {
    const meta = buildSampleImportMetadata({
      agentName: "my_sample",
      projectPath: "./agents/my_sample",
      importArgs: {},
      sampleProvenance,
    });
    expect(meta.tracking).toBeDefined();
  });

  it("adk_cli fields are empty for sample imports", () => {
    const meta = buildSampleImportMetadata({
      agentName: "my_sample",
      projectPath: "./agents/my_sample",
      importArgs: {},
      sampleProvenance,
    });
    expect(meta.adk_cli.detected_version).toBeNull();
    expect(meta.adk_cli.command_used).toBe("");
  });
});

describe("writeCreationMetadata for sample import", () => {
  it("writes valid JSON to project directory", () => {
    const projectPath = "sample_project";
    mkdirSync(`${workDir}/${projectPath}`, { recursive: true });

    const meta = buildSampleImportMetadata({
      agentName: "sample_agent",
      projectPath: `./${projectPath}`,
      importArgs: { mode: "official_sample" },
      sampleProvenance: {
        upstream_repo: "https://github.com/google/adk-samples.git",
        upstream_path: "agents/hello-world",
        upstream_ref: "main",
        commit: "abc123",
        imported_at: new Date().toISOString(),
        sample_slug: "hello_world",
      },
    });

    writeCreationMetadata(workDir, projectPath, meta);

    const raw = safeReadFile(workDir, `${projectPath}/${CREATION_METADATA_FILENAME}`);
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw!);
    expect(parsed.source_type).toBe("official_sample");
    expect(parsed.provenance.sample_import.sample_slug).toBe("hello_world");
  });
});

describe("buildCreationMetadata (native — regression)", () => {
  it("still builds native_app metadata correctly", () => {
    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "test_agent",
      projectPath: "./agents/test_agent",
      adkVersion: "1.2.3",
      commandUsed: "adk create test_agent",
      supportedModes: ["native_app"],
      creationArgs: {},
    });

    expect(meta.source_type).toBe("native_app");
    expect(meta.provenance.sample_import).toBeUndefined();
    expect(meta.provenance.created_at).toBeTruthy();
  });

  it("still builds native_config metadata correctly", () => {
    const meta = buildCreationMetadata({
      sourceType: "native_config",
      agentName: "cfg_agent",
      projectPath: "./agents/cfg_agent",
      adkVersion: null,
      commandUsed: "adk create --type=config cfg_agent",
      supportedModes: [],
      creationArgs: {},
    });

    expect(meta.source_type).toBe("native_config");
  });
});
