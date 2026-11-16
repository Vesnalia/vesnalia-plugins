/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Per-window store shared by the content script (gestures + DOM application) and the settings section (buttons).
 * Persists to localStorage so sizes are per device and survive reloads; other windows of the same origin follow via the `storage` event.
 *
 * FNXC:PinchZoom 2026-11-13-13:11:
 * Also holds the plugin-settings config (scope and ratios). Settings are only readable through the `useSettings` hook, so an app-overlay bridge component pushes them in with `setZoomConfig`; the content script never reads settings itself.
 */
import {
  DEFAULT_ZOOM_CONFIG,
  parseStoredState,
  serializeState,
  STORAGE_KEY,
  withValue,
  type ZoomConfig,
  type ZoomState,
  type ZoomTarget,
} from "./zoom-core";

export interface ZoomSnapshot {
  state: ZoomState;
  config: ZoomConfig;
}

type Listener = (snapshot: ZoomSnapshot) => void;

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let snapshot: ZoomSnapshot = {
  state: parseStoredState(typeof window === "undefined" ? null : readStorage()),
  config: DEFAULT_ZOOM_CONFIG,
};
const listeners = new Set<Listener>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const listener of listeners) listener(snapshot);
}

function persistSoon(): void {
  // Gestures update every frame; write storage once the values settle.
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeState(snapshot.state));
    } catch {
      // Private mode or full storage: the size still applies for this session.
    }
  }, 250);
}

/** Immutable snapshot; a new object on every change (safe for useSyncExternalStore). */
export function getZoomSnapshot(): ZoomSnapshot {
  return snapshot;
}

export function setZoomValue(target: ZoomTarget, value: number): void {
  setZoomState(withValue(snapshot.state, snapshot.config, target, value));
}

export function setZoomState(next: ZoomState): void {
  const { state } = snapshot;
  if (
    next.textScale === state.textScale &&
    next.terminalAdjust === state.terminalAdjust
  ) {
    return;
  }
  snapshot = { ...snapshot, state: next };
  persistSoon();
  emit();
}

export function setZoomConfig(config: ZoomConfig): void {
  const current = snapshot.config;
  if (
    config.scope === current.scope &&
    config.composerRatio === current.composerRatio &&
    config.terminalRatio === current.terminalRatio
  ) {
    return;
  }
  snapshot = { ...snapshot, config };
  emit();
}

export function subscribeZoom(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Follows changes made in another window/tab of the same origin. */
export function watchOtherWindows(signal: AbortSignal): void {
  window.addEventListener(
    "storage",
    (event) => {
      if (event.key !== STORAGE_KEY) return;
      snapshot = { ...snapshot, state: parseStoredState(event.newValue) };
      emit();
    },
    { signal },
  );
}
