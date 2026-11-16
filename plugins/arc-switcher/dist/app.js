// alia-plugin-runtime-shim:@vesnalia/plugin-sdk/app
var runtime = globalThis.__aliaPluginRuntime;
if (runtime == null || runtime.pluginSdkApp == null) {
  throw new Error('Cannot load "@vesnalia/plugin-sdk/app": this bundle must be loaded by the VesnALIA app, which provides the shared plugin runtime (globalThis.__aliaPluginRuntime).');
}
var mod = runtime.pluginSdkApp;
var {
  Markdown,
  ThreadChat,
  definePluginApp,
  experimental_NewThreadComposer,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useAliaContext,
  useAliaNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings
} = mod;

// app.tsx
var MAX_THREADS = 7;
var OPEN_EVENT = "alia-arc-switcher:open";
var MRU_STORAGE_KEY = "alia-arc-switcher:mru";
var THREAD_MARKER_STORAGE_KEY = "alia-arc-switcher:thread-markers:v1";
var MRU_LIMIT = 30;
var THREAD_MARKER_LIMIT = 200;
var ROUTE_POLL_MS = 400;
var THREAD_MARKERS = [
  "\u{1F680}",
  "\u{1F98A}",
  "\u{1F335}",
  "\u{1F9E0}",
  "\u26A1",
  "\u{1F3AF}",
  "\u{1F9E9}",
  "\u{1F52D}",
  "\u{1F525}",
  "\u{1F319}",
  "\u{1F48E}",
  "\u{1F340}",
  "\u{1F3A8}",
  "\u{1F6E0}\uFE0F",
  "\u{1F4DA}",
  "\u{1F9ED}",
  "\u{1F41D}",
  "\u{1F344}",
  "\u{1F3B8}",
  "\u{1FA90}",
  "\u{1F30A}",
  "\u{1F989}",
  "\u{1F3D5}\uFE0F",
  "\u{1F6F8}"
];
var THREAD_MARKER_ATTR = "data-alia-arc-marker";
var HEADER_TITLE_SELECTOR = "p.relative.min-w-0.truncate.text-sm.font-normal.transition-colors";
function formatAge(timestamp) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1e3));
  if (elapsedSeconds < 60) return "now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d`;
}
function getCurrentThreadId() {
  const match = decodeURIComponent(window.location.pathname).match(
    /\/threads\/([^/?#]+)/
  );
  if (match) return match[1];
  const activeRow = document.querySelector(
    '[data-sidebar-thread-id][aria-current="page"], [data-sidebar-thread-id][data-active="true"]'
  );
  return activeRow?.dataset.sidebarThreadId ?? null;
}
function readMru() {
  try {
    const raw = window.localStorage.getItem(MRU_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}
function recordVisit(threadId) {
  const mru = readMru();
  if (mru[0] === threadId) return;
  try {
    window.localStorage.setItem(
      MRU_STORAGE_KEY,
      JSON.stringify(
        [threadId, ...mru.filter((id) => id !== threadId)].slice(0, MRU_LIMIT)
      )
    );
  } catch {
  }
}
function readThreadMarkers() {
  try {
    const raw = window.localStorage.getItem(THREAD_MARKER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry) => typeof entry[1] === "string" && THREAD_MARKERS.includes(entry[1])
      )
    );
  } catch {
    return {};
  }
}
function markerStartIndex(threadId) {
  let hash = 2166136261;
  for (let index = 0; index < threadId.length; index += 1) {
    hash ^= threadId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % THREAD_MARKERS.length;
}
function deterministicMarker(threadId, exclude = /* @__PURE__ */ new Set()) {
  const start = markerStartIndex(threadId);
  for (let offset = 0; offset < THREAD_MARKERS.length; offset += 1) {
    const candidate = THREAD_MARKERS[(start + offset) % THREAD_MARKERS.length];
    if (!exclude.has(candidate)) return candidate;
  }
  return THREAD_MARKERS[start];
}
function persistThreadMarkers(stored, priorityIds) {
  try {
    const keepIds = Array.from(
      /* @__PURE__ */ new Set([...priorityIds, ...readMru(), ...Object.keys(stored)])
    ).slice(0, THREAD_MARKER_LIMIT);
    window.localStorage.setItem(
      THREAD_MARKER_STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          keepIds.flatMap((id) => stored[id] ? [[id, stored[id]]] : [])
        )
      )
    );
  } catch {
  }
}
function assignThreadMarkers(threads, exclude = /* @__PURE__ */ new Set()) {
  const stored = readThreadMarkers();
  const assigned = /* @__PURE__ */ new Map();
  const used = /* @__PURE__ */ new Set();
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
      if (!marker || used.has(marker)) {
        for (let offset = 0; offset < THREAD_MARKERS.length; offset += 1) {
          const candidate = THREAD_MARKERS[(start + offset) % THREAD_MARKERS.length];
          if (!used.has(candidate)) {
            marker = candidate;
            break;
          }
        }
      }
    }
    marker ??= THREAD_MARKERS[assigned.size % THREAD_MARKERS.length];
    assigned.set(thread.id, marker);
    stored[thread.id] = marker;
    used.add(marker);
  }
  persistThreadMarkers(
    stored,
    threads.map((thread) => thread.id)
  );
  return assigned;
}
function orderByRecentlyOpened(candidates, currentThreadId) {
  const mru = readMru();
  const rankedIds = currentThreadId ? [currentThreadId, ...mru.filter((id) => id !== currentThreadId)] : mru;
  const remaining = new Map(candidates.map((thread) => [thread.id, thread]));
  const ordered = [];
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
function navigateToThread(thread) {
  const rows = Array.from(
    document.querySelectorAll("[data-sidebar-thread-id]")
  );
  const target = rows.find((row) => row.dataset.sidebarThreadId === thread.id);
  if (target) {
    target.click();
    return;
  }
  const sample = rows.find(
    (row) => row instanceof HTMLAnchorElement && Boolean(row.dataset.sidebarThreadId)
  );
  if (sample?.dataset.sidebarThreadId) {
    const url = new URL(sample.href, window.location.href);
    url.pathname = url.pathname.replace(
      encodeURIComponent(sample.dataset.sidebarThreadId),
      encodeURIComponent(thread.id)
    );
    window.location.assign(url);
    return;
  }
  const encodedThreadId = encodeURIComponent(thread.id);
  const path = thread.projectId === "proj_personal" ? `/threads/${encodedThreadId}` : `/projects/${encodeURIComponent(thread.projectId)}/threads/${encodedThreadId}`;
  window.location.assign(path);
}
function isCommandD(event) {
  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.code === "KeyD" || event.key.toLowerCase() === "d");
}
var app_default = definePluginApp((app) => {
  app.slots.sidebarFooterAction({
    id: "recent-chats",
    title: "Recent chats (\u2318D)",
    icon: "Layers",
    run() {
      window.dispatchEvent(new CustomEvent(OPEN_EVENT));
    }
  });
  app.contentScripts.register({
    id: "arc-recent-chat-switcher",
    mount({ pluginId, generation, signal }) {
      let overlay = null;
      let threads = [];
      let threadMarkers = /* @__PURE__ */ new Map();
      let selectedIndex = 0;
      let pendingPresses = 0;
      let metaHeld = false;
      let mode = null;
      let loading = null;
      let projectEmojis = /* @__PURE__ */ new Map();
      let projectEmojiSet = /* @__PURE__ */ new Set();
      let projectEmojisLoaded = false;
      const loadProjectEmojis = async () => {
        try {
          const response = await fetch(
            "/api/v1/plugins/project-emoji/rpc/listProjects",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "null",
              signal
            }
          );
          const envelope = await response.json();
          if (response.ok && envelope.ok) {
            projectEmojis = new Map(
              envelope.result.projects.map((project) => [
                project.id,
                { name: project.name, emoji: project.emoji }
              ])
            );
            projectEmojiSet = new Set(
              envelope.result.projects.map((project) => project.emoji)
            );
          }
        } catch {
        } finally {
          projectEmojisLoaded = true;
        }
      };
      const reportClientEvent = (kind) => {
        void fetch(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/clientEvent`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind, generation }),
            signal
          }
        ).catch(() => void 0);
      };
      reportClientEvent("mounted");
      let lastSeenThreadId = null;
      const trackRoute = () => {
        const threadId = getCurrentThreadId();
        if (threadId && threadId !== lastSeenThreadId) {
          lastSeenThreadId = threadId;
          recordVisit(threadId);
        }
      };
      const applyMarker = (element, marker) => {
        if (element.getAttribute(THREAD_MARKER_ATTR) !== marker) {
          element.setAttribute(THREAD_MARKER_ATTR, marker);
        }
      };
      const findHeaderTitle = (actionsEl) => {
        let scope = actionsEl.parentElement;
        for (let depth = 0; scope && depth < 4; depth += 1) {
          const title = scope.querySelector(HEADER_TITLE_SELECTOR);
          if (title) return title;
          scope = scope.parentElement;
        }
        return null;
      };
      const decorateChrome = () => {
        const stored = readThreadMarkers();
        let dirty = false;
        const ensureMarker = (threadId) => {
          let marker = stored[threadId];
          if (!marker) {
            if (!projectEmojisLoaded) return null;
            marker = deterministicMarker(threadId, projectEmojiSet);
            stored[threadId] = marker;
            dirty = true;
          }
          return marker;
        };
        const sidebarIds = [];
        const titleToThread = /* @__PURE__ */ new Map();
        document.querySelectorAll("[data-sidebar-thread-id]").forEach((anchor) => {
          const threadId = anchor.dataset.sidebarThreadId;
          const label = anchor.parentElement?.querySelector("span.truncate");
          if (!threadId || !label) return;
          sidebarIds.push(threadId);
          const marker = ensureMarker(threadId);
          if (marker) applyMarker(label, marker);
          const text = label.textContent?.trim();
          if (text) {
            const existing = titleToThread.get(text);
            titleToThread.set(
              text,
              existing === void 0 || existing === threadId ? threadId : null
            );
          }
        });
        const urlThreadId = getCurrentThreadId();
        document.querySelectorAll("[data-thread-header-workflow-actions]").forEach((actionsEl) => {
          const title = findHeaderTitle(actionsEl);
          if (!title) return;
          const pane = actionsEl.closest("[data-split-pane-id]");
          let threadId = null;
          if (pane) {
            const text = title.textContent?.trim();
            threadId = text && titleToThread.get(text) || null;
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
        const panel = overlay?.querySelector("[role='listbox']");
        const selected = threads[selectedIndex];
        panel?.setAttribute(
          "aria-activedescendant",
          selected ? `alia-arc-thread-${selected.id}` : ""
        );
        overlay?.querySelectorAll(".alia-arc-switcher__item").forEach((item, index) => {
          const isSelected = index === selectedIndex;
          item.dataset.selected = String(isSelected);
          item.setAttribute("aria-selected", String(isSelected));
        });
      };
      const render = () => {
        overlay?.remove();
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
          threads[selectedIndex] ? `alia-arc-thread-${threads[selectedIndex].id}` : ""
        );
        const header = document.createElement("div");
        header.className = "alia-arc-switcher__header";
        header.innerHTML = '<span>Recent chats</span><kbd><span aria-hidden="true">&#8984;</span>D</kbd>';
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
          emoji.textContent = threadMarkers.get(thread.id) ?? "\u{1F4AC}";
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
          detail.textContent = project ? `${project.emoji} ${project.name} \xB7 ${thread.providerId} \xB7 ${formatAge(thread.updatedAt)}` : `${thread.providerId} \xB7 ${formatAge(thread.updatedAt)}`;
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
        footer.textContent = mode === "persistent" ? "Click a chat \xB7 1\u20137 jump \xB7 \u2191\u2193 move \xB7 \u23CE open \xB7 esc close" : "Keep \u2318 held, tap D to cycle, then release to open";
        panel.append(list, footer);
        overlay.append(panel);
        document.body.append(overlay);
      };
      const showError = (message) => {
        removeOverlay();
        overlay = document.createElement("div");
        overlay.className = "alia-arc-switcher alia-arc-switcher--error";
        overlay.innerHTML = `<div class="alia-arc-switcher__error" role="alert"></div>`;
        const error = overlay.querySelector(".alia-arc-switcher__error");
        if (error) error.textContent = message;
        document.body.append(overlay);
        const errorOverlay = overlay;
        window.setTimeout(() => {
          if (overlay === errorOverlay) removeOverlay();
        }, 1800);
      };
      const loadAndOpen = async (requestedMode) => {
        try {
          const [response] = await Promise.all([
            fetch(
              `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/recentThreads`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "null",
                signal
              }
            ),
            loadProjectEmojis()
          ]);
          const envelope = await response.json();
          if (!response.ok || !envelope.ok) {
            throw new Error(
              envelope.ok ? "Could not load recent chats" : envelope.error?.message
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
          const firstIndex = threads.length > 1 && threads[0].id === currentThreadId ? 1 : 0;
          selectedIndex = (firstIndex + Math.max(0, pendingPresses - 1)) % threads.length;
          pendingPresses = 0;
          render();
          if (mode === "held" && !metaHeld) commit();
        } catch (error) {
          pendingPresses = 0;
          if (signal.aborted) return;
          showError(error instanceof Error ? error.message : "Could not load recent chats");
        } finally {
          loading = null;
        }
      };
      const stepSelection = (step) => {
        if (threads.length === 0) return;
        selectedIndex = (selectedIndex + step + threads.length) % threads.length;
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
      const consume = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const onKeyDown = (event) => {
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
          if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.altKey && !event.shiftKey) {
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
      const onKeyUp = (event) => {
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
        document.querySelectorAll(`[${THREAD_MARKER_ATTR}]`).forEach((element) => element.removeAttribute(THREAD_MARKER_ATTR));
        cancel();
      };
    }
  });
});
export {
  app_default as default
};
