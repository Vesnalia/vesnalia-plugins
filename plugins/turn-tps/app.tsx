import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { parseRowId } from "./lib/row-id";
import "./app.css";

const TPS_ATTR = "data-alia-tps";
const BADGE_CLASS = "alia-turn-tps-badge";
const POLL_MS = 500;
const REFRESH_INTERVAL_MS = 1500;

interface TurnStat {
  turnId: string;
  threadId: string;
  durationMs: number;
  durationFormatted: string;
  tokens: number;
  tps: number;
  label: string;
  badgeText: string;
  tooltip: string;
}

type RpcEnvelope =
  | { ok: true; result: { turns: TurnStat[] } }
  | { ok: false; error?: { message?: string } };

function threadIdFromPath(pathname = window.location.pathname): string | null {
  const match = /\/threads\/(thr_[a-zA-Z0-9_-]+)/.exec(pathname);
  return match ? match[1] : null;
}

function visibleThreadIds(): string[] {
  const ids = new Set<string>();
  const urlId = threadIdFromPath();
  if (urlId) ids.add(urlId);

  document
    .querySelectorAll<HTMLElement>(
      '[data-sidebar-thread-id][aria-current="page"]',
    )
    .forEach((anchor) => {
      const threadId = anchor.dataset.sidebarThreadId;
      if (threadId) ids.add(threadId);
    });

  return Array.from(ids).slice(0, 8);
}

function findTurnButtons(): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  document.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    const text = btn.textContent?.trim() || "";
    if (/^(Worked for\s+\S+|Working)/.test(text)) {
      buttons.push(btn);
    }
  });
  return buttons;
}

function decorate(turns: TurnStat[]): void {
  const turnById = new Map(turns.map((t) => [`${t.threadId}:${t.turnId}`, t]));
  function statFor(row: HTMLElement | null) {
    const target = parseRowId(row?.dataset.timelineRowId);
    return target ? turnById.get(`${target.threadId}:${target.turnId}`) : undefined;
  }
  for (const btn of findTurnButtons()) {
    const stat = statFor(btn.closest<HTMLElement>("[data-timeline-row-id]"));
    if (!stat) {
      if (btn.hasAttribute(TPS_ATTR)) { btn.removeAttribute(TPS_ATTR); btn.removeAttribute("title"); }
      continue;
    }
    if (btn.getAttribute(TPS_ATTR) !== stat.label) btn.setAttribute(TPS_ATTR, stat.label);
    if (btn.title !== stat.tooltip) btn.title = stat.tooltip;
  }
  document.querySelectorAll<HTMLElement>('[data-timeline-row-id*=":assistant:"]').forEach((row) => {
    const stat = statFor(row);
    let badge = row.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
    if (!stat) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement("div");
      badge.className = BADGE_CLASS;
      row.appendChild(badge);
    }
    if (badge.textContent !== stat.badgeText) badge.textContent = stat.badgeText;
    if (badge.title !== stat.tooltip) badge.title = stat.tooltip;
  });
}

function clearDecorations(): void {
  document.querySelectorAll<HTMLElement>(`[${TPS_ATTR}]`).forEach((el) => {
    el.removeAttribute(TPS_ATTR);
    el.removeAttribute("title");
  });
  document.querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`).forEach((el) => {
    el.remove();
  });
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "turn-tps-indicator",
    mount({ pluginId, signal }) {
      const stats = new Map<string, TurnStat>();
      let inFlight: Promise<void> | null = null;
      let lastRefreshAt = 0;
      let lastThreadKey = "";

      const load = async (threadIds: string[], threadKey: string) => {
        try {
          const response = await fetch(
            `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/turnStats`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ threadIds }),
              signal,
            },
          );
          if (!response.ok) return;
          const envelope = (await response.json()) as RpcEnvelope;
          if (!envelope.ok || signal.aborted || threadKey !== visibleThreadIds().sort().join(",")) return;

          stats.clear();
          for (const turn of envelope.result.turns) {
            stats.set(`${turn.threadId}:${turn.turnId}`, turn);
          }
        } catch {
          // Handled / aborted
        }
      };

      const refresh = (force = false) => {
        const threadIds = visibleThreadIds();
        if (threadIds.length === 0) {
          lastThreadKey = "";
          if (stats.size > 0) {
            stats.clear();
            clearDecorations();
          }
          return;
        }

        const threadKey = threadIds.slice().sort().join(",");
        if (threadKey !== lastThreadKey) {
          stats.clear();
          clearDecorations();
        }
        const stale =
          force ||
          threadKey !== lastThreadKey ||
          Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS;

        const turnList = Array.from(stats.values());
        decorate(turnList);

        if (!stale || inFlight) return;

        lastThreadKey = threadKey;
        lastRefreshAt = Date.now();
        inFlight = load(threadIds, threadKey)
          .catch(() => undefined)
          .finally(() => {
            inFlight = null;
            if (!signal.aborted) {
              decorate(Array.from(stats.values()));
            }
          });
      };

      refresh(true);
      const timer = window.setInterval(() => refresh(false), POLL_MS);
      const observer = new MutationObserver(() => refresh(false));
      observer.observe(document.body, { childList: true, subtree: true });

      return () => {
        window.clearInterval(timer);
        observer.disconnect();
        clearDecorations();
      };
    },
  });
});
