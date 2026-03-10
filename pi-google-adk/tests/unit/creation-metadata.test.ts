/**
 * Unit tests: creation metadata.
 *
 * Behavior protected:
 * - buildCreationMetadata produces expected structure
 * - All required fields are present
 * - schema_version is set
 * - writeCreationMetadata writes to disk
 * - Metadata is valid JSON
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildCreationMetadata,
  writeCreationMetadata,
  CREATION_METADATA_FILENAME,
  type AdkCreationMetadata,
} from "../../src/lib/creation-metadata.js";
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

describe("buildCreationMetadata", () => {
  it("builds metadata with all required fields", () => {
    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "test_agent",
      projectPath: "./agents/test_agent",
      adkVersion: "1.2.3",
      commandUsed: "adk create test_agent",
      supportedModes: ["native_app", "native_config"],
      creationArgs: { mode: "native_app", name: "test_agent" },
    });

    expect(meta.schema_version).toBe("1");
    expect(meta.source_type).toBe("native_app");
    expect(meta.agent_name).toBe("test_agent");
    expect(meta.project_path).toBe("./agents/test_agent");
    expect(meta.adk_cli.detected_version).toBe("1.2.3");
    expect(meta.adk_cli.command_used).toBe("adk create test_agent");
    expect(meta.adk_cli.detected_supported_modes).toEqual(["native_app", "native_config"]);
    expect(meta.pi_google_adk.extension_version).toBeTruthy();
    expect(meta.provenance.created_at).toBeTruthy();
    expect(meta.provenance.creation_args).toEqual({ mode: "native_app", name: "test_agent" });
    expect(meta.tracking).toBeDefined();
  });

  it("handles null version", () => {
    const meta = buildCreationMetadata({
      sourceType: "native_config",
      agentName: "cfg_agent",
      projectPath: "./agents/cfg_agent",
      adkVersion: null,
      commandUsed: "adk create --type=config cfg_agent",
      supportedModes: ["native_app"],
      creationArgs: {},
    });

    expect(meta.adk_cli.detected_version).toBeNull();
    expect(meta.source_type).toBe("native_config");
  });
});

describe("writeCreationMetadata", () => {
  it("writes metadata file to project directory", () => {
    const projectPath = "test_project";
    mkdirSync(`${workDir}/${projectPath}`, { recursive: true });

    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "test_agent",
      projectPath: `./${projectPath}`,
      adkVersion: "1.0.0",
      commandUsed: "adk create test_agent",
      supportedModes: ["native_app"],
      creationArgs: {},
    });

    writeCreationMetadata(workDir, projectPath, meta);

    const raw = safeReadFile(workDir, `${projectPath}/${CREATION_METADATA_FILENAME}`);
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw!);
    expect(parsed.schema_version).toBe("1");
    expect(parsed.agent_name).toBe("test_agent");
    expect(parsed.source_type).toBe("native_app");
  });

  it("produces valid JSON", () => {
    const projectPath = "json_test";
    mkdirSync(`${workDir}/${projectPath}`, { recursive: true });

    const meta = buildCreationMetadata({
      sourceType: "native_app",
      agentName: "json_agent",
      projectPath: `./${projectPath}`,
      adkVersion: null,
      commandUsed: "adk create json_agent",
      supportedModes: [],
      creationArgs: { name: "json_agent", mode: "native_app" },
    });

    writeCreationMetadata(workDir, projectPath, meta);

    const raw = safeReadFile(workDir, `${projectPath}/${CREATION_METADATA_FILENAME}`);
    expect(() => JSON.parse(raw!)).not.toThrow();
  });
});
