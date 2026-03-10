/**
 * Unit tests: scaffold-manifest.
 *
 * Behavior protected:
 * - Manifest creation with correct defaults
 * - Serialization round-trips cleanly
 * - readManifest returns null for missing/malformed files
 * - addCapabilityToManifest is idempotent
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createManifest,
  serializeManifest,
  readManifest,
  addCapabilityToManifest,
  MANIFEST_FILENAME,
} from "../../src/lib/scaffold-manifest.js";
import { safeWriteFile } from "../../src/lib/fs-safe.js";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

describe("createManifest", () => {
  it("produces manifest with correct fields", () => {
    const m = createManifest("my_agent", "basic", "gemini-2.5-flash");
    expect(m.name).toBe("my_agent");
    expect(m.template).toBe("basic");
    expect(m.model).toBe("gemini-2.5-flash");
    expect(m.extension).toBe("pi-google-adk");
    expect(m.extension_version).toBe("0.1.0");
    expect(m.capabilities).toEqual([]);
  });
});

describe("serializeManifest / readManifest round-trip", () => {
  it("round-trips through JSON", () => {
    const m = createManifest("test_agent", "mcp", "gemini-2.5-pro");
    const serialized = serializeManifest(m);
    // Write and read back
    safeWriteFile(workDir, MANIFEST_FILENAME, serialized, false);
    const read = readManifest(workDir);
    expect(read).not.toBeNull();
    expect(read!.name).toBe("test_agent");
    expect(read!.template).toBe("mcp");
    expect(read!.model).toBe("gemini-2.5-pro");
  });
});

describe("readManifest", () => {
  it("returns null for missing file", () => {
    expect(readManifest(workDir)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    safeWriteFile(workDir, MANIFEST_FILENAME, "not json{{{", true);
    expect(readManifest(workDir)).toBeNull();
  });
});

describe("addCapabilityToManifest", () => {
  it("adds a capability", () => {
    const m = createManifest("a", "basic", "gemini-2.5-flash");
    safeWriteFile(workDir, `proj/${MANIFEST_FILENAME}`, serializeManifest(m), false);

    addCapabilityToManifest(workDir, "proj", "custom_tool");
    const read = readManifest(`${workDir}/proj`);
    expect(read!.capabilities).toEqual(["custom_tool"]);
  });

  it("is idempotent — no duplicate on second add", () => {
    const m = createManifest("a", "basic", "gemini-2.5-flash");
    safeWriteFile(workDir, `proj/${MANIFEST_FILENAME}`, serializeManifest(m), false);

    addCapabilityToManifest(workDir, "proj", "custom_tool");
    addCapabilityToManifest(workDir, "proj", "custom_tool");
    const read = readManifest(`${workDir}/proj`);
    expect(read!.capabilities).toEqual(["custom_tool"]);
  });

  it("adds multiple distinct capabilities", () => {
    const m = createManifest("a", "basic", "gemini-2.5-flash");
    safeWriteFile(workDir, `proj/${MANIFEST_FILENAME}`, serializeManifest(m), false);

    addCapabilityToManifest(workDir, "proj", "custom_tool");
    addCapabilityToManifest(workDir, "proj", "eval_stub");
    const read = readManifest(`${workDir}/proj`);
    expect(read!.capabilities).toEqual(["custom_tool", "eval_stub"]);
  });

  it("no-ops when manifest file is missing", () => {
    // Should not throw
    addCapabilityToManifest(workDir, "nonexistent", "custom_tool");
  });
});
