// bb-plugin-clickable-local-link - frontend entry.
//
// A content script catches clicks on links to local paths in the app (chat
// messages, rendered markdown) before BB's own handler runs:
//   - documents (docx, xlsx, pdf, images, ...) open in their default Mac app;
//   - folders open in Finder (BB does not treat folder links as files at all);
//   - Option-click on any local link selects it in Finder.
// Text and code files keep BB's built-in preview, so a click never launches a
// script. The server repeats the same safety decision (server.ts).
// Only the desktop app on this Mac is affected; remote clients and other
// operating systems keep BB's behavior untouched.
import { useEffect } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { resolveLang, type Lang } from "./lib/locale";

const TOAST_MS = 4000;

const MESSAGES: Record<Lang, { notFound: (p: string) => string; failed: (p: string) => string }> = {
  en: {
    notFound: (p) => `Not found: ${p}`,
    failed: (p) => `Could not open: ${p}`,
  },
  ru: {
    notFound: (p) => `Не найдено: ${p}`,
    failed: (p) => `Не удалось открыть: ${p}`,
  },
};

// The content script has no React context; this overlay passes the language
// setting to it.
let lang: Lang = resolveLang("System");

function SettingsBridge() {
  const { values } = useSettings();
  const language = values?.language;
  useEffect(() => {
    lang = resolveLang(language);
  }, [language]);
  return null;
}

// Same list as OPEN_EXTENSIONS in server.ts.
const OPEN_EXTENSIONS = new Set([
  "doc", "docx", "rtf", "odt", "pages",
  "xls", "xlsx", "csv", "ods", "numbers",
  "ppt", "pptx", "odp", "key",
  "pdf",
  "png", "jpg", "jpeg", "gif", "heic", "heif", "webp", "tif", "tiff", "bmp",
  "mp3", "m4a", "wav", "mp4", "mov", "webm",
  "zip",
]);

// Absolute paths BB renders as plain hrefs (folders have no extension, so BB
// does not turn them into file links). App routes never start with these.
const LOCAL_ROOTS = /^\/(Users|Volumes|private|tmp|var|Applications|Library|opt)\//;

/**
 * The desktop app loads BB from http://127.0.0.1:<port> when the server runs
 * on this Mac. A window connected to a remote BB server has another host, and
 * a click there must not open files on that remote machine.
 */
function isLocalMacClient(): boolean {
  const host = window.location.hostname;
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  return loopback && /Mac/i.test(navigator.platform || navigator.userAgent);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Absolute local path behind an anchor, or null when it is not a local link. */
export function localPathFromHref(href: string): string | null {
  let raw: string;
  if (href.startsWith("file://")) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.host !== "") return null;
    raw = safeDecode(url.pathname);
  } else if (LOCAL_ROOTS.test(safeDecode(href))) {
    // Cut "?query" and "#L12" BEFORE decoding, so "C%23 notes.docx" keeps its "#".
    raw = safeDecode(href.replace(/[?#].*$/, ""));
  } else {
    return null;
  }
  // Drop line suffixes: ":497", ":12:4", ":3-9".
  raw = raw.replace(/:\d+(?::\d+|-\d+)?$/, "");
  if (raw.length > 1 && raw.endsWith("/")) raw = raw.slice(0, -1);
  return raw.startsWith("/") && raw.length > 1 ? raw : null;
}

/** "" for folders, dotless files and names like "1. Finance". */
export function extensionOf(target: string): string {
  const base = target.slice(target.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

function mountOpenLocal(signal: AbortSignal, pluginId: string): () => void {
  const openUrl = `/api/v1/plugins/${encodeURIComponent(pluginId)}/http/open`;
  const toasts = new Set<HTMLElement>();
  const timers = new Set<number>();

  function toast(text: string) {
    const node = document.createElement("div");
    node.textContent = text;
    Object.assign(node.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      maxWidth: "420px",
      padding: "8px 12px",
      borderRadius: "8px",
      font: "13px/1.4 -apple-system, sans-serif",
      color: "#fff",
      background: "rgba(180, 40, 40, 0.95)",
      boxShadow: "0 4px 16px rgba(0,0,0,.25)",
    });
    document.body.appendChild(node);
    toasts.add(node);
    const timer = window.setTimeout(() => {
      node.remove();
      toasts.delete(node);
      timers.delete(timer);
    }, TOAST_MS);
    timers.add(timer);
  }

  async function open(target: string, reveal: boolean) {
    try {
      const response = await fetch(openUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target, reveal }),
        signal,
      });
      if (response.ok) return;
      const text = MESSAGES[lang];
      toast(response.status === 404 ? text.notFound(target) : text.failed(target));
    } catch {
      if (!signal.aborted) toast(MESSAGES[lang].failed(target));
    }
  }

  function onClick(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const target = localPathFromHref(anchor.getAttribute("href") ?? "");
    if (target === null) return;
    const reveal = event.altKey;
    const ext = extensionOf(target);
    // Text and code files stay in BB's preview.
    if (!reveal && ext !== "" && !OPEN_EXTENSIONS.has(ext)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void open(target, reveal);
  }

  if (!isLocalMacClient()) return () => {};
  window.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("click", onClick, true);
    for (const timer of timers) window.clearTimeout(timer);
    for (const node of toasts) node.remove();
    timers.clear();
    toasts.clear();
  };
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "settings-bridge", component: SettingsBridge });
  app.contentScripts.register({
    id: "clickable-local-links",
    mount: ({ signal, pluginId }) => mountOpenLocal(signal, pluginId),
  });
});
