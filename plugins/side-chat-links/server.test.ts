import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@vesnalia/plugin-sdk/testing";
import plugin from "./server";
import { REPLY_SEED_PREFIX } from "./shared/match";

const MAIN = "thr_main";

function sideChatThread(id: string, createdAt: number) {
  return makeThreadResponse({
    id,
    createdAt,
    originKind: "fork",
    originPluginId: "side-chat",
    sourceThreadId: MAIN,
    visibility: "hidden",
  });
}

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
  createdAt: number,
) {
  return { id, kind: "conversation", role, text, createdAt };
}

interface Scenario {
  /** Side chat id -> the quote it was started with, or null for none. */
  quotes: Record<string, string | null>;
  /** Side chats the user has written in. */
  used: string[];
  /** Timeline pages of the main thread, newest first. */
  pages: unknown[][];
}

async function setup(scenario: Scenario) {
  const threads = Object.keys(scenario.quotes).map((id, index) =>
    sideChatThread(id, 100 + index),
  );
  const { alia, harness } = createFakePluginHost({
    pluginId: "side-chat-links",
    sdk: {
      threads: {
        list: async () => threads,
        events: {
          list: async ({
            threadId,
            types,
          }: {
            threadId: string;
            types?: readonly string[];
          }) => {
            if (types?.[0] === "turn/started") {
              return scenario.used.includes(threadId) ? [{ seq: 10 }] : [];
            }
            const quote = scenario.quotes[threadId];
            return [
              {
                data: {
                  input:
                    quote == null
                      ? []
                      : [{ type: "text", text: `${REPLY_SEED_PREFIX}${quote}` }],
                },
              },
            ];
          },
        },
        timeline: async ({ beforeAnchorId }: { beforeAnchorId?: string }) => {
          const index =
            beforeAnchorId === undefined ? 0 : Number(beforeAnchorId);
          const hasOlder = index + 1 < scenario.pages.length;
          return {
            rows: scenario.pages[index] ?? [],
            timelinePage: {
              olderCursor: hasOlder
                ? { anchorId: String(index + 1), anchorSeq: index + 1 }
                : null,
            },
          };
        },
      },
    },
  });
  await plugin(alia);
  const list = async () =>
    (
      (await harness.behavior.callRpc("listSideChats", {
        threadId: MAIN,
      })) as { sideChats: { threadId: string; messageId: string | null }[] }
    ).sideChats;
  return { harness, list };
}

describe("renameSideChat", () => {
  async function setupRename(thread: ReturnType<typeof makeThreadResponse>) {
    const { alia, harness } = createFakePluginHost({
      pluginId: "side-chat-links",
      sdk: {
        threads: {
          get: async () => thread,
          update: async () => thread,
        },
      },
    });
    await plugin(alia);
    return harness;
  }

  it("saves the name as the side chat thread's title", async () => {
    const harness = await setupRename(sideChatThread("thr_side", 100));
    expect(
      await harness.behavior.callRpc("renameSideChat", {
        threadId: "thr_side",
        title: "  Vault question ",
      }),
    ).toEqual({ title: "Vault question" });
    expect(harness.inspection.sdk.callsTo("threads.update")).toEqual([
      [{ threadId: "thr_side", title: "Vault question" }],
    ]);
  });

  it("removes the name when the title is empty", async () => {
    const harness = await setupRename(sideChatThread("thr_side", 100));
    expect(
      await harness.behavior.callRpc("renameSideChat", {
        threadId: "thr_side",
        title: " ",
      }),
    ).toEqual({ title: null });
  });

  it("refuses a thread that is not a side chat", async () => {
    const harness = await setupRename(makeThreadResponse({ id: "thr_main" }));
    await expect(
      harness.behavior.callRpc("renameSideChat", {
        threadId: "thr_main",
        title: "New name",
      }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("threads.update")).toHaveLength(0);
  });
});

describe("listSideChats", () => {
  it("links a side chat to the message it quotes", async () => {
    const { list } = await setup({
      quotes: { thr_side: "I deleted the branch." },
      used: ["thr_side"],
      pages: [
        [
          message("u1", "user", "Delete the branch.", 10),
          message("a1", "assistant", "I deleted the branch.", 20),
          message("a2", "assistant", "Anything else?", 30),
        ],
      ],
    });
    expect(await list()).toMatchObject([
      {
        threadId: "thr_side",
        messageId: "a1",
        messageText: "I deleted the branch.",
      },
    ]);
  });

  it("leaves out a side chat the user never wrote in", async () => {
    const { list } = await setup({
      quotes: { thr_side: "I deleted the branch." },
      used: [],
      pages: [[message("a1", "assistant", "I deleted the branch.", 20)]],
    });
    expect(await list()).toEqual([]);
  });

  it("reads older pages to find the quoted message", async () => {
    const { list, harness } = await setup({
      quotes: { thr_side: "An early answer." },
      used: ["thr_side"],
      pages: [
        [message("a9", "assistant", "A late answer.", 90)],
        [message("a1", "assistant", "An early answer.", 20)],
      ],
    });
    expect(await list()).toMatchObject([{ messageId: "a1" }]);
    expect(harness.inspection.sdk.callsTo("threads.timeline")).toHaveLength(2);
  });

  it("links a side chat without a quote to the last response", async () => {
    const { list, harness } = await setup({
      quotes: { thr_side: null },
      used: ["thr_side"],
      pages: [
        [message("a9", "assistant", "A late answer.", 90)],
        [message("a1", "assistant", "An early answer.", 20)],
      ],
    });
    expect(await list()).toMatchObject([{ messageId: "a9" }]);
    expect(harness.inspection.sdk.callsTo("threads.timeline")).toHaveLength(1);
  });

  it("remembers a side chat's message", async () => {
    const { list, harness } = await setup({
      quotes: { thr_side: "I deleted the branch." },
      used: ["thr_side"],
      pages: [[message("a1", "assistant", "I deleted the branch.", 20)]],
    });
    await list();
    expect(await list()).toMatchObject([{ messageId: "a1" }]);
    expect(harness.inspection.sdk.callsTo("threads.timeline")).toHaveLength(1);
  });

  it("finds messages nested in a turn row", async () => {
    const { list } = await setup({
      quotes: { thr_side: "A nested answer." },
      used: ["thr_side"],
      pages: [
        [
          {
            id: "t1",
            kind: "turn",
            children: [message("a1", "assistant", "A nested answer.", 20)],
          },
        ],
      ],
    });
    expect(await list()).toMatchObject([{ messageId: "a1" }]);
  });
});
