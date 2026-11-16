import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

interface ReviewWork {
  turn: boolean;
  maintenance: Promise<void> | null;
}

const work = new WeakMap<AliaPluginApi, Map<string, ReviewWork>>();

function stateFor(alia: AliaPluginApi, targetKey: string) {
  let reviews = work.get(alia);
  if (!reviews) { reviews = new Map(); work.set(alia, reviews); }
  let state = reviews.get(targetKey);
  if (!state) { state = { turn: false, maintenance: null }; reviews.set(targetKey, state); }
  return { reviews, state };
}

/** Reserve the turn before waiting, so another question cannot queue behind it. */
export async function withReviewAgentTurn<T>(alia: AliaPluginApi, targetKey: string, run: () => Promise<T>): Promise<T> {
  const { reviews, state } = stateFor(alia, targetKey);
  if (state.turn) throw new Error("An answer is already in progress for this review.");
  state.turn = true;
  try {
    if (state.maintenance) await state.maintenance;
    return await run();
  } finally {
    state.turn = false;
    if (!state.maintenance) reviews.delete(targetKey);
  }
}

/** Maintenance yields to turns, while an already-started cleanup completes first. */
export async function withReviewAgentMaintenance(alia: AliaPluginApi, targetKey: string, run: () => Promise<void>): Promise<void> {
  const { reviews, state } = stateFor(alia, targetKey);
  if (state.turn || state.maintenance) return;
  let release!: () => void;
  state.maintenance = new Promise<void>((resolve) => { release = resolve; });
  try { await run(); }
  finally {
    state.maintenance = null;
    release();
    if (!state.turn) reviews.delete(targetKey);
  }
}
