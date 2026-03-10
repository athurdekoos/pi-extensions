/**
 * Unit tests: ADK CLI detection and capability parsing.
 *
 * Behavior protected:
 * - parseAdkVersion extracts versions from various output formats
 * - helpShowsCreate detects create subcommand in help output
 * - createHelpShowsConfigType detects --type=config support
 * - detectAdkCli returns structured capabilities (mocked boundary)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseAdkVersion,
  helpShowsCreate,
  createHelpShowsConfigType,
} from "../../src/lib/adk-cli-detect.js";

// ---------------------------------------------------------------------------
// Version parsing
// ---------------------------------------------------------------------------

describe("parseAdkVersion", () => {
  it("parses 'adk 1.2.3'", () => {
    expect(parseAdkVersion("adk 1.2.3")).toBe("1.2.3");
  });

  it("parses 'ADK version 1.2.3'", () => {
    expect(parseAdkVersion("ADK version 1.2.3")).toBe("1.2.3");
  });

  it("parses standalone '1.2.3'", () => {
    expect(parseAdkVersion("1.2.3")).toBe("1.2.3");
  });

  it("parses 'google-adk==1.2.3'", () => {
    expect(parseAdkVersion("google-adk==1.2.3")).toBe("1.2.3");
  });

  it("parses version with pre-release suffix", () => {
    expect(parseAdkVersion("adk 1.2.3rc1")).toBe("1.2.3rc1");
  });

  it("returns null for empty string", () => {
    expect(parseAdkVersion("")).toBeNull();
  });

  it("returns null for unparseable output", () => {
    expect(parseAdkVersion("No version info available")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Help parsing: create subcommand
// ---------------------------------------------------------------------------

describe("helpShowsCreate", () => {
  it("detects create in typical help output", () => {
    const help = `
Usage: adk [OPTIONS] COMMAND [ARGS]...

Commands:
  create   Create a new ADK application
  run      Run an ADK agent
  web      Start the ADK web UI
`;
    expect(helpShowsCreate(help)).toBe(true);
  });

  it("detects create when mentioned in description", () => {
    expect(helpShowsCreate("Use 'adk create' to scaffold a new project")).toBe(true);
  });

  it("returns false when create not mentioned", () => {
    const help = `
Usage: adk [OPTIONS] COMMAND [ARGS]...

Commands:
  run      Run an ADK agent
  web      Start the ADK web UI
`;
    expect(helpShowsCreate(help)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(helpShowsCreate("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Help parsing: config type support
// ---------------------------------------------------------------------------

describe("createHelpShowsConfigType", () => {
  it("detects --type with config value", () => {
    const help = `
Usage: adk create [OPTIONS] APP_NAME

Options:
  --type TEXT  Application type (app, config)  [default: app]
  --help       Show this message and exit.
`;
    expect(createHelpShowsConfigType(help)).toBe(true);
  });

  it("detects --type=config mention", () => {
    const help = "Use --type=config to create a configuration-based application.";
    expect(createHelpShowsConfigType(help)).toBe(true);
  });

  it("returns false when --type exists but no config value", () => {
    const help = `
Options:
  --type TEXT  Application type (app, flow)
`;
    expect(createHelpShowsConfigType(help)).toBe(false);
  });

  it("returns false when config exists but no --type flag", () => {
    const help = "config files are supported";
    expect(createHelpShowsConfigType(help)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(createHelpShowsConfigType("")).toBe(false);
  });
});
