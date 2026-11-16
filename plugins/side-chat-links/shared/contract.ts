// The RPC contract shared by server.ts and app.tsx.
import { defineRpcContract } from "@vesnalia/plugin-sdk";
import { z } from "zod";

export const sideChatSchema = z
  .object({
    /** The side chat's own thread. */
    threadId: z.string(),
    /** The main-thread message it belongs to; null when none was found. */
    messageId: z.string().nullable(),
    /** The start of that message's text; empty when it is not known. */
    messageText: z.string(),
    /** The quoted text the side chat replies to; empty when it has none. */
    anchorText: z.string(),
    /** The name the user gave it; null until it is renamed. */
    title: z.string().nullable(),
    createdAt: z.number(),
  })
  .strict();
export type SideChat = z.infer<typeof sideChatSchema>;

/** Tag of every read that lists one main thread's side chats. */
export function sourceThreadTag(threadId: string): string {
  return `source-thread:${threadId}`;
}

/** Longest name a side chat can be given. */
export const SIDE_CHAT_TITLE_MAX_LENGTH = 80;

export const rpcContract = defineRpcContract({
  listSideChats: {
    tags: (input) => [sourceThreadTag(input.threadId)],
    input: z.object({ threadId: z.string().trim().min(1) }).strict(),
    output: z.object({ sideChats: z.array(sideChatSchema) }).strict(),
  },
  /** Name a side chat. An empty title removes the name. */
  renameSideChat: {
    input: z
      .object({
        threadId: z.string().trim().min(1),
        title: z.string().trim().max(SIDE_CHAT_TITLE_MAX_LENGTH),
      })
      .strict(),
    output: z.object({ title: z.string().nullable() }).strict(),
  },
});
