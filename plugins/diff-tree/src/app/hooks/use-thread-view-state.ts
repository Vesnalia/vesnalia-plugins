import { useMemo, useSyncExternalStore } from "react";
import { experimental_usePluginId as usePluginId } from "@vesnalia/plugin-sdk/app";
import type { Scope } from "./use-changes";
import { validWorkspacePath } from "../../core/worktree";

export interface TreeViewState {
  selected: string | null;
  query: string;
  defaultExpanded: boolean;
  folderExceptions: string[];
}

function storedPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && validWorkspacePath(value);
}
function readTree(value: unknown, defaultExpanded: boolean): TreeViewState {
  const tree = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    selected: storedPath(tree.selected) ? tree.selected : null,
    query: typeof tree.query === "string" ? tree.query.slice(0, 256) : "",
    defaultExpanded: typeof tree.defaultExpanded === "boolean" ? tree.defaultExpanded : defaultExpanded,
    folderExceptions: Array.isArray(tree.folderExceptions) ? [...new Set(tree.folderExceptions.slice(0, 10000).filter(storedPath))] : [],
  };
}

export function revealTreeFile(tree: TreeViewState, path: string): TreeViewState {
  if (!storedPath(path)) return tree;
  const folders = new Set(tree.folderExceptions);
  const parents = path.split("/"); parents.pop();
  for (let i = 1; i <= parents.length; i++) {
    const parent = parents.slice(0, i).join("/");
    if (tree.defaultExpanded) folders.delete(parent);
    else folders.add(parent);
  }
  return { ...tree, query: "", selected: path, folderExceptions: [...folders] };
}

export interface ThreadViewState {
  scope: Scope;
  base: string;
  count: number;
  startingCommit: string;
  commit: string;
  worktreeMode: boolean;
  view: "unified" | "split" | null;
  preview: "diff" | "file";
  changesTree: TreeViewState;
  worktreeTree: TreeViewState;
  // Chat requests have session-only sequence numbers; never restore these from disk.
  requestSequence: number;
}
export type UpdateThreadView = (change: Partial<ThreadViewState>) => void;

function readState(key: string): ThreadViewState {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed as Record<string, unknown>;
  } catch { /* Storage may be unavailable or contain an older, invalid value. */ }
  return {
    scope: value.scope === "uncommitted" || value.scope === "recent" || value.scope === "commit" ? value.scope : "all",
    base: typeof value.base === "string" && value.base.length <= 1024 ? value.base : "",
    count: typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 1 && value.count <= 100 ? value.count : 1,
    startingCommit: typeof value.startingCommit === "string" && /^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(value.startingCommit) ? value.startingCommit : "",
    commit: typeof value.commit === "string" && /^[a-f\d]{40}$/i.test(value.commit) ? value.commit : "",
    worktreeMode: value.worktreeMode === true,
    view: value.view === "split" || value.view === "unified" ? value.view : null,
    preview: value.preview === "file" ? "file" : "diff",
    changesTree: readTree(value.changesTree, true),
    worktreeTree: readTree(value.worktreeTree, false),
    requestSequence: 0,
  };
}

function createEntry(key: string) {
  let state = readState(key);
  const listeners = new Set<() => void>();
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: (change: Partial<ThreadViewState>) => {
      state = { ...state, ...change };
      const { requestSequence: _, ...saved } = state;
      try { localStorage.setItem(key, JSON.stringify(saved)); }
      catch { /* Keep the in-memory state when storage is blocked or full. */ }
      listeners.forEach(listener => listener());
    },
  };
}
const entries = new Map<string, ReturnType<typeof createEntry>>();

// Clear only memory; stored choices remain, as after a frontend reload.
export function clearThreadViewCache() { entries.clear(); }

export function useThreadViewState(threadId: string) {
  const pluginId = usePluginId();
  const key = JSON.stringify(["alia-plugin", pluginId, "thread-view-v1", threadId]);
  const entry = useMemo(() => {
    let stored = entries.get(key);
    if (!stored) { stored = createEntry(key); entries.set(key, stored); }
    return stored;
  }, [key]);
  return [useSyncExternalStore(entry.subscribe, entry.snapshot), entry.update] as const;
}
