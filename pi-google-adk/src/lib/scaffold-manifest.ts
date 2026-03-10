/**
 * Scaffold manifest (.adk-scaffold.json) — records project metadata
 * and tracks capabilities applied by add_adk_capability.
 */

import { safeReadFile, safeWriteFile } from "./fs-safe.js";

export interface ScaffoldManifest {
  name: string;
  template: string;
  model: string;
  extension: string;
  extension_version: string;
  capabilities: string[];
}

const FILENAME = ".adk-scaffold.json";
const EXTENSION_NAME = "pi-google-adk";
const EXTENSION_VERSION = "0.1.0";

export function createManifest(
  name: string,
  template: string,
  model: string,
): ScaffoldManifest {
  return {
    name,
    template,
    model,
    extension: EXTENSION_NAME,
    extension_version: EXTENSION_VERSION,
    capabilities: [],
  };
}

export function serializeManifest(m: ScaffoldManifest): string {
  return JSON.stringify(m, null, 2) + "\n";
}

/**
 * Read the scaffold manifest from a project root.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readManifest(projectRoot: string): ScaffoldManifest | null {
  const raw = safeReadFile(projectRoot, FILENAME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScaffoldManifest;
  } catch {
    return null;
  }
}

/**
 * Add a capability to the manifest and write it back.
 * Skips duplicates.
 */
export function addCapabilityToManifest(
  cwd: string,
  projectPath: string,
  capability: string,
): void {
  const fullPath = `${projectPath}/${FILENAME}`;
  const raw = safeReadFile(cwd, fullPath);
  if (!raw) return;

  let manifest: ScaffoldManifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return;
  }

  if (!manifest.capabilities) {
    manifest.capabilities = [];
  }
  if (!manifest.capabilities.includes(capability)) {
    manifest.capabilities.push(capability);
  }
  safeWriteFile(cwd, fullPath, serializeManifest(manifest), true);
}

export { FILENAME as MANIFEST_FILENAME };
