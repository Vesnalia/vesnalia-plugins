import { describe, expect, it } from "vitest";
import {
  matchSourceMessage,
  parseReplySeed,
  REPLY_SEED_PREFIX,
  type SourceMessage,
} from "./match";

const messages: SourceMessage[] = [
  { id: "u1", role: "user", text: "Delete the old branch.", createdAt: 10 },
  {
    id: "a1",
    role: "assistant",
    text: "The branch is at the same commit as `main`, so it is **safe** to delete.",
    createdAt: 20,
  },
  { id: "a2", role: "assistant", text: "I deleted the branch.", createdAt: 30 },
  { id: "a3", role: "assistant", text: "Anything else?", createdAt: 50 },
];

describe("parseReplySeed", () => {
  it("returns the quoted text", () => {
    expect(parseReplySeed(`${REPLY_SEED_PREFIX}I deleted the branch.`)).toBe(
      "I deleted the branch.",
    );
  });

  it("returns null for text without the prefix or without a quote", () => {
    expect(parseReplySeed("I deleted the branch.")).toBeNull();
    expect(parseReplySeed(REPLY_SEED_PREFIX)).toBeNull();
  });
});

describe("matchSourceMessage", () => {
  it("links a whole-message quote to that message", () => {
    expect(
      matchSourceMessage({
        anchorText: "I deleted the branch.",
        forkCreatedAt: 60,
        messages,
      }),
    ).toEqual({ messageId: "a2", kind: "exact" });
  });

  it("links selected text to the message that contains it", () => {
    // A selection is rendered text: the Markdown marks are gone.
    expect(
      matchSourceMessage({
        anchorText: "same commit as main, so it is safe",
        forkCreatedAt: 60,
        messages,
      }),
    ).toEqual({ messageId: "a1", kind: "partial" });
  });

  it("links a side chat without a quote to the last response before it", () => {
    expect(
      matchSourceMessage({ anchorText: null, forkCreatedAt: 40, messages }),
    ).toEqual({ messageId: "a2", kind: "latest" });
  });

  it("falls back to the last response when the quote is not found", () => {
    expect(
      matchSourceMessage({
        anchorText: "text that is in no message",
        forkCreatedAt: 60,
        messages,
      }),
    ).toEqual({ messageId: "a3", kind: "latest" });
  });

  it("ignores messages written after the side chat was created", () => {
    expect(
      matchSourceMessage({
        anchorText: "Anything else?",
        forkCreatedAt: 40,
        messages,
      }),
    ).toEqual({ messageId: "a2", kind: "latest" });
  });

  it("does not match a short selection by accident", () => {
    expect(
      matchSourceMessage({ anchorText: "the", forkCreatedAt: 60, messages }),
    ).toEqual({ messageId: "a3", kind: "latest" });
  });

  it("returns null when the thread has no message yet", () => {
    expect(
      matchSourceMessage({ anchorText: null, forkCreatedAt: 60, messages: [] }),
    ).toBeNull();
  });
});
