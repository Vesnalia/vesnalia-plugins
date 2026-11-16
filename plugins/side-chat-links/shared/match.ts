// Finds which message of the main thread a side chat was started from.
//
// VesnALIA does not record the source message of a side chat. The only trace is the
// quoted text the Side chat plugin gives the agent as context, so the message
// is found by comparing that quote with the main thread's messages.

/**
 * The text the bundled Side chat plugin puts before the quoted message in the
 * side chat's first, agent-only input (`REPLY_SEED_PREFIX` in its server.ts).
 */
export const REPLY_SEED_PREFIX =
  "Replying to this earlier message in the conversation:\n\n";

/** One user or assistant message of the main thread. */
export interface SourceMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

export type MatchKind = "exact" | "partial" | "latest";

export interface MessageMatch {
  messageId: string;
  kind: MatchKind;
}

/** A partial quote shorter than this is too likely to match by accident. */
const MIN_PARTIAL_LENGTH = 8;

/**
 * Letters and digits only. A quote taken from a text selection is rendered
 * text, while a message's text is Markdown source, so punctuation and
 * whitespace differ between the two.
 */
function compact(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

/** The quoted text of a side chat's first input, or null when it has none. */
export function parseReplySeed(text: string): string | null {
  if (!text.startsWith(REPLY_SEED_PREFIX)) return null;
  const quoted = text.slice(REPLY_SEED_PREFIX.length).trim();
  return quoted.length > 0 ? quoted : null;
}

function latest(messages: readonly SourceMessage[]): SourceMessage | null {
  let found: SourceMessage | null = null;
  for (const message of messages) {
    if (found === null || message.createdAt >= found.createdAt) found = message;
  }
  return found;
}

/**
 * Pick the message a side chat belongs to. `messages` is the main thread's
 * messages in any order.
 *
 * 1. A message whose whole text is the quote ("Reply in side chat" on a
 *    message).
 * 2. A message that contains the quote (a reply to selected text).
 * 3. The last response written before the side chat was created ("Start side
 *    chat" has no quote, and a quote can fail to match).
 */
export function matchSourceMessage(args: {
  anchorText: string | null;
  forkCreatedAt: number;
  messages: readonly SourceMessage[];
}): MessageMatch | null {
  const before = args.messages.filter(
    (message) => message.createdAt <= args.forkCreatedAt,
  );
  const anchor = args.anchorText?.trim() ?? "";
  if (anchor.length > 0) {
    const sameText = latest(
      before.filter((message) => message.text.trim() === anchor),
    );
    if (sameText !== null) return { messageId: sameText.id, kind: "exact" };

    const compactAnchor = compact(anchor);
    if (compactAnchor.length > 0) {
      const sameCompact = latest(
        before.filter((message) => compact(message.text) === compactAnchor),
      );
      if (sameCompact !== null) {
        return { messageId: sameCompact.id, kind: "exact" };
      }
    }
    if (compactAnchor.length >= MIN_PARTIAL_LENGTH) {
      const containing = latest(
        before.filter((message) =>
          compact(message.text).includes(compactAnchor),
        ),
      );
      if (containing !== null) {
        return { messageId: containing.id, kind: "partial" };
      }
    }
  }
  const lastResponse =
    latest(before.filter((message) => message.role === "assistant")) ??
    latest(before);
  return lastResponse === null
    ? null
    : { messageId: lastResponse.id, kind: "latest" };
}
