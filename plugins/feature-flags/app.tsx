// alia-plugin-feature-flags — frontend entry.
//
// One row per flag, one column per LaunchDarkly environment. A flag is a
// single entity; only its on/off state is per-environment, so each cell is an
// independent toggle. The server publishes "flags-changed" after every
// toggle, so open pages stay current.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  useAliaNavigate,
  useComposerView,
  useRealtime,
  useRpc,
} from "@vesnalia/plugin-sdk/app";
import type { rpcContract, Environment, Flag, Member } from "./server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function relativeTime(ms: number): string {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// ── Shared sync state ────────────────────────────────────────────────────────
// The panel header (headerContent) and the page body are separate React trees,
// so they share sync state through this module-level store. The body owns the
// fetching and pushes state here; the header reads it and triggers refresh.

type SyncSnapshot = {
  fetchedAt: number | null;
  refreshing: boolean;
  count: number | null;
};

let syncSnapshot: SyncSnapshot = {
  fetchedAt: null,
  refreshing: false,
  count: null,
};
let refreshFn: (() => void) | null = null;
const syncListeners = new Set<() => void>();

const syncStore = {
  subscribe(cb: () => void) {
    syncListeners.add(cb);
    return () => {
      syncListeners.delete(cb);
    };
  },
  getSnapshot() {
    return syncSnapshot;
  },
  set(partial: Partial<SyncSnapshot>) {
    syncSnapshot = { ...syncSnapshot, ...partial };
    for (const cb of syncListeners) cb();
  },
  setRefresh(fn: (() => void) | null) {
    refreshFn = fn;
  },
  refresh() {
    refreshFn?.();
  },
};

function SyncHeader() {
  const snap = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot);
  // Re-render the relative time as it ages.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const parts: string[] = [];
  if (snap.count !== null) parts.push(`${snap.count} flags`);
  if (snap.refreshing) parts.push("syncing…");
  else if (snap.fetchedAt !== null)
    parts.push(`synced ${relativeTime(snap.fetchedAt)}`);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => syncStore.refresh()}
        disabled={snap.refreshing}
      >
        <Icon
          name="RotateCcw"
          className={cn("size-4", snap.refreshing && "animate-spin")}
        />
        Refresh
      </Button>
    </div>
  );
}

/** The dashed box VesnALIA's own list pages use for loading and empty states. */
function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

// ── Filters ────────────────────────────────────────────────────────────────

type Filters = {
  maintainer: string; // "all" | "me" | a maintainerId
  status: "all" | "new" | "active" | "launched" | "inactive" | "archived";
  type: "all" | "boolean" | "multivariate";
  lifecycle: "all" | "temporary" | "permanent";
  tag: string; // "all" | a tag
  created: "any" | "7" | "30" | "90";
};

const DEFAULT_FILTERS: Filters = {
  maintainer: "all",
  status: "all",
  type: "all",
  lifecycle: "all",
  tag: "all",
  created: "any",
};

const CREATED_CUTOFF_MS: Record<Filters["created"], number> = {
  any: 0,
  "7": 7 * 24 * 60 * 60 * 1000,
  "30": 30 * 24 * 60 * 60 * 1000,
  "90": 90 * 24 * 60 * 60 * 1000,
};

function FacetSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── State pill (per-environment toggle) ──────────────────────────────────────

function StatePill({
  on,
  status,
  busy,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  status: string;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy || disabled}
      aria-label={label}
      title={status ? `${on ? "On" : "Off"} · ${status}` : on ? "On" : "Off"}
      className={cn(
        "inline-flex h-6 min-w-12 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors",
        on
          ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400"
          : "bg-muted text-muted-foreground hover:bg-muted/70",
        (busy || disabled) && "opacity-50",
      )}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function CopyKeyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // clipboard blocked; nothing useful to show
        }
      }}
      aria-label={`Copy key ${value}`}
      title={copied ? "Copied" : "Copy key"}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Icon name={copied ? "Check" : "Copy"} className="size-3.5" />
    </button>
  );
}

function flagUrl(baseUrl: string, projectKey: string, flagKey: string): string {
  return `${baseUrl}/projects/${encodeURIComponent(projectKey)}/flags/${encodeURIComponent(flagKey)}/`;
}

function FlagRow({
  flag,
  environments,
  mine,
  busyCell,
  projectKey,
  baseUrl,
  onToggle,
}: {
  flag: Flag;
  environments: Environment[];
  mine: boolean;
  busyCell: string | null;
  projectKey: string;
  baseUrl: string;
  onToggle: (env: string, on: boolean) => void;
}) {
  return (
    <>
      <td className="py-3 pr-3 pl-4">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium" title={flag.name}>
            {flag.name}
          </span>
          {mine ? (
            <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
              You
            </span>
          ) : null}
          {flag.archived ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              Archived
            </span>
          ) : null}
        </div>
        {flag.description ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {flag.description}
          </div>
        ) : null}
        <div className="mt-1 flex items-center gap-x-2 gap-y-1 overflow-hidden text-xs text-muted-foreground">
          <span className="shrink-0">
            {flag.maintainerName ?? "No maintainer"}
            {flag.creationDate ? ` · ${formatDate(flag.creationDate)}` : ""}
          </span>
          {flag.tags.map((tag) => (
            <span
              key={tag}
              className="shrink-0 rounded bg-muted px-1.5 py-0.5"
            >
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="py-3 pr-2 align-middle">
        <div className="flex items-center gap-0.5">
          <span
            className="min-w-0 truncate font-mono text-xs text-muted-foreground"
            title={flag.key}
          >
            {flag.key}
          </span>
          <CopyKeyButton value={flag.key} />
        </div>
      </td>
      {environments.map((env) => {
        const state = flag.states[env.key];
        const on = state?.on === true;
        return (
          <td key={env.key} className="px-2 py-3 text-center align-middle">
            <StatePill
              on={on}
              status={state?.status ?? ""}
              busy={busyCell === `${flag.key}:${env.key}`}
              disabled={flag.archived}
              onToggle={() => onToggle(env.key, !on)}
              label={`Turn "${flag.name}" ${on ? "off" : "on"} in ${env.name}`}
            />
          </td>
        );
      })}
      <td className="py-3 pr-2 align-middle">
        <a
          href={flagUrl(baseUrl, projectKey, flag.key)}
          target="_blank"
          rel="noreferrer"
          title="Open in LaunchDarkly"
          aria-label={`Open "${flag.name}" in LaunchDarkly`}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Icon name="ExternalLink" className="size-4" />
        </a>
      </td>
    </>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

type PendingToggle = { flag: Flag; env: Environment; on: boolean };

function FlagsView({
  environments,
  meId,
  projectKey,
  baseUrl,
  protectedEnvironments,
  rpc,
}: {
  environments: Environment[];
  meId: string | null;
  projectKey: string;
  baseUrl: string;
  protectedEnvironments: string[];
  rpc: Rpc;
}) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [pending, setPending] = useState<PendingToggle | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const refetch = useCallback(
    (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      rpc.call("flags", { refresh }).then(
        (result) => {
          setFlags(result.flags);
          setFetchedAt(result.fetchedAt);
          setError(null);
          if (refresh) setRefreshing(false);
        },
        (cause) => {
          setError(errorText(cause));
          if (refresh) setRefreshing(false);
        },
      );
    },
    [rpc],
  );

  useEffect(() => {
    refetch(false);
  }, [refetch]);
  // Toggles update the cache in place, so a plain (cached) refetch is enough.
  useRealtime("flags-changed", () => refetch(false));

  // Expose refresh to the panel header and keep its sync state in step.
  useEffect(() => {
    syncStore.setRefresh(() => refetch(true));
    return () => syncStore.setRefresh(null);
  }, [refetch]);
  useEffect(() => {
    syncStore.set({ fetchedAt, refreshing, count: flags?.length ?? null });
  }, [fetchedAt, refreshing, flags]);

  // Clicking a pill asks for confirmation; the dialog runs the real toggle.
  const requestToggle = (flag: Flag, envKey: string, on: boolean) => {
    const env = environments.find((e) => e.key === envKey);
    if (env) setPending({ flag, env, on });
  };
  const confirmToggle = async () => {
    if (pending === null) return;
    const { flag, env, on } = pending;
    setPending(null);
    const cell = `${flag.key}:${env.key}`;
    setBusyCell(cell);
    try {
      await rpc.call("toggle", { key: flag.key, env: env.key, on });
      refetch(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyCell(null);
    }
  };

  const isMine = useCallback(
    (flag: Flag) => meId !== null && flag.maintainerId === meId,
    [meId],
  );

  const live = useMemo(
    () => (flags === null ? null : flags.filter((flag) => !flag.archived)),
    [flags],
  );

  const tagOptions = useMemo(() => {
    const base = [{ value: "all", label: "All tags" }];
    if (live === null) return base;
    const tags = new Set<string>();
    for (const flag of live) for (const tag of flag.tags) tags.add(tag);
    return [
      ...base,
      ...[...tags]
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => ({ value: tag, label: tag })),
    ];
  }, [live]);

  const maintainerOptions = useMemo(() => {
    const base: Array<{ value: string; label: string }> = [
      { value: "all", label: "All maintainers" },
    ];
    if (meId !== null) base.push({ value: "me", label: "Me" });
    if (live === null) return base;
    const seen = new Map<string, string>();
    for (const flag of live) {
      if (flag.maintainerId === null || flag.maintainerId === meId) continue;
      if (!seen.has(flag.maintainerId)) {
        seen.set(flag.maintainerId, flag.maintainerName ?? flag.maintainerId);
      }
    }
    const others = [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...base, ...others];
  }, [live, meId]);

  const visible = useMemo(() => {
    if (flags === null) return null;
    const cutoff =
      CREATED_CUTOFF_MS[filters.created] === 0
        ? 0
        : Date.now() - CREATED_CUTOFF_MS[filters.created];
    const needle = query.trim().toLowerCase();
    return flags.filter((flag) => {
      // Archived flags stay hidden unless the Status facet asks for them.
      if (filters.status === "archived") {
        if (!flag.archived) return false;
      } else {
        if (flag.archived) return false;
        // Status is per-environment; match if any environment has it.
        if (
          filters.status !== "all" &&
          !Object.values(flag.states).some((s) => s.status === filters.status)
        )
          return false;
      }
      if (filters.maintainer === "me" && !isMine(flag)) return false;
      if (
        filters.maintainer !== "me" &&
        filters.maintainer !== "all" &&
        flag.maintainerId !== filters.maintainer
      )
        return false;
      if (filters.type !== "all" && flag.kind !== filters.type) return false;
      if (filters.lifecycle === "temporary" && !flag.temporary) return false;
      if (filters.lifecycle === "permanent" && flag.temporary) return false;
      if (filters.tag !== "all" && !flag.tags.includes(filters.tag))
        return false;
      if (cutoff !== 0 && flag.creationDate < cutoff) return false;
      if (needle !== "") {
        const hit =
          flag.name.toLowerCase().includes(needle) ||
          flag.key.toLowerCase().includes(needle) ||
          flag.description.toLowerCase().includes(needle) ||
          flag.tags.some((tag) => tag.toLowerCase().includes(needle));
        if (!hit) return false;
      }
      return true;
    });
  }, [flags, filters, isMine, query]);

  const filtersActive =
    query.trim() !== "" ||
    filters.maintainer !== "all" ||
    filters.status !== "all" ||
    filters.type !== "all" ||
    filters.lifecycle !== "all" ||
    filters.tag !== "all" ||
    filters.created !== "any";

  return (
    <>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search flags by name, description, or key…"
        aria-label="Search flags"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FacetSelect
          label="Maintainer"
          value={filters.maintainer}
          onChange={(value) => setFilter("maintainer", value)}
          options={maintainerOptions}
        />
        <FacetSelect
          label="Status"
          value={filters.status}
          onChange={(value) => setFilter("status", value as Filters["status"])}
          options={[
            { value: "all", label: "Any status" },
            { value: "new", label: "New" },
            { value: "active", label: "Active" },
            { value: "launched", label: "Launched" },
            { value: "inactive", label: "Inactive" },
            { value: "archived", label: "Archived" },
          ]}
        />
        <FacetSelect
          label="Type"
          value={filters.type}
          onChange={(value) => setFilter("type", value as Filters["type"])}
          options={[
            { value: "all", label: "All types" },
            { value: "boolean", label: "Boolean" },
            { value: "multivariate", label: "Multivariate" },
          ]}
        />
        <FacetSelect
          label="Lifecycle"
          value={filters.lifecycle}
          onChange={(value) =>
            setFilter("lifecycle", value as Filters["lifecycle"])
          }
          options={[
            { value: "all", label: "Any lifecycle" },
            { value: "temporary", label: "Temporary" },
            { value: "permanent", label: "Permanent" },
          ]}
        />
        <FacetSelect
          label="Tag"
          value={filters.tag}
          onChange={(value) => setFilter("tag", value)}
          options={tagOptions}
        />
        <FacetSelect
          label="Created"
          value={filters.created}
          onChange={(value) => setFilter("created", value as Filters["created"])}
          options={[
            { value: "any", label: "Any time" },
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
          ]}
        />
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setFilters(DEFAULT_FILTERS);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4">
        {visible === null ? (
          <EmptyState>Loading flags…</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>
            {filtersActive
              ? "No flags match the filters."
              : "No flags in this project."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[480px] table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="w-36 py-2 pr-2 font-medium">Key</th>
                  {environments.map((env) => (
                    <th
                      key={env.key}
                      className="w-[72px] px-2 py-2 text-center font-medium"
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        {env.color ? (
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: `#${env.color}` }}
                          />
                        ) : null}
                        <span className="truncate" title={env.name}>
                          {env.name}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th className="w-10 py-2 pr-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((flag) => (
                  <tr
                    key={flag.key}
                    className="border-b border-border align-top last:border-b-0"
                  >
                    <FlagRow
                      flag={flag}
                      environments={environments}
                      mine={isMine(flag)}
                      busyCell={busyCell}
                      projectKey={projectKey}
                      baseUrl={baseUrl}
                      onToggle={(env, on) => requestToggle(flag, env, on)}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {visible !== null && visible.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {visible.length} flag{visible.length === 1 ? "" : "s"}
        </p>
      ) : null}

      <ConfirmToggleDialog
        pending={pending}
        protectedEnvironments={protectedEnvironments}
        onCancel={() => setPending(null)}
        onConfirm={confirmToggle}
      />
    </>
  );
}

function ConfirmToggleDialog({
  pending,
  protectedEnvironments,
  onCancel,
  onConfirm,
}: {
  pending: PendingToggle | null;
  protectedEnvironments: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isProtected =
    pending !== null && protectedEnvironments.includes(pending.env.key);
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {pending === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>
                Turn {pending.on ? "on" : "off"} in {pending.env.name}?
              </DialogTitle>
              <DialogDescription asChild>
                <div>
                  <span className="font-medium text-foreground">
                    {pending.flag.name}
                  </span>{" "}
                  will be turned{" "}
                  <span className="font-medium text-foreground">
                    {pending.on ? "on" : "off"}
                  </span>{" "}
                  in{" "}
                  <span className="font-medium text-foreground">
                    {pending.env.name}
                  </span>{" "}
                  right away.
                  {isProtected ? (
                    <span className="mt-2 block font-medium text-destructive">
                      {pending.env.name} is a protected environment.
                    </span>
                  ) : null}
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                variant={isProtected ? "destructive" : "default"}
                onClick={onConfirm}
              >
                Turn {pending.on ? "on" : "off"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────────

function SetupPrompt({ projectKey }: { projectKey: string }) {
  return (
    <EmptyState>
      <p className="font-medium text-foreground">
        Connect LaunchDarkly to get started.
      </p>
      <p className="mt-2">
        Set an access token in the plugin settings, then reload the plugin:
      </p>
      <pre className="mt-2 overflow-x-auto rounded bg-muted px-3 py-2 text-left text-xs">
        alia plugin config feature-flags set apiToken &lt;token&gt;{"\n"}alia plugin
        reload feature-flags
      </pre>
      <p className="mt-2 text-xs">
        Reading flags for project <code>{projectKey}</code>.
      </p>
    </EmptyState>
  );
}

function FlagsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "unconfigured"; projectKey: string }
    | {
        status: "ready";
        environments: Environment[];
        projectKey: string;
        baseUrl: string;
        protectedEnvironments: string[];
        member: Member | null;
      }
  >({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    rpc.call("config").then((cfg) => {
      if (!cfg.configured) {
        setState({ status: "unconfigured", projectKey: cfg.projectKey });
        return;
      }
      Promise.all([rpc.call("environments"), rpc.call("me")]).then(
        ([envs, me]) => {
          setState({
            status: "ready",
            environments: envs.environments,
            projectKey: cfg.projectKey,
            baseUrl: cfg.baseUrl,
            protectedEnvironments: cfg.protectedEnvironments,
            member: me.member,
          });
        },
        (cause) => setState({ status: "error", message: errorText(cause) }),
      );
    }, (cause) => setState({ status: "error", message: errorText(cause) }));
  }, [rpc]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-5xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {state.status === "loading" ? (
          <EmptyState>Loading…</EmptyState>
        ) : state.status === "error" ? (
          <div>
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load}>
              <Icon name="RotateCcw" className="size-4" />
              Retry
            </Button>
          </div>
        ) : state.status === "unconfigured" ? (
          <SetupPrompt projectKey={state.projectKey} />
        ) : state.environments.length === 0 ? (
          <EmptyState>
            No environments found in project <code>{state.projectKey}</code>.
          </EmptyState>
        ) : (
          <FlagsView
            environments={state.environments}
            meId={state.member?.id ?? null}
            projectKey={state.projectKey}
            baseUrl={state.baseUrl}
            protectedEnvironments={state.protectedEnvironments}
            rpc={rpc}
          />
        )}
      </div>
    </div>
  );
}

// ── Thread association ───────────────────────────────────────────────────────
// A flag is linked to a thread by storing its key under the thread id. Both the
// thread side-panel tab and the header chip read the linked flags for their
// thread and stay current through the "thread-links-changed" signal.

function useLinkedFlags(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const reload = useCallback(() => {
    rpc.call("thread_flags", { threadId }).then(
      (result) => setFlags(result.flags),
      () => setFlags([]),
    );
  }, [rpc, threadId]);
  useEffect(() => {
    reload();
  }, [reload]);
  useRealtime("thread-links-changed", (payload) => {
    if ((payload as { threadId?: string } | null)?.threadId === threadId)
      reload();
  });
  // A toggle from anywhere changes a flag's state; refresh the linked view.
  useRealtime("flags-changed", reload);
  return { rpc, flags, reload };
}

function anyOn(flag: Flag): boolean {
  return Object.values(flag.states).some((state) => state.on);
}

function LinkedFlagCard({
  flag,
  environments,
  baseUrl,
  projectKey,
  busyCell,
  onToggle,
  onUnlink,
  onOpen,
}: {
  flag: Flag;
  environments: Environment[];
  baseUrl: string;
  projectKey: string;
  busyCell: string | null;
  onToggle: (env: string, on: boolean) => void;
  onUnlink: () => void;
  onOpen: (url: string) => void;
}) {
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{flag.name}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {flag.key}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onOpen(flagUrl(baseUrl, projectKey, flag.key))}
            title="Open in LaunchDarkly"
            aria-label={`Open "${flag.name}" in LaunchDarkly`}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icon name="ExternalLink" className="size-4" />
          </button>
          <button
            type="button"
            onClick={onUnlink}
            title="Unlink from this thread"
            aria-label={`Unlink "${flag.name}" from this thread`}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icon name="X" className="size-4" />
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        {environments.map((env) => {
          const state = flag.states[env.key];
          const on = state?.on === true;
          return (
            <div key={env.key} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{env.name}</span>
              <StatePill
                on={on}
                status={state?.status ?? ""}
                busy={busyCell === `${flag.key}:${env.key}`}
                disabled={flag.archived}
                onToggle={() => onToggle(env.key, !on)}
                label={`Turn "${flag.name}" ${on ? "off" : "on"} in ${env.name}`}
              />
            </div>
          );
        })}
      </div>
    </li>
  );
}

/** Thread side-panel tab: the flags linked to this thread, plus a link picker. */
function ThreadFlagsPanel({ threadId }: { threadId: string }) {
  const { rpc, flags: linked } = useLinkedFlags(threadId);
  const nav = useAliaNavigate();
  const [cfg, setCfg] = useState<{
    configured: boolean;
    projectKey: string;
    baseUrl: string;
  } | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Flag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("config").then((c) => {
      setCfg(c);
      if (c.configured)
        rpc.call("environments").then(
          (r) => setEnvironments(r.environments),
          (cause) => setError(errorText(cause)),
        );
    }, (cause) => setError(errorText(cause)));
  }, [rpc]);

  // Debounced flag search for the link picker.
  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      rpc.call("search_flags", { query: q }).then(
        (r) => setResults(r.flags),
        (cause) => setError(errorText(cause)),
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [rpc, query]);

  const linkedKeys = new Set((linked ?? []).map((f) => f.key));

  const openUrl = (url: string) => {
    if (!nav.openUrl(url)) window.open(url, "_blank", "noreferrer");
  };
  const toggle = async (flag: Flag, env: string, on: boolean) => {
    setBusyCell(`${flag.key}:${env}`);
    try {
      await rpc.call("toggle", { key: flag.key, env, on });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyCell(null);
    }
  };
  const link = async (key: string) => {
    setQuery("");
    setResults([]);
    try {
      await rpc.call("thread_link", { threadId, key });
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const unlink = async (key: string) => {
    try {
      await rpc.call("thread_unlink", { threadId, key });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  if (cfg !== null && !cfg.configured) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        Set a LaunchDarkly token in the plugin settings, then reload.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="relative">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Link a flag by name, key, or tag…"
          aria-label="Search flags to link"
        />
        {results.length > 0 ? (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {results.map((flag) => {
              const already = linkedKeys.has(flag.key);
              return (
                <li key={flag.key}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => link(flag.key)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{flag.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {flag.key}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {already ? "Linked" : "Link"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {linked === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No flags linked to this thread yet. Search above to link one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {linked.map((flag) => (
              <LinkedFlagCard
                key={flag.key}
                flag={flag}
                environments={environments}
                baseUrl={cfg?.baseUrl ?? ""}
                projectKey={cfg?.projectKey ?? ""}
                busyCell={busyCell}
                onToggle={(env, on) => toggle(flag, env, on)}
                onUnlink={() => unlink(flag.key)}
                onOpen={openUrl}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A small read-only environment status pill: env name + On/Off. */
function EnvStatusPill({
  name,
  color,
  on,
}: {
  name: string;
  color: string | null;
  on: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
      {color ? (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: `#${color}` }}
        />
      ) : null}
      <span className="text-muted-foreground">{name}</span>
      <span
        className={cn(
          "font-medium",
          on ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
        )}
      >
        {on ? "On" : "Off"}
      </span>
    </span>
  );
}

/** Composer chip: full detail for a single linked flag, else a summary. */
function LinkedFlagsChip({ threadId }: { threadId: string }) {
  const { rpc, flags } = useLinkedFlags(threadId);
  const nav = useAliaNavigate();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  useEffect(() => {
    rpc.call("environments").then(
      (r) => setEnvironments(r.environments),
      () => setEnvironments([]),
    );
  }, [rpc]);

  if (flags === null || flags.length === 0) return null;
  const open = () => nav.openThreadPanel({ actionId: "thread-flags" });

  if (flags.length === 1) {
    const flag = flags[0];
    const envList: Environment[] = environments.length
      ? environments
      : Object.keys(flag.states).map((key) => ({ key, name: key, color: null }));
    return (
      <button
        type="button"
        onClick={open}
        title={`Open ${flag.name} in the LaunchDarkly panel`}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <Icon
          name="SlidersHorizontal"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 shrink truncate font-mono text-xs text-muted-foreground">
          {flag.key}
        </span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {envList.map((env) => (
            <EnvStatusPill
              key={env.key}
              name={env.name}
              color={env.color}
              on={flag.states[env.key]?.on === true}
            />
          ))}
        </span>
      </button>
    );
  }

  const onCount = flags.filter(anyOn).length;
  return (
    <button
      type="button"
      onClick={open}
      title={`Linked flags: ${flags.map((f) => f.name).join(", ")}`}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50"
    >
      <Icon name="SlidersHorizontal" className="size-4 shrink-0" />
      <span className="font-medium text-foreground">{flags.length} flags</span>
      <span>· {onCount} on</span>
    </button>
  );
}

/** Composer banner: shows the linked-flags chip above the prompt input. */
function ThreadFlagsComposerBanner() {
  const view = useComposerView();
  const { scope } = view;
  const threadId =
    scope.kind === "thread" || scope.kind === "queued-message"
      ? scope.threadId
      : null;
  if (threadId === null) return null;
  return <LinkedFlagsChip threadId={threadId} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "feature-flags",
    title: "LaunchDarkly Flags",
    icon: "SlidersHorizontal",
    path: "feature-flags",
    component: FlagsPage,
    headerContent: SyncHeader,
  });
  app.slots.threadPanelAction({
    id: "thread-flags",
    title: "LaunchDarkly Flags",
    icon: "SlidersHorizontal",
    layout: "flush",
    component: ThreadFlagsPanel,
  });
  app.composer.customize({
    id: "thread-flags",
    scopes: ["thread", "queued-message"],
    banners: [{ id: "linked-flags", component: ThreadFlagsComposerBanner }],
  });
});
