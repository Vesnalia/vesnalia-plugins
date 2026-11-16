// A tiny module-level store shared by the React panel and the content
// script. Both are compiled into the same app bundle, so they see the same
// module instance. The panel writes the query; the content script paints
// highlights and services jump requests.

import type { MatcherOptions } from "./search-core";

export interface SearchHit {
  /** The `data-timeline-row-id` of the message row. */
  rowId: string;
  /** The top-level row that contains it; equal to `rowId` for top-level rows. */
  topRowId: string;
  /** Zero-based occurrence index within that row. */
  index: number;
}

export interface SearchState extends MatcherOptions {
  query: string;
  current: SearchHit | null;
}

type Listener = (state: SearchState) => void;
type JumpListener = (hit: SearchHit) => void;

const initial: SearchState = {
  query: "",
  caseSensitive: false,
  regex: false,
  current: null,
};

let state: SearchState = initial;
/** Position of each top-level timeline row, oldest first, from the last search. */
let rowPositions = new Map<string, number>();
const listeners = new Set<Listener>();
const jumpListeners = new Set<JumpListener>();

export const searchStore = {
  get(): SearchState {
    return state;
  },
  set(patch: Partial<SearchState>): void {
    const next = { ...state, ...patch };
    if (
      next.query === state.query &&
      next.caseSensitive === state.caseSensitive &&
      next.regex === state.regex &&
      next.current?.rowId === state.current?.rowId &&
      next.current?.index === state.current?.index
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener(state);
  },
  clear(): void {
    rowPositions = new Map();
    searchStore.set(initial);
  },
  setRowOrder(order: readonly string[]): void {
    rowPositions = new Map(order.map((id, index) => [id, index]));
  },
  /** Timeline position of a top-level row, or undefined if it is unknown. */
  rowPosition(id: string): number | undefined {
    return rowPositions.get(id);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Ask the content script to scroll a hit into view and mark it current. */
  requestJump(hit: SearchHit): void {
    searchStore.set({ current: hit });
    for (const listener of jumpListeners) listener(hit);
  },
  onJump(listener: JumpListener): () => void {
    jumpListeners.add(listener);
    return () => {
      jumpListeners.delete(listener);
    };
  },
};
