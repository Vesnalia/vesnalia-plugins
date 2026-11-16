// Git worktree — stage, unstage, AI commit, pull, push and branch switching in BB's
// thread panel. Laid out like a review panel: a status bar tinted by the worktree's
// state with the one next action, pill tabs, and dense file rows (folder › name,
// +/− lines, status square). app.css styles it with host theme variables only.
import "./app.css";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { fileParts, statusOf, summaryOf, type GitFile, type Lines, type NextAction } from "./lib/git-status";
import type { rpcContract } from "./server";

type Branch = { name: string; scope: "local" | "remote"; sha: string; subject: string };
type State = {
  branch: string | null;
  branches: Branch[];
  hostId: string;
  projectId: string;
  files: GitFile[];
  remote: { ahead: number; behind: number; upstream: string | null };
  stashCount: number;
  lastCommit: { sha: string; subject: string } | null;
  commitSubject?: string;
  syncMessage?: string;
};
type Tab = "changes" | "staged";

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** The icon set has no minus; drawn at the same 1.5px stroke as the rest. */
function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  );
}

function LineCounts({ lines }: { lines: Lines | null }) {
  if (lines === null) return <span aria-hidden />;
  const { added, removed } = lines;
  return (
    <span className="gp-lines">
      {added !== null && added > 0 && <span className="gp-lines-added">+{added}</span>}
      {removed !== null && removed > 0 && <span className="gp-lines-removed">−{removed}</span>}
    </span>
  );
}

function FileRow({
  file,
  code,
  lines,
  actionLabel,
  actionIcon,
  pending,
  locked,
  onAction,
}: {
  file: GitFile;
  code: string;
  lines: Lines | null;
  actionLabel: string;
  actionIcon: ReactNode;
  pending: boolean;
  locked: boolean;
  onAction: () => void;
}) {
  const { name, dir } = fileParts(file.path);
  const status = statusOf(code);
  return (
    <li className="gp-row" title={`${file.path} · ${status.label}`}>
      <span className="gp-row-path">
        {dir !== "" && <span className="gp-dir">{dir}</span>}
        <span className="gp-name">{name}</span>
      </span>
      <LineCounts lines={lines} />
      <button
        type="button"
        className="gp-icon-button gp-reveal"
        data-pending={pending ? "" : undefined}
        aria-label={`${actionLabel} ${file.path}`}
        title={actionLabel}
        disabled={locked}
        onClick={onAction}
      >
        {pending ? <Icon name="Loading" className="gp-spin size-3.5" aria-hidden /> : actionIcon}
      </button>
      <span className="gp-status-box" data-tone={status.tone} role="img" aria-label={status.label} />
    </li>
  );
}

/** Closes a popover on Escape or a press anywhere outside its container. */
function useDismiss(open: boolean, containerRef: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, containerRef, close]);
}

type FieldMode = "search" | "create" | "rename" | null;

/** Lucide's pencil; the host icon set's Edit glyph reads as a form field. */
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

const FIELDS = [
  { mode: "rename", icon: <PencilIcon />, label: "Rename this branch", hint: "Rename this branch — edit the name, then Enter" },
  { mode: "create", icon: <Icon name="Plus" className="size-3.5" aria-hidden />, label: "New branch", hint: "New branch — type a name, then Enter" },
  { mode: "search", icon: <Icon name="Search" className="size-3.5" aria-hidden />, label: "Search branches", hint: "Search branches" },
] as const;

function BranchPicker({
  branch,
  upstream,
  branches,
  disabled,
  onSwitch,
  onCreate,
  onRename,
}: {
  branch: string | null;
  upstream: string | null;
  branches: Branch[];
  disabled: boolean;
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
  onRename: (branch: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"local" | "remote">("local");
  // The one field in the menu bar: filtering branches, or naming a new one.
  const [mode, setMode] = useState<FieldMode>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  useDismiss(open, pickerRef, () => setOpen(false));

  // Only the search field filters; naming or renaming leaves the list whole.
  const filter = mode === "search" ? query.toLowerCase() : "";
  const matching = branches.filter((item) => item.scope === scope && item.name.toLowerCase().includes(filter));

  return (
    <div className="gp-branch-picker" ref={pickerRef}>
      <button
        type="button"
        className="gp-branch-trigger"
        aria-label="Switch branch"
        aria-expanded={open}
        title={upstream ? `${branch} → ${upstream}` : branch ?? undefined}
        disabled={disabled || branch === null}
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
          setScope("local");
          setMode(null);
        }}
      >
        <Icon name="GitBranch" className="gp-branch-icon size-3.5" aria-hidden />
        <span className="gp-branch">{branch ?? "Detached HEAD"}</span>
        <Icon name="ChevronDown" className="gp-branch-chevron size-3.5" aria-hidden />
      </button>
      {open && (
        <div className="gp-branch-menu" role="dialog" aria-label="Branches">
          <div className="gp-branch-bar">
            <div className="gp-branch-tabs" role="tablist" aria-label="Branch scope">
              {(["local", "remote"] as const).map((value) => (
                <button key={value} type="button" role="tab" className="gp-branch-tab" aria-selected={scope === value} onClick={() => setScope(value)}>
                  {value === "local" ? "Local" : "Remote"}
                  <span className="gp-branch-tab-count">{branches.filter((item) => item.scope === value).length}</span>
                </button>
              ))}
            </div>
            {/* Three icons, one field: whichever is pressed slides to the left edge while
                the field opens behind it. Escape clears, then collapses. */}
            <div className="gp-search" data-open={mode === null ? undefined : ""}>
              <input
                ref={fieldRef}
                className="gp-branch-search"
                value={query}
                tabIndex={mode === null ? -1 : 0}
                placeholder={mode === "create" ? "New branch name" : mode === "rename" ? "New name" : "Search"}
                aria-label={mode === "create" ? "New branch name" : mode === "rename" ? `Rename ${branch}` : "Search branches"}
                onChange={(event) => setQuery(event.target.value)}
                onBlur={() => {
                  if (query === "") setMode(null);
                }}
                onKeyDown={(event) => {
                  if (mode === null) return;
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    if (query !== "") setQuery("");
                    else setMode(null);
                  } else if (event.key === "Enter" && query.trim() !== "") {
                    const name = query.trim();
                    if (mode === "create") {
                      event.preventDefault();
                      setOpen(false);
                      onCreate(name);
                    } else if (mode === "rename" && branch !== null && name !== branch) {
                      event.preventDefault();
                      setOpen(false);
                      onRename(branch, name);
                    }
                  }
                }}
              />
              {FIELDS.map((field) => (
                <button
                  key={field.mode}
                  type="button"
                  className="gp-search-trigger"
                  data-mode={field.mode}
                  data-active={mode === field.mode ? "" : undefined}
                  aria-label={field.label}
                  title={field.hint}
                  aria-expanded={mode === field.mode}
                  tabIndex={mode === null ? 0 : -1}
                  disabled={field.mode === "rename" && branch === null}
                  onClick={() => {
                    // Rename opens on the current name, ready to be edited.
                    setQuery(field.mode === "rename" ? branch ?? "" : "");
                    setMode(field.mode);
                    fieldRef.current?.focus();
                    if (field.mode === "rename") requestAnimationFrame(() => fieldRef.current?.select());
                  }}
                >
                  {field.icon}
                </button>
              ))}
            </div>
          </div>
          <div className="gp-branch-options" role="listbox" aria-label={scope === "local" ? "Local branches" : "Remote branches"}>
            {matching.length === 0 ? (
              <p className="gp-branch-empty">No {scope} branches match.</p>
            ) : (
              matching.map((item) => {
                // The checked-out branch, or on the Remote tab the branch it tracks.
                const current = item.name === branch || item.name === upstream;
                const slash = item.scope === "remote" ? item.name.indexOf("/") : -1;
                return (
                  <button
                    key={`${item.scope}:${item.name}`}
                    type="button"
                    role="option"
                    aria-selected={current}
                    className="gp-branch-option"
                    data-current={current ? "" : undefined}
                    title={`${item.name} · ${item.sha} · ${item.subject}`}
                    onClick={() => {
                      setOpen(false);
                      if (!current) onSwitch(item.name);
                    }}
                  >
                    <span className="gp-branch-marker" aria-hidden />
                    <span className="gp-branch-name">
                      {slash > 0 && <span className="gp-branch-remote">{item.name.slice(0, slash + 1)}</span>}
                      {slash > 0 ? item.name.slice(slash + 1) : item.name}
                    </span>
                    <code className="gp-branch-sha">{item.sha}</code>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type MenuAction = "sync" | "undoCommit" | "stash" | "stashPop";

/** Less frequent Git actions: sync, undo last commit, stash and pop. */
function MoreMenu({
  disabled,
  upstream,
  ahead,
  behind,
  lastCommit,
  hasChanges,
  stashCount,
  onRun,
}: {
  disabled: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommit: { sha: string; subject: string } | null;
  hasChanges: boolean;
  stashCount: number;
  onRun: (action: MenuAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(open, menuRef, () => setOpen(false));
  // Undo rewrites the last commit, so it stops once that commit is on the upstream.
  const pushed = upstream !== null && ahead === 0;
  const groups: Array<Array<{ action: MenuAction; label: string; icon: string; detail: string; disabled: boolean }>> = [
    [
      {
        action: "sync",
        label: "Sync",
        icon: "ArrowUpDown",
        detail: upstream === null ? "No upstream" : `↓${behind}  ↑${ahead}`,
        disabled: upstream === null || (ahead === 0 && behind === 0),
      },
    ],
    [
      {
        action: "undoCommit",
        label: "Undo last commit",
        icon: "ArrowTurnBackward",
        detail: lastCommit === null ? "No commits" : pushed ? "Already pushed" : lastCommit.subject,
        disabled: lastCommit === null || pushed,
      },
    ],
    [
      { action: "stash", label: "Stash changes", icon: "Archive", detail: hasChanges ? "Incl. untracked" : "Nothing to stash", disabled: !hasChanges },
      { action: "stashPop", label: "Pop latest stash", icon: "ArchiveRestore", detail: stashCount > 0 ? `${stashCount} saved` : "None saved", disabled: stashCount === 0 },
    ],
  ];
  return (
    <div className="gp-more" ref={menuRef}>
      <button
        type="button"
        className="gp-tool"
        aria-label="More Git actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
      </button>
      {open && (
        <div className="gp-menu" role="menu" aria-label="More Git actions">
          {groups.map((items, index) => (
            <Fragment key={items[0].action}>
              {index > 0 && <div className="gp-menu-sep" role="separator" />}
              {items.map((item) => (
                <button
                  key={item.action}
                  type="button"
                  role="menuitem"
                  className="gp-menu-item"
                  disabled={item.disabled}
                  title={item.detail}
                  onClick={() => {
                    setOpen(false);
                    onRun(item.action);
                  }}
                >
                  <Icon name={item.icon} className="size-3.5" aria-hidden />
                  <span className="gp-menu-label">{item.label}</span>
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

type ActionStatus = "idle" | "pending" | "success" | "error";

/**
 * The status bar's one action. Four faces — idle, pending, success, error — stacked in
 * a grid so the button never resizes, crossfading with a small rise and blur. Success
 * and error hold briefly, then fall back to idle.
 */
function ActionButton({ label, busyLabel, icon, disabled, onRun }: { label: string; busyLabel: string; icon: string; disabled: boolean; onRun: () => Promise<boolean> }) {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const faces = [
    { key: "idle", text: label, icon: <Icon name={icon} className="size-4" aria-hidden /> },
    { key: "pending", text: busyLabel, icon: <Icon name="Loading" className="gp-spin size-4" aria-hidden /> },
    { key: "success", text: "Done", icon: <Icon name="Check" className="size-4" aria-hidden /> },
    { key: "error", text: "Try again", icon: <Icon name="AlertCircle" className="size-4" aria-hidden /> },
  ] as const;
  const current = faces.find((face) => face.key === status) ?? faces[0];

  return (
    <button
      type="button"
      className="gp-bar-action"
      data-status={status}
      title={label}
      aria-label={current.text}
      aria-busy={status === "pending" || undefined}
      disabled={disabled}
      onClick={async () => {
        if (status === "pending") return;
        if (timer.current) clearTimeout(timer.current);
        setStatus("pending");
        const ok = await onRun();
        setStatus(ok ? "success" : "error");
        timer.current = setTimeout(() => setStatus("idle"), 1400);
      }}
    >
      <span className="gp-faces" aria-hidden>
        {faces.map((face) => (
          <span key={face.key} className="gp-face" data-show={face.key === status ? "" : undefined}>
            {face.icon}
            {face.text}
          </span>
        ))}
      </span>
    </button>
  );
}

const ACTIONS: Record<Exclude<NextAction, null>, { label: string; busyLabel: string; icon: string }> = {
  commit: { label: "Commit", busyLabel: "Committing…", icon: "AiContentGenerator01" },
  push: { label: "Push", busyLabel: "Pushing…", icon: "ArrowUp" },
  pull: { label: "Pull", busyLabel: "Pulling…", icon: "ArrowDown" },
  sync: { label: "Sync", busyLabel: "Syncing…", icon: "ArrowUpDown" },
  "stage-all": { label: "Stage all", busyLabel: "Staging…", icon: "Plus" },
};

function GitPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("changes");
  const loaded = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await rpc.call("status", { threadId });
      // First load opens on whichever list has something in it.
      if (!loaded.current) {
        const changed = next.files.some((file) => file.worktree !== " ");
        const staged = next.files.some((file) => file.index !== " " && file.index !== "?");
        setTab(!changed && staged ? "staged" : "changes");
      }
      setData(next);
      loaded.current = true;
      setError(null);
    } catch (cause) {
      const message = messageOf(cause, "Could not read Git status");
      // A failed first read replaces the panel; a failed refresh keeps what's on screen.
      if (loaded.current) toast.error(message);
      else setError(message);
    } finally {
      setRefreshing(false);
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ahead/behind come from local remote-tracking refs, which only move on a fetch. Once
  // the panel shows something, fetch quietly so incoming commits appear on their own;
  // offline or remote-less repos just keep the local picture.
  const fetchedOnce = useRef(false);
  useEffect(() => {
    if (data === null || fetchedOnce.current) return;
    fetchedOnce.current = true;
    rpc.call("fetch", { threadId }).then(
      (next) => setData(next),
      () => undefined,
    );
  }, [data, rpc, threadId]);

  /** Resolves true when the action went through, so a button can show its outcome. */
  const run = async (name: string, action: () => Promise<State>) => {
    setBusy(name);
    try {
      const result = await action();
      setData(result);
      if (result.commitSubject) toast.success(`Committed: ${result.commitSubject}`);
      if (result.syncMessage) toast.success(result.syncMessage);
      return true;
    } catch (cause) {
      toast.error(messageOf(cause, "Git action failed"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (data === null) {
    return error === null ? (
      <div className="gp-panel gp-state" role="status">
        <Icon name="Loading" className="gp-spin size-4" aria-hidden />
        <span>Reading Git status…</span>
      </div>
    ) : (
      <div className="gp-panel gp-state" role="alert">
        <Icon name="AlertCircle" className="gp-state-icon size-5" aria-hidden />
        <p className="gp-state-text">{error}</p>
        <button type="button" className="gp-text-button" disabled={refreshing} onClick={() => void load()}>
          {refreshing ? "Checking…" : "Try again"}
        </button>
      </div>
    );
  }

  const staged = data.files.filter((file) => file.index !== " " && file.index !== "?");
  const changed = data.files.filter((file) => file.worktree !== " ");
  const { ahead, behind, upstream } = data.remote;
  const locked = busy !== null;
  const summary = summaryOf({ staged: staged.length, changed: changed.length, ahead, behind, upstream });

  const stagePaths = (kind: "stage" | "unstage", name: string, paths: string[]) =>
    void run(name, () => rpc.call(kind, { threadId, paths }));
  const perform = (action: Exclude<NextAction, null>) =>
    action === "stage-all"
      ? run("stage-all", () => rpc.call("stage", { threadId, paths: changed.map((file) => file.path) }))
      : run(action, () => rpc.call(action, { threadId }));

  const onChanges = tab === "changes";
  const kind = onChanges ? "stage" : "unstage";
  const list = onChanges ? changed : staged;
  const bulkKey = `${kind}-all`;

  return (
    <div className="gp-panel">
      <header className="gp-bar" data-tone={summary.tone}>
        <BranchPicker
          branch={data.branch}
          upstream={upstream}
          branches={data.branches}
          disabled={locked}
          onSwitch={(name) => void run("switch-branch", () => rpc.call("switchBranch", { threadId, branch: name }))}
          onCreate={(name) => void run("create-branch", () => rpc.call("createBranch", { threadId, branch: name }))}
          onRename={(branch, name) => void run("rename-branch", () => rpc.call("renameBranch", { threadId, branch, name }))}
        />
        {/* "N unstaged changes" is left out: the Stage all button and the Changes count already say it. */}
        <p className="gp-bar-status" data-end={summary.action === null ? "" : undefined}>
          {summary.action !== "stage-all" && (
            <>
              <span className="gp-bar-label">
                {summary.label}
              </span>
            </>
          )}
        </p>
        {summary.action !== null && (
          <ActionButton
            key={summary.action}
            label={ACTIONS[summary.action].label}
            busyLabel={ACTIONS[summary.action].busyLabel}
            icon={ACTIONS[summary.action].icon}
            disabled={locked}
            onRun={() => perform(summary.action!)}
          />
        )}
      </header>

      <div className="gp-tabs">
        <div className="gp-tablist" role="tablist" aria-label="Files">
          {([
            ["changes", "Changes", changed.length],
            ["staged", "Staged", staged.length],
          ] as const).map(([value, label, count]) => (
            <button key={value} type="button" role="tab" className="gp-tab" aria-selected={tab === value} onClick={() => setTab(value)}>
              {label}
              <span className="gp-tab-count">{count}</span>
            </button>
          ))}
        </div>
        <div className="gp-tools">
          {/* Hidden when the status bar already offers the same step. */}
          {list.length > 0 && !(onChanges && summary.action === "stage-all") && (
            <button
              type="button"
              className="gp-text-button"
              disabled={locked}
              onClick={() => stagePaths(kind, bulkKey, list.map((file) => file.path))}
            >
              {busy === bulkKey ? "Working…" : onChanges ? "Stage all" : "Unstage all"}
            </button>
          )}
          <button
            type="button"
            className="gp-tool"
            aria-label={`Pull ${behind} ${behind === 1 ? "commit" : "commits"}`}
            title="Pull"
            disabled={locked || upstream === null || behind === 0}
            onClick={() => void run("pull", () => rpc.call("pull", { threadId }))}
          >
            <Icon name={busy === "pull" ? "Loading" : "ArrowDown"} className={busy === "pull" ? "gp-spin size-3.5" : "size-3.5"} aria-hidden />
            {behind > 0 && behind}
          </button>
          <button
            type="button"
            className="gp-tool"
            aria-label={`Push ${ahead} ${ahead === 1 ? "commit" : "commits"}`}
            title="Push"
            disabled={locked || upstream === null || ahead === 0}
            onClick={() => void run("push", () => rpc.call("push", { threadId }))}
          >
            <Icon name={busy === "push" ? "Loading" : "ArrowUp"} className={busy === "push" ? "gp-spin size-3.5" : "size-3.5"} aria-hidden />
            {ahead > 0 && ahead}
          </button>
          <button
            type="button"
            className="gp-tool"
            aria-label="Fetch from remote"
            title="Fetch"
            disabled={locked || refreshing}
            onClick={() => void run("fetch", () => rpc.call("fetch", { threadId }))}
          >
            <Icon name={busy === "fetch" ? "Loading" : "Download"} className={busy === "fetch" ? "gp-spin size-3.5" : "size-3.5"} aria-hidden />
          </button>
          <MoreMenu
            disabled={locked}
            upstream={upstream}
            ahead={ahead}
            behind={behind}
            lastCommit={data.lastCommit}
            hasChanges={data.files.length > 0}
            stashCount={data.stashCount}
            onRun={(action) => void run(action, () => rpc.call(action, { threadId }))}
          />
        </div>
      </div>

      <div className="gp-scroll" role="tabpanel" aria-label={onChanges ? "Changes" : "Staged changes"}>
        {list.length === 0 ? (
          <p className="gp-empty">{onChanges ? "Working tree clean" : "Nothing staged yet"}</p>
        ) : (
          <ul className="gp-rows">
            {list.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                code={onChanges ? file.worktree : file.index}
                lines={onChanges ? file.worktreeLines : file.stagedLines}
                actionLabel={onChanges ? "Stage" : "Unstage"}
                actionIcon={onChanges ? <Icon name="Plus" className="size-3.5" aria-hidden /> : <MinusIcon />}
                pending={busy === `${kind}:${file.path}`}
                locked={locked}
                onAction={() => stagePaths(kind, `${kind}:${file.path}`, [file.path])}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({ id: "git", title: "Git worktree", icon: "GitBranch", component: GitPanel, layout: "flush" });
});
