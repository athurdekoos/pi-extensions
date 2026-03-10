/**
 * Smoke tests: extension discovery and loading via the real pi loader.
 *
 * IMPORTANT: These tests do NOT directly import the extension source module.
 * The extension is discovered and loaded exclusively through the real pi
 * extension loader APIs (discoverAndLoadExtensions).
 *
 * This proves that pi can actually find and load pi-subagents through its
 * real discovery/loading path, not just that the extension code works when
 * imported directly.
 *
 * Forbidden in this file:
 *   - import ... from "../../index.js"
 *   - import ... from "../../index"
 *   - import ... from "../.."
 *   - any helper that secretly imports the extension and bypasses discovery
 *
 * The extension identifier appears only as a filesystem path target for
 * the loader, never as a TypeScript import.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  discoverAndLoadExtensions,
  type Extension,
} from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Type for the loader result (inferred from discoverAndLoadExtensions)
// ---------------------------------------------------------------------------

type LoadResult = Awaited<ReturnType<typeof discoverAndLoadExtensions>>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Absolute path to the pi-subagents package root.
 * Used as a discovery target for the loader, NOT as a TypeScript import.
 */
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * The extension entry point as declared in package.json pi.extensions.
 * Resolved from the package root, never imported directly.
 */
const DECLARED_ENTRY = path.resolve(PACKAGE_ROOT, "./index.ts");

/** Tool name registered by the extension. */
const TOOL_NAME = "delegate_to_subagent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all tool names from a loaded extension set. */
function getToolNames(result: LoadResult): string[] {
  const names: string[] = [];
  for (const ext of result.extensions) {
    for (const [name] of ext.tools) {
      names.push(name);
    }
  }
  return names;
}

/** Find the extension that registered a specific tool. */
function findExtensionWithTool(
  result: LoadResult,
  toolName: string
): Extension | undefined {
  return result.extensions.find((ext) => ext.tools.has(toolName));
}

/** Create a temporary directory that is cleaned up after use. */
function withTmpDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-smoke-"));
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

// ---------------------------------------------------------------------------
// Guard: verify no direct import of the extension module
// ---------------------------------------------------------------------------

/**
 * Verify that the test module itself does not import the extension source.
 * This is a structural safeguard against accidental bypass.
 */
function assertNoDirectImportInThisFile() {
  const thisFile = fs.readFileSync(
    path.resolve(import.meta.dirname, "extension-discovery.test.ts"),
    "utf-8"
  );
  // Strip comment lines before checking for direct imports,
  // so the guard does not trigger on documentation.
  const lines = thisFile.split("\n");
  const codeLines = lines.filter(
    (line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")
  );
  const codeOnly = codeLines.join("\n");

  const directImportPatterns = [
    /^\s*import\b.*from\s+["']\.\.\/\.\.\/index/m,
    /^\s*import\b.*from\s+["']\.\.\/\.\.['"]/m,
    /^\s*import\b.*from\s+["']\.\.\/\.\.\/src/m,
    /import\s*\(["']\.\.\/\.\.\/index/,
    /require\s*\(["']\.\.\/\.\.\/index/,
  ];
  for (const pattern of directImportPatterns) {
    if (pattern.test(codeOnly)) {
      throw new Error(
        `Smoke test file contains a direct import of the extension source. ` +
          `This defeats the purpose of discovery testing. Pattern: ${pattern}`
      );
    }
  }
}

// Run the guard once at module level so it fails immediately if violated.
assertNoDirectImportInThisFile();

// ---------------------------------------------------------------------------
// Scenario 1: Source-path discovery
// ---------------------------------------------------------------------------

describe("Scenario 1: source-path discovery", () => {
  it("discovers pi-subagents when package root is provided as a configured path", async () => {
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );

    expect(result.errors).toHaveLength(0);
    expect(result.extensions.length).toBeGreaterThanOrEqual(1);

    const toolNames = getToolNames(result);
    expect(toolNames).toContain(TOOL_NAME);
  });

  it("resolves the entry point from package.json pi.extensions", async () => {
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );

    const ext = findExtensionWithTool(result, TOOL_NAME);
    expect(ext).toBeDefined();

    // The resolved path should point to the declared entry
    expect(ext!.resolvedPath).toBe(DECLARED_ENTRY);
  });

  it(
    "discovers via .pi/extensions directory placement",
    withTmpDir(async (tmpDir) => {
      // Simulate the standard discovery path: cwd/.pi/extensions/<ext-dir>
      const piExtDir = path.join(tmpDir, ".pi", "extensions", "pi-subagents");
      fs.mkdirSync(path.dirname(piExtDir), { recursive: true });
      fs.symlinkSync(PACKAGE_ROOT, piExtDir, "dir");

      // discoverAndLoadExtensions with no configuredPaths;
      // it should find the extension via cwd/.pi/extensions/
      const result = await discoverAndLoadExtensions([], tmpDir);

      expect(result.errors).toHaveLength(0);
      const toolNames = getToolNames(result);
      expect(toolNames).toContain(TOOL_NAME);
    })
  );
});

// ---------------------------------------------------------------------------
// Scenario 2: Negative discovery
// ---------------------------------------------------------------------------

describe("Scenario 2: negative discovery", () => {
  it(
    "does not find delegate_to_subagent when no extension paths are provided",
    withTmpDir(async (tmpDir) => {
      const result = await discoverAndLoadExtensions([], tmpDir);
      const toolNames = getToolNames(result);
      expect(toolNames).not.toContain(TOOL_NAME);
    })
  );

  it(
    "does not find delegate_to_subagent when pointing at a directory without the extension",
    withTmpDir(async (tmpDir) => {
      const emptyExtDir = path.join(tmpDir, ".pi", "extensions");
      fs.mkdirSync(emptyExtDir, { recursive: true });

      const result = await discoverAndLoadExtensions([], tmpDir);
      const toolNames = getToolNames(result);
      expect(toolNames).not.toContain(TOOL_NAME);
    })
  );

  it("produces errors when pointed at a nonexistent extension file", async () => {
    const fakePath = path.join(os.tmpdir(), "nonexistent-extension-abc123.ts");
    // Pass the fake path as a configured path
    const result = await discoverAndLoadExtensions(
      [fakePath],
      os.tmpdir()
    );

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const toolNames = getToolNames(result);
    expect(toolNames).not.toContain(TOOL_NAME);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Package/linked-package discovery
// ---------------------------------------------------------------------------

describe("Scenario 3: package resolution via pi.extensions manifest", () => {
  /**
   * This scenario verifies loading mode: "pi manifest resolution".
   *
   * The loader reads package.json, extracts pi.extensions entries,
   * resolves them relative to the package root, and loads the extension.
   * This is the same path used by:
   *   - `pi -e ./path-to-package/`
   *   - symlinked packages in .pi/extensions/
   *   - installed pi-packages
   */

  it("loads the extension via the declared pi.extensions entry in package.json", async () => {
    // Verify the manifest exists and declares the extension
    const pkgJsonPath = path.join(PACKAGE_ROOT, "package.json");
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    expect(pkgJson.pi?.extensions).toBeDefined();
    expect(pkgJson.pi.extensions).toContain("./index.ts");

    // Load through the real loader using the package root as configured path.
    // discoverAndLoadExtensions resolves a directory configuredPath by
    // checking for package.json with pi manifest first.
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );

    expect(result.errors).toHaveLength(0);
    expect(result.extensions.length).toBeGreaterThanOrEqual(1);

    const toolNames = getToolNames(result);
    expect(toolNames).toContain(TOOL_NAME);
  });

  it(
    "symlinked package is discoverable",
    withTmpDir(async (tmpDir) => {
      const linkTarget = path.join(
        tmpDir,
        ".pi",
        "extensions",
        "pi-subagents"
      );
      fs.mkdirSync(path.dirname(linkTarget), { recursive: true });
      fs.symlinkSync(PACKAGE_ROOT, linkTarget, "dir");

      const result = await discoverAndLoadExtensions([], tmpDir);

      expect(result.errors).toHaveLength(0);
      const toolNames = getToolNames(result);
      expect(toolNames).toContain(TOOL_NAME);

      // Verify the loaded extension came from the linked path
      const ext = findExtensionWithTool(result, TOOL_NAME);
      expect(ext).toBeDefined();
    })
  );

  it(
    "pi.extensions array with missing entry does not produce the tool",
    withTmpDir(async (tmpDir) => {
      // Create a package.json with a nonexistent extension entry
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "fake-package",
          pi: { extensions: ["./does-not-exist.ts"] },
        })
      );

      const result = await discoverAndLoadExtensions([tmpDir], tmpDir);

      const toolNames = getToolNames(result);
      expect(toolNames).not.toContain(TOOL_NAME);
    })
  );
});

// ---------------------------------------------------------------------------
// Scenario 4: End-to-end loader-to-tool availability
// ---------------------------------------------------------------------------

describe("Scenario 4: loader-to-tool availability", () => {
  it("loaded tool has correct metadata", async () => {
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );
    expect(result.errors).toHaveLength(0);

    const ext = findExtensionWithTool(result, TOOL_NAME);
    expect(ext).toBeDefined();

    const registeredTool = ext!.tools.get(TOOL_NAME);
    expect(registeredTool).toBeDefined();

    const def = registeredTool!.definition;

    // Verify tool definition shape
    expect(def.name).toBe(TOOL_NAME);
    expect(typeof def.description).toBe("string");
    expect(def.description.length).toBeGreaterThan(10);
    expect(def.parameters).toBeDefined();
    expect(typeof def.execute).toBe("function");
  });

  it("tool parameter schema includes required 'task' field", async () => {
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );
    const ext = findExtensionWithTool(result, TOOL_NAME);
    const def = ext!.tools.get(TOOL_NAME)!.definition;

    const schema = def.parameters;
    expect(schema).toBeDefined();
    expect(schema.properties).toBeDefined();
    expect(schema.properties.task).toBeDefined();
    expect(schema.required).toContain("task");
  });

  it("tool parameter schema includes optional mode and safeCustomTools", async () => {
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );
    const ext = findExtensionWithTool(result, TOOL_NAME);
    const def = ext!.tools.get(TOOL_NAME)!.definition;

    const schema = def.parameters;
    expect(schema.properties.mode).toBeDefined();
    expect(schema.properties.safeCustomTools).toBeDefined();
  });

  it("loaded extension registers exactly one tool", async () => {
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );
    const ext = findExtensionWithTool(result, TOOL_NAME);
    expect(ext).toBeDefined();

    expect(ext!.tools.size).toBe(1);
    expect([...ext!.tools.keys()]).toEqual([TOOL_NAME]);
  });

  it(
    "multiple loads with different discovery paths are independent",
    withTmpDir(async (tmpDir) => {
      // Load with the real path
      const withExt = await discoverAndLoadExtensions(
        [PACKAGE_ROOT],
        PACKAGE_ROOT
      );
      expect(getToolNames(withExt)).toContain(TOOL_NAME);

      // Load without the extension
      const withoutExt = await discoverAndLoadExtensions([], tmpDir);
      expect(getToolNames(withoutExt)).not.toContain(TOOL_NAME);

      // Load again with the real path (independent of previous call)
      const withExtAgain = await discoverAndLoadExtensions(
        [PACKAGE_ROOT],
        PACKAGE_ROOT
      );
      expect(getToolNames(withExtAgain)).toContain(TOOL_NAME);
    })
  );

  it("runtime object is returned and usable", async () => {
    const result = await discoverAndLoadExtensions(
      [PACKAGE_ROOT],
      PACKAGE_ROOT
    );
    expect(result.runtime).toBeDefined();

    // Runtime should have the expected shape (stub methods before bind)
    expect(typeof result.runtime.refreshTools).toBe("function");
    expect(result.runtime.flagValues).toBeInstanceOf(Map);
  });
});
