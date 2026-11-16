import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import "./app.css";

type RecentThread = {
  id: string;
  projectId: string;
  title: string;
  providerId: string;
  status: "active" | "starting" | "stopping" | "idle" | "error";
  updatedAt: number;
};

type RecentThreadsResponse = {
  threads: RecentThread[];
};

type RpcEnvelope =
  | { ok: true; result: RecentThreadsResponse }
  | { ok: false; error?: { message?: string } };

// "held": opened with Cmd+D — releasing Command commits the highlighted chat.
// "persistent": opened from the sidebar footer — stays open for mouse
// selection until a chat is chosen or the switcher is dismissed.
type SwitcherMode = "held" | "persistent";

const MAX_THREADS = 7;
const OPEN_EVENT = "alia-arc-switcher:open";
const MRU_STORAGE_KEY = "alia-arc-switcher:mru";
const THREAD_MARKER_STORAGE_KEY = "alia-arc-switcher:thread-markers:v1";
const MRU_LIMIT = 30;
const THREAD_MARKER_LIMIT = 200;
const ROUTE_POLL_MS = 400;
const THREAD_MARKERS = [
  "🚀",
  "🦊",
  "🌵",
  "🧠",
  "⚡",
  "🎯",
  "🧩",
  "🔭",
  "🔥",
  "🌙",
  "💎",
  "🍀",
  "🎨",
  "🛠️",
  "📚",
  "🧭",
  "🐝",
  "🍄",
  "🎸",
  "🪐",
  "🌊",
  "🦉",
  "🏕️",
  "🛸",
] as const;

type ThreadMarker = (typeof THREAD_MARKERS)[number];

// Attribute consumed by app.css: [data-alia-arc-marker]::before renders the
// emoji, so React-owned DOM never gains or loses actual nodes.
const THREAD_MARKER_ATTR = "data-alia-arc-marker";

// The visible title of a thread header is a truncated <p> near the
// always-rendered workflow-actions region; these classes are the header
// title's full utility set, so the selector cannot land on message content.
const HEADER_TITLE_SELECTOR =
  "p.relative.min-w-0.truncate.text-sm.font-normal.transition-colors";

function formatAge(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d`;
}

function getCurrentThreadId(): string | null {
  const match = decodeURIComponent(window.location.pathname).match(
    /\/threads\/([^/?#]+)/,
  );
  if (match) return match[1];

  const activeRow = document.querySelector<HTMLElement>(
    '[data-sidebar-thread-id][aria-current="page"], [data-sidebar-thread-id][data-active="true"]',
  );
  return activeRow?.dataset.sidebarThreadId ?? null;
}

function readMru(): string[] {
  try {
    const raw = window.localStorage.getItem(MRU_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function recordVisit(threadId: string): void {
  const mru = readMru();
  if (mru[0] === threadId) return;
  try {
    window.localStorage.setItem(
      MRU_STORAGE_KEY,
      JSON.stringify(
        [threadId, ...mru.filter((id) => id !== threadId)].slice(0, MRU_LIMIT),
      ),
    );
  } catch {
    // Storage unavailable — the switcher falls back to updatedAt order.
  }
}

function readThreadMarkers(): Record<string, ThreadMarker> {
  try {
    const raw = window.localStorage.getItem(THREAD_MARKER_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ThreadMarker] =>
          typeof entry[1] === "string" &&
          THREAD_MARKERS.includes(entry[1] as ThreadMarker),
      ),
    );
  } catch {
    return {};
  }
}

function markerStartIndex(threadId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < threadId.length; index += 1) {
    hash ^= threadId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % THREAD_MARKERS.length;
}

// Deterministic pick that walks past markers reserved elsewhere (project
// emojis from the project-emoji plugin). Falls back to the plain pick if
// the whole palette is excluded.
function deterministicMarker(
  threadId: string,
  exclude: ReadonlySet<string> = new Set(),
): ThreadMarker {
  const start = markerStartIndex(threadId);
  for (let offset = 0; offset < THREAD_MARKERS.length; offset += 1) {
    const candidate = THREAD_MARKERS[(start + offset) % THREAD_MARKERS.length];
    if (!exclude.has(candidate)) return candidate;
  }
  return THREAD_MARKERS[start];
}

function persistThreadMarkers(
  stored: Record<string, ThreadMarker>,
  priorityIds: string[],
): void {
  try {
    const keepIds = Array.from(
      new Set([...priorityIds, ...readMru(), ...Object.keys(stored)]),
    ).slice(0, THREAD_MARKER_LIMIT);
    window.localStorage.setItem(
      THREAD_MARKER_STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          keepIds.flatMap((id) => (stored[id] ? [[id, stored[id]]] : [])),
        ),
      ),
    );
  } catch {
    // Storage unavailable — deterministic marker selection still works.
  }
}

// Preserve a chat's marker across MRU reordering and browser sessions. If two
// old assignments collide in the visible seven, the later chat gets the next
// available marker so every row remains distinguishable at a glance. New
// assignments skip emojis reserved by projects (existing stored markers are
// honored even when they collide with a project emoji).
function assignThreadMarkers(
  threads: RecentThread[],
  exclude: ReadonlySet<string> = new Set(),
): Map<string, ThreadMarker> {
  const stored = readThreadMarkers();
  const assigned = new Map<string, ThreadMarker>();
  const used = new Set<ThreadMarker>();

  for (const thread of threads) {
    let marker = stored[thread.id];
    if (!marker || used.has(marker)) {
      const start = markerStartIndex(thread.id);
      for (let offset = 0; offset < THREAD_MARKERS.length; offset += 1) {
        const candidate = THREAD_MARKERS[(start + offset) % THREAD_MARKERS.length];
        if (!used.has(candidate) && !exclude.has(candidate)) {
          marker = candidate;
          break;
        }
      }
      // Every non-excluded marker is taken: fall back to ignoring the
      // exclusions rather than leaving the row unmarked.
      if (!marker || used.has(marker)) {
        for (let offset = 0; offset < THREAD_MARKERS.length; offset += 1) {
          const candidate =
            THREAD_MARKERS[(start + offset) % THREAD_MARKERS.length];
          if (!used.has(candidate)) {
            marker = candidate;
            break;
          }
        }
      }
    }

    // MAX_THREADS is smaller than the palette, so this is only defensive.
    marker ??= THREAD_MARKERS[assigned.size % THREAD_MARKERS.length];
    assigned.set(thread.id, marker);
    stored[thread.id] = marker;
    used.add(marker);
  }

  persistThreadMarkers(
    stored,
    threads.map((thread) => thread.id),
  );

  return assigned;
}

// Current chat first, then the user's own open history, then anything the
// history hasn't seen yet in updatedAt order.
function orderByRecentlyOpened(
  candidates: RecentThread[],
  currentThreadId: string | null,
): RecentThread[] {
  const mru = readMru();
  const rankedIds = currentThreadId
    ? [currentThreadId, ...mru.filter((id) => id !== currentThreadId)]
    : mru;

  const remaining = new Map(candidates.map((thread) => [thread.id, thread]));
  const ordered: RecentThread[] = [];
  for (const id of rankedIds) {
    const thread = remaining.get(id);
    if (thread) {
      ordered.push(thread);
      remaining.delete(id);
    }
  }
  for (const thread of candidates) {
    if (remaining.has(thread.id)) ordered.push(thread);
  }
  return ordered.slice(0, MAX_THREADS);
}

function navigateToThread(thread: RecentThread): void {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"),
  );
  const target = rows.find((row) => row.dataset.sidebarThreadId === thread.id);
  if (target) {
    target.click();
    return;
  }

  const sample = rows.find(
    (row): row is HTMLAnchorElement =>
      row instanceof HTMLAnchorElement && Boolean(row.dataset.sidebarThreadId),
  );
  if (sample?.dataset.sidebarThreadId) {
    const url = new URL(sample.href, window.location.href);
    url.pathname = url.pathname.replace(
      encodeURIComponent(sample.dataset.sidebarThreadId),
      encodeURIComponent(thread.id),
    );
    window.location.assign(url);
    return;
  }

  // VesnALIA's canonical direct route. This is only used when a custom sidebar has
  // no shortcut-compatible rows mounted.
  const encodedThreadId = encodeURIComponent(thread.id);
  const path =
    thread.projectId === "proj_personal"
      ? `/threads/${encodedThreadId}`
      : `/projects/${encodeURIComponent(thread.projectId)}/threads/${encodedThreadId}`;
  window.location.assign(path);
}

function isCommandD(event: KeyboardEvent): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    (event.code === "KeyD" || event.key.toLowerCase() === "d")
  );
}

export default definePluginApp((app) => {
  app.slots.sidebarFooterAction({
    id: "recent-chats",
    title: "Recent chats (⌘D)",
    icon: "Layers",
    run() {
      window.dispatchEvent(new CustomEvent(OPEN_EVENT));
    },
  });

  app.contentScripts.register({
    id: "arc-recent-chat-switcher",
    mount({ pluginId, generation, signal }) {
      let overlay: HTMLDivElement | null = null;
      let threads: RecentThread[] = [];
      let threadMarkers = new Map<string, ThreadMarker>();
      let selectedIndex = 0;
      let pendingPresses = 0;
      let metaHeld = false;
      let mode: SwitcherMode | null = null;
      let loading: Promise<void> | null = null;

      // Project emojis from the project-emoji plugin: shown on switcher rows
      // and excluded when assigning NEW thread markers so a chat's marker is
      // never confusable with a project's emoji. Absence of that plugin
      // degrades gracefully to no exclusions.
      let projectEmojis = new Map<string, { name: string; emoji: string }>();
      let projectEmojiSet = new Set<string>();
      let projectEmojisLoaded = false;
      const loadProjectEmojis = async () => {
        try {
          const response = await fetch(
            "/api/v1/plugins/project-emoji/rpc/listProjects",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "null",
              signal,
            },
          );
          const envelope = (await response.json()) as
            | {
                ok: true;
                result: {
                  projects: { id: string; name: string; emoji: string }[];
                };
              }
            | { ok: false };
          if (response.ok && envelope.ok) {
            projectEmojis = new Map(
              envelope.result.projects.map((project) => [
                project.id,
                { name: project.name, emoji: project.emoji },
              ]),
            );
            projectEmojiSet = new Set(
              envelope.result.projects.map((project) => project.emoji),
            );
          }
        } catch {
          // project-emoji plugin unavailable — no exclusions this session.
        } finally {
          projectEmojisLoaded = true;
        }
      };

      const reportClientEvent = (kind: "mounted" | "shortcut") => {
        void fetch(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/clientEvent`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind, generation }),
            signal,
          },
        ).catch(() => undefined);
      };

      reportClientEvent("mounted");

      let lastSeenThreadId: string | null = null;
      const trackRoute = () => {
        const threadId = getCurrentThreadId();
        if (threadId && threadId !== lastSeenThreadId) {
          lastSeenThreadId = threadId;
          recordVisit(threadId);
        }
      };

      const applyMarker = (element: HTMLElement, marker: ThreadMarker) => {
        if (element.getAttribute(THREAD_MARKER_ATTR) !== marker) {
          element.setAttribute(THREAD_MARKER_ATTR, marker);
        }
      };

      const findHeaderTitle = (actionsEl: HTMLElement): HTMLElement | null => {
        let scope: HTMLElement | null = actionsEl.parentElement;
        for (let depth = 0; scope && depth < 4; depth += 1) {
          const title = scope.querySelector<HTMLElement>(HEADER_TITLE_SELECTOR);
          if (title) return title;
          scope = scope.parentElement;
        }
        return null;
      };

      // Paint each sidebar row's title and each open chat's header title with
      // the thread's stable emoji so a chat is recognizable everywhere the
      // switcher already made it recognizable.
      const decorateChrome = () => {
        const stored = readThreadMarkers();
        let dirty = false;
        const ensureMarker = (threadId: string): ThreadMarker | null => {
          let marker = stored[threadId];
          if (!marker) {
            // Defer NEW assignments until the project-emoji exclusion set is
            // known, so a fresh marker can never land on a project's emoji.
            if (!projectEmojisLoaded) return null;
            marker = deterministicMarker(threadId, projectEmojiSet);
            stored[threadId] = marker;
            dirty = true;
          }
          return marker;
        };

        // The sidebar row's anchor is an invisible overlay; the visible title
        // is a truncated span inside the same row. Collect title → id along
        // the way (null marks an ambiguous duplicate title).
        const sidebarIds: string[] = [];
        const titleToThread = new Map<string, string | null>();
        document
          .querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")
          .forEach((anchor) => {
            const threadId = anchor.dataset.sidebarThreadId;
            const label =
              anchor.parentElement?.querySelector<HTMLElement>("span.truncate");
            if (!threadId || !label) return;
            sidebarIds.push(threadId);
            const marker = ensureMarker(threadId);
            if (marker) applyMarker(label, marker);
            const text = label.textContent?.trim();
            if (text) {
              const existing = titleToThread.get(text);
              titleToThread.set(
                text,
                existing === undefined || existing === threadId ? threadId : null,
              );
            }
          });

        // The URL only names the focused thread, so split-pane headers are
        // resolved by matching their title against the sidebar instead.
        const urlThreadId = getCurrentThreadId();
        document
          .querySelectorAll<HTMLElement>("[data-thread-header-workflow-actions]")
          .forEach((actionsEl) => {
            const title = findHeaderTitle(actionsEl);
            if (!title) return;
            const pane = actionsEl.closest<HTMLElement>("[data-split-pane-id]");
            let threadId: string | null = null;
            if (pane) {
              const text = title.textContent?.trim();
              threadId = (text && titleToThread.get(text)) || null;
              if (!threadId && pane.dataset.focused === "true") {
                threadId = urlThreadId;
              }
            } else {
              threadId = urlThreadId;
            }
            if (!threadId) {
              title.removeAttribute(THREAD_MARKER_ATTR);
              return;
            }
            const marker = ensureMarker(threadId);
            if (marker) applyMarker(title, marker);
          });

        if (dirty) persistThreadMarkers(stored, sidebarIds);
      };

      const tick = () => {
        trackRoute();
        decorateChrome();
      };
      tick();
      void loadProjectEmojis().then(() => {
        if (!signal.aborted) decorateChrome();
      });
      const routeTimer = window.setInterval(tick, ROUTE_POLL_MS);

      const removeOverlay = () => {
        overlay?.remove();
        overlay = null;
        threads = [];
        threadMarkers.clear();
        selectedIndex = 0;
        mode = null;
      };

      const commit = () => {
        const selected = threads[selectedIndex];
        removeOverlay();
        if (selected) {
          lastSeenThreadId = selected.id;
          recordVisit(selected.id);
          navigateToThread(selected);
        }
      };

      const cancel = () => {
        pendingPresses = 0;
        removeOverlay();
      };

      const updateSelection = () => {
        const panel = overlay?.querySelector<HTMLElement>("[role='listbox']");
        const selected = threads[selectedIndex];
        panel?.setAttribute(
          "aria-activedescendant",
          selected ? `alia-arc-thread-${selected.id}` : "",
        );
        overlay
          ?.querySelectorAll<HTMLElement>(".alia-arc-switcher__item")
          .forEach((item, index) => {
            const isSelected = index === selectedIndex;
            item.dataset.selected = String(isSelected);
            item.setAttribute("aria-selected", String(isSelected));
          });
      };

      const render = () => {
        overlay?.remove();
        // When the overlay appears under a stationary cursor the browser fires
        // synthetic hover events that would steal the highlight from the
        // keyboard flow — honor hover only after the pointer really moves.
        const openedAt = performance.now();
        const pointerReady = () => performance.now() - openedAt > 250;
        overlay = document.createElement("div");
        overlay.className = "alia-arc-switcher";
        if (mode === "persistent") {
          overlay.classList.add("alia-arc-switcher--persistent");
        }
        overlay.setAttribute("role", "presentation");
        overlay.addEventListener("pointerdown", (event) => {
          if (event.target === overlay) cancel();
        });

        const panel = document.createElement("div");
        panel.className = "alia-arc-switcher__panel";
        panel.setAttribute("role", "listbox");
        panel.setAttribute("aria-label", "Recent chats");
        panel.setAttribute(
          "aria-activedescendant",
          threads[selectedIndex] ? `alia-arc-thread-${threads[selectedIndex].id}` : "",
        );

        const header = document.createElement("div");
        header.className = "alia-arc-switcher__header";
        header.innerHTML =
          '<span>Recent chats</span><kbd><span aria-hidden="true">&#8984;</span>D</kbd>';
        panel.append(header);

        const list = document.createElement("div");
        list.className = "alia-arc-switcher__list";

        threads.forEach((thread, index) => {
          const item = document.createElement("button");
          item.type = "button";
          item.id = `alia-arc-thread-${thread.id}`;
          item.className = "alia-arc-switcher__item";
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(index === selectedIndex));
          item.dataset.selected = String(index === selectedIndex);

          const marker = document.createElement("span");
          marker.className = "alia-arc-switcher__marker";
          marker.setAttribute("aria-hidden", "true");

          const emoji = document.createElement("span");
          emoji.className = "alia-arc-switcher__emoji";
          emoji.textContent = threadMarkers.get(thread.id) ?? "💬";

          const number = document.createElement("span");
          number.className = "alia-arc-switcher__marker-key";
          number.textContent = String(index + 1);
          marker.append(emoji, number);

          const copy = document.createElement("span");
          copy.className = "alia-arc-switcher__copy";

          const title = document.createElement("span");
          title.className = "alia-arc-switcher__title";
          title.textContent = thread.title;

          const detail = document.createElement("span");
          detail.className = "alia-arc-switcher__detail";
          const project = projectEmojis.get(thread.projectId);
          detail.textContent = project
            ? `${project.emoji} ${project.name} · ${thread.providerId} · ${formatAge(thread.updatedAt)}`
            : `${thread.providerId} · ${formatAge(thread.updatedAt)}`;

          const status = document.createElement("span");
          status.className = "alia-arc-switcher__status";
          status.dataset.status = thread.status;
          status.setAttribute("aria-label", thread.status);

          copy.append(title, detail);
          item.append(marker, copy, status);
          const hoverSelect = () => {
            if (!pointerReady() || selectedIndex === index) return;
            selectedIndex = index;
            updateSelection();
          };
          item.addEventListener("pointerenter", hoverSelect);
          item.addEventListener("pointermove", hoverSelect);
          item.addEventListener("click", () => {
            selectedIndex = index;
            commit();
          });
          list.append(item);
        });

        const footer = document.createElement("div");
        footer.className = "alia-arc-switcher__footer";
        footer.textContent =
          mode === "persistent"
            ? "Click a chat · 1–7 jump · ↑↓ move · ⏎ open · esc close"
            : "Keep ⌘ held, tap D to cycle, then release to open";

        panel.append(list, footer);
        overlay.append(panel);
        document.body.append(overlay);
      };

      const showError = (message: string) => {
        removeOverlay();
        overlay = document.createElement("div");
        overlay.className = "alia-arc-switcher alia-arc-switcher--error";
        overlay.innerHTML = `<div class="alia-arc-switcher__error" role="alert"></div>`;
        const error = overlay.querySelector<HTMLElement>(".alia-arc-switcher__error");
        if (error) error.textContent = message;
        document.body.append(overlay);
        const errorOverlay = overlay;
        window.setTimeout(() => {
          if (overlay === errorOverlay) removeOverlay();
        }, 1800);
      };

      const loadAndOpen = async (requestedMode: SwitcherMode) => {
        try {
          // Refresh project emojis alongside the thread list so the switcher
          // shows current assignments and excludes them from new markers.
          const [response] = await Promise.all([
            fetch(
              `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/recentThreads`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "null",
                signal,
              },
            ),
            loadProjectEmojis(),
          ]);
          const envelope = (await response.json()) as RpcEnvelope;
          if (!response.ok || !envelope.ok) {
            throw new Error(
              envelope.ok ? "Could not load recent chats" : envelope.error?.message,
            );
          }

          const currentThreadId = getCurrentThreadId();
          threads = orderByRecentlyOpened(envelope.result.threads, currentThreadId);
          if (threads.length === 0) {
            pendingPresses = 0;
            showError("No recent chats yet");
            return;
          }
          threadMarkers = assignThreadMarkers(threads, projectEmojiSet);

          mode = requestedMode;
          // The current chat leads the list, so the first press highlights the
          // chat that was open before it — a quick Cmd+D tap toggles back.
          const firstIndex =
            threads.length > 1 && threads[0].id === currentThreadId ? 1 : 0;
          selectedIndex =
            (firstIndex + Math.max(0, pendingPresses - 1)) % threads.length;
          pendingPresses = 0;
          render();

          // The user already released Command while we were fetching: a quick
          // Cmd+D tap means "jump to the most recent other chat".
          if (mode === "held" && !metaHeld) commit();
        } catch (error) {
          pendingPresses = 0;
          if (signal.aborted) return;
          showError(error instanceof Error ? error.message : "Could not load recent chats");
        } finally {
          loading = null;
        }
      };

      const stepSelection = (step: number) => {
        if (threads.length === 0) return;
        selectedIndex =
          (selectedIndex + step + threads.length) % threads.length;
        updateSelection();
      };

      const cycleHeld = () => {
        if (overlay && threads.length > 0) {
          if (mode !== "held") {
            mode = "held";
            render();
          }
          stepSelection(1);
          return;
        }

        pendingPresses += 1;
        if (!loading) {
          loading = loadAndOpen("held");
        }
      };

      const openPersistent = () => {
        if (overlay && threads.length > 0) {
          mode = "persistent";
          render();
          return;
        }
        pendingPresses = 1;
        if (!loading) {
          loading = loadAndOpen("persistent");
        }
      };

      const consume = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Meta") metaHeld = true;

        if (overlay) {
          if (event.key === "Escape") {
            consume(event);
            cancel();
            return;
          }
          if (event.key === "Enter" && threads.length > 0) {
            consume(event);
            commit();
            return;
          }
          if (event.key === "ArrowDown" && threads.length > 0) {
            consume(event);
            stepSelection(1);
            return;
          }
          if (event.key === "ArrowUp" && threads.length > 0) {
            consume(event);
            stepSelection(-1);
            return;
          }
          if (
            /^[1-9]$/.test(event.key) &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey
          ) {
            const index = Number(event.key) - 1;
            if (index < threads.length) {
              consume(event);
              selectedIndex = index;
              commit();
              return;
            }
          }
        }

        if (isCommandD(event)) {
          metaHeld = true;
          consume(event);
          reportClientEvent("shortcut");
          cycleHeld();
        }
      };

      const onKeyUp = (event: KeyboardEvent) => {
        if (event.key !== "Meta") return;
        metaHeld = false;
        if (mode === "held" && overlay && threads.length > 0) commit();
      };

      const onBlur = () => {
        metaHeld = false;
        if (mode === "held") cancel();
      };

      const onOpenEvent = () => {
        openPersistent();
      };

      window.addEventListener("keydown", onKeyDown, { capture: true, signal });
      window.addEventListener("keyup", onKeyUp, { capture: true, signal });
      window.addEventListener("blur", onBlur, { signal });
      window.addEventListener(OPEN_EVENT, onOpenEvent, { signal });

      return () => {
        window.clearInterval(routeTimer);
        document
          .querySelectorAll<HTMLElement>(`[${THREAD_MARKER_ATTR}]`)
          .forEach((element) => element.removeAttribute(THREAD_MARKER_ATTR));
        cancel();
      };
    },
  });
});
