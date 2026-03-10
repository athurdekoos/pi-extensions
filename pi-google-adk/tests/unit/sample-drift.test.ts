/**
 * Unit tests: drift detection logic.
 *
 * Behavior protected:
 * - classifyDrift returns correct status for all 4 core cases
 * - extractProvenance handles valid, missing, and wrong source_type
 * - writeDriftTracking writes tracking fields additively
 * - writeDriftTracking returns false when metadata is absent
 *
 * Note: Full git-based upstream comparisons are NOT tested here.
 * The git boundary is tested via the manual test plan.
 * These tests mock/isolate the classification and provenance logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, removeTempDir } from "../helpers/temp-dir.js";
import {
  classifyDrift,
  extractProvenance,
  writeDriftTracking,
  type DriftTrackingUpdate,
} from "../../src/lib/sample-drift.js";
import { CREATION_METADATA_FILENAME } from "../../src/lib/creation-metadata.js";

let workDir: string;

beforeEach(() => {
  workDir = createTempDir();
});

afterEach(() => {
  removeTempDir(workDir);
});

// ---------------------------------------------------------------------------
// classifyDrift
// ---------------------------------------------------------------------------

describe("classifyDrift", () => {
  const HASH_A = "aaa111";
  const HASH_B = "bbb222";
  const HASH_C = "ccc333";

  it("returns up_to_date when all three hashes match", () => {
    expect(classifyDrift(HASH_A, HASH_A, HASH_A)).toBe("up_to_date");
  });

  it("returns upstream_updated when baseline == local but != upstream", () => {
    expect(classifyDrift(HASH_A, HASH_A, HASH_B)).toBe("upstream_updated");
  });

  it("returns local_modified when baseline == upstream but != local", () => {
    expect(classifyDrift(HASH_A, HASH_B, HASH_A)).toBe("local_modified");
  });

  it("returns diverged when baseline != local and baseline != upstream", () => {
    expect(classifyDrift(HASH_A, HASH_B, HASH_C)).toBe("diverged");
  });

  it("returns diverged when local == upstream but both differ from baseline", () => {
    // Both changed to the same thing — still diverged from baseline
    expect(classifyDrift(HASH_A, HASH_B, HASH_B)).toBe("diverged");
  });
});

// ---------------------------------------------------------------------------
// extractProvenance
// ---------------------------------------------------------------------------

describe("extractProvenance", () => {
  function writeMetadata(projectDir: string, meta: Record<string, unknown>) {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      JSON.stringify(meta, null, 2),
      "utf-8",
    );
  }

  it("extracts valid provenance from official_sample metadata", () => {
    const projectDir = join(workDir, "sample_project");
    writeMetadata(projectDir, {
      source_type: "official_sample",
      provenance: {
        sample_import: {
          upstream_repo: "https://github.com/google/adk-samples.git",
          upstream_path: "agents/hello-world",
          upstream_ref: "main",
          commit: "abc123",
          sample_slug: "hello_world",
        },
      },
    });

    const result = extractProvenance(projectDir);
    expect("provenance" in result).toBe(true);
    if ("provenance" in result) {
      expect(result.provenance.upstream_repo).toBe("https://github.com/google/adk-samples.git");
      expect(result.provenance.upstream_path).toBe("agents/hello-world");
      expect(result.provenance.upstream_ref).toBe("main");
      expect(result.provenance.commit).toBe("abc123");
      expect(result.provenance.sample_slug).toBe("hello_world");
    }
  });

  it("returns missing_provenance when no metadata file exists", () => {
    const projectDir = join(workDir, "no_meta");
    mkdirSync(projectDir, { recursive: true });

    const result = extractProvenance(projectDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe("missing_provenance");
    }
  });

  it("returns unsupported_project for native_app source_type", () => {
    const projectDir = join(workDir, "native_project");
    writeMetadata(projectDir, {
      source_type: "native_app",
      provenance: { created_at: "2025-01-01" },
    });

    const result = extractProvenance(projectDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe("unsupported_project");
      expect(result.error.summary).toContain("native_app");
    }
  });

  it("returns unsupported_project for native_config source_type", () => {
    const projectDir = join(workDir, "config_project");
    writeMetadata(projectDir, {
      source_type: "native_config",
      provenance: { created_at: "2025-01-01" },
    });

    const result = extractProvenance(projectDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe("unsupported_project");
    }
  });

  it("returns missing_provenance when sample_import is missing", () => {
    const projectDir = join(workDir, "no_import");
    writeMetadata(projectDir, {
      source_type: "official_sample",
      provenance: { created_at: "2025-01-01" },
    });

    const result = extractProvenance(projectDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe("missing_provenance");
    }
  });

  it("returns missing_provenance when upstream_repo is missing", () => {
    const projectDir = join(workDir, "incomplete");
    writeMetadata(projectDir, {
      source_type: "official_sample",
      provenance: {
        sample_import: {
          upstream_path: "agents/hello-world",
        },
      },
    });

    const result = extractProvenance(projectDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe("missing_provenance");
    }
  });

  it("returns missing_provenance for unparseable JSON", () => {
    const projectDir = join(workDir, "bad_json");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      "not valid json {{{",
      "utf-8",
    );

    const result = extractProvenance(projectDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe("missing_provenance");
    }
  });

  it("defaults upstream_ref to main when absent", () => {
    const projectDir = join(workDir, "no_ref");
    writeMetadata(projectDir, {
      source_type: "official_sample",
      provenance: {
        sample_import: {
          upstream_repo: "https://github.com/google/adk-samples.git",
          upstream_path: "agents/hello-world",
          commit: "abc123",
          sample_slug: "hello_world",
        },
      },
    });

    const result = extractProvenance(projectDir);
    expect("provenance" in result).toBe(true);
    if ("provenance" in result) {
      expect(result.provenance.upstream_ref).toBe("main");
    }
  });
});

// ---------------------------------------------------------------------------
// writeDriftTracking
// ---------------------------------------------------------------------------

describe("writeDriftTracking", () => {
  const trackingUpdate: DriftTrackingUpdate = {
    last_drift_check_at: "2026-03-10T12:00:00.000Z",
    last_drift_status: "up_to_date",
    last_checked_upstream_commit: "abc123",
    last_local_hash: "localhash",
    last_upstream_hash: "upstreamhash",
  };

  it("writes tracking fields to existing metadata", () => {
    const projectDir = join(workDir, "tracking_test");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      JSON.stringify({
        schema_version: "1",
        source_type: "official_sample",
        tracking: {},
      }),
      "utf-8",
    );

    const result = writeDriftTracking(projectDir, trackingUpdate);
    expect(result).toBe(true);

    const updated = JSON.parse(
      readFileSync(join(projectDir, CREATION_METADATA_FILENAME), "utf-8"),
    );
    expect(updated.tracking.last_drift_check_at).toBe("2026-03-10T12:00:00.000Z");
    expect(updated.tracking.last_drift_status).toBe("up_to_date");
    expect(updated.tracking.last_checked_upstream_commit).toBe("abc123");
    expect(updated.tracking.last_local_hash).toBe("localhash");
    expect(updated.tracking.last_upstream_hash).toBe("upstreamhash");
  });

  it("preserves other metadata fields", () => {
    const projectDir = join(workDir, "preserve_test");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      JSON.stringify({
        schema_version: "1",
        source_type: "official_sample",
        agent_name: "my_agent",
        tracking: { support_notes: "keep this" },
      }),
      "utf-8",
    );

    writeDriftTracking(projectDir, trackingUpdate);

    const updated = JSON.parse(
      readFileSync(join(projectDir, CREATION_METADATA_FILENAME), "utf-8"),
    );
    expect(updated.schema_version).toBe("1");
    expect(updated.source_type).toBe("official_sample");
    expect(updated.agent_name).toBe("my_agent");
    expect(updated.tracking.support_notes).toBe("keep this");
    expect(updated.tracking.last_drift_status).toBe("up_to_date");
  });

  it("creates tracking section if absent", () => {
    const projectDir = join(workDir, "no_tracking");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      JSON.stringify({ source_type: "official_sample" }),
      "utf-8",
    );

    const result = writeDriftTracking(projectDir, trackingUpdate);
    expect(result).toBe(true);

    const updated = JSON.parse(
      readFileSync(join(projectDir, CREATION_METADATA_FILENAME), "utf-8"),
    );
    expect(updated.tracking.last_drift_status).toBe("up_to_date");
  });

  it("returns false when no metadata file exists", () => {
    const projectDir = join(workDir, "no_file");
    mkdirSync(projectDir, { recursive: true });

    const result = writeDriftTracking(projectDir, trackingUpdate);
    expect(result).toBe(false);
  });

  it("returns false for unparseable metadata", () => {
    const projectDir = join(workDir, "bad_file");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, CREATION_METADATA_FILENAME),
      "not json",
      "utf-8",
    );

    const result = writeDriftTracking(projectDir, trackingUpdate);
    expect(result).toBe(false);
  });
});
