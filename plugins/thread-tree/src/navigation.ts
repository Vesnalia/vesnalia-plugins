import type { AliaNavigate } from "@vesnalia/plugin-sdk/app";

export function openThread(navigate: Pick<AliaNavigate, "toThread">, threadId: string, split = false, events: EventTarget = window) {
  const request = new CustomEvent("thread-tree:open-thread", { cancelable: true, detail: { threadId, split } });
  if (events.dispatchEvent(request)) navigate.toThread(threadId, { split });
}
