import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from "react";
import { CircleX, Info, Sparkles, TriangleAlert, type LucideIcon } from "lucide-react";
import { definePluginApp, UrlLink, useAliaNavigate, useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "./server";
import { issueBadgeEntries, issueRouteKey, splitProjectSlugs } from "./sentry-core";
import type {
  SentryAggregatedIssue,
  SentryConnectionHealth,
  SentryConnectionTestResult,
  SentryIssue,
  SentryEventSummary,
  SentryIssueDetail,
  SentrySafeValue,
  SentryTriageThreadLink,
  SentryProject,
  IssueBadgeSeverity,
} from "./sentry-core";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormatter = new Intl.NumberFormat();

type SentryConnection = {
  id: string;
  label: string;
  orgSlug: string;
  projectSlugs: string[];
  projectLinks: SentryProjectLink[];
  baseUrl: string;
  filters: SentryFilters;
  configured: boolean;
  health: SentryConnectionHealth;
};

type SentryProjectLink = {
  projectSlug: string;
  localProjectId: string;
};

type LocalProject = {
  id: string;
  name: string;
  path: string;
};

type SentryFilters = {
  environment: string;
  timeRange: "1h" | "24h" | "7d" | "14d" | "30d";
  query: string;
  limit: "10" | "20" | "50";
};

const defaultFilters: SentryFilters = {
  environment: "",
  timeRange: "24h",
  query: "",
  limit: "20",
};

function connectionEditorKey(connection?: SentryConnection): string {
  if (connection === undefined) return "new";
  return JSON.stringify({
    id: connection.id,
    label: connection.label,
    orgSlug: connection.orgSlug,
    projectSlugs: connection.projectSlugs,
    projectLinks: connection.projectLinks,
    baseUrl: connection.baseUrl,
    filters: connection.filters,
  });
}

const severityLabels: Record<IssueBadgeSeverity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};
const severityBadgeClasses: Record<IssueBadgeSeverity, string> = {
  error: "bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30",
  warning: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30",
  info: "bg-accent/15 text-accent-foreground ring-1 ring-inset ring-accent/30",
};
const severityIcons: Record<IssueBadgeSeverity, LucideIcon> = {
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
};

type IssueRoute =
  | { view: "issues" }
  | { view: "issue"; connectionId: string; projectSlug: string; issueId: string };

type IssueStatusFilter = "all" | "unresolved" | "resolved" | "ignored";
const defaultIssueStatusFilter: IssueStatusFilter = "unresolved";
const ALL_PROJECTS_VALUE = "__all_projects__";

type DisplayIssue = SentryIssue | SentryAggregatedIssue;
type IssueScope =
  | { kind: "all" }
  | { kind: "target"; connectionId: string; projectSlug: string };

function isAggregatedIssue(issue: DisplayIssue): issue is SentryAggregatedIssue {
  return "connectionId" in issue;
}

function parseIssueRoute(subPath: string): IssueRoute {
  const parts = subPath.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== "issue") return { view: "issues" };
  try {
    const connectionId = decodeURIComponent(parts[1] ?? "");
    const projectSlug = decodeURIComponent(parts[2] ?? "");
    const issueId = decodeURIComponent(parts[3] ?? "");
    if (connectionId === "" || projectSlug === "" || issueId === "") return { view: "issues" };
    return { view: "issue", connectionId, projectSlug, issueId };
  } catch {
    return { view: "issues" };
  }
}

function issueSubPath(connectionId: string, projectSlug: string, issueId: string): string {
  return issueRouteKey(connectionId, projectSlug, issueId);
}

function formatDate(value: string | null): string {
  if (value === null) return "Unknown";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : dateFormatter.format(timestamp);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function healthLabel(connection: SentryConnection): string {
  if (!connection.configured) return "Needs setup";
  switch (connection.health.status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Partial failure";
    case "failed":
      return "Unavailable";
    default:
      return "Not checked";
  }
}

function healthClass(connection: SentryConnection): string {
  if (!connection.configured) return "bg-muted text-foreground";
  switch (connection.health.status) {
    case "healthy":
      return "bg-accent text-accent-foreground";
    case "degraded":
      return "bg-muted text-foreground";
    case "failed":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function healthTime(value: string | null): string {
  return value === null ? "Never" : formatDate(value);
}

function useConnections() {
  const rpc = useRpc<typeof rpcContract>();
  const [connections, setConnections] = useState<SentryConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const nextConnections = (await rpc.call("getConnections")).connections;
      if (request !== requestId.current) return;
      setConnections(nextConnections);
      setError(null);
    } catch (cause) {
      if (request === requestId.current) setError(errorMessage(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { connections, error, loading, refresh };
}

function useIssues(scope: IssueScope | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [issues, setIssues] = useState<DisplayIssue[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const hasScope = scope !== null;
  const allProjects = scope?.kind === "all";
  const connectionId = scope?.kind === "target" ? scope.connectionId : null;
  const projectSlug = scope?.kind === "target" ? scope.projectSlug : null;

  const applyResult = (result: {
    issues: DisplayIssue[];
    fetchedAt: string;
    fromCache: boolean;
    warning: string | null;
    hasMore: boolean;
    complete: boolean;
  }) => {
    setIssues(result.issues);
    setFetchedAt(result.fetchedAt);
    setFromCache(result.fromCache);
    setWarning(result.warning);
    setHasMore(result.hasMore);
    setComplete(result.complete);
    setError(null);
  };

  const refresh = useCallback(async (force = false) => {
    const request = ++requestId.current;
    if (!hasScope) {
      setIssues(null);
      setFetchedAt(null);
      setFromCache(false);
      setWarning(null);
      setComplete(true);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = allProjects
        ? await rpc.call(force ? "refreshAllIssues" : "listAllIssues", null)
        : await rpc.call(force ? "refreshIssues" : "listIssues", {
          connectionId: connectionId!,
          projectSlug: projectSlug!,
        });
      if (request !== requestId.current) return;
      applyResult(result);
    } catch (cause) {
      if (request !== requestId.current) return;
      setWarning(null);
      setError(errorMessage(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [allProjects, connectionId, hasScope, projectSlug, rpc]);

  const loadMore = useCallback(async (): Promise<boolean> => {
    const request = ++requestId.current;
    if (scope === null) return false;
    setLoading(true);
    try {
      const result = allProjects
        ? await rpc.call("loadMoreAllIssues", null)
        : await rpc.call("loadMoreIssues", {
          connectionId: connectionId!,
          projectSlug: projectSlug!,
        });
      if (request !== requestId.current) return false;
      applyResult(result);
      return true;
    } catch (cause) {
      if (request !== requestId.current) return false;
      setError(errorMessage(cause));
      return false;
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [allProjects, connectionId, projectSlug, rpc, scope]);

  useEffect(() => {
    setIssues(null);
    setFetchedAt(null);
    setFromCache(false);
    setWarning(null);
    setComplete(true);
    setHasMore(false);
    setError(null);
  }, [allProjects, connectionId, projectSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onIssuesChanged = useCallback(() => {
    void refresh();
  }, [refresh]);
  useRealtime("issues-changed", onIssuesChanged);

  return { issues, fetchedAt, fromCache, warning, complete, hasMore, error, loading, refresh, loadMore };
}

function useLocalProjects() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const nextProjects = (await rpc.call("getLocalProjects", null)).projects;
      if (request !== requestId.current) return;
      setProjects(nextProjects);
      setError(null);
    } catch (cause) {
      if (request === requestId.current) setError(errorMessage(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, error, loading, refresh };
}

function useIssueDetail(
  connectionId: string | null,
  projectSlug: string | null,
  issueId: string | null,
) {
  const rpc = useRpc<typeof rpcContract>();
  const [issue, setIssue] = useState<SentryIssueDetail | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async (force = false) => {
    const request = ++requestId.current;
    if (connectionId === null || projectSlug === null || issueId === null) {
      setIssue(null);
      setFetchedAt(null);
      setFromCache(false);
      setWarning(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await rpc.call(force ? "refreshIssueDetail" : "getIssueDetail", {
        connectionId,
        projectSlug,
        issueId,
      });
      if (request !== requestId.current) return;
      setIssue(result.issue);
      setFetchedAt(result.fetchedAt);
      setFromCache(result.fromCache);
      setWarning(result.warning);
      setError(null);
    } catch (cause) {
      if (request === requestId.current) setError(errorMessage(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [connectionId, issueId, projectSlug, rpc]);

  useEffect(() => {
    setIssue(null);
    setFetchedAt(null);
    setFromCache(false);
    setWarning(null);
    setError(null);
  }, [connectionId, issueId, projectSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { issue, fetchedAt, fromCache, warning, error, loading, refresh };
}
function useIssueEvent(
  connectionId: string | null,
  projectSlug: string | null,
  issueId: string | null,
  eventId: string | null,
) {
  const rpc = useRpc<typeof rpcContract>();
  const [event, setEvent] = useState<SentryEventSummary | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (connectionId === null || projectSlug === null || issueId === null || eventId === null) {
      setEvent(null);
      setFetchedAt(null);
      setFromCache(false);
      setWarning(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setEvent(null);
    setError(null);
    try {
      const result = await rpc.call("getIssueEvent", {
        connectionId,
        projectSlug,
        issueId,
        eventId,
      });
      if (request !== requestId.current) return;
      setEvent(result.event);
      setFetchedAt(result.fetchedAt);
      setFromCache(result.fromCache);
      setWarning(result.warning);
    } catch (cause) {
      if (request !== requestId.current) return;
      setWarning(null);
      setError(errorMessage(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [connectionId, eventId, issueId, projectSlug, rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { event, fetchedAt, fromCache, warning, error, loading, refresh };
}

function useTriageThreads(
  connectionId: string | null,
  projectSlug: string | null,
  issueId: string | null,
) {
  const rpc = useRpc<typeof rpcContract>();
  const [threads, setThreads] = useState<SentryTriageThreadLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (connectionId === null || projectSlug === null || issueId === null) {
      setThreads([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextThreads = (await rpc.call("getTriageThreads", {
        connectionId,
        projectSlug,
        issueId,
      })).threads;
      if (request !== requestId.current) return;
      setThreads(nextThreads);
      setError(null);
    } catch (cause) {
      if (request === requestId.current) setError(errorMessage(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [connectionId, issueId, projectSlug, rpc]);

  useEffect(() => {
    setThreads([]);
    setError(null);
  }, [connectionId, issueId, projectSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onTriageChanged = useCallback(() => {
    void refresh();
  }, [refresh]);
  useRealtime("triage-changed", onTriageChanged);

  return { threads, error, loading, refresh };
}

function ConnectionForm({
  connection,
  onSaved,
  onHealthChanged,
  onRemoved,
  onCancel,
}: {
  connection?: SentryConnection;
  onSaved: () => Promise<void>;
  onHealthChanged?: () => Promise<void>;
  onRemoved?: () => Promise<void>;
  onCancel?: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const {
    projects: localProjects,
    error: localProjectsError,
    loading: localProjectsLoading,
  } = useLocalProjects();
  const [label, setLabel] = useState(connection?.label ?? "");
  const [orgSlug, setOrgSlug] = useState(connection?.orgSlug ?? "");
  const [projectSlugs, setProjectSlugs] = useState(connection?.projectSlugs.join("\n") ?? "");
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "https://sentry.io");
  const [environment, setEnvironment] = useState(connection?.filters.environment ?? defaultFilters.environment);
  const [timeRange, setTimeRange] = useState<SentryFilters["timeRange"]>(connection?.filters.timeRange ?? defaultFilters.timeRange);
  const [query, setQuery] = useState(connection?.filters.query ?? defaultFilters.query);
  const [limit, setLimit] = useState<SentryFilters["limit"]>(connection?.filters.limit ?? defaultFilters.limit);
  const [projectLinks, setProjectLinks] = useState<Record<string, string>>(
    Object.fromEntries((connection?.projectLinks ?? []).map((link) => [link.projectSlug, link.localProjectId])),
  );
  const [authToken, setAuthToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [discoveredProjects, setDiscoveredProjects] = useState<SentryProject[]>([]);
  const [discoveryFallback, setDiscoveryFallback] = useState(false);
  const [discoveryWarning, setDiscoveryWarning] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SentryConnectionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projects = splitProjectSlugs(projectSlugs);

  const discover = async () => {
    setDiscovering(true);
    setError(null);
    setDiscoveryWarning(null);
    try {
      const result = await rpc.call("discoverProjects", {
        ...(connection === undefined ? {} : { id: connection.id }),
        orgSlug: orgSlug.trim(),
        baseUrl: baseUrl.trim(),
        ...(authToken.trim() === "" ? {} : { authToken: authToken.trim() }),
      });
      setDiscoveredProjects(result.projects);
      setDiscoveryFallback(result.fallback);
      setDiscoveryWarning(result.warning);
      if (result.projects.length === 0 && result.warning === null) {
        setDiscoveryWarning("No accessible projects were returned. Enter a project slug manually if needed.");
      }
    } catch (cause) {
      setDiscoveryWarning(null);
      setError(errorMessage(cause));
    } finally {
      setDiscovering(false);
    }
  };

  const test = async () => {
    if (projects.length === 0) {
      setError("Enter or discover at least one project before testing the connection.");
      return;
    }
    setTesting(true);
    setError(null);
    try {
      const result = await rpc.call("testConnection", {
        ...(connection === undefined ? {} : { id: connection.id }),
        orgSlug: orgSlug.trim(),
        projectSlugs: projects,
        baseUrl: baseUrl.trim(),
        ...(authToken.trim() === "" ? {} : { authToken: authToken.trim() }),
      });
      setTestResult(result);
      await onHealthChanged?.();
    } catch (cause) {
      setTestResult(null);
      setError(errorMessage(cause));
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (connection === undefined || onRemoved === undefined) return;
    if (!window.confirm(
      "Remove " + connection.label + "? This deletes its token, health metadata, cached issues, cached details, and project links.",
    )) return;
    setRemoving(true);
    setError(null);
    try {
      await rpc.call("removeConnection", {
        connectionId: connection.id,
        confirmation: "REMOVE",
      });
      await onRemoved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRemoving(false);
    }
  };

  const save = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (projects.length === 0) {
      setError("Enter at least one project slug.");
      return;
    }
    if (connection?.configured !== true && authToken.trim() === "") {
      setError("Enter a Sentry auth token for this connection.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await rpc.call("saveConnection", {
        ...(connection === undefined ? {} : { id: connection.id }),
        label: label.trim(),
        orgSlug: orgSlug.trim(),
        projectSlugs: projects,
        projectLinks: projects.flatMap((projectSlug) => {
          const localProjectId = projectLinks[projectSlug]?.trim();
          return localProjectId === undefined || localProjectId === ""
            ? []
            : [{ projectSlug, localProjectId }];
        }),
        baseUrl: baseUrl.trim(),
        filters: {
          environment: environment.trim(),
          timeRange,
          query: query.trim(),
          limit,
        },
        ...(authToken.trim() === "" ? {} : { authToken: authToken.trim() }),
      });
      setAuthToken("");
      await onSaved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="font-semibold text-foreground">
          {connection === undefined ? "Add Sentry connection" : "Edit Sentry connection"}
        </h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Keep personal and work accounts separate, or add several projects to one organization.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-foreground" htmlFor="sentry-connection-label">
          Connection name
          <input
            id="sentry-connection-label"
            type="text"
            autoComplete="off"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Work Sentry"
            required
            className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="block text-sm font-medium text-foreground" htmlFor="sentry-connection-token">
          Sentry auth token
          <input
            id="sentry-connection-token"
            type="password"
            autoComplete="new-password"
            value={authToken}
            onChange={(event) => setAuthToken(event.target.value)}
            placeholder={connection?.configured === true ? "Leave blank to keep the saved token" : undefined}
            required={connection?.configured !== true}
            className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Use a token with read-only project:read, event:read, and org:read scopes.
          </span>
        </label>

        <label className="block text-sm font-medium text-foreground" htmlFor="sentry-connection-org">
          Organization slug
          <input
            id="sentry-connection-org"
            type="text"
            autoComplete="organization"
            value={orgSlug}
            onChange={(event) => setOrgSlug(event.target.value)}
            required
            className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-foreground" htmlFor="sentry-connection-projects">
            Project slugs
          </label>
          <textarea
            id="sentry-connection-projects"
            value={projectSlugs}
            onChange={(event) => setProjectSlugs(event.target.value)}
            placeholder="web\napi\nworker"
            rows={4}
            required
            className="mt-1.5 block w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Enter one slug per line or separate slugs with commas.
          </span>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void discover()}
              disabled={discovering || saving || testing || removing}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
            >
              {discovering ? "Discovering…" : "Discover projects"}
            </button>
            <span className="text-xs text-muted-foreground">
              Discovery uses the organization API. Manual slugs remain available for custom variants.
            </span>
          </div>
        </div>

        {discoveryWarning === null ? null : (
          <div role="status" className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground sm:col-span-2">
            {discoveryFallback ? "Project discovery fallback: " : ""}{discoveryWarning}
          </div>
        )}

        {discoveredProjects.length === 0 ? null : (
          <fieldset className="rounded-lg border border-border p-4 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold text-foreground">Select discovered projects</legend>
            <p className="mb-3 text-xs leading-5 text-muted-foreground">
              Select the projects this connection should sync. You can still add a slug manually below.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {discoveredProjects.map((project) => (
                <label key={project.slug} className="flex min-w-0 items-start gap-2 rounded-md border border-border/70 px-3 py-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={projects.includes(project.slug)}
                    onChange={(event) => {
                      setProjectSlugs((current) => {
                        const selected = splitProjectSlugs(current);
                        const next = event.target.checked
                          ? Array.from(new Set([...selected, project.slug]))
                          : selected.filter((slug) => slug !== project.slug);
                        return next.join("\n");
                      });
                    }}
                    className="mt-0.5 size-4 accent-current"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{project.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{project.slug}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {projects.length === 0 ? null : (
          <fieldset className="rounded-lg border border-border p-4 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold text-foreground">Link local projects</legend>
            <p className="mb-4 text-xs font-normal leading-5 text-muted-foreground">
              Link each Sentry project to a local VesnALIA checkout to enable the in-app Triage button on its issues.
            </p>
            {localProjectsLoading ? (
              <p className="text-sm text-muted-foreground">Loading local VesnALIA projects…</p>
            ) : localProjectsError !== null ? (
              <p role="alert" className="text-sm text-destructive">Local projects unavailable: {localProjectsError}</p>
            ) : localProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No local VesnALIA projects found. Add a project with a local checkout, then reopen this form.
              </p>
            ) : (
              <div className="space-y-3">
                {projects.map((projectSlug) => (
                  <label key={projectSlug} className="block text-sm font-medium text-foreground">
                    <span className="font-mono text-xs">{projectSlug}</span>
                    <select
                      aria-label={`Local VesnALIA project for Sentry project ${projectSlug}`}
                      value={projectLinks[projectSlug] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setProjectLinks((current) => ({ ...current, [projectSlug]: value }));
                      }}
                      className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">No local project linked</option>
                      {localProjects.map((localProject) => (
                        <option key={localProject.id} value={localProject.id}>
                          {localProject.name} — {localProject.path}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <label className="block text-sm font-medium text-foreground sm:col-span-2" htmlFor="sentry-connection-base-url">
          Sentry base URL
          <input
            id="sentry-connection-base-url"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
            className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Use https://sentry.io for Sentry Cloud or your self-hosted Sentry URL.
          </span>
        </label>

        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">Issue filters</legend>
          <p className="mb-4 text-xs font-normal leading-5 text-muted-foreground">
            Environment, time range, and query are saved with this connection and control fetched issues. Initial list size only controls visible rows; the page heading summarizes all unresolved cached issues by severity.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-foreground" htmlFor="sentry-connection-environment">
              Environment (optional)
              <input
                id="sentry-connection-environment"
                type="text"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
                placeholder="All environments"
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="block text-sm font-medium text-foreground" htmlFor="sentry-connection-time-range">
              Time range
              <select
                id="sentry-connection-time-range"
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value as SentryFilters["timeRange"])}
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="14d">Last 14 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>

            <label className="block text-sm font-medium text-foreground sm:col-span-2" htmlFor="sentry-connection-query">
              Issue query
              <input
                id="sentry-connection-query"
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="All issues, or e.g. is:unresolved"
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="block text-sm font-medium text-foreground" htmlFor="sentry-connection-limit">
              Initial issues shown
              <select
                id="sentry-connection-limit"
                value={limit}
                onChange={(event) => setLimit(event.target.value as SentryFilters["limit"])}
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </label>
          </div>
        </fieldset>
      </div>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Tokens are stored as secrets and are never sent back to the app. Leave the token blank when editing to keep the existing one.
      </p>

      {error === null ? null : (
        <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {testResult === null ? null : (
        <div role="status" className={"mt-4 rounded-lg border p-3 text-sm " + (
          testResult.ok
            ? "border-accent/40 bg-accent/10 text-accent-foreground"
            : "border-destructive/40 bg-destructive/10 text-destructive"
        )}>
          <p className="font-semibold">
            {testResult.ok ? "Connection test passed" : "Connection test failed"}
          </p>
          <p className="mt-1">
            Organization <span className="font-mono">{testResult.organization.slug}</span>: {testResult.organization.ok ? "available" : testResult.organization.error}
          </p>
          {testResult.warning === null ? null : (
            <p className="mt-1 text-muted-foreground">{testResult.warning}</p>
          )}
          <ul className="mt-2 space-y-1">
            {testResult.projects.map((project) => (
              <li key={project.slug}>
                <span className="font-mono">{project.slug}</span>: {project.ok ? "available" : project.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void test()}
          disabled={saving || testing || discovering || removing}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button
          type="submit"
          disabled={saving || testing || discovering || removing}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Saving…" : connection === undefined ? "Add connection" : "Save connection"}
        </button>
        {connection === undefined || onRemoved === undefined ? null : (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={saving || testing || discovering || removing}
            className="rounded-md border border-destructive/50 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-60"
          >
            {removing ? "Removing…" : "Remove connection"}
          </button>
        )}
        {onCancel === undefined ? null : (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving || testing || discovering || removing}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ConnectionsSettingsSection() {
  const state = useConnections();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const editingConnection = editing === null || editing === "new"
    ? undefined
    : state.connections?.find((connection) => connection.id === editing);

  useEffect(() => {
    if (editing !== null && editing !== "new" && state.connections !== null && editingConnection === undefined) {
      setEditing(null);
    }
  }, [editing, editingConnection, state.connections]);

  const onConnectionsChanged = useCallback(() => {
    void state.refresh();
  }, [state.refresh]);
  useRealtime("connections-changed", onConnectionsChanged);

  const saveComplete = async () => {
    setEditing(null);
    await state.refresh();
  };

  const removeComplete = async () => {
    setEditing(null);
    await state.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {state.connections === null
            ? "Loading connections…"
            : `${state.connections.length} connection${state.connections.length === 1 ? "" : "s"} configured`}
        </p>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Add connection
        </button>
      </div>

      {state.error === null ? null : (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      {state.connections === null ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Loading…</p>
      ) : state.connections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No Sentry connections yet. Add one here for a personal or work account.
        </p>
      ) : (
        <div className="space-y-3">
          {state.connections.map((connection) => (
            <article key={connection.id} className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-foreground">{connection.label}</h3>
                  <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide " + healthClass(connection)}>
                    {healthLabel(connection)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {connection.orgSlug} · {connection.projectSlugs.length} project{connection.projectSlugs.length === 1 ? "" : "s"}
                </p>
                <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                  {connection.projectSlugs.join(" · ")}
                </p>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Last successful sync: {healthTime(connection.health.lastSuccessfulSync)}</p>
                  <p>Last tested: {healthTime(connection.health.lastTestedAt)}</p>
                  {connection.health.lastFailure === null ? null : (
                    <p title={connection.health.lastFailure.message}>
                      Last failure: {healthTime(connection.health.lastFailure.at)} · {connection.health.lastFailure.message}
                    </p>
                  )}
                  {connection.health.failedProjects.length === 0 ? null : (
                    <p>
                      Failed projects: <span className="font-mono">{connection.health.failedProjects.join(", ")}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(connection.id)}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Edit
              </button>
            </article>
          ))}
        </div>
      )}

      {editing === null ? null : (
        <ConnectionForm
          key={editing === "new" ? "new" : connectionEditorKey(editingConnection)}
          connection={editing === "new" ? undefined : editingConnection}
          onSaved={saveComplete}
          onHealthChanged={state.refresh}
          onRemoved={removeComplete}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SetupPage({
  connection,
  error,
  loading,
  refresh,
}: {
  connection?: SentryConnection;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 md:p-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Sentry Issues</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Connect your Sentry projects</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Add a named connection for personal, work, or any other Sentry account. Each connection can include multiple projects.
          </p>
        </div>

        {error === null ? null : (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <ConnectionForm
          key={connectionEditorKey(connection)}
          connection={connection}
          onSaved={refresh}
        />

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="self-start rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Checking…" : "Check connections"}
        </button>
      </div>
    </div>
  );
}

function issueStatusTone(status: string) {
  switch (status.toLowerCase()) {
    case "resolved":
      return {
        dot: "bg-accent",
        text: "text-accent-foreground",
        border: "border-l-accent",
      };
    case "ignored":
      return {
        dot: "bg-muted",
        text: "text-muted-foreground",
        border: "border-l-border",
      };
    default:
      return {
        dot: "bg-destructive",
        text: "text-destructive",
        border: "border-l-destructive",
      };
  }
}

function IssueRow({ issue, onOpen }: { issue: DisplayIssue; onOpen: () => void }) {
  const tone = issueStatusTone(issue.status);
  const aggregated = isAggregatedIssue(issue);
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        className="block w-full cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0 text-left font-inherit transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label={"View Sentry issue " + issue.shortId + ": " + issue.title}
        onClick={onOpen}
      >
        <div className="flex items-start gap-3">
          <span className={"mt-1.5 size-2.5 shrink-0 rounded-full " + tone.dot} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {aggregated ? (
              <p className="mb-1 truncate text-xs font-medium text-muted-foreground" title={issue.connectionLabel + " · " + issue.orgSlug + " / " + issue.projectSlug}>
                {issue.connectionLabel} · <span className="font-mono">{issue.orgSlug} / {issue.projectSlug}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={"font-semibold uppercase tracking-wide " + tone.text}>{issue.status}</span>
              <span className="font-mono text-muted-foreground">{issue.shortId}</span>
              <span className="text-muted-foreground">
                {numberFormatter.format(issue.count)} event{issue.count === 1 ? "" : "s"}
              </span>
            </div>
            <h2 className="mt-2 break-words text-base font-semibold text-foreground">{issue.title}</h2>
            {issue.culprit === null ? null : (
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{issue.culprit}</p>
            )}
          </div>
          <span className="pt-0.5 text-lg leading-none text-muted-foreground" aria-hidden="true">›</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <span>Last seen {formatDate(issue.lastSeen)}</span>
          <span>First seen {formatDate(issue.firstSeen)}</span>
          {issue.environments.length > 0 ? <span>{issue.environments.join(", ")}</span> : null}
        </div>
        {issue.topTags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {issue.topTags.map((tag) => (
              <span
                key={`${tag.key}:${tag.value}`}
                className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                title={`${tag.key}: ${tag.value}`}
              >
                {tag.key}: {tag.value}
              </span>
            ))}
          </div>
        ) : null}
      </button>
      {issue.permalink === null ? null : (
        <UrlLink
          className="mt-3 inline-block text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
          href={issue.permalink}
          target="_blank"
          rel="noreferrer"
        >
          Open in Sentry ↗
        </UrlLink>
      )}
    </article>
  );
}

function Message({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null;
  mono?: boolean;
}) {
  const displayValue = value === null || String(value).trim() === "" ? "Not set" : String(value);
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={"mt-1 break-words text-sm text-foreground " + (mono ? "font-mono" : "")}>{displayValue}</dd>
    </div>
  );
}

function readableActivityType(value: string): string {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}


function safeJson(value: SentrySafeValue | null): string {
  try {
    return JSON.stringify(value, null, 2) ?? "Unavailable";
  } catch {
    return "Unavailable";
  }
}

function DebugValue({
  label,
  value,
}: {
  label: string;
  value: SentrySafeValue | null;
}) {
  if (value === null) return null;
  return (
    <details className="rounded-lg border border-border/70 bg-muted/20">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">{label}</summary>
      <pre className="max-h-56 overflow-auto border-t border-border/70 px-3 py-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
        {safeJson(value)}
      </pre>
    </details>
  );
}

function EventDebugContext({ event }: { event: SentryEventSummary }) {
  const frameCount = event.exceptions.reduce((count, exception) => count + exception.frames.length, 0);
  return (
    <div className="mt-6 space-y-3 border-t border-border/70 pt-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Debugging context</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Sentry values are normalized, redacted, and bounded before they reach this view.
        </p>
      </div>
      {event.exceptions.length === 0 ? null : (
        <details open className="rounded-lg border border-border/70 bg-muted/20">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
            Exceptions and stack trace · {event.exceptions.length} exception{event.exceptions.length === 1 ? "" : "s"} · {frameCount} frame{frameCount === 1 ? "" : "s"}
          </summary>
          <div className="max-h-96 space-y-3 overflow-auto border-t border-border/70 p-3">
            {event.exceptions.map((exception, exceptionIndex) => (
              <details key={exceptionIndex} open={exceptionIndex === 0} className="rounded-md border border-border/70 bg-background/40">
                <summary className="cursor-pointer px-3 py-2 text-sm text-foreground">
                  {exception.type ?? "Exception"}{exception.value === null ? "" : ": " + exception.value}
                </summary>
                {exception.frames.length === 0 ? (
                  <p className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">No stack frames returned.</p>
                ) : (
                  <ol className="space-y-2 border-t border-border/70 p-3">
                    {[...exception.frames].reverse().map((frame, frameIndex) => {
                      const location = [
                        frame.filename ?? "<unknown>",
                        frame.lineNumber === null ? null : String(frame.lineNumber),
                        frame.columnNumber === null ? null : String(frame.columnNumber),
                      ].filter((value): value is string => value !== null).join(":");
                      const sourceContext = [
                        ...frame.preContext,
                        frame.contextLine,
                        ...frame.postContext,
                      ].filter((value): value is string => value !== null);
                      return (
                        <li key={frameIndex} className="rounded-md border border-border/70 bg-card p-2.5 text-xs">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <code className="break-all font-semibold text-foreground">{location}</code>
                            {frame.function === null ? null : <span className="break-words text-muted-foreground">{frame.function}</span>}
                            {frame.inApp === null ? null : (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {frame.inApp ? "in app" : "dependency"}
                              </span>
                            )}
                          </div>
                          {sourceContext.length === 0 ? null : (
                            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono leading-5 text-muted-foreground">
                              {sourceContext.join("\n")}
                            </pre>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {exception.mechanism === null ? null : (
                  <pre className="max-h-32 overflow-auto border-t border-border/70 px-3 py-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
                    Mechanism: {safeJson(exception.mechanism)}
                  </pre>
                )}
              </details>
            ))}
          </div>
        </details>
      )}
      {event.breadcrumbs.length === 0 ? null : (
        <details className="rounded-lg border border-border/70 bg-muted/20">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
            Breadcrumbs · {event.breadcrumbs.length}
          </summary>
          <ol className="max-h-72 space-y-2 overflow-auto border-t border-border/70 p-3">
            {event.breadcrumbs.map((breadcrumb, index) => (
              <li key={index} className="rounded-md border border-border/70 bg-background/40 p-2.5 text-xs">
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
                  <time>{formatDate(breadcrumb.timestamp)}</time>
                  {breadcrumb.level === null ? null : <span>{breadcrumb.level}</span>}
                  {breadcrumb.category === null ? null : <span className="font-medium text-foreground">{breadcrumb.category}</span>}
                </div>
                {breadcrumb.message === null ? null : <p className="mt-1 break-words whitespace-pre-wrap text-foreground">{breadcrumb.message}</p>}
                {breadcrumb.data === null ? null : (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-muted-foreground">
                    {safeJson(breadcrumb.data)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="space-y-2">
        <DebugValue label="Request" value={event.request} />
        <DebugValue label="Contexts" value={event.contexts} />
        <DebugValue label="User" value={event.user} />
        <DebugValue label="SDK" value={event.sdk} />
        <DebugValue label="Extra data" value={event.extra} />
      </div>
    </div>
  );
}

type IssueBadgeData = {
  count: number;
  severityCounts: Record<IssueBadgeSeverity, number>;
  newIssueCount: number;
  error: boolean;
};

const emptyIssueBadge: IssueBadgeData = {
  count: 0,
  severityCounts: { error: 0, warning: 0, info: 0 },
  newIssueCount: 0,
  error: true,
};

const issueBadgeStore = {
  badge: null as IssueBadgeData | null,
  inFlight: null as Promise<void> | null,
  listeners: new Set<() => void>(),
  refresh: null as (() => Promise<IssueBadgeData>) | null,
  timer: null as number | null,
};

function notifyIssueBadge(): void {
  for (const listener of issueBadgeStore.listeners) listener();
}

function refreshIssueBadge(): Promise<void> {
  const refresh = issueBadgeStore.refresh;
  if (refresh === null) return Promise.resolve();
  if (issueBadgeStore.inFlight !== null) return issueBadgeStore.inFlight;

  let settled!: Promise<void>;
  settled = Promise.resolve()
    .then(refresh)
    .then((badge) => {
      issueBadgeStore.badge = badge;
      notifyIssueBadge();
    })
    .catch(() => {
      issueBadgeStore.badge = emptyIssueBadge;
      notifyIssueBadge();
    })
    .finally(() => {
      if (issueBadgeStore.inFlight === settled) issueBadgeStore.inFlight = null;
    });
  issueBadgeStore.inFlight = settled;
  return settled;
}

function subscribeToIssueBadge(listener: () => void): () => void {
  issueBadgeStore.listeners.add(listener);
  if (issueBadgeStore.listeners.size === 1) {
    void refreshIssueBadge();
    if (typeof window !== "undefined") {
      issueBadgeStore.timer = window.setInterval(() => {
        void refreshIssueBadge();
      }, 60_000);
    }
  }
  return () => {
    issueBadgeStore.listeners.delete(listener);
    if (issueBadgeStore.listeners.size === 0 && issueBadgeStore.timer !== null) {
      if (typeof window !== "undefined") window.clearInterval(issueBadgeStore.timer);
      issueBadgeStore.timer = null;
    }
  };
}

function useIssueBadge(): IssueBadgeData | null {
  const rpc = useRpc<typeof rpcContract>();
  const refresh = useCallback(() => rpc.call("getIssueBadge", null), [rpc]);
  const onConnectionsChanged = useCallback(() => {
    void refreshIssueBadge();
  }, []);

  useRealtime("connections-changed", onConnectionsChanged);
  useRealtime("issues-changed", onConnectionsChanged);
  useEffect(() => {
    issueBadgeStore.refresh = refresh;
    void refreshIssueBadge();
    return () => {
      if (issueBadgeStore.refresh === refresh) issueBadgeStore.refresh = null;
    };
  }, [refresh]);

  return useSyncExternalStore(
    subscribeToIssueBadge,
    () => issueBadgeStore.badge,
    () => null,
  );
}

function IssueBadge() {
  const badge = useIssueBadge();

  if (badge === null) {
    return (
      <span
        aria-label="Sentry Issues is loading"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
        title="Sentry Issues is loading"
      >
        …
      </span>
    );
  }

  const countLabel = badge.count + " unresolved Sentry issue" + (badge.count === 1 ? "" : "s") +
    " across configured Sentry projects";
  const severityEntries = issueBadgeEntries(badge.severityCounts);
  const severityLabel = severityEntries
    .map(({ severity, count }) => `${severityLabels[severity]}: ${count}`)
    .join(", ");
  const accessibleLabel = `${countLabel} by severity: ${severityLabel}`;
  return (
    <span
      aria-label={badge.error ? accessibleLabel + "; sync needs attention" : accessibleLabel}
      className="inline-flex max-w-full flex-wrap items-center gap-2"
      title={badge.error ? accessibleLabel + "; sync needs attention" : accessibleLabel}
    >
      {severityEntries.map(({ severity, count }) => {
        const SeverityIcon = severityIcons[severity];
        return (
          <span
            key={severity}
            className={
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold leading-none " +
              severityBadgeClasses[severity] +
              (count === 0 ? " opacity-75" : "")
            }
            title={`${severityLabels[severity]}: ${count}`}
          >
            <SeverityIcon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
            <span>{severityLabels[severity]}</span>
            <span className="tabular-nums">{count > 99 ? "99+" : count}</span>
          </span>
        );
      })}
      {badge.error ? <span aria-hidden="true" className="px-px text-destructive">!</span> : null}
    </span>
  );
}

function NewIssueBadge() {
  const badge = useIssueBadge();
  if (badge === null || badge.newIssueCount === 0) return null;

  const accessibleLabel =
    "New Sentry issues detected since last sync" +
    (badge.error ? "; sync needs attention" : "");
  return (
    <span
      aria-label={accessibleLabel}
      className={
        "inline-flex h-5 max-w-full shrink-0 items-center gap-0.5 rounded-md px-1 text-[10px] font-semibold leading-none tracking-tight ring-1 ring-inset " +
        (badge.error
          ? "bg-primary/10 text-primary ring-primary/30"
          : "bg-accent/15 text-accent-foreground ring-accent/30")
      }
      title={accessibleLabel}
    >
      <Sparkles aria-hidden="true" className="size-3 shrink-0" strokeWidth={2.25} />
      <span>New</span>
    </span>
  );
}

function IssuesPage({
  connections,
  refreshConnections,
  connectionError,
  onOpenIssue,
}: {
  connections: SentryConnection[];
  refreshConnections: () => Promise<void>;
  connectionError: string | null;
  onOpenIssue: (connection: SentryConnection, projectSlug: string, issue: SentryIssue) => void;
}) {
  const [activeConnectionId, setActiveConnectionId] = useState(connections[0]?.id ?? "");
  const [allProjectsSelected, setAllProjectsSelected] = useState(false);
  const [projectSlug, setProjectSlug] = useState(connections[0]?.projectSlugs[0] ?? "");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<IssueStatusFilter>(defaultIssueStatusFilter);
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [displayLimit, setDisplayLimit] = useState(Number.parseInt(defaultFilters.limit, 10));
  const selectedConnection = allProjectsSelected
    ? undefined
    : connections.find((connection) => connection.id === activeConnectionId) ?? connections[0];
  const selectedProjectSlug = allProjectsSelected
    ? null
    : selectedConnection?.projectSlugs.includes(projectSlug) === true
      ? projectSlug
      : null;
  const issueScope: IssueScope | null = allProjectsSelected
    ? { kind: "all" }
    : selectedConnection?.configured === true && selectedProjectSlug !== null
      ? { kind: "target", connectionId: selectedConnection.id, projectSlug: selectedProjectSlug }
      : null;
  const issues = useIssues(issueScope);
  const environmentOptions = Array.from(new Set(
    issues.issues?.flatMap((issue) => issue.environments) ?? [],
  )).sort((a, b) => a.localeCompare(b));
  const normalizedSearch = search.trim().toLowerCase();
  const filteredIssues = issues.issues?.filter((issue) => {
    const status = issue.status.toLowerCase();
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (environmentFilter !== "all" && !issue.environments.includes(environmentFilter)) return false;
    if (normalizedSearch === "") return true;
    const sourceTerms = isAggregatedIssue(issue)
      ? [issue.connectionLabel, issue.orgSlug, issue.projectSlug]
      : [];
    const searchable = [
      issue.id,
      issue.title,
      issue.shortId,
      issue.culprit ?? "",
      ...sourceTerms,
      ...issue.environments,
      ...issue.topTags.flatMap((tag) => [tag.key, tag.value]),
    ].join(" ").toLowerCase();
    return searchable.includes(normalizedSearch);
  }) ?? null;
  const visibleIssues = filteredIssues?.slice(0, displayLimit) ?? [];
  const canShowMoreCached = filteredIssues !== null && filteredIssues.length > displayLimit;
  const canLoadMore = canShowMoreCached || issues.hasMore;
  const hasListFilters = normalizedSearch !== "" || statusFilter !== "all" || environmentFilter !== "all";
  const activeIssueCount = visibleIssues.filter((issue) => {
    const status = issue.status.toLowerCase();
    return status !== "resolved" && status !== "ignored";
  }).length;
  const visibleEventCount = visibleIssues.reduce((total, issue) => total + issue.count, 0);


  useEffect(() => {
    if (allProjectsSelected || connections.some((connection) => connection.id === activeConnectionId)) return;
    const first = connections[0];
    if (first === undefined) return;
    setActiveConnectionId(first.id);
    setProjectSlug(first.projectSlugs[0] ?? "");
  }, [activeConnectionId, allProjectsSelected, connections]);

  useEffect(() => {
    if (allProjectsSelected || selectedConnection?.projectSlugs.includes(projectSlug) === true) return;
    setProjectSlug(selectedConnection?.projectSlugs[0] ?? "");
  }, [allProjectsSelected, projectSlug, selectedConnection]);

  useEffect(() => {
    setDisplayLimit(allProjectsSelected
      ? Number.parseInt(defaultFilters.limit, 10)
      : Number.parseInt(selectedConnection?.filters.limit ?? defaultFilters.limit, 10));
  }, [allProjectsSelected, selectedConnection?.filters.limit]);

  useEffect(() => {
    setSearch("");
    setStatusFilter(defaultIssueStatusFilter);
    setEnvironmentFilter("all");
  }, [activeConnectionId, allProjectsSelected, selectedProjectSlug]);

  const saveComplete = async () => {
    setEditing(null);
    await refreshConnections();
  };

  const removeComplete = async () => {
    setEditing(null);
    await refreshConnections();
  };

  const editingConnection = editing === null || editing === "new"
    ? undefined
    : connections.find((connection) => connection.id === editing);
  const showEditor = editing === "new" || editingConnection !== undefined;

  useEffect(() => {
    if (editing !== null && editing !== "new" && editingConnection === undefined) {
      setEditing(null);
    }
  }, [editing, editingConnection]);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Sentry</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Issues</h1>
              <IssueBadge />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {allProjectsSelected
                ? "Every configured connection and project"
                : selectedConnection === undefined
                  ? "Choose a connection to get started."
                  : selectedConnection.label + " · " + selectedConnection.orgSlug + " / " + (selectedProjectSlug ?? "no project")}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Add connection
            </button>
            <button
              type="button"
              onClick={() => selectedConnection === undefined ? undefined : setEditing(selectedConnection.id)}
              disabled={selectedConnection === undefined}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Edit connection
            </button>
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-2 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="sentry-active-connection">
              Connection
              <select
                id="sentry-active-connection"
                value={allProjectsSelected ? ALL_PROJECTS_VALUE : selectedConnection?.id ?? ""}
                onChange={(event) => {
                  if (event.target.value === ALL_PROJECTS_VALUE) {
                    setAllProjectsSelected(true);
                    setEditing(null);
                    return;
                  }
                  const next = connections.find((connection) => connection.id === event.target.value);
                  setAllProjectsSelected(false);
                  setActiveConnectionId(event.target.value);
                  setProjectSlug(next?.projectSlugs[0] ?? "");
                  setEditing(null);
                }}
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                <option value={ALL_PROJECTS_VALUE}>All projects</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.label} — {connection.orgSlug} ({healthLabel(connection).toLowerCase()})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-muted-foreground" htmlFor="sentry-active-project">
              Project
              <select
                id="sentry-active-project"
                value={allProjectsSelected ? "" : selectedProjectSlug ?? ""}
                onChange={(event) => setProjectSlug(event.target.value)}
                disabled={allProjectsSelected || selectedConnection?.projectSlugs.length === 0}
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">{allProjectsSelected ? "All configured projects" : "Choose a project"}</option>
                {selectedConnection?.projectSlugs.map((project) => (
                  <option key={project} value={project}>{project}</option>
                ))}
              </select>
            </label>

        </div>

        {allProjectsSelected ? (
          <section aria-label="All projects sync status" className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">All projects inbox</h2>
              <span className="text-xs text-muted-foreground">
                {connections.length} connection{connections.length === 1 ? "" : "s"} · {issues.issues?.length ?? 0} cached issues
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {issues.complete
                ? "Every configured target has a complete cached snapshot."
                : issues.hasMore
                  ? "Some targets have more issues available. Load more to extend the local snapshots."
                  : "Some targets are incomplete or unavailable. Refresh and resolve the connection attention state."}
            </p>
          </section>
        ) : null}
        {selectedConnection === undefined ? null : (
          <section aria-label="Sentry connection health" className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Connection health</h2>
              <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide " + healthClass(selectedConnection)}>
                {healthLabel(selectedConnection)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Last successful sync: {healthTime(selectedConnection.health.lastSuccessfulSync)}</span>
              <span>Last tested: {healthTime(selectedConnection.health.lastTestedAt)}</span>
              {selectedConnection.health.failedProjects.length === 0 ? null : (
                <span>Failed projects: <span className="font-mono">{selectedConnection.health.failedProjects.join(", ")}</span></span>
              )}
              {selectedConnection.health.lastFailure === null ? null : (
                <span title={selectedConnection.health.lastFailure.message}>
                  Last failure: {healthTime(selectedConnection.health.lastFailure.at)} · {selectedConnection.health.lastFailure.message}
                </span>
              )}
            </div>
          </section>
        )}

        {!allProjectsSelected && selectedConnection?.configured !== true ? null : (
          <section aria-label="Filter Sentry issues" className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Find issues</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {allProjectsSelected
                    ? "Search cached issues from every configured connection and project."
                    : "Search the saved snapshot, then narrow it by status or environment."}
                </p>
              </div>
              {hasListFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                    setEnvironmentFilter("all");
                  }}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="block sm:col-span-2">
                <label className="block text-sm font-medium text-foreground" htmlFor="sentry-issue-search">
                  Search
                </label>
                <input
                  id="sentry-issue-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title, ID, culprit, tag…"
                  className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <label className="block text-sm font-medium text-foreground" htmlFor="sentry-issue-status-filter">
                Status
                <select
                  id="sentry-issue-status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as IssueStatusFilter)}
                  className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="all">All statuses</option>
                  <option value="unresolved">Unresolved</option>
                  <option value="resolved">Resolved</option>
                  <option value="ignored">Ignored</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-foreground" htmlFor="sentry-issue-environment-filter">
                Environment
                <select
                  id="sentry-issue-environment-filter"
                  value={environmentFilter}
                  onChange={(event) => setEnvironmentFilter(event.target.value)}
                  className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="all">All environments</option>
                  {environmentOptions.map((environment) => (
                    <option key={environment} value={environment}>{environment}</option>
                  ))}
                </select>
              </label>
            </div>
            {issues.issues === null ? null : (
              <p className="mt-3 text-xs text-muted-foreground">
                {hasListFilters
                  ? `${visibleIssues.length} of ${issues.issues.length} loaded issues shown`
                  : `${visibleIssues.length} of ${issues.issues.length} loaded issues`}
              </p>
            )}
          </section>
        )}

        {connectionError === null ? null : (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {connectionError}
          </div>
        )}

        {showEditor ? (
          <ConnectionForm
            key={editing === "new" ? "new" : connectionEditorKey(editingConnection)}
            connection={editing === "new" ? undefined : editingConnection}
            onSaved={saveComplete}
            onHealthChanged={refreshConnections}
            onRemoved={removeComplete}
            onCancel={() => setEditing(null)}
          />
        ) : null}

        {!allProjectsSelected && selectedConnection?.configured !== true ? (
          showEditor ? null : (
            <ConnectionForm
              key={`setup-${connectionEditorKey(selectedConnection)}`}
              connection={selectedConnection}
              onSaved={saveComplete}
            />
          )
        ) : (
          <>
            {issues.issues === null ? null : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-card px-3 py-3">
                  <p className="text-xs text-muted-foreground">Issues shown</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{visibleIssues.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-3">
                  <p className="text-xs text-muted-foreground">Active</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{activeIssueCount}</p>
                </div>
                <div className="col-span-2 rounded-lg border border-border bg-card px-3 py-3 sm:col-span-1">
                  <p className="text-xs text-muted-foreground">Events shown</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{numberFormatter.format(visibleEventCount)}</p>
                </div>
              </div>
            )}

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {issues.fetchedAt === null ? null : (
                  <p className="text-xs text-muted-foreground">
                    {issues.fromCache ? "Local snapshot" : "Synced"} · {formatDate(issues.fetchedAt)}
                    {!issues.complete ? (
                      <span className="ml-2">
                        {issues.hasMore ? "More issues available" : "Snapshot incomplete"}
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {canLoadMore ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (canShowMoreCached) {
                        setDisplayLimit((current) => current + Number.parseInt(selectedConnection?.filters.limit ?? defaultFilters.limit, 10));
                        return;
                      }
                      void issues.loadMore().then((loaded) => {
                        if (loaded) {
                          setDisplayLimit((current) => current + Number.parseInt(selectedConnection?.filters.limit ?? defaultFilters.limit, 10));
                        }
                      });
                    }}
                    disabled={issues.loading}
                    className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                  >
                    {issues.loading ? "Loading…" : canShowMoreCached ? "Show more" : "Load more"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void issues.refresh(true)}
                  disabled={issues.loading}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                >
                  {issues.loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            {issues.error === null ? null : (
              <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {issues.error}
              </div>
            )}
            {issues.warning === null ? null : (
              <div role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
                Showing the last saved issue snapshot. Sync warning: {issues.warning}
              </div>
            )}
            {issues.issues !== null && !issues.complete && !issues.hasMore ? (
              <div role="status" className="rounded-xl border border-border bg-muted/60 p-4 text-sm text-muted-foreground">
                This cached snapshot is incomplete. Refresh to retry synchronization.
              </div>
            ) : null}

            {issues.issues === null ? (
              <Message>{issues.loading ? "Loading Sentry issues…" : "No issue data yet."}</Message>
            ) : issues.issues.length === 0 ? (
              <Message>No issues matched the configured query.</Message>
            ) : visibleIssues.length === 0 ? (
              <Message>No issues match these filters.</Message>
            ) : (
              <div className="space-y-3">
                {visibleIssues.map((issue) => {
                  const sourceConnection = isAggregatedIssue(issue)
                    ? connections.find((connection) => connection.id === issue.connectionId)
                    : selectedConnection;
                  const sourceProjectSlug = isAggregatedIssue(issue) ? issue.projectSlug : selectedProjectSlug;
                  if (sourceConnection === undefined || sourceProjectSlug === null) return null;
                  return (
                    <IssueRow
                      key={issueSubPath(sourceConnection.id, sourceProjectSlug, issue.id)}
                      issue={issue}
                      onOpen={() => onOpenIssue(sourceConnection, sourceProjectSlug, issue)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IssueDetailPage({
  connection,
  projectSlug,
  issueId,
  onBack,
}: {
  connection: SentryConnection;
  projectSlug: string;
  issueId: string;
  onBack: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useAliaNavigate();
  const { projects: localProjects } = useLocalProjects();
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const detailData = useIssueDetail(connection.id, projectSlug, issueId);
  const linkedProjectId = connection.projectLinks.find((link) => link.projectSlug === projectSlug)?.localProjectId ?? null;
  const linkedProject = localProjects.find((project) => project.id === linkedProjectId) ?? null;
  const issue = detailData.issue;
  const detailedIssue = detailData.issue;
  const recentEvents = detailedIssue?.events ?? [];
  const latestEvent = detailedIssue?.latestEvent ?? null;
  const fetchedAt = detailData.fetchedAt;
  const fromCache = detailData.fromCache;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const selectedEventSummary = selectedEventId === null
    ? latestEvent ?? recentEvents[0] ?? null
    : recentEvents.find((event) => event.id === selectedEventId) ??
      (latestEvent?.id === selectedEventId ? latestEvent : null);
  const selectedEventFetchId = selectedEventId !== null && selectedEventId !== latestEvent?.id
    ? selectedEventId
    : null;
  const selectedEventData = useIssueEvent(
    connection.id,
    projectSlug,
    issueId,
    selectedEventFetchId,
  );
  const triageThreads = useTriageThreads(connection.id, projectSlug, issueId);
  const firstRelease = detailedIssue?.firstRelease ?? null;
  const lastRelease = detailedIssue?.lastRelease ?? null;

  useEffect(() => {
    const availableIds = recentEvents.map((event) => event.id);
    const fallbackId = latestEvent?.id ?? recentEvents[0]?.id ?? null;
    setSelectedEventId((current) =>
      current !== null && (current === latestEvent?.id || availableIds.includes(current))
        ? current
        : fallbackId,
    );
  }, [detailedIssue?.id, latestEvent?.id, recentEvents]);



  if (issue === null) {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Sentry issues"
            className="self-start rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Back to issues
          </button>
          {detailData.error === null ? null : (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {detailData.error}
            </div>
          )}
          <Message>
            {detailData.loading
              ? "Loading the Sentry issue…"
              : "This issue could not be loaded from Sentry."}
          </Message>
        </div>
      </div>
    );
  }

  const tone = issueStatusTone(issue.status);
  const selectedEvent = selectedEventData.event ?? selectedEventSummary;
  const triage = async (newRun = false) => {
    if (linkedProjectId === null) return;
    if (newRun || triageThreads.threads.length === 0) {
      const prompt = newRun
        ? "Start a new AI triage thread for this issue? Existing linked threads will be kept. VesnALIA will ask for approval before any file changes."
        : "Start an AI triage thread for this issue? It will inspect the linked local project and VesnALIA will ask for approval before any file changes.";
      if (!window.confirm(prompt)) return;
    }
    setTriageLoading(true);
    setTriageError(null);
    try {
      const result = await rpc.call("triageIssue", {
        connectionId: connection.id,
        projectSlug,
        issueId,
        ...(newRun ? { newRun: true } : {}),
      });
      await triageThreads.refresh();
      navigate.toThread(result.threadId);
    } catch (cause) {
      setTriageError(errorMessage(cause));
    } finally {
      setTriageLoading(false);
    }
  };


  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Sentry issues"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Back to issues
          </button>
          <span className="min-w-0 flex-1 truncate" title={connection.label + " · " + projectSlug}>
            {connection.label} · <span className="font-mono">{projectSlug}</span>
          </span>
          {linkedProjectId === null ? (
            <span
              className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
              title="Edit the Sentry connection to link this project to a local VesnALIA checkout"
            >
              Link a local project to enable triage
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void triage()}
                disabled={triageLoading}
                title={linkedProject === null ? "Start triage in the linked local VesnALIA project" : "Open the linked triage thread in " + linkedProject.name}
                className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              >
                {triageLoading ? "Opening…" : triageThreads.threads.length > 0 ? "Open triage" : "Start triage"}
              </button>
              {triageThreads.threads.length === 0 ? null : (
                <button
                  type="button"
                  onClick={() => void triage(true)}
                  disabled={triageLoading}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                >
                  New triage run
                </button>
              )}
            </div>
          )}
          {issue.permalink === null ? null : (
            <UrlLink
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              href={issue.permalink}
              target="_blank"
              rel="noreferrer"
            >
              Open in Sentry
            </UrlLink>
          )}
          <button
            type="button"
            onClick={() => {
              void detailData.refresh(true);
            }}
            disabled={detailData.loading}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            {detailData.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {detailData.warning === null ? null : (
          <div role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
            Showing the last saved issue detail. Refresh failed: {detailData.warning}
          </div>
        )}
        {detailData.error === null ? null : (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Issue detail unavailable: {detailData.error}
          </div>
        )}
        {detailData.error === null ? null : (
          <div role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
            Additional Sentry details are unavailable: {detailData.error}
          </div>
        )}
        {detailData.warning === null ? null : (
          <div role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
            Some event details are unavailable: {detailData.warning}
          </div>
        )}
        {triageError === null ? null : (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Could not start triage: {triageError}
          </div>
        )}

        {selectedEventData.error === null ? null : (
          <div role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
            Selected event detail is unavailable: {selectedEventData.error}
          </div>
        )}
        {selectedEventData.warning === null ? null : (
          <div role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
            Showing the selected event summary. Detailed context could not be loaded: {selectedEventData.warning}
          </div>
        )}
        {triageThreads.error === null ? null : (
          <div role="alert" className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
            Related triage threads are unavailable: {triageThreads.error}
          </div>
        )}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Related VesnALIA triage threads</h2>
            <span className="text-xs text-muted-foreground">
              {triageThreads.loading ? "Loading…" : triageThreads.threads.length + " linked"}
            </span>
          </div>
          {triageThreads.threads.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No triage thread is linked yet. Start triage after confirming the local project link.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border/70 rounded-lg border border-border/70">
              {triageThreads.threads.map((thread) => (
                <li key={thread.threadId}>
                  <button
                    type="button"
                    onClick={() => navigate.toThread(thread.threadId)}
                    className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {thread.title ?? thread.threadId}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                        {thread.threadId}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      <span className="block">{thread.status ?? "linked"}</span>
                      <time className="mt-1 block">{formatDate(thread.createdAt)}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={"overflow-hidden rounded-xl border border-border border-l-4 bg-card shadow-sm " + tone.border}>
          <div className="border-b border-border/70 bg-muted/20 px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={"inline-flex items-center gap-2 font-semibold uppercase tracking-wide " + tone.text}>
                <span className={"size-2.5 rounded-full " + tone.dot} aria-hidden="true" />
                {issue.status}
              </span>
              <span className="font-mono text-muted-foreground">{issue.shortId}</span>
            </div>
          </div>
          <div className="p-5">
            <h1 className="max-w-3xl break-words text-2xl font-semibold tracking-tight text-foreground">
              {issue.title}
            </h1>
            {issue.culprit === null ? null : (
              <p className="mt-2 max-w-3xl break-words font-mono text-sm text-muted-foreground">{issue.culprit}</p>
            )}
            <dl className="mt-6 grid gap-x-4 gap-y-5 border-t border-border/70 pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Events</dt>
                <dd className="mt-1 text-foreground">
                  {numberFormatter.format(issue.count)} event{issue.count === 1 ? "" : "s"}
                </dd>
              </div>
              {detailedIssue === null ? null : (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Users affected</dt>
                  <dd className="mt-1 text-foreground">{numberFormatter.format(detailedIssue.userCount)}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last seen</dt>
                <dd className="mt-1 text-foreground">{formatDate(issue.lastSeen)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">First seen</dt>
                <dd className="mt-1 text-foreground">{formatDate(issue.firstSeen)}</dd>
              </div>
            </dl>
            {fetchedAt === null ? null : (
              <p className="mt-6 text-xs text-muted-foreground">
                {fromCache ? "Local snapshot" : "Synced"} · {formatDate(fetchedAt)}
              </p>
            )}
          </div>
        </section>

        {detailedIssue === null && detailData.loading ? (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Loading additional Sentry details…
          </div>
        ) : null}

        {detailedIssue === null ? null : (
          <>
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Issue details</h2>
              <dl className="mt-4 grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Level" value={detailedIssue.level} />
                <DetailField label="Priority" value={detailedIssue.priority} />
                <DetailField label="Platform" value={detailedIssue.platform} />
                <DetailField label="Type" value={detailedIssue.issueType ?? detailedIssue.issueCategory} />
                <DetailField label="Project" value={detailedIssue.projectName ?? detailedIssue.projectSlug} mono />
                <DetailField label="Assigned to" value={detailedIssue.assignedTo} />
                <DetailField label="Users affected" value={detailedIssue.userCount} />
                <DetailField label="Comments" value={detailedIssue.numComments} />
                <DetailField label="User reports" value={detailedIssue.userReportCount} />
                <DetailField label="Substatus" value={detailedIssue.substatus} />
                <DetailField label="Logger" value={detailedIssue.logger} mono />
              </dl>
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
              <section className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Event debugging context</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Latest event summary with bounded diagnostic context</p>
                  </div>
                  {selectedEvent === null ? null : (
                    <span className="max-w-full truncate font-mono text-xs text-muted-foreground" title={selectedEvent.id}>
                      {selectedEvent.id}
                    </span>
                  )}
                </div>
                {recentEvents.length > 1 ? (
                  <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="sentry-recent-event">
                    Recent event
                    <select
                      id="sentry-recent-event"
                      value={selectedEvent?.id ?? ""}
                      onChange={(event) => setSelectedEventId(event.target.value || null)}
                      className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      {recentEvents.map((event) => (
                        <option key={event.id} value={event.id}>
                          {formatDate(event.timestamp)} · {event.title ?? event.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {selectedEventData.loading ? (
                  <p role="status" className="mt-3 text-xs text-muted-foreground">Loading selected event context…</p>
                ) : null}
                {selectedEvent === null ? (
                  <p className="mt-4 text-sm text-muted-foreground">No event summary was returned.</p>
                ) : (
                  <>
                    <h3 className="mt-4 break-words text-base font-semibold text-foreground">
                      {selectedEvent.title ?? "Selected event"}
                    </h3>
                    {selectedEvent.message === null || selectedEvent.message === selectedEvent.title ? null : (
                      <p className="mt-2 break-words whitespace-pre-wrap font-mono text-sm text-muted-foreground">
                        {selectedEvent.message}
                      </p>
                    )}
                    <dl className="mt-5 grid gap-x-4 gap-y-5 border-t border-border/70 pt-5 sm:grid-cols-2">
                      <DetailField label="Received" value={formatDate(selectedEvent.timestamp)} />
                      <DetailField label="Environment" value={selectedEvent.environment} />
                      <DetailField label="Platform" value={selectedEvent.platform} />
                      <DetailField label="Release" value={selectedEvent.release} mono />
                      <DetailField label="Location" value={selectedEvent.location} mono />
                      <DetailField label="Event type" value={selectedEvent.type} />
                    </dl>
                    {selectedEvent.metadataType === null && selectedEvent.metadataValue === null ? null : (
                      <div className="mt-5 border-t border-border/70 pt-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {selectedEvent.metadataType ?? "Event metadata"}
                        </p>
                        <p className="mt-2 max-h-32 overflow-auto break-words whitespace-pre-wrap font-mono text-sm text-foreground">
                          {selectedEvent.metadataValue ?? "No value"}
                        </p>
                      </div>
                    )}
                    {selectedEvent.tags.length === 0 ? null : (
                      <div className="mt-5 border-t border-border/70 pt-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Event tags</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {selectedEvent.tags.map((tag) => (
                            <span
                              key={tag.key + ":" + tag.value}
                              className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                              title={tag.key + ": " + tag.value}
                            >
                              {tag.key}: {tag.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <EventDebugContext event={selectedEvent} />
                  </>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold text-foreground">Releases</h2>
                <dl className="mt-4 space-y-5">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">First release</dt>
                    <dd className="mt-1 break-words font-mono text-sm text-foreground">
                      {firstRelease?.shortVersion ?? firstRelease?.version ?? "Not set"}
                    </dd>
                    {firstRelease?.dateCreated ? (
                      <p className="mt-1 text-xs text-muted-foreground">Created {formatDate(firstRelease.dateCreated)}</p>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last release</dt>
                    <dd className="mt-1 break-words font-mono text-sm text-foreground">
                      {lastRelease?.shortVersion ?? lastRelease?.version ?? "Not set"}
                    </dd>
                    {lastRelease?.dateCreated ? (
                      <p className="mt-1 text-xs text-muted-foreground">Created {formatDate(lastRelease.dateCreated)}</p>
                    ) : null}
                  </div>
                </dl>
              </section>
            </div>

            {detailedIssue.activity.length === 0 ? null : (
              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold text-foreground">Activity</h2>
                <ol className="mt-3 divide-y divide-border/70">
                  {detailedIssue.activity.map((activity) => (
                    <li key={activity.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="size-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{readableActivityType(activity.type)}</p>
                        <time className="mt-0.5 block text-xs text-muted-foreground">
                          {formatDate(activity.dateCreated)}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Environments</h2>
            {issue.environments.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No environment recorded.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {issue.environments.map((environment) => (
                  <div key={environment} className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                    <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-mono text-sm text-foreground">{environment}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Tags</h2>
            {issue.topTags.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No tags recorded.</p>
            ) : (
              <dl className="mt-3 divide-y divide-border/70 rounded-lg border border-border/70">
                {issue.topTags.map((tag) => (
                  <div key={tag.key + ":" + tag.value} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] sm:gap-4">
                    <dt className="truncate text-muted-foreground" title={tag.key}>{tag.key}</dt>
                    <dd className="break-words text-foreground" title={tag.value}>{tag.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

      </div>
    </div>
  );
}

function PluginPage({ subPath }: { subPath: string }) {
  const navigate = useAliaNavigate();
  const state = useConnections();
  const route = parseIssueRoute(subPath);
  if (state.connections === null || state.connections.length === 0) {
    return (
      <SetupPage
        {...state}
      />
    );
  }
  if (route.view === "issue") {
    const connection = state.connections.find((item) => item.id === route.connectionId);
    if (connection !== undefined && connection.configured && connection.projectSlugs.includes(route.projectSlug)) {
      return (
        <IssueDetailPage
          connection={connection}
          projectSlug={route.projectSlug}
          issueId={route.issueId}
          onBack={() => navigate.toPluginPanel("issues", { subPath: "" })}
        />
      );
    }
  }
  return (
    <IssuesPage
      connections={state.connections}
      refreshConnections={state.refresh}
      connectionError={state.error}
      onOpenIssue={(connection, projectSlug, issue) => {
        navigate.toPluginPanel("issues", {
          subPath: issueSubPath(connection.id, projectSlug, issue.id),
        });
      }}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "connections",
    title: "Connections",
    description: "Add and manage personal, work, and other Sentry accounts without editing stored configuration.",
    component: ConnectionsSettingsSection,
  });
  app.slots.navPanel({
    id: "issues",
    title: "Sentry Issues",
    icon: "Bug",
    path: "issues",
    component: PluginPage,
    experimental_sidebarAccessory: NewIssueBadge,
  });
});
