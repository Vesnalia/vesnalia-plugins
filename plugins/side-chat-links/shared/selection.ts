// Which side chat a group's panel tab shows.
import type { SideChat } from "./contract";

/**
 * The side chat to show: the remembered one while it is still in the group,
 * otherwise the group's newest. `group` is oldest first.
 */
export function resolveSelected<T extends Pick<SideChat, "threadId">>(
  group: readonly T[],
  remembered: string | null,
): T | null {
  return (
    group.find((entry) => entry.threadId === remembered) ??
    group.at(-1) ??
    null
  );
}

/**
 * A thread's side chats as groups, one per message, in the order each
 * message got its first side chat. Side chats whose message is not known
 * form one last group with a null message.
 */
export function groupByMessage<T extends Pick<SideChat, "messageId">>(
  sideChats: readonly T[],
): { messageId: string | null; sideChats: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const sideChat of sideChats) {
    const group = groups.get(sideChat.messageId);
    if (group) group.push(sideChat);
    else groups.set(sideChat.messageId, [sideChat]);
  }
  const unknown = groups.get(null);
  groups.delete(null);
  const ordered = [...groups].map(([messageId, group]) => ({
    messageId,
    sideChats: group,
  }));
  return unknown === undefined
    ? ordered
    : [...ordered, { messageId: null, sideChats: unknown }];
}
