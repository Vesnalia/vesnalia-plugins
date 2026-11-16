import { describe, expect, it } from "vitest";
import {
  openInBbFromRpcResponse,
  shortcutStoryIdFromUrl,
  shortcutStoryPluginPath,
} from "./shortcut-links";

describe("shortcutStoryIdFromUrl", () => {
  it("extracts story ids from canonical Shortcut links", () => {
    expect(shortcutStoryIdFromUrl(
      "https://app.shortcut.com/acme/story/318690/scope-oauth-client-mutations",
    )).toBe(318690);
    expect(shortcutStoryIdFromUrl(
      "https://app.shortcut.com/acme/story/42?view=full#comments",
    )).toBe(42);
  });

  it("ignores non-story and lookalike links", () => {
    expect(shortcutStoryIdFromUrl("https://app.shortcut.com/acme/epic/318690/example")).toBeNull();
    expect(shortcutStoryIdFromUrl("https://app.shortcut.com.evil.test/acme/story/318690")).toBeNull();
    expect(shortcutStoryIdFromUrl("https://example.com/acme/story/318690")).toBeNull();
    expect(shortcutStoryIdFromUrl("not a Shortcut URL")).toBeNull();
  });
});

describe("shortcutStoryPluginPath", () => {
  it("builds the Shortcut plugin detail route", () => {
    expect(shortcutStoryPluginPath("shortcut", 318690)).toBe(
      "/plugins/shortcut/stories/318690",
    );
  });
});

describe("openInBbFromRpcResponse", () => {
  it("reads the mode from a successful rpc response", () => {
    expect(openInBbFromRpcResponse({ ok: true, result: { openInBb: true } })).toBe(true);
    expect(openInBbFromRpcResponse({ ok: true, result: { openInBb: false } })).toBe(false);
  });

  it("rejects malformed payloads", () => {
    expect(openInBbFromRpcResponse(null)).toBeNull();
    expect(openInBbFromRpcResponse("ok")).toBeNull();
    expect(openInBbFromRpcResponse({ ok: false, error: { code: "handler_error", message: "boom" } })).toBeNull();
    expect(openInBbFromRpcResponse({ ok: true, result: null })).toBeNull();
    expect(openInBbFromRpcResponse({ ok: true, result: { openInBb: "yes" } })).toBeNull();
    expect(openInBbFromRpcResponse({ ok: true, result: {} })).toBeNull();
  });
});
