import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustForTerminalPx,
  appliedScales,
  composerFollowZoom,
  DEFAULT_ZOOM_CONFIG,
  DEFAULT_ZOOM_STATE,
  nextTerminalPx,
  normalizeTextScale,
  parseConfig,
  parseStoredState,
  pinchValue,
  serializeState,
  terminalFontPx,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  touchPinchScale,
  valueOf,
  wheelScaleFactor,
  withValue,
  type ZoomConfig,
} from "../lib/zoom-core.ts";

const cfg = (over: Partial<ZoomConfig> = {}): ZoomConfig => ({ ...DEFAULT_ZOOM_CONFIG, ...over });

test("text scale clamps, rounds, and snaps to 100%", () => {
  assert.equal(normalizeTextScale(5), TEXT_SCALE_MAX);
  assert.equal(normalizeTextScale(0.1), TEXT_SCALE_MIN);
  assert.equal(normalizeTextScale(Number.NaN), TEXT_SCALE_MIN);
  assert.equal(normalizeTextScale(1.02), 1);
  assert.equal(normalizeTextScale(1.234), 1.23);
});

test("terminal follows text scale times its ratio, in whole px within bounds", () => {
  assert.equal(terminalFontPx(DEFAULT_ZOOM_STATE, cfg()), 12);
  assert.equal(terminalFontPx({ textScale: 1.5, terminalAdjust: 1 }, cfg()), 18);
  assert.equal(terminalFontPx({ textScale: 1, terminalAdjust: 1 }, cfg({ terminalRatio: 1.25 })), 15);
  assert.equal(terminalFontPx({ textScale: 2, terminalAdjust: 4 }, cfg({ terminalRatio: 2 })), TERMINAL_FONT_MAX);
  assert.equal(terminalFontPx({ textScale: 0.75, terminalAdjust: 0.25 }, cfg()), TERMINAL_FONT_MIN);
});

test("terminal fine-tune hits the requested px and keeps following the text scale", () => {
  const state = withValue(DEFAULT_ZOOM_STATE, cfg(), "terminal", 18);
  assert.equal(state.terminalAdjust, 1.5);
  assert.equal(valueOf(state, cfg(), "terminal"), 18);
  const bigger = withValue(state, cfg(), "text", 1.2);
  assert.equal(terminalFontPx(bigger, cfg()), 22);
  assert.equal(adjustForTerminalPx(12, DEFAULT_ZOOM_STATE, cfg()), 1);
});

test("scope decides where scales apply", () => {
  const state = { textScale: 1.2, terminalAdjust: 1 };
  assert.deepEqual(appliedScales(state, cfg({ scope: "app", composerRatio: 1.1 })), { root: 1.2, timeline: 1, composer: 1.1 });
  assert.deepEqual(appliedScales(state, cfg({ scope: "content", composerRatio: 1.1 })), { root: 1, timeline: 1.2, composer: 1.32 });
});

test("composer text follows chat text, with the iOS 16px floor", () => {
  // Desktop: both 13px, so the zoom is unchanged.
  assert.equal(composerFollowZoom(1.49, 13, 13), 1.49);
  // Phone: chat 15px, composer 16px; composer must land on chat × ratio.
  assert.ok(Math.abs(composerFollowZoom(1.49, 15, 16) * 16 - 15 * 1.49) < 0.02);
  assert.ok(Math.abs(composerFollowZoom(1.2 * 1.1, 15, 16) * 16 - 15 * 1.2 * 1.1) < 0.02);
  // iOS floor: never below 16px effective.
  assert.equal(composerFollowZoom(1, 15, 16, 16), 1);
  assert.ok(composerFollowZoom(1.5, 15, 16, 16) * 16 > 16);
  // Unknown sizes fall back to the plain scale.
  assert.equal(composerFollowZoom(1.2, 0, 16), 1.2);
});

test("settings parse defensively", () => {
  assert.deepEqual(parseConfig(undefined), DEFAULT_ZOOM_CONFIG);
  assert.equal(DEFAULT_ZOOM_CONFIG.scope, "content");
  assert.equal(parseConfig({ scope: "app" }).scope, "app");
  assert.deepEqual(parseConfig({ scope: "content", composerScale: 1.25, terminalScale: 9 }), {
    scope: "content",
    composerRatio: 1.25,
    terminalRatio: 2,
  });
  assert.deepEqual(parseConfig({ scope: "bogus", composerScale: -1, terminalScale: "x" }), DEFAULT_ZOOM_CONFIG);
});

test("pinch, wheel and touch math", () => {
  assert.equal(pinchValue(12, 1.5), 18);
  assert.equal(pinchValue(12, 0), 12);
  assert.ok(wheelScaleFactor(-5) > 1);
  assert.equal(wheelScaleFactor(1000), wheelScaleFactor(20));
  assert.equal(wheelScaleFactor(Number.NaN), 1);
  assert.equal(nextTerminalPx(12, 1.01), 13);
  assert.equal(nextTerminalPx(12, 0.99), 11);
  assert.equal(nextTerminalPx(12, 1.5), 18);
  assert.equal(touchPinchScale(100, 150), 1.5);
  assert.equal(touchPinchScale(0, 150), null);
});

test("stored state round-trips, migrates v0.1.0 px, and falls back per field", () => {
  const state = { textScale: 1.3, terminalAdjust: 1.2 };
  assert.deepEqual(parseStoredState(serializeState(state)), state);
  assert.deepEqual(parseStoredState(null), DEFAULT_ZOOM_STATE);
  assert.deepEqual(parseStoredState("{not json"), DEFAULT_ZOOM_STATE);
  assert.deepEqual(parseStoredState('{"textScale":1,"terminalFontSize":18}'), { textScale: 1, terminalAdjust: 1.5 });
  assert.deepEqual(parseStoredState('{"textScale":"big","terminalAdjust":"x"}'), DEFAULT_ZOOM_STATE);
});
