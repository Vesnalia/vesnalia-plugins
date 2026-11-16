import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { BotMetadata } from "../contract";
import { conversationRoots, orderConversations } from "./conversation-order";

export async function listBotConversations(alia: AliaPluginApi, bot: BotMetadata, resolveOwner: (id: string, persist: boolean) => Promise<string | null>) {
  const rows: Awaited<ReturnType<typeof alia.sdk.threads.list>> = [];
  for (let offset = 0; ; offset += 100) {
    const page = await alia.sdk.threads.list({ archived: false, offset, limit: 100 });
    for (const row of page) {
      if (!row.archivedAt && !row.deletedAt && row.visibility !== "hidden" && await resolveOwner(row.id, false) === bot.id) rows.push(row);
    }
    if (page.length < 100) break;
  }
  const ordered = orderConversations(rows, bot.threadOrder);
  return { rows: ordered, roots: conversationRoots(ordered) };
}
