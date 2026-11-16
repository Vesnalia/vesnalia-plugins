// bb-plugin-live-markdown — frontend.
//
// One fileOpener for .md/.mdx/.markdown: an Obsidian-style live-preview editor.
// The buffer is the file's exact text; saving writes that text back, so an
// edit changes only the characters typed. Autosave is debounced and
// compare-and-swap guarded; a file an agent changed underneath you reloads in
// place when you have no unsaved edits, and raises a conflict when you do.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc, type PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, type Text, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import type { rpcContract } from "./server";
import { MARKDOWN_EXTENSIONS, OPENER_ID, seedDefaultOpener } from "./default-opener";
import { linkClicks, livePreview } from "./editor/live-preview";
import { tables } from "./editor/tables";
import { liveTheme } from "./editor/theme";

const AUTOSAVE_DELAY_MS = 1000;
const DISK_POLL_MS = 3000;

/** Marks a transaction that mirrors the disk, so it neither dirties the buffer nor enters undo history. */
const fromDisk = Annotation.define<true>();

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

type SaveState =
  | { kind: "saved" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "conflict"; diskSha256: string | null }
  | { kind: "error"; message: string };

/** The disk version the buffer descends from: the CAS base for the next write. */
interface DiskVersion {
  doc: Text;
  sha256: string;
}

/**
 * Unsaved text whose editor unmounted before it could be saved: bb can remount
 * the panel (a layout change), and a remount in a conflict used to drop the
 * edits. Keyed by file; the next editor for that file restores it.
 */
interface UnsavedDraft {
  text: string;
  /** The disk version the text was written against. */
  baseSha256: string;
}

const unsavedDrafts = new Map<string, UnsavedDraft>();

/** Applies `next` as the smallest single replacement, so the cursor and scroll survive an agent's edit. */
function applyDiskText(view: EditorView, next: string): void {
  const current = view.state.sliceDoc();
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start++;
  let end = 0;
  while (
    end < current.length - start &&
    end < next.length - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }
  view.dispatch({
    changes: { from: start, to: current.length - end, insert: next.slice(start, next.length - end) },
    annotations: [fromDisk.of(true), Transaction.addToHistory.of(false)],
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function LiveMarkdownOpener({ path, source, Original, experimental_lineRange }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const diskRef = useRef<DiskVersion | null>(null);
  const saveStateRef = useRef<SaveState>({ kind: "saved" });
  const autosaveTimer = useRef<number | undefined>(undefined);
  const previewCompartment = useRef(new Compartment());
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [saveState, setSaveStateRaw] = useState<SaveState>({ kind: "saved" });
  const [livePreviewOn, setLivePreviewOn] = useState(true);

  const setSaveState = useCallback((next: SaveState) => {
    saveStateRef.current = next;
    setSaveStateRaw(next);
  }, []);

  // `source` is a fresh object per render; key the file on its fields.
  const sourceKey = JSON.stringify(source);
  const fileRef = useRef({ path, source });
  fileRef.current = { path, source };

  const save = useCallback(
    async (expectedSha256?: string | null) => {
      const view = viewRef.current;
      const disk = diskRef.current;
      if (view === null || disk === null) return;
      const state = saveStateRef.current.kind;
      if (state === "saving" || (state === "conflict" && expectedSha256 === undefined)) return;
      const doc = view.state.doc;
      if (expectedSha256 === undefined && doc.eq(disk.doc)) {
        setSaveState({ kind: "saved" });
        return;
      }
      setSaveState({ kind: "saving" });
      const content = view.state.sliceDoc();
      try {
        const result = await rpc.call("write", {
          ...fileRef.current,
          content,
          expectedSha256: expectedSha256 === undefined ? disk.sha256 : expectedSha256,
        });
        if (result.outcome === "conflict") {
          // The disk may already hold exactly this text (an earlier editor's unmount write).
          const current = await rpc.call("read", fileRef.current);
          if (current.kind === "text" && current.content === content) {
            diskRef.current = { doc, sha256: current.sha256 };
            setSaveState(view.state.doc.eq(doc) ? { kind: "saved" } : { kind: "unsaved" });
            return;
          }
          setSaveState({ kind: "conflict", diskSha256: result.currentSha256 });
          return;
        }
        diskRef.current = { doc, sha256: result.sha256 };
        // Typing during the round trip leaves the buffer ahead of what was written.
        if (view.state.doc.eq(doc)) {
          setSaveState({ kind: "saved" });
        } else {
          setSaveState({ kind: "unsaved" });
          autosaveTimer.current = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
        }
      } catch (error) {
        setSaveState({ kind: "error", message: messageOf(error) });
      }
    },
    [rpc, setSaveState],
  );

  // Load the file and build the editor; rebuilt only when the file identity changes.
  useEffect(() => {
    let disposed = false;
    setLoad({ kind: "loading" });
    setSaveState({ kind: "saved" });

    void (async () => {
      try {
        const file = await rpc.call("read", { path, source });
        if (disposed) return;
        if (file.kind === "unsupported") {
          setLoad({ kind: "unsupported" });
          return;
        }
        const host = hostRef.current;
        if (host === null) return;
        // CRLF files keep CRLF: the separator is what sliceDoc() writes back.
        const crlf = file.content.includes("\r\n") && !/(^|[^\r])\n/.test(file.content);
        const state = EditorState.create({
          doc: file.content,
          extensions: [
            crlf ? EditorState.lineSeparator.of("\r\n") : [],
            history(),
            drawSelection(),
            search({ top: true }),
            EditorView.lineWrapping,
            markdown({ base: markdownLanguage }),
            previewCompartment.current.of([livePreview, tables, linkClicks]),
            liveTheme,
            keymap.of([
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                  clearTimeout(autosaveTimer.current);
                  void save();
                  return true;
                },
              },
              ...searchKeymap,
              ...historyKeymap,
              ...defaultKeymap,
            ]),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged || update.transactions.every((tr) => tr.annotation(fromDisk))) return;
              if (saveStateRef.current.kind === "conflict") return;
              if (saveStateRef.current.kind !== "saving") setSaveState({ kind: "unsaved" });
              clearTimeout(autosaveTimer.current);
              autosaveTimer.current = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
            }),
          ],
        });
        const draftKey = `${path}\u0000${sourceKey}`;
        const draft = unsavedDrafts.get(draftKey);
        unsavedDrafts.delete(draftKey);
        const view = new EditorView({ state, parent: host });
        viewRef.current = view;
        diskRef.current = { doc: state.doc, sha256: file.sha256 };
        if (draft !== undefined && draft.text !== file.content) {
          // The restored text is a local edit on top of what was just read.
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: draft.text } });
          if (draft.baseSha256 !== file.sha256) {
            setSaveState({ kind: "conflict", diskSha256: file.sha256 });
          }
        }
        setLoad({ kind: "ready" });
      } catch (error) {
        if (!disposed) setLoad({ kind: "error", message: messageOf(error) });
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(autosaveTimer.current);
      const view = viewRef.current;
      const disk = diskRef.current;
      // Closing the tab keeps unsaved text, as Obsidian does. The draft is stashed
      // first and dropped only once the write lands: a conflict, a failed write, or
      // an unmount mid-conflict leaves it for the next editor of this file.
      if (view !== null && disk !== null && !view.state.doc.eq(disk.doc)) {
        const draftKey = `${path}\u0000${sourceKey}`;
        const text = view.state.sliceDoc();
        unsavedDrafts.set(draftKey, { text, baseSha256: disk.sha256 });
        if (saveStateRef.current.kind !== "conflict") {
          void rpc
            .call("write", { path, source, content: text, expectedSha256: disk.sha256 })
            .then((result) => {
              if (result.outcome === "written" && unsavedDrafts.get(draftKey)?.text === text) {
                unsavedDrafts.delete(draftKey);
              }
            })
            .catch(() => undefined);
        }
      }
      view?.destroy();
      viewRef.current = null;
      diskRef.current = null;
    };
    // sourceKey stands in for `source`, which is a new object every render.
  }, [path, sourceKey, rpc, save, setSaveState]);

  // Follow the disk: agents edit these files too.
  useEffect(() => {
    if (load.kind !== "ready") return;
    const timer = setInterval(async () => {
      const view = viewRef.current;
      if (view === null || document.visibilityState !== "visible") return;
      const before = saveStateRef.current.kind;
      if (before === "saving" || before === "conflict") return;
      try {
        const file = await rpc.call("read", fileRef.current);
        // A save may have finished, or the tab moved on, while the read was in flight.
        const disk = diskRef.current;
        // The ref changes across the await; widen past the pre-await narrowing.
        const now = saveStateRef.current as SaveState;
        if (file.kind !== "text" || disk === null || viewRef.current !== view || now.kind === "saving") return;
        if (file.sha256 === disk.sha256) return;
        if (view.state.doc.eq(disk.doc)) {
          applyDiskText(view, file.content);
          diskRef.current = { doc: view.state.doc, sha256: file.sha256 };
        } else {
          clearTimeout(autosaveTimer.current);
          setSaveState({ kind: "conflict", diskSha256: file.sha256 });
        }
      } catch {
        // A failed poll is retried on the next tick; saving reports its own errors.
      }
    }, DISK_POLL_MS);
    return () => clearInterval(timer);
  }, [load.kind, rpc, setSaveState]);

  // Jump to the requested lines on open and on every new targeted open.
  useEffect(() => {
    const view = viewRef.current;
    if (load.kind !== "ready" || view === null || !experimental_lineRange) return;
    const lines = view.state.doc.lines;
    const start = view.state.doc.line(Math.min(Math.max(experimental_lineRange.startLineNumber, 1), lines));
    view.dispatch({ selection: { anchor: start.from }, effects: EditorView.scrollIntoView(start.from, { y: "center" }) });
  }, [load.kind, experimental_lineRange]);

  const reloadFromDisk = useCallback(async () => {
    const view = viewRef.current;
    if (view === null) return;
    try {
      const file = await rpc.call("read", fileRef.current);
      if (file.kind !== "text") return;
      applyDiskText(view, file.content);
      diskRef.current = { doc: view.state.doc, sha256: file.sha256 };
      setSaveState({ kind: "saved" });
    } catch (error) {
      setSaveState({ kind: "error", message: messageOf(error) });
    }
  }, [rpc, setSaveState]);

  const toggleLivePreview = useCallback(() => {
    const view = viewRef.current;
    if (view === null) return;
    const next = !livePreviewOn;
    view.dispatch({
      effects: previewCompartment.current.reconfigure(next ? [livePreview, tables, linkClicks] : []),
    });
    setLivePreviewOn(next);
    view.focus();
  }, [livePreviewOn]);

  if (load.kind === "unsupported") return <Original />;

  const status =
    saveState.kind === "saved"
      ? "Saved"
      : saveState.kind === "unsaved"
        ? "Unsaved"
        : saveState.kind === "saving"
          ? "Saving…"
          : saveState.kind === "conflict"
            ? "Changed on disk"
            : "Save failed";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={path}>
          {path}
        </span>
        <span
          className={
            saveState.kind === "conflict" || saveState.kind === "error"
              ? "shrink-0 text-destructive"
              : "shrink-0 text-muted-foreground"
          }
          data-testid="live-md-status"
        >
          {status}
        </span>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={toggleLivePreview}
          title={livePreviewOn ? "Show all Markdown source" : "Hide Markdown syntax off the cursor line"}
          data-testid="live-md-mode"
        >
          {livePreviewOn ? "Source" : "Live"}
        </button>
      </div>

      {saveState.kind === "conflict" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">This file changed on disk while you had unsaved edits.</span>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 hover:bg-background"
            onClick={() => void reloadFromDisk()}
          >
            Load disk version
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 hover:bg-background"
            onClick={() => void save(saveState.diskSha256)}
          >
            Keep mine
          </button>
        </div>
      ) : null}

      {saveState.kind === "error" ? (
        <div className="shrink-0 border-b border-border px-3 py-2 text-xs text-destructive">{saveState.message}</div>
      ) : null}

      {load.kind === "error" ? (
        <div className="px-3 py-2 text-xs text-destructive">{load.message}</div>
      ) : null}

      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" data-testid="live-md-editor" />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: OPENER_ID,
    title: "Live Markdown",
    extensions: [...MARKDOWN_EXTENSIONS],
    component: LiveMarkdownOpener,
  });
  // One-shot and synchronous: nothing stays mounted, so there is nothing to dispose.
  app.contentScripts.register({
    id: "default-markdown-opener",
    mount: ({ pluginId }) => seedDefaultOpener(pluginId),
  });
});
