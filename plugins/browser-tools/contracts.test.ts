import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BrowserToolError,
  browserClickInputSchema,
  browserCloseInputSchema,
  browserConsoleInputSchema,
  browserEvaluateInputSchema,
  browserNavigateInputSchema,
  browserOpenInputSchema,
  browserPressInputSchema,
  browserScreenshotInputSchema,
  browserSnapshotInputSchema,
  browserToolInputSchemas,
  browserTypeInputSchema,
  cleanupComplete,
  hostContract,
  hostOpenInputSchema,
  navigationUrlSchema,
  newCleanupSteps,
  pressKeySchema,
  refSchema,
  sessionRecordSchema,
  snapshotIdForRef,
  toErrorEnvelope,
} from "./contracts.js";

const validToolInputs: Record<keyof typeof browserToolInputSchemas, unknown> = {
  browser_open: { url: "https://example.com/", allowPersonal: false },
  browser_navigate: { url: "http://127.0.0.1:8080/path?q=1" },
  browser_snapshot: {},
  browser_click: { ref: "abcd1234.1:e42" },
  browser_type: { ref: "abcd1234.1:e42", text: "hello", replace: true },
  browser_press: { key: "Control+Enter" },
  browser_screenshot: { fullPage: false },
  browser_evaluate: { expression: "document.title" },
  browser_console: { cursor: 0 },
  browser_close: { closeTab: false },
};

describe("tool input contracts", () => {
  it("parses one complete valid fixture per tool", () => {
    for (const [name, schema] of Object.entries(browserToolInputSchemas)) {
      const fixture = validToolInputs[name as keyof typeof browserToolInputSchemas];
      expect(schema.safeParse(fixture).success, name).toBe(true);
    }
  });

  it("applies defaults without accepting unknown keys", () => {
    const open = browserOpenInputSchema.parse({ url: "about:blank" });
    expect(open.allowPersonal).toBe(false);
    const type = browserTypeInputSchema.parse({ ref: "abcd1234.1:e1", text: "x" });
    expect(type.replace).toBe(true);
    const screenshot = browserScreenshotInputSchema.parse({});
    expect(screenshot.fullPage).toBe(false);
    expect(browserSnapshotInputSchema.safeParse({ extra: true }).success).toBe(false);
    expect(browserConsoleInputSchema.safeParse({ cursor: -1 }).success).toBe(false);
  });

  it("rejects contradictory open inputs", () => {
    const withTabAndUrl = { ...(validToolInputs.browser_open as object), tabId: "tab_1" };
    expect(browserOpenInputSchema.safeParse(withTabAndUrl).success).toBe(false);
    expect(browserOpenInputSchema.safeParse({ allowPersonal: true }).success).toBe(false);
    expect(
      browserOpenInputSchema.safeParse({ hostId: undefined, instanceId: "i" }).success,
    ).toBe(false);
    expect(
      browserOpenInputSchema.safeParse({
        allowPersonal: true,
        tabId: "tab_1",
        hostId: "host_1",
        instanceId: "inst_1",
      }).success,
    ).toBe(true);
  });

  it("bounds typed text and evaluate expressions", () => {
    expect(
      browserTypeInputSchema.safeParse({
        ref: "abcd1234.1:e1",
        text: "x".repeat(4_001),
      }).success,
    ).toBe(false);
    expect(
      browserEvaluateInputSchema.safeParse({ expression: "x".repeat(128_001) }).success,
    ).toBe(false);
  });
});

describe("navigation policy", () => {
  it("accepts http(s) and about:blank", () => {
    for (const url of [
      "http://127.0.0.1:8731/",
      "https://example.com/path?q=1#frag",
      "about:blank",
    ]) {
      expect(navigationUrlSchema.safeParse(url).success, url).toBe(true);
    }
  });

  it("rejects credential schemes, userinfo, whitespace, and oversize URLs", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://user:pass@example.com/",
      "https://example.com/ path",
      `https://example.com/${"a".repeat(5_000)}`,
    ]) {
      expect(navigationUrlSchema.safeParse(url).success, url).toBe(false);
    }
  });
});

describe("refs and snapshot ids", () => {
  it("accepts versioned refs and maps them to their snapshot", () => {
    expect(refSchema.safeParse("abcd1234.3:e17").success).toBe(true);
    expect(snapshotIdForRef("abcd1234.3:e17")).toBe("abcd1234.3");
    expect(snapshotIdForRef("e17")).toBeNull();
  });

  it("rejects malformed or unversioned refs", () => {
    for (const ref of ["abcd1234.3:e", ":e1", "abcd1234:e1", "ab.1:e1", "abcd1234.3:e1x"]) {
      expect(refSchema.safeParse(ref).success, ref).toBe(false);
    }
  });
});

describe("press keys", () => {
  it("accepts named keys, single characters, and modifier combinations", () => {
    for (const key of ["Enter", "Escape", "ArrowDown", "Space", "a", "Z", "Control+Enter", "Meta+Shift+Tab"]) {
      expect(pressKeySchema.safeParse(key).success, key).toBe(true);
    }
  });

  it("rejects unknown keys and malformed combinations", () => {
    for (const key of ["", "Foo", "Control+Control+Enter", "Enter+", "Control+", "Ctrl+Enter", "Enter+Tab"]) {
      expect(pressKeySchema.safeParse(key).success, key).toBe(false);
    }
  });
});

describe("error envelopes", () => {
  it("preserves classified errors and normalizes unknown failures", () => {
    const classified = toErrorEnvelope(new BrowserToolError("STALE_REF", "Take a fresh snapshot"));
    expect(classified).toEqual({ code: "STALE_REF", message: "Take a fresh snapshot" });
    expect(toErrorEnvelope(new Error("secret endpoint ws://127.0.0.1/x"))).toEqual({
      code: "INTERNAL",
      message: "Browser operation failed",
    });
  });
});

describe("session records", () => {
  const validRecord = {
    version: 1,
    id: "s_1",
    threadId: "thr_1",
    hostId: "host_1",
    phase: "ready",
    createdAt: 1,
    expiresAt: 2,
    lastUsedAt: 1,
    stoppedAt: null,
    desktop: {
      instanceId: "inst_1",
      generation: "gen_1",
      leaseId: "lease_1",
      tabId: "tab_1",
      borrowed: false,
      profileId: "prof_1",
      pendingClose: false,
    },
    cleanup: { hostConnectionClosed: false, leaseReleased: false, tabClosed: false },
  };

  it("parses a complete valid record", () => {
    expect(sessionRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it("rejects unknown versions, missing fields, and unknown keys", () => {
    expect(sessionRecordSchema.safeParse({ ...validRecord, version: 2 }).success).toBe(false);
    const { desktop: _desktop, ...missing } = validRecord;
    expect(sessionRecordSchema.safeParse(missing).success).toBe(false);
    expect(sessionRecordSchema.safeParse({ ...validRecord, extra: 1 }).success).toBe(false);
  });

  it("tracks cleanup completion per step", () => {
    const record = sessionRecordSchema.parse(validRecord);
    expect(cleanupComplete(record)).toBe(false);
    record.cleanup = { hostConnectionClosed: true, leaseReleased: true, tabClosed: false };
    expect(cleanupComplete(record)).toBe(true);
    record.desktop = { ...record.desktop!, pendingClose: true };
    expect(cleanupComplete(record)).toBe(false);
    expect(newCleanupSteps()).toEqual({
      hostConnectionClosed: false,
      leaseReleased: false,
      tabClosed: false,
    });
  });
});

describe("host contract", () => {
  it("parses open input and result envelopes", () => {
    const input = hostOpenInputSchema.parse({
      sessionId: "s_1",
      wsEndpoint: "ws://127.0.0.1:9999/cdp/deadbeef",
      expiresAt: Date.now() + 60_000,
      deadlineAt: Date.now() + 30_000,
    });
    expect(input.sessionId).toBe("s_1");

    const snapshot = {
      snapshotId: "abcd1234.1",
      text: "- generic",
      refs: [],
      url: "about:blank",
      title: "",
      truncated: { text: false, nodes: false, depth: false, refs: false, droppedNodes: 0 },
    };
    const output = hostContract.open.output;
    expect(output.safeParse({ ok: true, data: { snapshot } }).success).toBe(true);
    expect(
      output.safeParse({ ok: false, error: { code: "TARGET_UNAVAILABLE", message: "No tab" } })
        .success,
    ).toBe(true);
    expect(output.safeParse({ ok: true, data: { snapshot, extra: 1 } }).success).toBe(false);
    expect(output.safeParse({ ok: false }).success).toBe(false);
  });

  it("rejects raw secrets in non-endpoint results", () => {
    const payload = hostContract.screenshot.output;
    expect(
      payload.safeParse({
        ok: false,
        error: { code: "OUTPUT_LIMIT", message: "Screenshot exceeds the 500 KiB budget" },
      }).success,
    ).toBe(true);
    expect(z.string().safeParse("ws://127.0.0.1").success).toBe(true);
  });
});
