import { describe, expect, it } from "vitest";
import {
  defaultSideChatLabel,
  groupTitle,
  linkDescription,
  sideChatLabel,
} from "./label";

function sideChat(threadId: string, messageId: string, title?: string) {
  return { threadId, messageId, title: title ?? null };
}

describe("sideChatLabel", () => {
  it("has no number for a message's only side chat", () => {
    const sideChats = [sideChat("s1", "a1"), sideChat("s2", "a2")];
    expect(sideChatLabel(sideChats, "s1")).toBe("Side chat");
    expect(sideChatLabel(sideChats, "s2")).toBe("Side chat");
  });

  it("numbers the side chats of one message in order", () => {
    const sideChats = [
      sideChat("s1", "a1"),
      sideChat("s2", "a2"),
      sideChat("s3", "a1"),
    ];
    expect(sideChatLabel(sideChats, "s1")).toBe("Side chat 1");
    expect(sideChatLabel(sideChats, "s3")).toBe("Side chat 2");
    expect(sideChatLabel(sideChats, "s2")).toBe("Side chat");
  });

  it("uses the name the user gave", () => {
    const sideChats = [
      sideChat("s1", "a1", "Vault question"),
      sideChat("s2", "a1"),
    ];
    expect(sideChatLabel(sideChats, "s1")).toBe("Vault question");
    // Naming one does not renumber the other.
    expect(sideChatLabel(sideChats, "s2")).toBe("Side chat 2");
    expect(defaultSideChatLabel(sideChats, "s1")).toBe("Side chat 1");
  });

  it("treats a blank name as no name", () => {
    expect(sideChatLabel([sideChat("s1", "a1", "  ")], "s1")).toBe(
      "Side chat",
    );
  });
});

describe("linkDescription", () => {
  it("names a single side chat", () => {
    expect(linkDescription(["Vault question"])).toBe(
      "Open side chat: Vault question",
    );
  });

  it("counts and names several", () => {
    expect(linkDescription(["Side chat 1", "Vault question"])).toBe(
      "Open 2 side chats: Side chat 1, Vault question",
    );
  });
});

describe("groupTitle", () => {
  it("is the start of the message as plain text", () => {
    expect(
      groupTitle([
        {
          messageText: "I deleted `bends-and-resolve` both locally and on GitHub.",
          anchorText: "",
        },
      ]),
    ).toBe("I deleted bends-and-resolve…");
  });

  it("keeps a short message whole", () => {
    expect(groupTitle([{ messageText: "**Done.**", anchorText: "" }])).toBe(
      "Done.",
    );
  });

  it("falls back to the quoted text, then to a plain name", () => {
    expect(
      groupTitle([{ messageText: "", anchorText: "Anything else?" }]),
    ).toBe("Anything else?");
    expect(groupTitle([{ messageText: "", anchorText: "" }])).toBe(
      "Side chats",
    );
  });
});
