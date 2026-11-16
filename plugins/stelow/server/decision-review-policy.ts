/**
 * The independent-review gate policy: one owned singleton row, off or
 * required. Reads degrade to `off` — a missing or unreadable row never
 * blocks a board; writes publish so open review gates refresh.
 */
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { DecisionStore, Mode } from "./decision-store.js";

export interface DecisionReviewPolicyDeps {
  alia: AliaPluginApi;
  store: DecisionStore;
  now: () => number;
}

export function decisionReviewPolicyHandlers(ctx: DecisionReviewPolicyDeps) {
  const { alia, store, now } = ctx;
  return {
    async getReviewPolicy() {
      return store.readReviewPolicy();
    },
    async setReviewPolicy({ mode }: { mode: Mode }) {
      store.saveReviewPolicy(mode, now);
      alia.realtime.publish("board-changed", { reviewPolicy: mode });
      return { ok: true, error: null };
    },
  };
}
