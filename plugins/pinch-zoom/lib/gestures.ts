/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Content script: turns pinch/zoom gestures into text-size changes.
 *
 * Routing: a pinch that starts over a terminal (`.xterm`) changes the terminal text size; a pinch anywhere else changes the app text size.
 * Pinches inside dialogs are left alone, because bb's image lightbox and Mermaid diagram viewer use pinch for their own pan/zoom.
 *
 * Input sources, one per platform:
 * - Safari / iOS / bb on iPhone: `gesturestart`/`gesturechange`/`gestureend` (also stops Safari's page zoom).
 * - Chromium, Electron (bb desktop) trackpad pinch and ctrl+mouse wheel: `wheel` with `ctrlKey`.
 * - Android / other touch browsers without GestureEvent: two-finger `touchmove`.
 *
 * Listeners sit on `document` in the capture phase: after bb's window-capture pan-zoom handlers (so we can honor their `defaultPrevented`), before xterm's own wheel handling.
 *
 * FNXC:PinchZoom 2026-11-13-13:11:
 * The scope setting picks what text scaling resizes: the whole app (root font size) or only chat, composer and terminal (CSS `zoom` on the chat timeline and composer).
 * The composer follows the text scale times its configured ratio; terminals follow the text scale times their ratio times the per-device fine-tune.
 */
import {
  appliedScales,
  composerFollowZoom,
  describeValue,
  nextTerminalPx,
  pinchValue,
  terminalFontPx,
  touchPinchScale,
  valueOf,
  wheelScaleFactor,
  type AppliedScales,
  type ZoomTarget,
} from "./zoom-core";
import {
  getZoomSnapshot,
  setZoomValue,
  subscribeZoom,
  watchOtherWindows,
  type ZoomSnapshot,
} from "./zoom-store";
import {
  applyTerminalFontSize,
  applyToAllTerminals,
  restoreAllTerminals,
} from "./terminal-bridge";

const TERMINAL_SELECTOR = ".xterm";
const EXCLUDED_SELECTOR = '[role="dialog"], [role="alertdialog"]';
/** Delay before resizing the PTY after the last terminal size change. */
const TERMINAL_REFIT_DELAY_MS = 140;
const INDICATOR_HIDE_DELAY_MS = 900;
/**
 * FNXC:PinchZoom 2026-11-13-13:11:
 * bb DOM hooks for "chat only" scaling, found in bb 0.49: the thread timeline row list and every prompt box (follow-up and new-thread composers).
 * `data-scroll-attached` was rejected: bb only sets it while the transcript is pinned to the bottom.
 */
const TIMELINE_SELECTOR = '[data-timeline-row-list="top-level"]';
const COMPOSER_SELECTOR = "form[data-promptbox]";
/** Chat message text; the surrounding message column reports a different (16px) size than the text inside it. */
const CHAT_TEXT_SELECTOR = "[data-timeline-row-list] [data-markdown-preview]";
const COMPOSER_TEXT_SELECTOR = 'form[data-promptbox] [contenteditable="true"]';
/** iOS zooms the page when a focused field is under 16px, so the composer never goes below it there. */
const IOS_MIN_COMPOSER_PX = 16;

function isIos(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Current displayed value for a target. */
function current(target: ZoomTarget): number {
  const { state, config } = getZoomSnapshot();
  return valueOf(state, config, target);
}

function currentTerminalPx(): number {
  const { state, config } = getZoomSnapshot();
  return terminalFontPx(state, config);
}

function elementFrom(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/** Decides what a gesture at this element controls; null = not ours. */
export function resolveTarget(element: Element | null): ZoomTarget | null {
  if (element === null) return "text";
  if (element.closest(TERMINAL_SELECTOR) !== null) return "terminal";
  if (element.closest(EXCLUDED_SELECTOR) !== null) return null;
  return "text";
}

function createIndicator(): {
  show: (text: string) => void;
  dispose: () => void;
} {
  let node: HTMLDivElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    show(text) {
      if (node === null) {
        node = document.createElement("div");
        node.setAttribute("data-bb-plugin", "pinch-zoom");
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        // px sizes on purpose: the indicator must not grow with the text scale it reports.
        Object.assign(node.style, {
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: "2147483647",
          pointerEvents: "none",
          padding: "6px 12px",
          borderRadius: "999px",
          font: "500 13px/1.2 system-ui, -apple-system, sans-serif",
          fontVariantNumeric: "tabular-nums",
          background: "var(--foreground, #111)",
          color: "var(--background, #fff)",
          boxShadow: "0 4px 16px rgb(0 0 0 / 0.25)",
          opacity: "0",
          transition: "opacity 120ms ease",
        } satisfies Partial<CSSStyleDeclaration>);
        document.body.appendChild(node);
      }
      node.textContent = text;
      node.style.opacity = "0.92";
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (node !== null) node.style.opacity = "0";
      }, INDICATOR_HIDE_DELAY_MS);
    },
    dispose() {
      if (hideTimer !== null) clearTimeout(hideTimer);
      node?.remove();
      node = null;
    },
  };
}

/** Mounts gesture handling and size application. Returns the disposer. */
export function mountPinchZoom(signal: AbortSignal): () => void {
  const root = document.documentElement;
  const originalRootFontSize = root.style.fontSize;
  const indicator = createIndicator();
  const listenerOptions = { capture: true, passive: false, signal } as const;
  let refitTimer: ReturnType<typeof setTimeout> | null = null;
  let applied: { scales: AppliedScales; terminalPx: number } | null = null;
  const zoomStyle = document.createElement("style");
  zoomStyle.setAttribute("data-bb-plugin", "pinch-zoom");
  document.head.appendChild(zoomStyle);
  /** True while a gesture is in progress, so terminal PTY resizes wait for it to settle. */
  let gestureActive = false;

  const applyText = (scale: number) => {
    // A percentage keeps the user's browser default font size as the base.
    root.style.fontSize = scale === 1 ? originalRootFontSize : `${scale * 100}%`;
  };

  const scheduleTerminalRefit = () => {
    if (refitTimer !== null) clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      refitTimer = null;
      if (gestureActive) {
        scheduleTerminalRefit();
        return;
      }
      applyToAllTerminals(currentTerminalPx(), true);
    }, TERMINAL_REFIT_DELAY_MS);
  };

  /**
   * FNXC:PinchZoom 2026-11-13-16:35:
   * Base chat and composer font sizes, measured with the plugin's zoom rules switched off so the result never feeds back into itself.
   * They only change with bb's responsive breakpoints, so they are re-measured on resize and when a composer gains focus, not on every gesture frame.
   */
  let bases: { chatPx: number; composerPx: number } | null = null;
  const minComposerPx = isIos() ? IOS_MIN_COMPOSER_PX : 0;
  let lastScales: AppliedScales | null = null;

  const measureBases = () => {
    const chat = document.querySelector<HTMLElement>(CHAT_TEXT_SELECTOR);
    const composer = document.querySelector<HTMLElement>(COMPOSER_TEXT_SELECTOR);
    if (chat === null || composer === null) return;
    const rules = zoomStyle.textContent;
    zoomStyle.textContent = "";
    const chatPx = Number.parseFloat(getComputedStyle(chat).fontSize);
    const composerPx = Number.parseFloat(getComputedStyle(composer).fontSize);
    zoomStyle.textContent = rules;
    if (chatPx > 0 && composerPx > 0) bases = { chatPx, composerPx };
  };

  const applyZoomStyle = (scales: AppliedScales) => {
    lastScales = scales;
    if (bases === null) measureBases();
    const composerZoom =
      bases === null
        ? scales.composer
        : composerFollowZoom(scales.composer, bases.chatPx, bases.composerPx, minComposerPx);
    const rules: string[] = [];
    if (scales.timeline !== 1) rules.push(`${TIMELINE_SELECTOR}{zoom:${scales.timeline}}`);
    if (composerZoom !== 1) rules.push(`${COMPOSER_SELECTOR}{zoom:${composerZoom}}`);
    const text = rules.join("\n");
    if (zoomStyle.textContent !== text) zoomStyle.textContent = text;
  };

  const remeasure = () => {
    bases = null;
    if (lastScales !== null) applyZoomStyle(lastScales);
  };

  const apply = ({ state, config }: ZoomSnapshot) => {
    const scales = appliedScales(state, config);
    const terminalPx = terminalFontPx(state, config);
    if (applied === null || applied.scales.root !== scales.root) applyText(scales.root);
    if (
      applied === null ||
      applied.scales.timeline !== scales.timeline ||
      applied.scales.composer !== scales.composer
    ) {
      applyZoomStyle(scales);
    }
    if (applied === null || applied.terminalPx !== terminalPx) {
      // Font changes immediately for feedback; cols/rows follow once the gesture settles.
      applyToAllTerminals(terminalPx, false);
      scheduleTerminalRefit();
    }
    applied = { scales, terminalPx };
  };

  apply(getZoomSnapshot());
  const unsubscribe = subscribeZoom(apply);
  // Breakpoint changes alter bb's base sizes; a focused composer may be one that mounted after the last measurement.
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener(
    "resize",
    () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(remeasure, 200);
    },
    { signal },
  );
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target instanceof Element && event.target.closest(COMPOSER_SELECTOR) !== null) {
        remeasure();
      }
    },
    { signal },
  );
  // The thread view usually mounts after the content script; measure once it has rendered.
  const initialMeasureTimer = setTimeout(remeasure, 1500);
  watchOtherWindows(signal);

  // New terminals mount at bb's default 12px; bring them to the chosen size.
  const observer = new MutationObserver((records) => {
    const size = currentTerminalPx();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains("xterm")) {
          // terminal.open() appends .xterm before bb's first fit; wait a frame.
          requestAnimationFrame(() => applyTerminalFontSize(node, size, true));
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const change = (target: ZoomTarget, value: number) => {
    setZoomValue(target, value);
    indicator.show(describeValue(target, current(target)));
  };

  // --- Safari / iOS GestureEvent ---------------------------------------
  const supportsGestureEvents = "ongesturestart" in window;
  let gesture: { target: ZoomTarget; startValue: number } | null = null;

  const onGestureStart = (event: Event) => {
    if (event.defaultPrevented) return;
    const target = resolveTarget(elementFrom(event.target));
    if (target === null) return;
    event.preventDefault();
    gestureActive = true;
    gesture = { target, startValue: current(target) };
  };
  const onGestureChange = (event: Event) => {
    if (gesture === null || event.defaultPrevented) return;
    event.preventDefault();
    const scale = (event as Event & { scale?: number }).scale ?? 1;
    change(gesture.target, pinchValue(gesture.startValue, scale));
  };
  const onGestureEnd = (event: Event) => {
    if (gesture === null) return;
    event.preventDefault();
    gesture = null;
    gestureActive = false;
  };

  if (supportsGestureEvents) {
    document.addEventListener("gesturestart", onGestureStart, listenerOptions);
    document.addEventListener("gesturechange", onGestureChange, listenerOptions);
    document.addEventListener("gestureend", onGestureEnd, listenerOptions);
  }

  // --- Chromium / Electron trackpad pinch and ctrl+wheel ----------------
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey || event.defaultPrevented) return;
    const target = resolveTarget(elementFrom(event.target));
    if (target === null) return;
    event.preventDefault();
    const factor = wheelScaleFactor(event.deltaY, event.deltaMode);
    const now = current(target);
    change(target, target === "terminal" ? nextTerminalPx(now, factor) : now * factor);
  };
  document.addEventListener("wheel", onWheel, listenerOptions);

  // --- Two-finger touch (browsers without GestureEvent) -----------------
  let touch: { target: ZoomTarget; startValue: number; startDistance: number } | null =
    null;
  const distance = (touches: TouchList): number => {
    const a = touches[0];
    const b = touches[1];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 2 || event.defaultPrevented) {
      touch = null;
      return;
    }
    const a = event.touches[0];
    const b = event.touches[1];
    if (a === undefined || b === undefined) return;
    const midpoint = document.elementFromPoint(
      (a.clientX + b.clientX) / 2,
      (a.clientY + b.clientY) / 2,
    );
    const target = resolveTarget(midpoint ?? elementFrom(event.target));
    if (target === null) return;
    gestureActive = true;
    touch = {
      target,
      startValue: current(target),
      startDistance: distance(event.touches),
    };
  };
  const onTouchMove = (event: TouchEvent) => {
    if (touch === null || event.touches.length !== 2) return;
    // Cancel from the first two-finger move, or the browser starts its own page zoom.
    if (event.cancelable) event.preventDefault();
    const scale = touchPinchScale(touch.startDistance, distance(event.touches));
    if (scale === null) return;
    change(touch.target, pinchValue(touch.startValue, scale));
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) {
      touch = null;
      gestureActive = false;
    }
  };

  if (!supportsGestureEvents) {
    document.addEventListener("touchstart", onTouchStart, listenerOptions);
    document.addEventListener("touchmove", onTouchMove, listenerOptions);
    document.addEventListener("touchend", onTouchEnd, listenerOptions);
    document.addEventListener("touchcancel", onTouchEnd, listenerOptions);
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    observer.disconnect();
    if (refitTimer !== null) clearTimeout(refitTimer);
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    clearTimeout(initialMeasureTimer);
    indicator.dispose();
    zoomStyle.remove();
    root.style.fontSize = originalRootFontSize;
    restoreAllTerminals();
    // Event listeners are removed by the abort signal.
  };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
