import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@vesnalia/plugin-sdk/testing";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import plugin, { type SearchResult } from "./server";

type Timeline = AliaPluginApi["sdk"]["threads"]["timeline"];
type Page = Awaited<ReturnType<Timeline>>;
type TimelineRow = Page["rows"][number];
type TimelineConversationRow = Extract<TimelineRow, { kind: "conversation" }>;
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });

it("uses only public SDK entrypoints and declared public UI dependencies", () => {
  const scan = experimental_scanPublicSdkOnly(process.cwd(), { allow: [
    /^@\//, /^@hugeicons\//, /^@radix-ui\//, /^@testing-library\//,
    /^react(?:-dom)?(?:\/.*)?$/,
    /^(?:re2js|class-variance-authority|clsx|tailwind-merge|vitest(?:\/.*)?)$/,
  ] });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});

function base(id: string, seq: number) {
  return { id, threadId: "thr_1", turnId: null, createdAt: seq, startedAt: seq, sourceSeqStart: seq, sourceSeqEnd: seq };
}
function turn(id: string, seq: number, children: TimelineRow[]): TimelineRow {
  return { ...base(id, seq), kind: "turn", turnId: id, status: "completed", summaryCount: children.length, completedAt: seq, children };
}
function page(rows: TimelineRow[], olderCursor: Page["timelinePage"]["olderCursor"] = null,
  overrides: Partial<Page["timelinePage"]> = {}): Page {
  return {
    rows, maxSeq: 1000, completedTurnDisplay: "flat", contextBoundarySeq: null,
    activeBackgroundCommands: [], activePromptMode: null, activeThinking: null,
    activeWorkflows: [], goal: null, modelFallback: null, pendingTodos: null,
    providerCommands: null, sessionOptions: null,
    timelinePage: { historySnapshot: "snapshot-1", olderCursor, olderRowsSourceSeqEnd: null, returnedSegmentCount: rows.length, ...overrides },
  };
}

function message(id: string, role: "user" | "assistant", seq: number, text: string): TimelineConversationRow {
  const common = { ...base(id, seq), kind: "conversation" as const, text, attachments: null, messageSeq: seq };
  return role === "assistant" ? { ...common, role, turnRequest: null } : {
    ...common, role, initiator: "user", mentions: [], senderThreadId: null,
    systemMessageKind: "unlabeled", systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
}

function timelineStub() {
  const older = page([
    message("r1", "user", 1, "Please add a custom hook."),
    turn("w1", 2, []),
  ]);
  const latest = page([
    turn("t1", 3, [message("r2", "assistant", 3, "Custom hooks: useCustom and CUSTOM_KEY.")]),
    message("r3", "user", 5, "no match here"),
  ], { anchorId: "opaque-snapshot-cursor", anchorSeq: 3 });
  const calls: Parameters<Timeline>[0][] = [];
  const timeline: Timeline = async (args) => {
    calls.push(args);
    return args.beforeAnchorId === undefined ? latest : older;
  };
  return { calls, timeline };
}

async function load(timeline?: Timeline) {
  const stub = timelineStub();
  const { alia, harness } = createFakePluginHost({
    pluginId: "chat-search",
    sdk: { threads: { timeline: timeline ?? stub.timeline } },
  });
  disposals.push(() => harness.lifecycle.dispose());
  await plugin(alia);
  return { harness, stub };
}

describe("search rpc", () => {
  it("pages through history and reports every occurrence in seq order", async () => {
    const { harness, stub } = await load();
    const result = (await harness.behavior.callRpc("search", {
      threadId: "thr_1",
      query: "custom",
      caseSensitive: false,
      regex: false,
    })) as { hits: { rowId: string; topRowId: string; index: number; match: string; role: string }[]; rowOrder: string[]; totalMatches: number; matchedMessages: number; scannedMessages: number; truncated: boolean };
    expect(stub.calls).toHaveLength(2);
    expect(result.totalMatches).toBe(4);
    expect(result.matchedMessages).toBe(2);
    expect(result.scannedMessages).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.hits.map((hit) => [hit.rowId, hit.topRowId, hit.index, hit.match, hit.role])).toEqual([
      ["r1", "r1", 0, "custom", "user"],
      ["r2", "t1", 0, "Custom", "assistant"],
      ["r2", "t1", 1, "Custom", "assistant"],
      ["r2", "t1", 2, "CUSTOM", "assistant"],
    ]);
    expect(result.rowOrder).toEqual(["r1", "w1", "t1", "r3"]);
  });
  it("flags invalid regular expressions instead of throwing", async () => {
    const { harness } = await load();
    const result = (await harness.behavior.callRpc("search", {
      threadId: "thr_1",
      query: "(",
      caseSensitive: false,
      regex: true,
    })) as { invalidRegex: boolean; hits: unknown[] };
    expect(result.invalidRegex).toBe(true);
    expect(result.hits).toEqual([]);
  });
});

describe("cli", () => {
  it("prints hits for find and usage otherwise", async () => {
    const { harness } = await load();
    const ok = await harness.behavior.runCli(["find", "custom", "--thread", "thr_1", "--case"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("1 match(es) in 1 of 3 message(s)");
    const bad = await harness.behavior.runCli(["find", "custom"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("Usage:");
  });
});

const searchInput = { threadId: "thr_1", query: "needle", caseSensitive: false, regex: false };

describe("current timeline pagination contract", () => {
  it("finds a match only in older history and forwards the opaque cursor unchanged", async () => {
    const timeline = vi.fn<Timeline>()
      .mockResolvedValueOnce(page([message("new", "user", 10, "nothing")], { anchorId: "opaque:keep-me", anchorSeq: 10 }))
      .mockResolvedValueOnce(page([message("old", "user", 1, "needle")]));
    const { harness } = await load(timeline);
    const result = await harness.behavior.callRpc("search", searchInput) as SearchResult;
    expect(timeline.mock.calls).toEqual([
      [{ threadId: "thr_1", segmentLimit: "100", includeNestedRows: "true" }],
      [{ threadId: "thr_1", segmentLimit: "100", includeNestedRows: "true", beforeAnchorId: "opaque:keep-me", beforeAnchorSeq: "10" }],
    ]);
    expect(result.hits.map(hit => hit.rowId)).toEqual(["old"]);
    expect(result.truncated).toBe(false);
  });

  it("merges partial nested rows and older-row updates without replacing the latest message", async () => {
    const timeline = vi.fn<Timeline>()
      .mockResolvedValueOnce(page([message("new", "user", 30, "needle latest")], { anchorId: "part:2", anchorSeq: 10 }, {
        olderRowsSourceSeqEnd: 20,
        olderRowUpdates: [turn("t", 10, [message("b", "assistant", 20, "needle updated")])],
      }))
      .mockResolvedValueOnce(page([turn("t", 10, [message("b", "assistant", 20, "stale"), message("a", "assistant", 11, "needle first")])], { anchorId: "part:1", anchorSeq: 10 }))
      .mockResolvedValueOnce(page([message("old", "user", 1, "needle oldest"), turn("t", 10, [message("a", "assistant", 11, "needle first")])]));
    const { harness } = await load(timeline);
    const result = await harness.behavior.callRpc("search", searchInput) as SearchResult;
    expect(result.hits.map(hit => [hit.rowId, hit.topRowId])).toEqual([["old", "old"], ["a", "t"], ["b", "t"], ["new", "new"]]);
    expect(result.rowOrder).toEqual(["old", "t", "new"]);
    expect(result.scannedMessages).toBe(4);
    expect(result.truncated).toBe(false);
  });

  it("continues through empty pages that still have a cursor", async () => {
    const timeline = vi.fn<Timeline>()
      .mockResolvedValueOnce(page([], { anchorId: "empty", anchorSeq: 5 }))
      .mockResolvedValueOnce(page([message("old", "user", 1, "needle")]));
    const { harness } = await load(timeline);
    expect((await harness.behavior.callRpc("search", searchInput) as SearchResult).hits).toHaveLength(1);
  });

  it.each([false, true])("only reports complete at the 200-page cap if the last cursor is null (%s)", async (exhausted) => {
    let calls = 0;
    const timeline: Timeline = async () => {
      calls += 1;
      const seq = 201 - calls;
      return page([message(`r${seq}`, "user", seq, "needle")], exhausted && calls === 200 ? null : { anchorId: `cursor-${seq}`, anchorSeq: seq });
    };
    const { harness } = await load(timeline);
    const result = await harness.behavior.callRpc("search", searchInput) as SearchResult;
    expect(calls).toBe(200);
    expect(result.scannedMessages).toBe(200);
    expect(result.hits[0]?.seq).toBe(1);
    expect(result.hits[199]?.seq).toBe(200);
    expect(result.truncated).toBe(!exhausted);
  });

  it("stops a repeated cursor and reports incomplete", async () => {
    const timeline = vi.fn<Timeline>().mockResolvedValue(page([], { anchorId: "stuck", anchorSeq: 1 }));
    const { harness } = await load(timeline);
    const result = await harness.behavior.callRpc("search", searchInput) as SearchResult;
    expect(timeline).toHaveBeenCalledTimes(2);
    expect(result.truncated).toBe(true);
  });

  it("rejects mixed snapshots instead of returning a misleading complete search", async () => {
    const timeline = vi.fn<Timeline>()
      .mockResolvedValueOnce(page([], { anchorId: "cursor", anchorSeq: 1 }))
      .mockResolvedValueOnce(page([], null, { historySnapshot: "changed" }));
    const { harness } = await load(timeline);
    await expect(harness.behavior.callRpc("search", searchInput)).rejects.toThrow("Chat history changed");
  });

  it("keeps the hit cap distinct from exhausted history", async () => {
    const { harness } = await load(async () => page([message("many", "user", 1, "needle ".repeat(501))]));
    const result = await harness.behavior.callRpc("search", searchInput) as SearchResult;
    expect(result.hits).toHaveLength(500);
    expect(result.totalMatches).toBe(501);
    expect(result.truncated).toBe(true);
  });
});
