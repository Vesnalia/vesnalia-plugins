// bb-plugin-message-date-time - frontend entry.
//
// Adds a date-and-time line above every user and agent message in the thread
// chat ("Today, 4:34 PM", "Yesterday, 22:10", "Сегодня, 16:34", "3 окт., 09:15").
// Language and clock come from the plugin settings; "System" follows the
// computer's language and the region's clock.
//
// BB keeps each message's time on the timeline row (`startedAt`) but shows it
// only inside the message "..." menu, and the Plugin SDK has no slot for
// message chrome. So a content script reads the time from the React props of
// each rendered message column and writes it into a data attribute; a
// stylesheet renders that attribute with ::before. Nothing is inserted into
// React-owned DOM, and disposal removes every attribute, observer and style.
import { useEffect, useState } from "react";
import { definePluginApp, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { resolveHour12, resolveLang, type Lang, type SystemClockHint } from "./lib/locale";
import { makeFormatter, type Formatter } from "./lib/format";

const MESSAGE_SELECTOR = "[data-message-column]";
const LABEL_ATTR = "data-mdt-label";
const ROLE_ATTR = "data-mdt-role";
const STYLE_ID = "bb-plugin-message-date-time-style";
const MAX_FIBER_DEPTH = 30;
const REFRESH_MS = 60_000;

const STYLE = `
[${LABEL_ATTR}]::before {
  content: attr(${LABEL_ATTR});
  display: block;
  width: 100%;
  margin-bottom: 4px;
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground, #888);
  opacity: 0.85;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}
[${ROLE_ATTR}="user"]::before { text-align: right; }
[${ROLE_ATTR}="assistant"]::before { text-align: left; }
`;

type Role = "user" | "assistant";
type MessageTime = { ms: number; role: Role };
type Fiber = { memoizedProps?: unknown; return?: Fiber | null };

function fiberOf(element: Element): Fiber | null {
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactFiber$")) {
      return (element as unknown as Record<string, Fiber>)[key] ?? null;
    }
  }
  return null;
}

function toMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function asRole(value: unknown): Role | null {
  return value === "user" || value === "assistant" ? value : null;
}

/** Nearest ancestor component that knows this message's time and author. */
function readMessageTime(element: Element): MessageTime | null {
  let fiber = fiberOf(element);
  for (let depth = 0; fiber && depth < MAX_FIBER_DEPTH; depth++) {
    const props = fiber.memoizedProps;
    if (props && typeof props === "object") {
      const record = props as Record<string, unknown>;
      // The message body component: { role, timestamp } (BB passes startedAt).
      const role = asRole(record.role);
      const ms = toMs(record.timestamp);
      if (role && ms !== null) return { ms, role };
      // The timeline row wrapper: { row: { kind: "conversation", role, startedAt } }.
      const row = record.row;
      if (row && typeof row === "object") {
        const rowRecord = row as Record<string, unknown>;
        const rowRole = asRole(rowRecord.role);
        const rowMs = toMs(rowRecord.startedAt ?? rowRecord.createdAt);
        if (rowRecord.kind === "conversation" && rowRole && rowMs !== null) {
          return { ms: rowMs, role: rowRole };
        }
      }
    }
    fiber = fiber.return ?? null;
  }
  return null;
}

// The content script has no React context, so a tiny app-wide overlay reads
// the settings with useSettings() (and the computer's clock from the server)
// and hands them over through this store.
let prefs: { lang: Lang; hour12: boolean } = {
  lang: resolveLang("System"),
  hour12: resolveHour12("System", resolveLang("System")),
};
let current: Formatter = makeFormatter(prefs.lang, prefs.hour12);
const listeners = new Set<() => void>();

/** Rebuilt on every refresh too, so a time-zone change shows up within a minute. */
function rebuildFormatter() {
  current = makeFormatter(prefs.lang, prefs.hour12);
}

function SettingsBridge() {
  const { values } = useSettings();
  const rpc = useRpc<typeof rpcContract>();
  const [systemClock, setSystemClock] = useState<SystemClockHint | null>(null);
  useEffect(() => {
    let alive = true;
    rpc.call("system_clock").then(
      (value) => alive && setSystemClock(value),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [rpc]);
  const language = values?.language;
  const timeFormat = values?.timeFormat;
  useEffect(() => {
    const lang = resolveLang(language);
    prefs = { lang, hour12: resolveHour12(timeFormat, lang, systemClock) };
    rebuildFormatter();
    for (const listener of listeners) listener();
  }, [language, timeFormat, systemClock]);
  return null;
}

function mountTimestamps(signal: AbortSignal): () => void {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);

  let frame = 0;
  // A message element keeps its time and author for life; walk React's tree
  // once per element, not on every DOM change while a reply streams.
  const known = new WeakMap<Element, MessageTime>();

  const scan = () => {
    frame = 0;
    if (signal.aborted) return;
    const now = new Date();
    for (const element of document.querySelectorAll(MESSAGE_SELECTOR)) {
      let time = known.get(element) ?? null;
      if (!time) {
        time = readMessageTime(element);
        if (time) known.set(element, time);
      }
      if (!time) continue;
      const label = current.label(time.ms, now);
      if (element.getAttribute(LABEL_ATTR) !== label) {
        element.setAttribute(LABEL_ATTR, label);
      }
      if (element.getAttribute(ROLE_ATTR) !== time.role) {
        element.setAttribute(ROLE_ATTR, time.role);
      }
    }
  };

  const schedule = () => {
    if (frame === 0 && !signal.aborted) frame = requestAnimationFrame(scan);
  };

  // Attribute writes are not observed, so the scan cannot retrigger itself.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  // "Today" becomes "Yesterday" after midnight without any DOM change.
  const refresh = window.setInterval(() => {
    rebuildFormatter();
    schedule();
  }, REFRESH_MS);
  listeners.add(schedule);
  schedule();

  return () => {
    observer.disconnect();
    window.clearInterval(refresh);
    listeners.delete(schedule);
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    for (const element of document.querySelectorAll(`[${LABEL_ATTR}]`)) {
      element.removeAttribute(LABEL_ATTR);
      element.removeAttribute(ROLE_ATTR);
    }
    style.remove();
  };
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "settings-bridge", component: SettingsBridge });
  app.contentScripts.register({
    id: "message-date-time",
    mount: ({ signal }) => mountTimestamps(signal),
  });
});
