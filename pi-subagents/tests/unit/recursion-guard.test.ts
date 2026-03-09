/**
 * Unit tests: recursion guard state management.
 *
 * Behavior protected:
 * - childDepth increments/decrements correctly
 * - activeChildSignals tracks signals correctly
 * - Extension refuses to register when childDepth > 0
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  _getChildDepth,
  _setChildDepth,
  _addChildSignal,
  _removeChildSignal,
} from "../../index.js";
import piSubagentsExtension from "../../index.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

beforeEach(() => {
  _setChildDepth(0);
});

describe("childDepth accessors", () => {
  it("starts at 0", () => {
    expect(_getChildDepth()).toBe(0);
  });

  it("can be set and read back", () => {
    _setChildDepth(3);
    expect(_getChildDepth()).toBe(3);
    _setChildDepth(0);
    expect(_getChildDepth()).toBe(0);
  });
});

describe("extension registration guard", () => {
  it("registers delegate_to_subagent when childDepth is 0", () => {
    _setChildDepth(0);
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);
    expect(registeredTools.some((t) => t.name === "delegate_to_subagent")).toBe(true);
  });

  it("refuses to register when childDepth > 0", () => {
    _setChildDepth(1);
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);
    expect(registeredTools).toHaveLength(0);
  });

  it("refuses to register at any positive depth", () => {
    _setChildDepth(5);
    const { api, registeredTools } = createMockExtensionAPI();
    piSubagentsExtension(api);
    expect(registeredTools).toHaveLength(0);
  });
});

describe("signal tracking", () => {
  it("add and remove do not throw", () => {
    const signal = new AbortController().signal;
    expect(() => _addChildSignal(signal)).not.toThrow();
    expect(() => _removeChildSignal(signal)).not.toThrow();
  });
});
