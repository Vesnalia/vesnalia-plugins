/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Pure sizing math and persistence parsing for the Pinch Zoom plugin.
 * Kept free of DOM access so it can be unit-tested with `node --test`.
 *
 * Requirements:
 * - Pinch/zoom gestures change two independent sizes: app text size (a scale of the root font size) and terminal text size (xterm font size in px).
 * - Both sizes persist per device (localStorage), because a phone and a desktop want different sizes.
 * - Sizes are clamped so a stray gesture cannot make the app unusable.
 *
 * FNXC:PinchZoom 2026-11-13-13:11:
 * New requirements: plugin settings set the composer and terminal sizes relative to the text size, and choose whether text scaling resizes the whole app or only chat, composer and terminal.
 * - The text scale (pinch outside a terminal) is the master size; composer and terminal follow it through their configured ratios.
 * - Pinching over a terminal still fine-tunes that terminal on this device: it is stored as a per-device multiplier on top of the ratio, so the terminal keeps following later text-size changes.
 * - Ratios and scope are plugin settings (shared by every device); the text scale and terminal fine-tune stay per device.
 */

/** Per-device state, changed by gestures and the settings section buttons. */
export interface ZoomState {
  /** Master text scale: 1 = bb's default size. */
  textScale: number;
  /** Per-device terminal fine-tune from pinching over a terminal; 1 = exactly the configured ratio. */
  terminalAdjust: number;
}

/** What text scaling resizes. */
export type ZoomScope = "app" | "content";

/** Plugin settings, shared by every device. */
export interface ZoomConfig {
  scope: ZoomScope;
  /** Composer size relative to the text scale. */
  composerRatio: number;
  /** Terminal size relative to the text scale. */
  terminalRatio: number;
}

export type ZoomTarget = "text" | "terminal";

export const TEXT_SCALE_MIN = 0.75;
export const TEXT_SCALE_MAX = 2;
export const TEXT_SCALE_DEFAULT = 1;
/** Step used by the settings buttons. */
export const TEXT_SCALE_STEP = 0.05;

export const TERMINAL_FONT_MIN = 8;
export const TERMINAL_FONT_MAX = 32;
/** Matches the hard-coded `fontSize: 12` in bb's ThreadTerminalView. */
export const TERMINAL_FONT_BASE = 12;

export const RATIO_MIN = 0.5;
export const RATIO_MAX = 2;
const ADJUST_MIN = 0.25;
const ADJUST_MAX = 4;

export const DEFAULT_ZOOM_STATE: ZoomState = {
  textScale: TEXT_SCALE_DEFAULT,
  terminalAdjust: 1,
};

/** FNXC:PinchZoom 2026-11-13-13:39: Default scope is chat, composer and terminal only; whole-app scaling is opt-in. */
export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  scope: "content",
  composerRatio: 1,
  terminalRatio: 1,
};

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Text scale snaps to whole percents, with a small detent at 100% so the user can pinch back to the default without overshooting.
 */
export function normalizeTextScale(value: number): number {
  const clamped = clamp(value, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
  if (Math.abs(clamped - TEXT_SCALE_DEFAULT) < 0.03) return TEXT_SCALE_DEFAULT;
  return Math.round(clamped * 100) / 100;
}

function normalizeAdjust(value: number): number {
  const clamped = clamp(value, ADJUST_MIN, ADJUST_MAX);
  if (Math.abs(clamped - 1) < 0.005) return 1;
  return Math.round(clamped * 1000) / 1000;
}

function normalizeRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 1;
  return Math.round(clamp(value, RATIO_MIN, RATIO_MAX) * 100) / 100;
}

/** Turns raw plugin setting values (untrusted) into a config. */
export function parseConfig(values: Record<string, unknown> | undefined): ZoomConfig {
  return {
    scope: values?.scope === "app" ? "app" : "content",
    composerRatio: normalizeRatio(values?.composerScale),
    terminalRatio: normalizeRatio(values?.terminalScale),
  };
}

/** Effective terminal font size in whole px (fractional sizes render blurry glyphs). */
export function terminalFontPx(state: ZoomState, config: ZoomConfig): number {
  const raw = TERMINAL_FONT_BASE * state.textScale * config.terminalRatio * state.terminalAdjust;
  return Math.round(clamp(raw, TERMINAL_FONT_MIN, TERMINAL_FONT_MAX));
}

/** The terminal fine-tune that produces `px` at the current text scale and ratio. */
export function adjustForTerminalPx(
  px: number,
  state: ZoomState,
  config: ZoomConfig,
): number {
  const target = clamp(px, TERMINAL_FONT_MIN, TERMINAL_FONT_MAX);
  return normalizeAdjust(
    target / (TERMINAL_FONT_BASE * state.textScale * config.terminalRatio),
  );
}

/**
 * FNXC:PinchZoom 2026-11-13-13:11:
 * Where each scale is applied.
 * - "app": the root font size scales every rem-sized element (sidebar, headers, chat); the composer only needs its ratio on top.
 * - "content": the root is untouched; the chat timeline and composer use CSS `zoom` because bb sizes chat text in rem, which a container font size cannot change.
 */
export interface AppliedScales {
  root: number;
  timeline: number;
  composer: number;
}

export function appliedScales(state: ZoomState, config: ZoomConfig): AppliedScales {
  const s = state.textScale;
  return config.scope === "app"
    ? { root: s, timeline: 1, composer: config.composerRatio }
    : { root: 1, timeline: s, composer: round3(s * config.composerRatio) };
}

/**
 * FNXC:PinchZoom 2026-11-13-16:35:
 * User requirement: the composer text size follows the chat text size, not just its scale factor.
 * bb sizes the two differently on phones (chat 15px, composer 16px; both 13px on desktop), so scaling both by the same factor kept the composer larger than chat.
 * The composer zoom therefore also corrects for the measured base sizes, so composer text = chat text × the composer ratio.
 * `minComposerPx` keeps the composer at or above 16px on iOS, where a smaller focused field makes Safari zoom the whole page; that is why bb uses 16px there.
 *
 * @param baseZoom composer zoom before correction (`appliedScales().composer`)
 * @param chatPx chat message font size with no plugin zoom applied
 * @param composerPx composer editor font size with no plugin zoom applied
 */
export function composerFollowZoom(
  baseZoom: number,
  chatPx: number,
  composerPx: number,
  minComposerPx = 0,
): number {
  if (!(chatPx > 0) || !(composerPx > 0)) return round3(baseZoom);
  let zoom = (baseZoom * chatPx) / composerPx;
  if (minComposerPx > 0 && composerPx * zoom < minComposerPx) zoom = minComposerPx / composerPx;
  return round3(zoom);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Current displayed value: text scale, or effective terminal px. */
export function valueOf(state: ZoomState, config: ZoomConfig, target: ZoomTarget): number {
  return target === "text" ? state.textScale : terminalFontPx(state, config);
}

/** Sets a displayed value: text scale directly, or terminal px via the fine-tune multiplier. */
export function withValue(
  state: ZoomState,
  config: ZoomConfig,
  target: ZoomTarget,
  value: number,
): ZoomState {
  if (target === "text") return { ...state, textScale: normalizeTextScale(value) };
  return { ...state, terminalAdjust: adjustForTerminalPx(value, state, config) };
}

/** Value for a pinch: the value at gesture start times the gesture's scale. */
export function pinchValue(startValue: number, gestureScale: number): number {
  if (!Number.isFinite(gestureScale) || gestureScale <= 0) return startValue;
  return startValue * gestureScale;
}

/**
 * Terminal px for a terminal pinch/wheel step. Whole-pixel sizes would swallow small trackpad deltas, so a change always moves at least 1px in its direction.
 */
export function nextTerminalPx(currentPx: number, factor: number): number {
  const next = Math.round(currentPx * factor);
  if (next === currentPx && factor !== 1) return currentPx + (factor > 1 ? 1 : -1);
  return next;
}

/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Trackpad pinch in Chromium/Electron arrives as `wheel` events with `ctrlKey` set and small deltas.
 * A mouse ctrl+wheel notch reports ~100, so the delta is clamped to keep one notch to about ±20%.
 * Returns the multiplicative factor for one event (deltaY < 0 = zoom in).
 */
export function wheelScaleFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;
  // deltaMode 1 = lines, 2 = pages; convert to approximate pixels.
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -20, 20) * 0.01);
}

/**
 * Two-finger touch pinch scale: current finger distance over the starting distance.
 * Returns null while the start distance is too small to divide safely.
 */
export function touchPinchScale(
  startDistance: number,
  currentDistance: number,
): number | null {
  if (!(startDistance > 8) || !Number.isFinite(currentDistance)) return null;
  return currentDistance / startDistance;
}

export const STORAGE_KEY = "bb-plugin-pinch-zoom:v1";

/**
 * Parses persisted per-device state; anything malformed falls back to the defaults field by field.
 * FNXC:PinchZoom 2026-11-13-13:11: v0.1.0 stored an absolute `terminalFontSize`; it migrates to a fine-tune relative to the stored text scale.
 */
export function parseStoredState(raw: string | null): ZoomState {
  if (raw === null) return { ...DEFAULT_ZOOM_STATE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_ZOOM_STATE };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_ZOOM_STATE };
  }
  const record = parsed as Record<string, unknown>;
  const textScale =
    typeof record.textScale === "number"
      ? normalizeTextScale(record.textScale)
      : TEXT_SCALE_DEFAULT;
  let terminalAdjust = 1;
  if (typeof record.terminalAdjust === "number") {
    terminalAdjust = normalizeAdjust(record.terminalAdjust);
  } else if (typeof record.terminalFontSize === "number") {
    const px = clamp(record.terminalFontSize, TERMINAL_FONT_MIN, TERMINAL_FONT_MAX);
    terminalAdjust = normalizeAdjust(px / (TERMINAL_FONT_BASE * textScale));
  }
  return { textScale, terminalAdjust };
}

export function serializeState(state: ZoomState): string {
  return JSON.stringify({
    textScale: state.textScale,
    terminalAdjust: state.terminalAdjust,
  });
}

export function formatValue(target: ZoomTarget, value: number): string {
  return target === "text" ? `${Math.round(value * 100)}%` : `${value}px`;
}

/** Indicator text shown while pinching, e.g. "Text 115%" or "Terminal 14px". */
export function describeValue(target: ZoomTarget, value: number): string {
  return `${target === "text" ? "Text" : "Terminal"} ${formatValue(target, value)}`;
}
