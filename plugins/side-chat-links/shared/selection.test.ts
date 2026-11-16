import { describe, expect, it } from "vitest";
import { groupByMessage, resolveSelected } from "./selection";

const sideChats = [
  { threadId: "s1", messageId: "a1" },
  { threadId: "s2", messageId: "a2" },
  { threadId: "s3", messageId: "a1" },
];

describe("resolveSelected", () => {
  it("shows the remembered side chat", () => {
    expect(resolveSelected(sideChats, "s2")?.threadId).toBe("s2");
  });

  it("shows the newest when nothing is remembered or it is gone", () => {
    expect(resolveSelected(sideChats, null)?.threadId).toBe("s3");
    expect(resolveSelected(sideChats, "deleted")?.threadId).toBe("s3");
  });

  it("shows nothing for an empty group", () => {
    expect(resolveSelected([], "s1")).toBeNull();
  });
});

describe("groupByMessage", () => {
  it("groups side chats under their message", () => {
    expect(groupByMessage(sideChats)).toEqual([
      { messageId: "a1", sideChats: [sideChats[0], sideChats[2]] },
      { messageId: "a2", sideChats: [sideChats[1]] },
    ]);
  });

  it("puts side chats without a message last", () => {
    const lost = { threadId: "s0", messageId: null };
    expect(groupByMessage([lost, ...sideChats]).at(-1)).toEqual({
      messageId: null,
      sideChats: [lost],
    });
  });
});
