// The names side chats and their groups go by.
import type { SideChat } from "./contract";

type Labelled = Pick<SideChat, "threadId" | "messageId" | "title">;

/**
 * The name of a side chat the user has not named: "Side chat" for a message's
 * only side chat; "Side chat 1", "Side chat 2", in creation order, when the
 * message has several. `sideChats` is every side chat of the thread, oldest
 * first.
 */
export function defaultSideChatLabel(
  sideChats: readonly Pick<Labelled, "threadId" | "messageId">[],
  threadId: string,
): string {
  const sideChat = sideChats.find((entry) => entry.threadId === threadId);
  if (sideChat === undefined) return "Side chat";
  const siblings = sideChats.filter(
    (entry) => entry.messageId === sideChat.messageId,
  );
  return siblings.length === 1
    ? "Side chat"
    : `Side chat ${siblings.indexOf(sideChat) + 1}`;
}

/** The name the user gave the side chat, or its default name. */
export function sideChatLabel(
  sideChats: readonly Labelled[],
  threadId: string,
): string {
  const title = sideChats
    .find((entry) => entry.threadId === threadId)
    ?.title?.trim();
  return title ? title : defaultSideChatLabel(sideChats, threadId);
}

/** What a message's link says about the side chats it leads to. */
export function linkDescription(labels: readonly string[]): string {
  return labels.length === 1
    ? `Open side chat: ${labels[0]}`
    : `Open ${labels.length} side chats: ${labels.join(", ")}`;
}

const GROUP_TITLE_LENGTH = 28;

/**
 * The name of a message's group of side chats, used as its panel tab's
 * title: the start of the message, as plain text. A panel tab keeps the title
 * it opened with, so the title comes from the message, which does not change,
 * and not from the side chats, which can be renamed and added to.
 */
export function groupTitle(
  group: readonly Pick<SideChat, "messageText" | "anchorText">[],
): string {
  const source =
    group.find((entry) => entry.messageText.trim().length > 0)?.messageText ??
    group.find((entry) => entry.anchorText.trim().length > 0)?.anchorText ??
    "";
  // Markdown marks would read as noise in a tab title.
  const plain = source
    .replace(/[*_`#>~[\]]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length === 0) return "Side chats";
  return plain.length <= GROUP_TITLE_LENGTH
    ? plain
    : `${plain.slice(0, GROUP_TITLE_LENGTH).trimEnd()}…`;
}
