import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export type Sdk = {
  plugins: Pick<AliaPluginApi["sdk"]["plugins"], "callRpc">;
  subscribe: AliaPluginApi["sdk"]["subscribe"];
};
export type ThreadEntry = Awaited<ReturnType<AliaPluginApi["sdk"]["threads"]["list"]>>[number];
export type EventRow = Awaited<ReturnType<AliaPluginApi["sdk"]["threads"]["events"]["list"]>>[number];
export interface MessageIndex { lastMessageAt: number | null; lastSeq: number }
export interface RecentRow { threadId: string; lastMessageAt: number }
export const MESSAGE_TYPES = ["client/turn/requested", "item/completed", "system/manager/user_message"] as const;

// Reference semantics for tests. The production reader is the read-only SQL worker.
export function messageTime(event: EventRow): number | null {
  let nonempty = false;
  if (event.type === "client/turn/requested") {
    if (event.data.initiator === "system" || event.data.retryOfRequestId) return null;
    nonempty = event.data.input.some(part => part.visibility !== "agent-only" && (
      part.type === "text" ? part.text.trim().length > 0 :
        part.type === "image" || part.type === "localImage" || part.type === "localFile"));
  } else if (event.type === "item/completed") {
    const item = event.data.item;
    nonempty = !item.parentToolCallId && (item.type === "agentMessage" || item.type === "plan") && item.text.trim().length > 0;
  } else if (event.type === "system/manager/user_message") {
    nonempty = event.data.text.trim().length > 0;
  }
  if (!nonempty) return null;
  if (!Number.isFinite(event.createdAt)) throw new Error("Некорректная дата сообщения ALIA");
  return event.createdAt;
}

export function topRecent(index: ReadonlyMap<string, MessageIndex>): RecentRow[] {
  return [...index].flatMap(([threadId, { lastMessageAt }]) =>
    lastMessageAt === null ? [] : [{ threadId, lastMessageAt }])
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt ||
      (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0)).slice(0, 50);
}
