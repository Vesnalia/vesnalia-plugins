// Side chat links — backend.
//
// Lists the side chats forked from a thread and works out which message each
// one was started from, so app.tsx can show a link on that message.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import {
  rpcContract,
  sourceThreadTag,
  type SideChat,
} from "./shared/contract.js";
import {
  matchSourceMessage,
  parseReplySeed,
  type SourceMessage,
} from "./shared/match.js";

export { rpcContract };

/** The bundled plugin that creates side chats. */
const SIDE_CHAT_PLUGIN_ID = "side-chat";
const LIST_PAGE_SIZE = 100;
/** Most timeline pages read while looking for one quoted message. */
const MAX_TIMELINE_PAGES = 40;
const RESOLVED_KEY_PREFIX = "resolved:";
/** How much of a message's text is kept to name its group of side chats. */
const MESSAGE_TEXT_LENGTH = 200;

const resolvedSchema = z.object({
  messageId: z.string(),
  // Absent from entries saved before message text was kept.
  messageText: z.string().default(""),
  anchorText: z.string(),
});
type Resolved = z.infer<typeof resolvedSchema>;

interface SideChatThread {
  id: string;
  title: string | null;
  createdAt: number;
}

interface ForkOrigin {
  originKind: string | null;
  originPluginId: string | null;
  sourceThreadId: string | null;
}

/** The main thread of a side chat, or null for any other thread. */
export function sideChatSourceThreadId(thread: ForkOrigin): string | null {
  return thread.originKind === "fork" &&
    thread.originPluginId === SIDE_CHAT_PLUGIN_ID
    ? thread.sourceThreadId
    : null;
}

const timelineRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  role: z.string().optional(),
  text: z.string().optional(),
  createdAt: z.number().optional(),
  children: z.array(z.unknown()).nullish(),
});

/** The user and assistant messages among timeline rows, nested ones included. */
export function collectMessages(
  rows: readonly unknown[],
  into: SourceMessage[] = [],
): SourceMessage[] {
  for (const value of rows) {
    const row = timelineRowSchema.safeParse(value);
    if (!row.success) continue;
    const { id, kind, role, text, createdAt, children } = row.data;
    if (
      kind === "conversation" &&
      (role === "user" || role === "assistant") &&
      text !== undefined &&
      createdAt !== undefined
    ) {
      into.push({ id, role, text, createdAt });
    }
    if (children != null) collectMessages(children, into);
  }
  return into;
}

/** The part of a timeline page this plugin reads. */
interface TimelinePage {
  rows: readonly unknown[];
  timelinePage: {
    olderCursor: { anchorId: string; anchorSeq: number } | null;
  };
}

const seedEventSchema = z.object({
  data: z.object({
    input: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }),
});

export default function plugin(alia: AliaPluginApi) {
  async function listSideChatThreads(
    sourceThreadId: string,
  ): Promise<SideChatThread[]> {
    const found: SideChatThread[] = [];
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const page = await alia.sdk.threads.list({
        sourceThreadId,
        originKind: "fork",
        originPluginId: SIDE_CHAT_PLUGIN_ID,
        includeHidden: true,
        archived: false,
        limit: LIST_PAGE_SIZE,
        offset,
      });
      for (const thread of page) {
        found.push({
          id: thread.id,
          title: thread.title,
          createdAt: thread.createdAt,
        });
      }
      if (page.length < LIST_PAGE_SIZE) break;
    }
    return found.sort((left, right) => left.createdAt - right.createdAt);
  }

  /** True once the user has sent the side chat a message. */
  async function hasStartedTurn(threadId: string): Promise<boolean> {
    const events = await alia.sdk.threads.events.list({
      threadId,
      types: ["turn/started"],
      limit: "1",
    });
    return events.length > 0;
  }

  /** The text the side chat quotes, or null when it was started without one. */
  async function readAnchorText(threadId: string): Promise<string | null> {
    const events = await alia.sdk.threads.events.list({
      threadId,
      types: ["client/turn/requested"],
      limit: "1",
    });
    const seed = seedEventSchema.safeParse(events[0]);
    if (!seed.success) return null;
    for (const item of seed.data.data.input) {
      if (item.type !== "text" || item.text === undefined) continue;
      const anchor = parseReplySeed(item.text);
      if (anchor !== null) return anchor;
    }
    return null;
  }

  /**
   * Read the main thread's messages, newest page first, until every pending
   * side chat has its message or the history ends.
   */
  async function resolvePending(
    sourceThreadId: string,
    pending: readonly (SideChatThread & { anchorText: string | null })[],
  ): Promise<Map<string, Resolved>> {
    const resolved = new Map<string, Resolved>();
    const messages: SourceMessage[] = [];
    let before: { beforeAnchorId: string; beforeAnchorSeq: string } | null =
      null;
    for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
      const timeline: TimelinePage = await alia.sdk.threads.timeline({
        threadId: sourceThreadId,
        includeNestedRows: "true",
        ...before,
      });
      collectMessages(timeline.rows, messages);
      const older = timeline.timelinePage.olderCursor;
      before =
        older === null
          ? null
          : {
              beforeAnchorId: older.anchorId,
              beforeAnchorSeq: String(older.anchorSeq),
            };
      const reachedStart = older === null;
      let waiting = false;
      for (const chat of pending) {
        const match = matchSourceMessage({
          anchorText: chat.anchorText,
          forkCreatedAt: chat.createdAt,
          messages,
        });
        // "latest" is a fallback: with a quote to find, keep reading older
        // pages before settling for it.
        const settled =
          match !== null &&
          (match.kind !== "latest" || chat.anchorText === null || reachedStart);
        if (match !== null && settled) {
          resolved.set(chat.id, {
            messageId: match.messageId,
            messageText: (
              messages.find((message) => message.id === match.messageId)
                ?.text ?? ""
            )
              .trim()
              .slice(0, MESSAGE_TEXT_LENGTH),
            anchorText: chat.anchorText ?? "",
          });
        } else {
          waiting = true;
        }
      }
      if (!waiting || reachedStart) break;
    }
    return resolved;
  }

  async function listSideChats(sourceThreadId: string): Promise<SideChat[]> {
    const threads = await listSideChatThreads(sourceThreadId);
    const known = new Map<string, Resolved>();
    const pending: (SideChatThread & { anchorText: string | null })[] = [];
    for (const thread of threads) {
      const stored = resolvedSchema.safeParse(
        await alia.storage.kv.get(`${RESOLVED_KEY_PREFIX}${thread.id}`),
      );
      if (stored.success) {
        known.set(thread.id, stored.data);
        continue;
      }
      // A side chat that was opened and never used gets no link.
      if (!(await hasStartedTurn(thread.id))) continue;
      pending.push({ ...thread, anchorText: await readAnchorText(thread.id) });
    }
    if (pending.length > 0) {
      const resolved = await resolvePending(sourceThreadId, pending);
      for (const [threadId, value] of resolved) {
        known.set(threadId, value);
        await alia.storage.kv.set(`${RESOLVED_KEY_PREFIX}${threadId}`, value);
      }
    }
    const pendingById = new Map(pending.map((chat) => [chat.id, chat]));
    const sideChats: SideChat[] = [];
    for (const thread of threads) {
      const resolved = known.get(thread.id);
      const unresolved = pendingById.get(thread.id);
      if (resolved === undefined && unresolved === undefined) continue;
      sideChats.push({
        threadId: thread.id,
        messageId: resolved?.messageId ?? null,
        messageText: resolved?.messageText ?? "",
        anchorText: resolved?.anchorText ?? unresolved?.anchorText ?? "",
        title: thread.title,
        createdAt: thread.createdAt,
      });
    }
    return sideChats;
  }

  alia.rpc.register(rpcContract, {
    async listSideChats({ threadId }) {
      return { sideChats: await listSideChats(threadId) };
    },
    // The name is the side chat thread's own title, so VesnALIA shows it wherever
    // it shows that thread.
    async renameSideChat({ threadId, title }) {
      const thread = await alia.sdk.threads.get({ threadId });
      const sourceThreadId = sideChatSourceThreadId(thread);
      if (sourceThreadId === null) {
        throw new Error("Only a side chat can be renamed here.");
      }
      const next = title.length > 0 ? title : null;
      await alia.sdk.threads.update({ threadId, title: next });
      alia.rpc.experimental_invalidate([sourceThreadTag(sourceThreadId)]);
      return { title: next };
    },
  });

  // A side chat appearing, getting its first message, or going away changes
  // what its main thread's messages show.
  function refreshSourceThread(thread: ForkOrigin): void {
    const sourceThreadId = sideChatSourceThreadId(thread);
    if (sourceThreadId !== null) {
      alia.rpc.experimental_invalidate([sourceThreadTag(sourceThreadId)]);
    }
  }
  for (const event of [
    "thread.created",
    "thread.active",
    "thread.archived",
    "thread.unarchived",
  ] as const) {
    alia.events.on(event, ({ thread }) => refreshSourceThread(thread));
  }
  alia.events.on("thread.deleted", async ({ thread }) => {
    refreshSourceThread(thread);
    if (sideChatSourceThreadId(thread) !== null) {
      await alia.storage.kv.delete(`${RESOLVED_KEY_PREFIX}${thread.id}`);
    }
  });
}
