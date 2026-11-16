// bb-plugin-auto-answer — frontend entry.
//
// BB renders an agent's question (Claude Code's AskUserQuestion and the
// equivalent from other providers) as a widget in place of the composer: one
// tab per question, a list of option buttons, and a "Next" / "Submit answer"
// button. Answering a three-question set therefore costs three extra clicks on
// "Next" after you have already told BB what you want.
//
// This overlay removes those clicks. The moment an option's selected state
// changes it starts a countdown, right under the option you picked; when the
// countdown runs out it presses the widget's own primary button, which advances
// to the next tab or submits the whole answer. Picking another option (or the
// same one again) restarts the countdown, and a "Stop" button at the top of the
// block cancels it.
//
// Everything here drives BB's real widget through the DOM — the host owns the
// question state, so a fired countdown is exactly the click you would have
// made yourself.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";

/** Marks the container we append to a question widget for our own UI. */
const HOST_ATTRIBUTE = "data-bb-autoanswer-host";
/** The widget root's distinctive height class; see `findWidgetRoot`. */
const WIDGET_ROOT_SELECTOR = 'div[class*="max-h-[calc(100dvh-6rem)]"]';
/** Labels of the widget's primary button, in its two states. */
const NEXT_LABEL = "Next";
const SUBMIT_LABEL = "Submit answer";
/** How far above a `fieldset` the widget root may sit in the fallback search. */
const MAX_ROOT_SEARCH_DEPTH = 8;
/** How often the countdown re-checks that firing is still valid, and fires. */
const TICK_MS = 100;

const DEFAULT_DELAY_SECONDS = 4;
const MIN_DELAY_SECONDS = 1;
const MAX_DELAY_SECONDS = 120;

/** An armed countdown against one question of one widget. */
type Countdown = {
  /** The widget root, used to re-find the primary button as the DOM changes. */
  root: HTMLElement;
  /** Our injected container inside `root`; the portal target. */
  host: HTMLElement;
  /** What firing will do, read from the primary button when we armed. */
  action: "next" | "submit";
  endsAt: number;
};

/**
 * The widget's primary button: the only "Next" / "Submit answer" button
 * outside the `fieldset` that holds the options.
 */
function findPrimaryButton(root: HTMLElement): HTMLButtonElement | null {
  for (const button of root.querySelectorAll("button")) {
    if (button.closest("fieldset") !== null) continue;
    const label = (button.textContent ?? "").trim();
    if (label === NEXT_LABEL || label === SUBMIT_LABEL) return button;
  }
  return null;
}

/**
 * The widget root that owns `node`. The root carries a distinctive height
 * class, but a class is a detail of BB's markup, so we fall back to the
 * nearest ancestor of the options `fieldset` that also owns a primary button.
 */
function findWidgetRoot(node: Element): HTMLElement | null {
  const fieldset = node.closest("fieldset");
  if (fieldset === null) return null;
  const tagged = fieldset.closest(WIDGET_ROOT_SELECTOR);
  if (tagged instanceof HTMLElement && findPrimaryButton(tagged) !== null) {
    return tagged;
  }
  let current = fieldset.parentElement;
  for (let depth = 0; current !== null && depth < MAX_ROOT_SEARCH_DEPTH; depth++) {
    if (findPrimaryButton(current) !== null) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * An option button: the widget renders each option as a button with
 * `aria-pressed` inside the options `fieldset`. The question tabs also use
 * `aria-pressed`, but they sit outside the fieldset. Our own block now lives
 * inside that fieldset too, so it is excluded explicitly — a countdown must
 * never take its own UI for an option and try to nest itself.
 */
function isOptionButton(node: Element): boolean {
  return (
    node instanceof HTMLButtonElement &&
    node.hasAttribute("aria-pressed") &&
    node.closest("fieldset") !== null &&
    node.closest(`[${HOST_ATTRIBUTE}]`) === null
  );
}

/**
 * Whether firing the countdown would still do what the user asked for. Checked
 * on every tick, so a countdown disappears by itself when the answer stops
 * being applicable — the option was toggled back off, "Other…" opened its
 * free-text box (which we must never submit on the user's behalf), the widget
 * is busy submitting, or it is gone entirely.
 */
function canFire(root: HTMLElement): boolean {
  if (!root.isConnected) return false;
  if (root.querySelector("textarea") !== null) return false;
  const primary = findPrimaryButton(root);
  return primary !== null && !primary.disabled;
}

/**
 * Where the countdown block goes: directly under the option that armed it, so
 * Stop is next to the pointer that just picked — not a trip to the bottom of a
 * long list. BB wraps each option in its own element (the button plus its
 * optional preview), and that wrapper is the row we sit beneath.
 */
function anchorFor(option: HTMLElement): Element {
  const wrapper = option.parentElement;
  return wrapper !== null && wrapper.closest("fieldset") !== null ? wrapper : option;
}

/**
 * Our UI container, created once and then moved: reusing the node keeps the
 * React portal mounted as the countdown hops from one option to the next.
 */
function ensureHost(anchor: Element): HTMLElement {
  const host =
    document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`) ??
    document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  anchor.after(host);
  return host;
}

function readDelayMs(values: Record<string, string | number | boolean> | undefined) {
  const raw = values?.delaySeconds;
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_DELAY_SECONDS;
  return Math.min(Math.max(seconds, MIN_DELAY_SECONDS), MAX_DELAY_SECONDS) * 1000;
}

function AutoAnswerOverlay() {
  const { values } = useSettings();
  const enabled = values?.enabled !== false;
  const delayMs = readDelayMs(values);

  const [countdown, setCountdown] = useState<Countdown | null>(null);
  /** Whole seconds shown in the label; the bar is painted straight to the DOM. */
  const [secondsLeft, setSecondsLeft] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);

  // "Stop" only cancels the countdown in front of you. Picking an option
  // afterwards — the same one or another — arms it again, so stopping is a
  // pause to think, never a switch you have to remember you flipped.
  const stop = useCallback(() => setCountdown(null), []);
  const clear = stop;

  // Arm on a change of selected state rather than on a click, so keyboard
  // option shortcuts start the countdown exactly like the mouse does.
  useEffect(() => {
    if (!enabled) return;
    const observer = new MutationObserver((records) => {
      const touched = records
        .map((record) => record.target)
        .filter(
          (target): target is HTMLElement =>
            target instanceof HTMLElement && isOptionButton(target),
        );
      if (touched.length === 0) return;
      // One commit can flip several options at once — moving a single-select
      // from A to B touches both. The one that ended up selected is the one
      // the user is looking at, so anchor the countdown there.
      const option =
        touched.find((candidate) => candidate.getAttribute("aria-pressed") === "true") ??
        touched[0]!;

      const root = findWidgetRoot(option);
      if (root === null) return;

      // React has already committed this selection, so the widget's own
      // state is readable here: no countdown for a selection that cannot be
      // applied, such as un-ticking the last option of a multi-select or
      // opening "Other…".
      if (!canFire(root)) return;

      const primary = findPrimaryButton(root);
      if (primary === null) return;
      const action =
        (primary.textContent ?? "").trim() === SUBMIT_LABEL ? "submit" : "next";

      // A fresh object every time: picking another option — or the same one
      // again — restarts the countdown from the full delay.
      setCountdown({
        root,
        host: ensureHost(anchorFor(option)),
        action,
        endsAt: Date.now() + delayMs,
      });
      setSecondsLeft(Math.ceil(delayMs / 1000));
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed"],
    });
    return () => observer.disconnect();
  }, [enabled, delayMs]);

  // Any other interaction with the widget — Back, a tab, Cancel, pressing
  // Next yourself, typing — means the user is still deciding.
  useEffect(() => {
    if (countdown === null) return;
    const cancelFromEvent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element) {
        if (target.closest(`[${HOST_ATTRIBUTE}]`) !== null) {
          return; // our own timer UI; the Stop button handles itself
        }
        const button = target.closest("button");
        // Picking another option restarts the countdown; that is the
        // observer's job, so leave this one alone.
        if (button !== null && isOptionButton(button)) return;
      }
      if (countdown.root.contains(target)) clear();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stop();
        return;
      }
      if (event.key !== " " || event.metaKey || event.ctrlKey || event.altKey) return;
      // Space is the reflex key here, but only while a countdown is running and
      // never out from under a text field. preventDefault stops the page
      // scrolling, and stops a focused Stop button firing a second time.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      event.preventDefault();
      stop();
    };
    document.addEventListener("click", cancelFromEvent, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("click", cancelFromEvent, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [countdown, clear, stop]);

  // The countdown itself. Deliberately a timer rather than the paint loop
  // below: animation frames stop in a hidden window, and the delay the user
  // configured is wall-clock time, not time spent looking at the screen.
  useEffect(() => {
    if (countdown === null) return;
    const tick = () => {
      if (!canFire(countdown.root)) {
        clear();
        return;
      }
      if (countdown.endsAt - Date.now() > 0) return;
      const primary = findPrimaryButton(countdown.root);
      clear();
      primary?.click();
    };
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [countdown, clear]);

  // The bar, painted every frame straight onto the node. Driving it from React
  // state would tie its smoothness to the render rate and step visibly; this
  // way it sweeps at the display's own refresh rate, and the component
  // re-renders only when the whole second in the label changes.
  useEffect(() => {
    if (countdown === null) return;
    let frame = 0;
    const paint = () => {
      const remaining = countdown.endsAt - Date.now();
      const elapsed = Math.min(1, Math.max(0, 1 - remaining / delayMs));
      if (barRef.current !== null) {
        barRef.current.style.width = `${elapsed * 100}%`;
      }
      setSecondsLeft(Math.max(1, Math.ceil(remaining / 1000)));
      frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [countdown, delayMs]);

  // Drop containers belonging to countdowns that are over, including widgets
  // that have been removed from the page.
  useEffect(() => {
    for (const host of document.querySelectorAll(`[${HOST_ATTRIBUTE}]`)) {
      if (host !== countdown?.host) host.remove();
    }
  }, [countdown]);

  if (countdown === null) return null;
  const label =
    countdown.action === "submit"
      ? `Submitting answer in ${secondsLeft}s`
      : `Next question in ${secondsLeft}s`;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="mt-2 rounded-md border border-border bg-surface-raised px-2.5 py-2"
    >
      <button
        type="button"
        onClick={stop}
        className="flex h-7 w-full items-center justify-center rounded-md border border-border text-xs font-medium text-foreground transition-colors hover:bg-state-hover"
      >
        Stop
        <span className="ml-1.5 font-normal text-subtle-foreground">
          (press space)
        </span>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {secondsLeft}
        </span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div ref={barRef} className="h-full rounded-full bg-primary" style={{ width: "0%" }} />
      </div>
    </div>,
    countdown.host,
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "auto-answer-countdown",
    component: AutoAnswerOverlay,
  });
});
