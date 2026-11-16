// bb-plugin-simple-sidebar-folders — group sidebar projects into folders.
//
// This does NOT replace bb's thread list. bb's own list keeps rendering every
// project and thread row exactly as shipped; this overlay only adds one level
// above it. It finds the element that holds bb's project blocks, inserts a
// header element per folder, and uses CSS `order` to sort each project under
// its folder header. Projects in a folded folder get `display: none`.
//
// Because nothing is replaced, any thread-list provider that renders bb's
// original list (bb-office, for one) keeps working alongside it.
//
// The cost of that choice: it relies on two attributes on bb's sidebar DOM,
// `data-sidebar-sticky-project-item` and `data-sidebar-project-id`. If a bb
// update renames them, the folders silently stop appearing and bb's plain list
// shows through — it never breaks the sidebar.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useBbContext,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { Folder, rpcContract } from "./server";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";

declare const __BB_PLUGIN_ID__: string | undefined;

const PROJECT_SELECTOR = "[data-sidebar-sticky-project-item][data-sidebar-project-id]";
const COLLAPSED_KEY = "bb-plugin-simple-sidebar-folders:collapsed";
/** Marks every element this plugin inserted or restyled, for cleanup. */
const MANAGED_ATTR = "data-simple-sidebar-folders";
/** bb's project blocks use `space-y-4`; keep the same rhythm. */
const PROJECT_GAP = "1rem";
/** Pulls a folder's first project up under its header. */
const HEADER_PULL = "-0.5rem";
const ORDER_STRIDE = 10_000;
/** Room between a folder's divider and its header text. */
const SECTION_PAD = "0.625rem";
/** The divider above a folder: a hairline that fades out at both ends. */
const SECTION_RULE =
  "linear-gradient(to right, transparent, var(--border) 12%, var(--border) 88%, transparent)";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

// ---------------------------------------------------------------------------
// Data

function useFolders(rpc: Rpc) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const refetch = useCallback(() => {
    rpc.call("folders_list").then(
      (result) => setFolders(result.folders),
      (error) => console.warn("[simple-sidebar-folders] list failed", error),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("folders-changed", refetch);
  // Realtime signals are not replayed, so re-read after a reconnect.
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) refetch();
    wasConnected.current = true;
  }, [connection, refetch]);
  return folders;
}

/**
 * Folded folder ids, per client. localStorage rather than plugin storage: a
 * work laptop folds Personal while a home machine folds Work, and the value
 * must be readable synchronously on first paint.
 */
function useCollapsed(): {
  collapsed: ReadonlySet<string>;
  toggle: (id: string) => void;
  expand: (id: string) => void;
} {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      const raw: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  });
  const update = useCallback((change: (next: Set<string>) => void) => {
    setCollapsed((current) => {
      const next = new Set(current);
      change(next);
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // A private window can refuse storage; folding still works this session.
      }
      return next;
    });
  }, []);
  const toggle = useCallback(
    (id: string) => update((next) => void (next.delete(id) || next.add(id))),
    [update],
  );
  const expand = useCallback((id: string) => update((next) => void next.delete(id)), [update]);
  return { collapsed, toggle, expand };
}

/**
 * Open the folder that holds the project being viewed, so the current thread
 * is never hidden inside a folded folder.
 *
 * It acts only when the viewed project changes. Folding the folder you are
 * already in therefore sticks; it reopens the next time you navigate into it.
 */
function useRevealActiveProject(
  folders: readonly Folder[],
  collapsed: ReadonlySet<string>,
  expand: (id: string) => void,
): void {
  const { projectId } = useBbContext();
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (projectId === null || projectId === revealed.current) return;
    const folder = folders.find((candidate) => candidate.projectIds.includes(projectId));
    // Wait for folders to load before deciding this project has been handled.
    if (folders.length === 0) return;
    revealed.current = projectId;
    if (folder !== undefined && collapsed.has(folder.id)) expand(folder.id);
  }, [projectId, folders, collapsed, expand]);
}

// ---------------------------------------------------------------------------
// DOM layout

interface ProjectBlock {
  projectId: string;
  /** The container's child that holds this project; what gets sorted. */
  element: HTMLElement;
}

/**
 * bb's project list: the nearest element holding every project, plus, for
 * each project, the child of that element it lives in.
 *
 * The depth is found, not assumed. bb has wrapped each project in an extra
 * element before (`data-sidebar-visibility-group`), and a fixed "parent of
 * the project item" silently stopped matching when it did.
 */
function findProjectList(): { container: HTMLElement; blocks: ProjectBlock[] } | null {
  const items = Array.from(document.querySelectorAll<HTMLElement>(PROJECT_SELECTOR));
  if (items.length === 0) return null;
  let container = items[0]!.parentElement;
  while (container !== null && !items.every((item) => container!.contains(item))) {
    container = container.parentElement;
  }
  if (container === null) return null;
  const blocks: ProjectBlock[] = [];
  for (const item of items) {
    let element: HTMLElement = item;
    while (element.parentElement !== null && element.parentElement !== container) {
      element = element.parentElement;
    }
    // Only one flat list is understood (bb's default "by project" layout):
    // each child of the container holds exactly one project.
    if (element.querySelectorAll(PROJECT_SELECTOR).length !== 1) return null;
    blocks.push({ projectId: item.getAttribute("data-sidebar-project-id") ?? "", element });
  }
  return { container, blocks };
}

/** The element holding bb's project blocks, or null if bb's list is absent. */
function findContainer(): HTMLElement | null {
  return findProjectList()?.container ?? null;
}

function setStyle(element: HTMLElement, property: string, value: string | null): void {
  if (value === null) {
    if (element.style.getPropertyValue(property) !== "") element.style.removeProperty(property);
  } else if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

interface LayoutInput {
  folders: readonly Folder[];
  collapsed: ReadonlySet<string>;
  headers: ReadonlyMap<string, HTMLElement>;
  footer: HTMLElement;
}

/**
 * Put folder headers into bb's container and sort projects under them.
 * Idempotent and write-avoiding: it runs on every sidebar mutation.
 */
function applyLayout(
  container: HTMLElement,
  blocks: readonly ProjectBlock[],
  input: LayoutInput,
): void {
  container.setAttribute(MANAGED_ATTR, "container");
  setStyle(container, "display", "flex");
  setStyle(container, "flex-direction", "column");
  setStyle(container, "gap", PROJECT_GAP);

  const folderIndex = new Map<string, number>();
  input.folders.forEach((folder, index) => {
    for (const projectId of folder.projectIds) folderIndex.set(projectId, index);
  });

  blocks.forEach(({ projectId, element: item }, domIndex) => {
    const index = folderIndex.get(projectId);
    const folder = index === undefined ? undefined : input.folders[index];
    // Unfiled projects stay on top in bb's order; folders follow.
    const base = index === undefined ? 0 : (index + 1) * ORDER_STRIDE;
    item.setAttribute(MANAGED_ATTR, "project");
    setStyle(item, "order", String(base + 1 + domIndex));
    setStyle(item, "margin-block", "0");
    setStyle(item, "display", folder && input.collapsed.has(folder.id) ? "none" : null);
  });

  // A hairline above each folder marks where a section starts — except above
  // whatever sits first in the list, where bb's own divider already is.
  const hasUnfiled = blocks.some(({ projectId }) => !folderIndex.has(projectId));
  input.folders.forEach((folder, index) => {
    const header = input.headers.get(folder.id);
    if (header === undefined) return;
    if (header.parentElement !== container) container.append(header);
    setStyle(header, "order", String((index + 1) * ORDER_STRIDE));
    const divided = index > 0 || hasUnfiled;
    // Drawn as a background, not a border, so it can fade out at both ends.
    setStyle(header, "background-image", divided ? SECTION_RULE : null);
    setStyle(header, "background-size", divided ? "100% 1px" : null);
    setStyle(header, "background-repeat", divided ? "no-repeat" : null);
    setStyle(header, "background-position", divided ? "top" : null);
    setStyle(header, "padding-top", divided ? SECTION_PAD : null);
    const open = !input.collapsed.has(folder.id) && folder.projectIds.length > 0;
    setStyle(header, "margin-bottom", open ? HEADER_PULL : null);
  });

  if (input.footer.parentElement !== container) container.append(input.footer);
  setStyle(input.footer, "order", String((input.folders.length + 1) * ORDER_STRIDE));
}

/** Undo everything applyLayout did, leaving bb's list as shipped. */
function clearLayout(): void {
  document.querySelectorAll<HTMLElement>(`[${MANAGED_ATTR}]`).forEach((element) => {
    const role = element.getAttribute(MANAGED_ATTR);
    if (role !== "container" && role !== "project") {
      element.remove();
      return;
    }
    for (const property of ["display", "flex-direction", "gap", "order", "margin-block", "margin-bottom"]) {
      element.style.removeProperty(property);
    }
    element.removeAttribute(MANAGED_ATTR);
  });
}

function createHost(role: "header" | "footer"): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute(MANAGED_ATTR, role);
  // Plugin CSS is scoped to plugin roots; these hosts sit inside bb's tree.
  host.setAttribute("data-bb-plugin-root", "");
  if (typeof __BB_PLUGIN_ID__ === "string") host.setAttribute("data-bb-plugin", __BB_PLUGIN_ID__);
  return host;
}

// ---------------------------------------------------------------------------
// Drag to file a project

/**
 * The drop target under a point: a folder id, or null for the unfiled band
 * above the first folder.
 *
 * The sidebar is already partitioned top to bottom — unfiled projects, then
 * each folder's header followed by its projects — so a drop belongs to the
 * band it lands in. Dropping on a folder's header and dropping among its
 * projects therefore mean the same thing, which is what dragging something
 * "into" a folder looks like.
 */
function targetAt(y: number, headers: ReadonlyMap<string, HTMLElement>, folders: readonly Folder[]): string | null {
  let target: string | null = null;
  for (const folder of folders) {
    const header = headers.get(folder.id);
    if (header === undefined) continue;
    if (y >= header.getBoundingClientRect().top) target = folder.id;
  }
  return target;
}

/**
 * Follow bb's own project drag and report where it would land.
 *
 * Filing rides on the gesture bb already has — grab a project by its name and
 * drop it in a folder's band — rather than adding a second drag of this
 * plugin's own. This only watches: it listens on the document in the capture
 * phase and never calls preventDefault, so bb draws the drag and keeps its
 * reorder, its click-to-collapse, and its keyboard handling.
 *
 * Returns the live drop target, or `undefined` when no drag is in flight.
 */
function useSortableDragTarget(
  headers: ReadonlyMap<string, HTMLElement>,
  folders: readonly Folder[],
  onDrop: (projectId: string, folderId: string | null) => void,
): string | null | undefined {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const latest = useRef({ headers, folders, onDrop });
  latest.current = { headers, folders, onDrop };

  useEffect(() => {
    let origin: { projectId: string; label: HTMLElement; dragging: boolean } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const label = event.target.closest<HTMLElement>("[data-sidebar=group-label]");
      const projectId = label?.closest<HTMLElement>(PROJECT_SELECTOR)?.getAttribute("data-sidebar-project-id");
      if (label === null || projectId === undefined || projectId === null) return;
      origin = { projectId, label, dragging: false };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (origin === null) return;
      // Count it as a drag only once bb's sortable has actually picked the
      // row up; dnd-kit marks it aria-pressed. That makes a click, a touch
      // scroll, or a slide off one of bb's row buttons file nothing, and it
      // follows bb's own touch long-press without guessing its timing.
      if (!origin.dragging) {
        if (origin.label.getAttribute("aria-pressed") !== "true") return;
        origin.dragging = true;
      }
      const { headers: currentHeaders, folders: currentFolders } = latest.current;
      setTarget(targetAt(event.clientY, currentHeaders, currentFolders));
    };

    const finish = (event: PointerEvent) => {
      const started = origin;
      origin = null;
      setTarget(undefined);
      if (started === null || !started.dragging) return;
      const { headers: currentHeaders, folders: currentFolders, onDrop: drop } = latest.current;
      drop(started.projectId, targetAt(event.clientY, currentHeaders, currentFolders));
    };
    const cancel = () => {
      origin = null;
      setTarget(undefined);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", finish, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", finish, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return target;
}

// ---------------------------------------------------------------------------
// UI

interface MenuState {
  folderId: string;
  anchor: DOMRect;
}

function FolderHeader({
  folder,
  collapsed,
  needsYou,
  editing,
  onToggle,
  onOpenMenu,
  onRename,
  onCancelRename,
}: {
  folder: Folder;
  collapsed: boolean;
  needsYou: boolean;
  editing: boolean;
  onToggle: () => void;
  onOpenMenu: (anchor: DOMRect) => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  const label = (
    <>
      <Icon
        name="ChevronRight"
        aria-hidden="true"
        className={cn("size-3 shrink-0 transition-transform duration-150", !collapsed && "rotate-90")}
      />
      {editing ? (
        <NameInput initial={folder.name} onSubmit={onRename} onCancel={onCancelRename} />
      ) : (
        <span className="min-w-0 truncate">{folder.name}</span>
      )}
      {collapsed ? (
        <span className="shrink-0 normal-case tracking-normal text-subtle-foreground tabular-nums">
          {folder.projectIds.length}
        </span>
      ) : null}
      {collapsed && needsYou ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-primary"
          title="A thread in this folder needs you"
        />
      ) : null}
    </>
  );
  return (
    <div className="group/folder flex h-7 items-center rounded-md pl-1 text-xs font-semibold uppercase tracking-wider text-foreground select-none hover:bg-state-hover">
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">{label}</div>
      ) : (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 text-left uppercase outline-none"
        >
          {label}
        </button>
      )}
      <button
        type="button"
        aria-label={`${folder.name} folder options`}
        onClick={(event) => onOpenMenu(event.currentTarget.getBoundingClientRect())}
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground opacity-0 outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100"
      >
        <Icon name="MoreHorizontal" className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The one-line name field, shared by renaming a folder and naming a new one.
 * Enter keeps it, Escape drops it, and clicking away keeps whatever was typed
 * — the same bargain bb's own inline rename makes.
 */
function NameInput({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (submit && name !== "" && name !== initial) onSubmit(name);
    else onCancel();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={80}
      placeholder={placeholder}
      aria-label="Folder name"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      className="h-5 min-w-0 flex-1 rounded-sm bg-background px-1 text-xs font-normal normal-case tracking-normal text-foreground outline-none ring-1 ring-ring placeholder:text-subtle-foreground"
    />
  );
}

/**
 * The always-present way to add a folder, at the end of the list.
 *
 * It creates nothing until a name is confirmed: the old flow made a folder
 * called "New folder" first and asked for its name second, which left junk
 * behind whenever the naming was abandoned.
 */
function NewFolderRow({ onCreate }: { onCreate: (name: string) => void }) {
  const [naming, setNaming] = useState(false);
  if (naming) {
    return (
      <div className="flex h-7 items-center gap-1 rounded-md pl-1 pr-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">
        <Icon name="FolderPlus" className="size-3 shrink-0 text-subtle-foreground" aria-hidden="true" />
        <NameInput
          initial=""
          placeholder="Folder name"
          onSubmit={(name) => {
            setNaming(false);
            onCreate(name);
          }}
          onCancel={() => setNaming(false)}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setNaming(true)}
      className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md pl-1 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <Icon name="FolderPlus" className="size-3 shrink-0" aria-hidden="true" />
      New folder
    </button>
  );
}

function MenuItem({
  children,
  onSelect,
  destructive = false,
  disabled = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-state-hover focus-visible:bg-state-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
        destructive && "text-destructive",
      )}
    >
      {children}
    </button>
  );
}

function FolderMenu({
  menu,
  folders,
  onClose,
  onRename,
  onMove,
  onDelete,
}: {
  menu: MenuState;
  folders: readonly Folder[];
  onClose: () => void;
  onRename: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scope = usePortalScopeProps();
  const index = folders.findIndex((folder) => folder.id === menu.folderId);
  const folder = folders[index];

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  // Keep the menu on screen: below the button, flipped up if it would overflow.
  const [position, setPosition] = useState({ left: menu.anchor.left, top: menu.anchor.bottom + 4 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(menu.anchor.left, window.innerWidth - width - 8));
    const below = menu.anchor.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, menu.anchor.top - height - 4) : below;
    setPosition({ left, top });
  }, [menu.anchor]);

  if (folder === undefined) return null;
  const select = (action: () => void) => () => {
    onClose();
    action();
  };

  return createPortal(
    <div {...scope} className="contents">
      <div
        ref={ref}
        role="menu"
        style={{ left: position.left, top: position.top }}
        className="fixed z-50 w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <MenuItem onSelect={select(onRename)}>Rename</MenuItem>
        <MenuItem disabled={index === 0} onSelect={select(() => onMove("up"))}>
          Move up
        </MenuItem>
        <MenuItem disabled={index === folders.length - 1} onSelect={select(() => onMove("down"))}>
          Move down
        </MenuItem>
        <MenuItem destructive onSelect={select(onDelete)}>
          Delete folder
        </MenuItem>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Where the drop lands: one thin rule at the top of the band the project will
 * join — under a folder's header, or across the top of the list for unfiled.
 *
 * A rule rather than a box around the folder heading: bb draws its own drag,
 * so a second highlighted container fights it for attention. Fixed-position
 * and portaled, so marking the target never shifts bb's rows mid-drag.
 */
function DropIndicator({
  target,
  headers,
}: {
  target: string | null;
  headers: ReadonlyMap<string, HTMLElement>;
}) {
  const scope = usePortalScopeProps();
  const container = findContainer();
  if (container === null) return null;
  const bounds = container.getBoundingClientRect();
  const header = target === null ? null : headers.get(target);
  const top = header === undefined ? null : (header?.getBoundingClientRect().bottom ?? bounds.top);
  if (top === null) return null;
  return createPortal(
    <div {...scope} className="contents">
      <div
        aria-hidden="true"
        style={{ left: bounds.left, top: top - 1, width: bounds.width }}
        className="pointer-events-none fixed z-50 h-0.5 rounded-full bg-primary"
      />
    </div>,
    document.body,
  );
}

function SidebarFolders() {
  const rpc = useRpc<typeof rpcContract>();
  const folders = useFolders(rpc);
  const { collapsed, toggle: toggleCollapsed, expand } = useCollapsed();
  useRevealActiveProject(folders, collapsed, expand);
  const { threads } = experimental_useSidebarThreads();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // One host element per folder, created lazily and reused across renders so
  // the portals below keep a stable target.
  const headers = useRef(new Map<string, HTMLElement>()).current;
  const footer = useRef<HTMLElement | null>(null);
  footer.current ??= createHost("footer");
  for (const folder of folders) if (!headers.has(folder.id)) headers.set(folder.id, createHost("header"));
  for (const [id, host] of headers) {
    if (!folders.some((folder) => folder.id === id)) {
      host.remove();
      headers.delete(id);
    }
  }
  const layout = useRef<LayoutInput | null>(null);
  layout.current = { folders, collapsed, headers, footer: footer.current };

  // Re-apply whenever bb re-renders its list (a new project, a new thread,
  // a remount) and whenever folders or fold state change.
  const sync = useCallback(() => {
    const list = findProjectList();
    if (list !== null && layout.current !== null) applyLayout(list.container, list.blocks, layout.current);
  }, []);
  useEffect(() => {
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearLayout();
    };
  }, [sync]);
  useEffect(sync, [sync, folders, collapsed]);

  const report = (error: unknown) => console.warn("[simple-sidebar-folders]", error);
  const createFolder = (name: string) => {
    rpc.call("folder_create", { name }).catch(report);
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const assign = useCallback(
    (projectId: string, folderId: string | null) => {
      const owner = folders.find((folder) => folder.projectIds.includes(projectId))?.id ?? null;
      if (owner === folderId) return;
      rpc.call("project_assign", { projectId, folderId }).catch(report);
    },
    [folders, rpc],
  );
  const dropTarget = useSortableDragTarget(headers, folders, assign);

  // A folded folder still signals a thread that is waiting on you.
  const projectsNeedingYou = new Set(
    threads
      .filter((thread) => !thread.isArchived && (thread.hasPendingInteraction || thread.isUnread))
      .map((thread) => thread.projectId),
  );

  const folderOf = new Map<string, Folder>();
  for (const folder of folders) for (const id of folder.projectIds) folderOf.set(id, folder);

  return (
    <>
      {dropTarget === undefined ? null : <DropIndicator target={dropTarget} headers={headers} />}
      {folders.map((folder) => {
        const host = headers.get(folder.id);
        if (host === undefined) return null;
        return createPortal(
          <FolderHeader
            folder={folder}
            collapsed={collapsed.has(folder.id)}
            needsYou={folder.projectIds.some((id) => projectsNeedingYou.has(id))}
            editing={editingId === folder.id}
            onToggle={() => toggleCollapsed(folder.id)}
            onOpenMenu={(anchor) => setMenu({ folderId: folder.id, anchor })}
            onRename={(name) => {
              setEditingId(null);
              rpc.call("folder_rename", { id: folder.id, name }).catch(report);
            }}
            onCancelRename={() => setEditingId(null)}
          />,
          host,
          folder.id,
        );
      })}
      {createPortal(<NewFolderRow onCreate={createFolder} />, footer.current)}
      {menu !== null ? (
        <FolderMenu
          menu={menu}
          folders={folders}
          onClose={closeMenu}
          onRename={() => setEditingId(menu.folderId)}
          onMove={(direction) => {
            rpc.call("folder_move", { id: menu.folderId, direction }).catch(report);
          }}
          onDelete={() => {
            rpc.call("folder_delete", { id: menu.folderId }).catch(report);
          }}
        />
      ) : null}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "simple-sidebar-folders",
    component: SidebarFolders,
  });
});
