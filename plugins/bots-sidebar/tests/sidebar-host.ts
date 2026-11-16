import { renderSlot as renderSdkSlot } from "@vesnalia/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@vesnalia/plugin-sdk/testing/app";
import { makeThreadResponse } from "@vesnalia/plugin-sdk/testing";

// The SDK deliberately doesn't emulate VesnALIA's registered thread actions. Supply
// explicit test doubles; lifecycle tests control the resulting sidebar snapshot.
export function renderSlot<Props extends object>(registration: { component: React.ComponentType<Props> }, props: Props, options: RenderSlotOptions = {}) {
  const nativeActionCalls: Array<{ key: string; threadId: string }> = [];
  const slot = renderSdkSlot(registration, props, {
    ...options,
    sdk: { ...options.sdk, threads: {
      update: async ({ threadId, title }) => makeThreadResponse({ id: threadId, title }),
      ...options.sdk?.threads,
    } },
    threadActions: options.threadActions ?? ((thread, { requestRename }) => [
      { key: "alia--core/rename", pluginId: "alia--core", group: "settings", action: { label: "Rename…", icon: "Pencil", run: async () => requestRename(thread.id) } },
      ...[
        ["open-in-split", "Open in split"],
        [thread.isUnread ? "mark-read" : "mark-unread", thread.isUnread ? "Mark as read" : "Mark as unread"],
        ["archive", "Archive conversation"],
      ].map(([id, label]) => ({
        key: `alia--core/${id}`, pluginId: "alia--core", group: "lifecycle",
        action: { label: label!, icon: "Archive" as const, run: async () => { nativeActionCalls.push({ key: `alia--core/${id}`, threadId: thread.id }); } },
      })),
    ]),
  });
  return Object.assign(slot, { nativeActionCalls });
}
