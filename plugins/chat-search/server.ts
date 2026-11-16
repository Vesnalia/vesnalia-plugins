// alia-plugin-chat-search — backend entry.
//
// One RPC method searches a thread's messages. It reads the thread timeline
// through the SDK (paging through older history), matches the query against
// every user and assistant message, and returns one hit per occurrence with
// the timeline row id the frontend uses to locate the message in the DOM. It
// also returns the order of the top-level rows so the frontend can find a row
// that the virtualized chat has not rendered yet.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import {
  buildMatcher,
  findMatches,
  makeSnippet,
  MAX_QUERY_LENGTH,
  type MatcherOptions,
} from "./lib/search-core";

const MAX_HITS = 500;
const MAX_PAGES = 200;
const SEGMENT_LIMIT = "100";

const hitSchema = z.object({
  rowId: z.string(),
  /** The top-level timeline row that contains the message (itself if top-level). */
  topRowId: z.string(),
  role: z.enum(["user", "assistant"]),
  seq: z.number(),
  index: z.number(),
  before: z.string(),
  match: z.string(),
  after: z.string(),
});
export type SearchHitResult = z.infer<typeof hitSchema>;

const resultSchema = z.object({
  hits: z.array(hitSchema),
  /** Top-level timeline row ids, oldest first. */
  rowOrder: z.array(z.string()),
  totalMatches: z.number(),
  matchedMessages: z.number(),
  scannedMessages: z.number(),
  truncated: z.boolean(),
  invalidRegex: z.boolean(),
});
export type SearchResult = z.infer<typeof resultSchema>;

export const rpcContract = defineRpcContract({
  search: {
    input: z
      .object({
        threadId: z.string().min(1),
        query: z.string().min(1).max(MAX_QUERY_LENGTH),
        caseSensitive: z.boolean(),
        regex: z.boolean(),
      })
      .strict(),
    output: resultSchema,
  },
});

interface MessageRow {
  id: string;
  topRowId: string;
  role: "user" | "assistant";
  seq: number;
  text: string;
}

type TimelineResponse = Awaited<ReturnType<AliaPluginApi["sdk"]["threads"]["timeline"]>>;
type AnyRow = TimelineResponse["rows"][number];

function isMessageRow(row: AnyRow): row is AnyRow & {
  kind: "conversation";
  role: "user" | "assistant";
  text: string;
} {
  return (
    row.kind === "conversation" &&
    (row.role === "user" || row.role === "assistant") &&
    typeof (row as { text?: unknown }).text === "string"
  );
}

function childRows(row: AnyRow): AnyRow[] {
  const candidate = row as { childRows?: unknown; children?: unknown };
  if (Array.isArray(candidate.childRows)) return candidate.childRows as AnyRow[];
  if (Array.isArray(candidate.children)) return candidate.children as AnyRow[];
  return [];
}

function collectMessages(rows: AnyRow[], into: Map<string, MessageRow>, topRowId?: string): void {
  for (const row of rows) {
    if (isMessageRow(row) && !into.has(row.id)) {
      into.set(row.id, {
        id: row.id,
        topRowId: topRowId ?? row.id,
        role: row.role,
        seq: row.sourceSeqStart,
        text: row.text,
      });
    }
    collectMessages(childRows(row), into, topRowId ?? row.id);
  }
}

function collectTopRows(rows: AnyRow[], into: Map<string, number>): void {
  for (const row of rows) {
    if (!into.has(row.id)) into.set(row.id, row.sourceSeqStart);
  }
}

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  /** Every user/assistant message in the thread and every top-level row, oldest first. */
  async function loadMessages(
    threadId: string,
  ): Promise<{ messages: MessageRow[]; rowOrder: string[]; complete: boolean }> {
    const found = new Map<string, MessageRow>();
    const topRows = new Map<string, number>();
    let page = await alia.sdk.threads.timeline({
      threadId, segmentLimit: SEGMENT_LIMIT, includeNestedRows: "true",
    });
    const snapshot = page.timelinePage.historySnapshot;
    const cursors = new Set<string>();
    let pages = 0;
    while (true) {
      // The opaque cursor binds every page to the initial snapshot. Never
      // combine histories if the host invalidates it while searching.
      if (page.timelinePage.historySnapshot !== snapshot) {
        throw new Error("Chat history changed while searching. Please search again.");
      }
      // Updates contain children of older top-level rows that changed in the
      // latest window. Collect them too; later older pages fill in the rest.
      // Keep the first copy of each message, so older projections cannot
      // replace the latest text. olderRowsSourceSeqEnd describes omitted
      // content, not whether pagination is exhausted; only a null cursor does.
      const rows = [...page.rows, ...(page.timelinePage.olderRowUpdates ?? [])];
      collectMessages(rows, found);
      collectTopRows(rows, topRows);
      pages += 1;
      if (page.timelinePage.olderCursor === null || pages >= MAX_PAGES) break;
      const { anchorId, anchorSeq } = page.timelinePage.olderCursor;
      const cursorKey = JSON.stringify([anchorId, anchorSeq]);
      if (cursors.has(cursorKey)) break;
      cursors.add(cursorKey);
      page = await alia.sdk.threads.timeline({
        threadId,
        segmentLimit: SEGMENT_LIMIT,
        includeNestedRows: "true",
        beforeAnchorId: anchorId,
        beforeAnchorSeq: String(anchorSeq),
      });
    }
    const messages = [...found.values()].sort((a, b) => a.seq - b.seq);
    const rowOrder = [...topRows.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    return { messages, rowOrder, complete: page.timelinePage.olderCursor === null };
  }

  async function search(
    threadId: string,
    query: string,
    options: MatcherOptions,
  ): Promise<SearchResult> {
    const matcher = buildMatcher(query, options);
    const empty: SearchResult = {
      hits: [],
      rowOrder: [],
      totalMatches: 0,
      matchedMessages: 0,
      scannedMessages: 0,
      truncated: false,
      invalidRegex: false,
    };
    if (matcher === null) return { ...empty, invalidRegex: options.regex };
    const { messages, rowOrder, complete } = await loadMessages(threadId);
    const hits: SearchHitResult[] = [];
    let totalMatches = 0;
    let matchedMessages = 0;
    for (const message of messages) {
      const ranges = findMatches(message.text, matcher);
      if (ranges.length === 0) continue;
      matchedMessages += 1;
      totalMatches += ranges.length;
      ranges.forEach((range, index) => {
        if (hits.length >= MAX_HITS) return;
        hits.push({
          rowId: message.id,
          topRowId: message.topRowId,
          role: message.role,
          seq: message.seq,
          index,
          ...makeSnippet(message.text, range),
        });
      });
    }
    return {
      hits,
      rowOrder,
      totalMatches,
      matchedMessages,
      scannedMessages: messages.length,
      truncated: !complete || totalMatches > hits.length,
      invalidRegex: false,
    };
  }

  alia.rpc.register(rpcContract, {
    search: ({ threadId, query, caseSensitive, regex }) =>
      search(threadId, query, { caseSensitive, regex }),
  });

  const usage = [
    "Usage:",
    "  VesnALIA chat-search find <query> --thread <thread-id> [--case] [--regex] [--json]",
    "",
    "Searches the user and assistant messages of one thread.",
  ].join("\n");

  alia.cli.register({
    name: "chat-search",
    summary: "Find text in a thread's messages",
    commands: [
      {
        name: "find",
        summary: "List every match of a query in one thread",
        usage: "alia chat-search find <query> --thread <thread-id> [--case] [--regex] [--json]",
      },
    ],
    async run(argv) {
      const flags = new Set<string>();
      const positional: string[] = [];
      let threadId: string | undefined;
      for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]!;
        if (arg === "--thread") {
          threadId = argv[i + 1];
          i += 1;
        } else if (arg.startsWith("--")) {
          flags.add(arg);
        } else {
          positional.push(arg);
        }
      }
      const [command, ...rest] = positional;
      if (command === undefined || command === "help" || flags.has("--help")) {
        return { exitCode: 0, stdout: usage };
      }
      if (command !== "find") return { exitCode: 1, stderr: usage };
      const query = rest.join(" ");
      if (query.length === 0 || threadId === undefined || threadId.length === 0) {
        return { exitCode: 1, stderr: usage };
      }
      const result = await search(threadId, query, {
        caseSensitive: flags.has("--case"),
        regex: flags.has("--regex"),
      });
      if (flags.has("--json")) return { exitCode: 0, stdout: JSON.stringify(result) };
      if (result.invalidRegex) return { exitCode: 1, stderr: "Invalid regular expression." };
      const lines = result.hits.map(
        (hit) => `[${hit.role}] seq ${hit.seq}: ${hit.before}${hit.match}${hit.after}`,
      );
      const header = `${result.totalMatches} match(es) in ${result.matchedMessages} of ${result.scannedMessages} message(s)${result.truncated ? " (truncated)" : ""}`;
      return { exitCode: 0, stdout: [header, ...lines].join("\n") };
    },
  });

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
