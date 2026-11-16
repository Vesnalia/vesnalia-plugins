import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import type { Entry, InstalledPlugin, Label } from "./server";

const NEGATIVE_LABELS = new Set(["rejected", "buggy", "slow", "clashes", "redundant"]);
const TITLE_SELECTOR = "span.line-clamp-2, span.truncate.font-medium, h2, h3";

const STYLES = `
.pv-neg > :not(.pv-tile), .pv-neg .pv-note { filter: blur(4px) !important; transition: filter 0.15s !important; }
.pv-neg:hover > :not(.pv-tile), .pv-neg:hover .pv-note { filter: none !important; }
.pv-tile {
  grid-column: 1 / -1 !important;
  position: relative !important;
  z-index: 5 !important;
  pointer-events: none !important;
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 4px !important;
  margin-top: 4px !important;
  font-size: 11px !important;
  line-height: 1.35 !important;
}
.pv-note {
  flex-basis: 100% !important;
  font-style: italic !important;
  opacity: 0.9 !important;
  word-break: break-word !important;
  color: var(--foreground, #fafafa) !important;
}
.pv-chip {
  display: inline-flex !important;
  align-items: center !important;
  padding: 1px 7px !important;
  border-radius: 9999px !important;
  border: 1px solid !important;
  font-size: 10px !important;
  font-weight: 600 !important;
  white-space: nowrap !important;
}
.pv-edit {
  pointer-events: auto !important;
  cursor: pointer !important;
  padding: 1px 7px !important;
  border-radius: 9999px !important;
  border: 1px dashed var(--border, rgba(255,255,255,0.25)) !important;
  background: transparent !important;
  color: var(--muted-foreground, #a1a1aa) !important;
  font-size: 10px !important;
  font-weight: 600 !important;
}
.pv-edit:hover { color: var(--foreground, #fafafa) !important; }
.pv-hdr { display: inline-flex !important; flex-wrap: wrap !important; gap: 4px !important; align-items: center !important; }
.pv-menuitem:hover { background: var(--state-hover, rgba(127,127,127,0.14)) !important; }
.pv-dialog {
  position: fixed !important;
  inset: 0 !important;
  margin: auto !important;
  height: fit-content !important;
  max-height: calc(100vh - 32px) !important;
  overflow-y: auto !important;
  width: min(440px, calc(100vw - 32px)) !important;
  padding: 16px !important;
  border-radius: 12px !important;
  border: 1px solid var(--border, rgba(255,255,255,0.15)) !important;
  background: var(--popover, var(--background, #18181b)) !important;
  color: var(--foreground, #fafafa) !important;
  font-size: 13px !important;
}
.pv-dialog::backdrop { background: rgba(0,0,0,0.5) !important; }
.pv-dialog h2 { margin: 0 0 12px !important; font-size: 14px !important; font-weight: 600 !important; }
.pv-dialog .pv-section { margin-bottom: 12px !important; }
.pv-dialog .pv-caption { margin-bottom: 6px !important; font-size: 11px !important; color: var(--muted-foreground, #a1a1aa) !important; }
.pv-dialog .pv-labels { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; }
.pv-dialog .pv-labels label { display: inline-flex !important; align-items: center !important; gap: 4px !important; cursor: pointer !important; }
.pv-dialog .pv-row { display: flex !important; gap: 6px !important; align-items: center !important; }
.pv-dialog input[type="text"], .pv-dialog textarea {
  flex: 1 !important;
  width: 100% !important;
  box-sizing: border-box !important;
  padding: 6px 8px !important;
  border-radius: 6px !important;
  border: 1px solid var(--input, rgba(255,255,255,0.15)) !important;
  background: transparent !important;
  color: inherit !important;
  font: inherit !important;
}
.pv-dialog input[type="color"] { width: 32px !important; height: 30px !important; padding: 0 !important; border: none !important; background: none !important; }
.pv-dialog button.pv-btn {
  padding: 5px 12px !important;
  border-radius: 6px !important;
  border: 1px solid var(--border, rgba(255,255,255,0.15)) !important;
  background: transparent !important;
  color: inherit !important;
  cursor: pointer !important;
  font-size: 12px !important;
  font-weight: 600 !important;
}
.pv-dialog button.pv-primary { background: var(--primary, #fafafa) !important; color: var(--primary-foreground, #18181b) !important; border-color: transparent !important; }
.pv-dialog .pv-actions { display: flex !important; justify-content: flex-end !important; gap: 6px !important; }
.pv-dialog .pv-error { color: var(--destructive, #ef4444) !important; font-size: 12px !important; margin-bottom: 8px !important; }
`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeKey(str: string): string {
  return str.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function chipHtml(label: Label): string {
  const c = escapeHtml(label.color);
  return `<span class="pv-chip" style="color:${c};background:${c}22;border-color:${c}66;">${escapeHtml(label.name)}</span>`;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "plugin-vault-badger",
    mount({ pluginId, signal }) {
      let entries: Entry[] = [];
      const labels = new Map<string, Label>();
      const entryMap = new Map<string, Entry>();
      const installed = new Set<string>();
      const catalogMap = new Map<string, string>(); // alias/name/slug -> canonical pluginId
      let version = 0;
      let debounceTimer: number | null = null;

      const styleEl = document.createElement("style");
      styleEl.textContent = STYLES;
      document.head.appendChild(styleEl);

      async function rpc<T>(method: string, input: unknown): Promise<T> {
        const res = await fetch(`/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${res.status})`);
        return data.result as T;
      }

      function addAlias(key: string, pid: string) {
        catalogMap.set(key.toLowerCase(), pid);
        catalogMap.set(normalizeKey(key), pid);
      }

      async function fetchVault() {
        try {
          const result = await rpc<{
            entries: Entry[];
            labels: Label[];
            installed: InstalledPlugin[];
            catalogMap?: Record<string, string>;
          }>(
            "vault_list",
            null
          );
          entries = result.entries;
          labels.clear();
          for (const l of result.labels) labels.set(l.id, l);
          entryMap.clear();
          for (const e of entries) {
            for (const key of [e.id, e.name]) {
              entryMap.set(key.toLowerCase(), e);
              entryMap.set(normalizeKey(key), e);
            }
          }
          installed.clear();
          for (const p of result.installed) installed.add(p.id.toLowerCase());
          for (const [key, pid] of Object.entries(result.catalogMap ?? {})) addAlias(key, pid.toLowerCase());
          version++;
          requestScan();
        } catch {
          // aborted or network failure
        }
      }

      function lookup(input: string): { id: string; entry?: Entry } | null {
        const lower = input.trim().toLowerCase();
        const norm = normalizeKey(input);
        if (!norm) return null;
        const direct = entryMap.get(lower) ?? entryMap.get(norm);
        if (direct) return { id: direct.id, entry: direct };
        const pid = catalogMap.get(lower) ?? catalogMap.get(norm);
        if (!pid) return null;
        return { id: pid, entry: entryMap.get(pid) ?? entryMap.get(normalizeKey(pid)) };
      }

      function resolveCard(card: HTMLElement): { id: string; name: string; entry?: Entry } | null {
        const candidates: string[] = [];

        const rowId = card.closest('[data-testid^="plugin-row-"]')?.getAttribute("data-testid")?.replace("plugin-row-", "");
        if (rowId) candidates.push(rowId);

        const detailsLabel = card.querySelector('button[aria-label*="details" i]')?.getAttribute("aria-label") ?? "";
        const d = detailsLabel.match(/Open\s+(.+?)\s+details/i) || detailsLabel.match(/(.+?)\s+plugin\s+details/i);
        if (d) candidates.push(d[1]);

        const installLabel =
          card.querySelector('button[aria-label^="Install " i], button[aria-label*=" installed" i]')?.getAttribute("aria-label") ?? "";
        const m = installLabel.match(/^Install\s+(.+?)(?:\s+—|$)/i) || installLabel.match(/^(.+?)\s+installed/i);
        if (m) candidates.push(m[1]);

        const title = card.querySelector(TITLE_SELECTOR)?.textContent?.trim();
        if (title) candidates.push(title);

        if (candidates.length === 0) return null;
        const name = title || candidates[0];
        const hits = candidates.map(lookup);
        const hit = hits.find((h) => h?.entry) ?? hits.find(Boolean);
        return hit ? { ...hit, name } : { id: rowId ?? normalizeKey(candidates[0]), name };
      }

      function findAllCards(): HTMLElement[] {
        const cards = new Set<HTMLElement>();
        document.querySelectorAll('button[aria-label*="details" i]').forEach((btn) => {
          const card = btn.closest<HTMLElement>('.group.relative.grid, [class*="group"][class*="grid"]');
          if (card) cards.add(card);
        });
        document.querySelectorAll<HTMLElement>('[data-testid^="plugin-row-"]').forEach((row) => {
          cards.add(row.querySelector<HTMLElement>('.group.relative.grid, [class*="group"][class*="grid"]') ?? row);
        });
        return Array.from(cards);
      }

      function displayLabels(id: string, entry?: Entry): Label[] {
        const ids = entry?.labels ?? [];
        const all = installed.has(id.toLowerCase()) && !ids.includes("installed") ? ["installed", ...ids] : ids;
        return all.map((l) => labels.get(l)).filter((l): l is Label => !!l);
      }

      function isNegative(entry?: Entry): boolean {
        return !!entry?.labels.some((l) => NEGATIVE_LABELS.has(l));
      }

      function decorationHtml(id: string, name: string, entry?: Entry): string {
        const chips = displayLabels(id, entry).map(chipHtml).join("");
        const note = entry?.note ? `<div class="pv-note">${escapeHtml(entry.note)}</div>` : "";
        const button = `<button type="button" class="pv-edit" data-pv-edit="${escapeHtml(id)}" data-pv-name="${escapeHtml(name)}">${entry ? "Edit" : "+ Label"}</button>`;
        return chips + button + note;
      }

      function decorateCard(card: HTMLElement) {
        const target = resolveCard(card);
        if (!target) return;
        const key = `${version}:${target.id}`;
        if (card.dataset.pvKey === key) return;
        card.dataset.pvKey = key;

        let section = card.querySelector<HTMLElement>(":scope > .pv-tile");
        if (!section) {
          section = document.createElement("div");
          section.className = "pv-tile pv-injected";
          card.appendChild(section);
        }
        section.innerHTML = decorationHtml(target.id, target.name, target.entry);

        card.classList.toggle("pv-neg", isNegative(target.entry));
        if (card.matches("[data-resource-row]")) return;
        const shown = displayLabels(target.id, target.entry);
        const color = (shown.find((l) => l.id !== "installed") ?? shown[0])?.color;
        card.style.border = `1px solid ${color ? `${color}99` : "var(--border, rgba(255,255,255,0.15))"}`;
        card.style.boxShadow = color ? `0 0 0 1px ${color}44` : "";
      }

      function detailPluginId(): string | null {
        const match = window.location.pathname.match(/^\/plugins\/([a-zA-Z0-9_-]+)\/?$/);
        return match ? match[1].toLowerCase() : null;
      }

      function renderHeader() {
        const pid = detailPluginId();
        const wrap = pid ? document.querySelector<HTMLElement>("h1")?.parentElement : null;
        let hdr = document.getElementById("pv-hdr");
        if (!pid || !wrap) {
          hdr?.remove();
          return;
        }
        const key = `${version}:${pid}`;
        if (hdr?.dataset.pvKey === key && hdr.parentElement === wrap) return;
        if (!hdr) {
          hdr = document.createElement("span");
          hdr.id = "pv-hdr";
          hdr.className = "pv-hdr pv-injected";
        }
        if (hdr.parentElement !== wrap) wrap.appendChild(hdr);
        hdr.dataset.pvKey = key;
        const hit = lookup(pid);
        hdr.innerHTML = displayLabels(hit?.id ?? pid, hit?.entry).map(chipHtml).join("");
      }

      function injectMenuItem() {
        const pid = detailPluginId();
        const menu = pid ? document.querySelector<HTMLElement>('[role="menu"][aria-labelledby]') : null;
        if (!pid || !menu || menu.querySelector(".pv-menuitem")) return;
        const trigger = document.getElementById(menu.getAttribute("aria-labelledby")!);
        if (!trigger?.closest("div.flex.min-w-0.items-start")?.querySelector("h1")) return;
        const hit = lookup(pid);
        const item = document.createElement("div");
        item.setAttribute("role", "menuitem");
        item.className = `${menu.querySelector('[role="menuitem"]')?.className ?? ""} pv-menuitem pv-injected`;
        item.dataset.pvEdit = hit?.id ?? pid;
        item.dataset.pvName = document.querySelector("h1")?.textContent?.trim() ?? pid;
        item.textContent = "Labels & comment…";
        menu.appendChild(item);
      }

      function requestScan() {
        if (debounceTimer !== null) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
          debounceTimer = null;
          if (signal.aborted || !window.location.pathname.startsWith("/plugins")) return;
          findAllCards().forEach(decorateCard);
          renderHeader();
          injectMenuItem();
        }, 80);
      }

      // --- Editor dialog ---
      const dialog = document.createElement("dialog");
      dialog.className = "pv-dialog pv-injected";
      document.body.appendChild(dialog);

      function openEditor(id: string, name: string) {
        const entry = entryMap.get(id.toLowerCase());
        const selected = new Set(entry?.labels ?? []);
        dialog.innerHTML = `
          <form method="dialog">
            <h2>${escapeHtml(name)} <span style="font-size:11px;opacity:0.6;font-family:monospace;">${escapeHtml(id)}</span></h2>
            <div class="pv-error" hidden></div>
            <div class="pv-section">
              <div class="pv-caption">Labels</div>
              <div class="pv-labels"></div>
            </div>
            <div class="pv-section">
              <div class="pv-caption">New label</div>
              <div class="pv-row">
                <input type="text" name="newName" placeholder="Label name" maxlength="40" />
                <input type="color" name="newColor" value="#8b5cf6" aria-label="Label color" />
                <button type="button" class="pv-btn" data-action="create">Create</button>
              </div>
            </div>
            <div class="pv-section">
              <div class="pv-caption">Description</div>
              <textarea name="note" rows="3" placeholder="Why this label? What did you notice?">${escapeHtml(entry?.note ?? "")}</textarea>
            </div>
            <div class="pv-actions">
              <button type="button" class="pv-btn" data-action="cancel">Cancel</button>
              <button type="submit" class="pv-btn pv-primary">Save</button>
            </div>
          </form>`;

        const form = dialog.querySelector("form")!;
        const list = dialog.querySelector<HTMLElement>(".pv-labels")!;
        const errorEl = dialog.querySelector<HTMLElement>(".pv-error")!;
        const showError = (err: unknown) => {
          errorEl.textContent = err instanceof Error ? err.message : String(err);
          errorEl.hidden = false;
        };

        const renderLabels = () => {
          list.innerHTML = [...labels.values()]
            .map(
              (l) =>
                `<label><input type="checkbox" value="${escapeHtml(l.id)}" ${selected.has(l.id) ? "checked" : ""} />${chipHtml(l)}</label>`
            )
            .join("");
        };
        renderLabels();
        list.addEventListener("change", (e) => {
          const box = e.target as HTMLInputElement;
          if (box.checked) selected.add(box.value);
          else selected.delete(box.value);
        });

        form.querySelector('[data-action="cancel"]')!.addEventListener("click", () => dialog.close());
        form.querySelector('[data-action="create"]')!.addEventListener("click", async () => {
          const nameInput = form.elements.namedItem("newName") as HTMLInputElement;
          const color = (form.elements.namedItem("newColor") as HTMLInputElement).value;
          if (!nameInput.value.trim()) return nameInput.focus();
          try {
            const label = await rpc<Label>("label_create", { name: nameInput.value.trim(), color });
            labels.set(label.id, label);
            selected.add(label.id);
            nameInput.value = "";
            renderLabels();
          } catch (err) {
            showError(err);
          }
        });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            await rpc("vault_set", {
              id,
              name,
              labels: [...selected],
              note: (form.elements.namedItem("note") as HTMLTextAreaElement).value,
            });
            dialog.close();
            await fetchVault();
          } catch (err) {
            showError(err);
          }
        });

        dialog.showModal();
      }

      function handleDocClick(e: MouseEvent) {
        const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-pv-edit]");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const { pvEdit, pvName } = btn.dataset;
        if (btn.closest('[role="menu"]')) {
          document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          window.setTimeout(() => openEditor(pvEdit!, pvName!), 0);
        } else openEditor(pvEdit!, pvName!);
      }
      document.addEventListener("click", handleDocClick, true);

      const observer = new MutationObserver((mutations) => {
        if (mutations.some((m) => !(m.target as Element).closest?.(".pv-injected"))) requestScan();
      });
      observer.observe(document.body, { childList: true, subtree: true });

      fetchVault();

      return () => {
        if (debounceTimer !== null) window.clearTimeout(debounceTimer);
        observer.disconnect();
        document.removeEventListener("click", handleDocClick, true);
        document.querySelectorAll(".pv-injected").forEach((el) => el.remove());
        document.querySelectorAll<HTMLElement>("[data-pv-key]").forEach((el) => {
          delete el.dataset.pvKey;
          el.style.border = "";
          el.style.boxShadow = "";
        });
        document.querySelectorAll(".pv-neg").forEach((el) => el.classList.remove("pv-neg"));
        styleEl.remove();
      };
    },
  });
});
