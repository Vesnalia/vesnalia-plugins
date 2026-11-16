// alia-plugin-linear-card — a thread header chip showing the thread's Linear
// card. Clicking it opens the card, or, when nothing is linked, an explorer of
// the viewer's assigned issues where one can be linked to the thread.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Markdown,
  definePluginApp,
  useAliaNavigate,
  useRealtime,
  useRpc,
} from "@vesnalia/plugin-sdk/app";
import type { PluginRpcClient, PluginThreadHeaderActionProps } from "@vesnalia/plugin-sdk/app";
import type { IssueDetail, IssueSummary, Team, ThreadCard, rpcContract } from "./server";
import { CARD_CHANGED, ENABLED_PROJECTS_CHANGED } from "./shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Rpc = PluginRpcClient<typeof rpcContract>;

// Linear's own workflow order: in progress first, finished last.
const STATE_GROUPS = [
  { type: "started", label: "In progress" },
  { type: "unstarted", label: "Todo" },
  { type: "triage", label: "Triage" },
  { type: "backlog", label: "Backlog" },
  { type: "completed", label: "Done" },
  { type: "canceled", label: "Canceled" },
] as const;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function StateDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** Linear's logomark (Simple Icons, CC0); inherits the text color. */
function LinearLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-3.5 shrink-0", className)} fill="currentColor">
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  );
}

/**
 * Linear's workflow-state glyph: the shape says the state type (dashed =
 * backlog, empty = todo/triage, half = in progress, check = done, cross =
 * canceled) and the color is the team's color for that exact state.
 */
function StateIcon({ state }: { state: { name: string; type: string; color: string } }) {
  const { type, color } = state;
  const ring =
    type === "backlog" ? (
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="1.4 1.6" />
    ) : (
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
    );
  let inner = null;
  if (type === "started") inner = <path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill={color} />;
  if (type === "completed" || type === "canceled") {
    inner = (
      <>
        <circle cx="7" cy="7" r="6.25" fill={color} />
        <path
          d={type === "completed" ? "M4.3 7.2 6.1 9l3.6-3.8" : "M4.8 4.8l4.4 4.4M9.2 4.8 4.8 9.2"}
          fill="none"
          stroke="var(--background, #fff)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  }
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" role="img" aria-label={state.name}>
      <title>{state.name}</title>
      {type === "completed" || type === "canceled" ? null : ring}
      {inner}
    </svg>
  );
}

// Linear attachments need the API key; the plugin's /upload route adds it.
const LINEAR_UPLOAD_URL = /https:\/\/uploads\.linear\.app\/[^\s)"'<>\]]+/gu;

function Unconfigured() {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>Linear Card needs a Linear personal API key.</p>
      <p>
        Add it in Settings → Plugins → Linear Card, or run{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">alia plugin config linear-card set apiKey</code>.
      </p>
    </div>
  );
}

function IssueMeta({ issue }: { issue: IssueSummary | IssueDetail }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <StateIcon state={issue.state} />
        {issue.state.name}
      </span>
      {issue.priority > 0 ? <span>{issue.priorityLabel}</span> : null}
      {issue.project ? <span>{issue.project.name}</span> : null}
      {"assignee" in issue && issue.assignee ? <span>{issue.assignee.name}</span> : null}
      {"labels" in issue
        ? issue.labels.nodes.map((label) => (
            <span key={label.name} className="flex items-center gap-1">
              <StateDot color={label.color} className="size-1.5" />
              {label.name}
            </span>
          ))
        : null}
    </div>
  );
}

function Description({ issue }: { issue: IssueDetail }) {
  return issue.description?.trim() ? (
    <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border p-3 text-sm">
      <Markdown
        content={issue.description.replace(
          LINEAR_UPLOAD_URL,
          (url) => `${window.location.origin}/api/v1/plugins/linear-card/http/upload?u=${encodeURIComponent(url)}`,
        )}
      />
    </div>
  ) : (
    <p className="text-sm italic text-muted-foreground">No description.</p>
  );
}

/** The thread's current card, with actions to open, change, or unlink it. */
function CardView({
  card,
  rpc,
  threadId,
  onChange,
}: {
  card: Extract<ThreadCard, { status: "card" }>;
  rpc: Rpc;
  threadId: string;
  onChange: () => void;
}) {
  const navigate = useAliaNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { issue } = card;

  async function unlink() {
    setBusy(true);
    try {
      await rpc.call("unlink_card", { threadId });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogDescription className="text-xs">
          {issue.identifier}
          {card.source === "branch" ? ` · detected from branch ${card.branchName}` : " · linked to this chat"}
        </DialogDescription>
        <DialogTitle className="pr-6 text-base leading-snug">{issue.title}</DialogTitle>
        <IssueMeta issue={issue} />
      </DialogHeader>
      <Description issue={issue} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void unlink()}>
          Unlink
        </Button>
        <Button variant="outline" size="sm" onClick={onChange}>
          Change card
        </Button>
        <Button size="sm" onClick={() => navigate.openUrl(issue.url)}>
          <Icon name="ExternalLink" className="size-3.5" aria-hidden />
          Open in Linear
        </Button>
      </div>
    </div>
  );
}

/** Expanded explorer row: lazily loaded description plus the link action. */
function IssuePreview({
  identifier,
  rpc,
  linked,
  onLink,
}: {
  identifier: string;
  rpc: Rpc;
  linked: boolean;
  onLink: () => Promise<void>;
}) {
  const navigate = useAliaNavigate();
  const [issue, setIssue] = useState<IssueDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    rpc.call("issue_detail", { identifier }).then(
      (result) => live && setIssue(result.issue),
      (cause) => live && setError(errorText(cause)),
    );
    return () => {
      live = false;
    };
  }, [rpc, identifier]);

  async function link() {
    setBusy(true);
    try {
      await onLink();
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 px-2 pb-3 pt-1">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {issue === undefined && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {issue ? <IssueMeta issue={issue} /> : null}
      {issue ? <Description issue={issue} /> : null}
      {issue === null ? <p className="text-sm text-muted-foreground">Linear no longer has this issue.</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {issue ? (
          <Button variant="outline" size="sm" onClick={() => navigate.openUrl(issue.url)}>
            <Icon name="ExternalLink" className="size-3.5" aria-hidden />
            Open in Linear
          </Button>
        ) : null}
        <Button size="sm" disabled={busy || linked || !issue} onClick={() => void link()}>
          {linked ? "Linked to this chat" : busy ? "Linking…" : "Link to this chat"}
        </Button>
      </div>
    </div>
  );
}

type ExplorerData = { teams: Team[]; teamKey: string | null; issues: IssueSummary[] };

/** The viewer's assigned issues for the project's Linear team. */
function Explorer({
  rpc,
  threadId,
  projectId,
  linkedIdentifier,
}: {
  rpc: Rpc;
  threadId: string;
  projectId: string;
  linkedIdentifier: string | null;
}) {
  const [data, setData] = useState<ExplorerData | "unconfigured" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // `teamKey: undefined` asks the server for the project's saved scope; picking
  // a team saves it, so a later includeDone reload keeps that team.
  const load = useCallback(
    (teamKey: string | null | undefined) => {
      setError(null);
      // JSON has no `undefined`: omit the key to mean "use the saved scope".
      const input = teamKey === undefined ? { projectId, includeDone } : { projectId, teamKey, includeDone };
      rpc.call("explorer", input).then(
        (result) => setData(result.status === "ok" ? result : "unconfigured"),
        (cause) => setError(errorText(cause)),
      );
    },
    [rpc, projectId, includeDone],
  );
  useEffect(() => load(undefined), [load]);

  const issues = data && data !== "unconfigured" ? data.issues : [];
  const projects = useMemo(
    () => [...new Set(issues.flatMap((issue) => (issue.project ? [issue.project.name] : [])))].sort(),
    [issues],
  );
  const needle = query.trim().toLowerCase();
  const visible = issues.filter(
    (issue) =>
      (projectFilter === null || (issue.project?.name ?? "") === projectFilter) &&
      (needle === "" ||
        issue.identifier.toLowerCase().includes(needle) ||
        issue.title.toLowerCase().includes(needle)),
  );

  if (data === "unconfigured") return <Unconfigured />;

  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assigned cards"
            aria-label="Search assigned cards"
            className="h-8 pl-8 text-sm"
          />
        </div>
        {data && data.teams.length > 1 ? (
          <select
            aria-label="Linear team for this project"
            value={data.teamKey ?? ""}
            onChange={(event) => load(event.target.value || null)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All teams</option>
            {data.teams.map((team) => (
              <option key={team.key} value={team.key}>
                {team.name} ({team.key})
              </option>
            ))}
          </select>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={includeDone}
          onClick={() => setIncludeDone((value) => !value)}
        >
          {includeDone ? "Hide done" : "Show done"}
        </Button>
      </div>

      {projects.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by Linear project">
          {[null, ...projects, ""].map((name) => (
            <button
              key={name ?? "\u0000all"}
              type="button"
              aria-pressed={projectFilter === name}
              onClick={() => setProjectFilter(name)}
              className={cn(
                "rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover",
                projectFilter === name && "bg-state-active text-foreground",
              )}
            >
              {name === null ? "All projects" : name === "" ? "No project" : name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="max-h-[55vh] min-h-24 overflow-y-auto rounded-md border border-border">
        {data === null && !error ? <p className="p-3 text-sm text-muted-foreground">Loading cards…</p> : null}
        {data && visible.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No assigned cards match.</p>
        ) : null}
        {STATE_GROUPS.map((group) => {
          const rows = visible.filter((issue) => issue.state.type === group.type);
          if (rows.length === 0) return null;
          return (
            <section key={group.type} className="border-t border-border first:border-t-0">
              <h3 className="sticky top-0 z-10 border-b border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {group.label} <span className="opacity-60">{rows.length}</span>
              </h3>
              <ul>
                {rows.map((issue) => (
                  <li key={issue.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={expanded === issue.identifier}
                      onClick={() => setExpanded(expanded === issue.identifier ? null : issue.identifier)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-state-hover"
                    >
                      <StateIcon state={issue.state} />
                      <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {issue.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                      {issue.identifier === linkedIdentifier ? (
                        <Icon name="Check" className="size-3.5 shrink-0 text-muted-foreground" aria-label="Linked" />
                      ) : null}
                      {issue.project ? (
                        <span className="hidden max-w-32 shrink-0 truncate text-xs text-muted-foreground sm:inline">
                          {issue.project.name}
                        </span>
                      ) : null}
                    </button>
                    {expanded === issue.identifier ? (
                      <IssuePreview
                        identifier={issue.identifier}
                        rpc={rpc}
                        linked={issue.identifier === linkedIdentifier}
                        onLink={async () => {
                          await rpc.call("link_card", { threadId, identifier: issue.identifier });
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function useThreadCard(threadId: string, projectId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<ThreadCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("thread_card", { threadId, projectId }).then(
      (result) => {
        setCard(result);
        setError(null);
      },
      (cause) => setError(errorText(cause)),
    );
  }, [rpc, threadId, projectId]);
  useEffect(refetch, [refetch]);
  useRealtime(
    CARD_CHANGED,
    useCallback(
      (payload: unknown) => {
        if ((payload as { threadId?: unknown } | null)?.threadId === threadId) refetch();
      },
      [threadId, refetch],
    ),
  );
  // Turning a project on or off in settings shows or hides the chip at once.
  useRealtime(ENABLED_PROJECTS_CHANGED, refetch);
  return { rpc, card, error, refetch };
}

function LinearCardButton({ threadId, projectId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { rpc, card, error, refetch } = useThreadCard(threadId, projectId);

  const [open, setOpen] = useState(false);
  const [exploring, setExploring] = useState(false);

  // Linking from the explorer swaps the dialog back to the card view.
  const identifier = card?.status === "card" ? card.issue.identifier : null;
  useEffect(() => setExploring(false), [identifier]);

  let chip: ReactNode;
  let label: string;
  if (error) {
    chip = <span>Linear error</span>;
    label = `Linear card failed to load: ${error}`;
  } else if (card === null || card.status === "disabled") {
    // Nothing until the server says the project is on, so off projects never flash a chip.
    return null;
  } else if (card.status === "card") {
    chip = (
      <>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-foreground">{card.issue.identifier}</span>
        {isCompactViewport ? null : <span className="min-w-0 truncate">{card.shortTitle ?? card.issue.title}</span>}
      </>
    );
    label = `Linear card ${card.issue.identifier} (${card.issue.state.name}): ${card.issue.title}`;
  } else if (card.status === "missing") {
    chip = <span>{card.identifier} not found</span>;
    label = `Linked Linear card ${card.identifier} was not found`;
  } else if (card.status === "unconfigured") {
    chip = <span>Linear: add API key</span>;
    label = "Linear Card needs an API key";
  } else {
    chip = <span>{isCompactViewport ? "No card" : "No Linear card"}</span>;
    label = "No Linear card connected — browse assigned cards";
  }

  const showExplorer = card !== null && (exploring || card.status === "none" || card.status === "missing");

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          refetch();
          setOpen(true);
        }}
        className={cn(
          "flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border px-2 text-2xs text-muted-foreground",
          "hover:bg-accent hover:text-foreground",
          card?.status === "none" && "border-dashed",
        )}
      >
        <LinearLogo className={card?.status === "card" ? "text-foreground" : undefined} />
        {chip}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setExploring(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          {card?.status === "unconfigured" ? (
            <>
              <DialogHeader>
                <DialogTitle>Linear Card</DialogTitle>
              </DialogHeader>
              <Unconfigured />
            </>
          ) : card?.status === "card" && !exploring ? (
            <CardView card={card} rpc={rpc} threadId={threadId} onChange={() => setExploring(true)} />
          ) : showExplorer && card ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {card.status === "card" ? "Change Linear card" : "Your assigned Linear cards"}
                </DialogTitle>
                <DialogDescription>
                  {card.status === "missing"
                    ? `The linked card ${card.identifier} no longer exists in Linear. Pick another.`
                    : card.status === "none"
                      ? "No Linear card is connected to this chat. Pick one to link it."
                      : `Linked to ${identifier}. Pick another to replace it.`}
                </DialogDescription>
              </DialogHeader>
              <Explorer rpc={rpc} threadId={threadId} projectId={projectId} linkedIdentifier={identifier} />
            </>
          ) : (
            <DialogTitle className="text-sm text-muted-foreground">{error ?? "Loading…"}</DialogTitle>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Enabled project ids, kept current across every open header and settings page. */
function useEnabledProjects(rpc: Rpc) {
  const [projectIds, setProjectIds] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call("enabled_projects", null).then(
      (result) => live && setProjectIds(result.projectIds),
      () => live && setProjectIds([]),
    );
    return () => {
      live = false;
    };
  }, [rpc]);
  useRealtime(
    ENABLED_PROJECTS_CHANGED,
    useCallback((payload: unknown) => {
      const ids = (payload as { projectIds?: unknown } | null)?.projectIds;
      if (Array.isArray(ids)) setProjectIds(ids.filter((id): id is string => typeof id === "string"));
    }, []),
  );
  return projectIds;
}

type SettingsProject = { id: string; name: string };

/** Plugin settings page: one switch per VesnALIA project. */
function ProjectsSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<SettingsProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabledIds = useEnabledProjects(rpc);

  useEffect(() => {
    rpc.call("settings_projects", null).then(
      (result) => setProjects(result.projects),
      (cause) => setError(errorText(cause)),
    );
  }, [rpc]);

  async function toggle(projectId: string, enabled: boolean) {
    setError(null);
    try {
      await rpc.call("set_project_enabled", { projectId, enabled });
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (projects === null || enabledIds === null) return <p className="text-sm text-muted-foreground">Loading projects…</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {projects.map((project) => {
        const enabled = enabledIds.includes(project.id);
        return (
          <li key={project.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-state-hover">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={enabled}
                onChange={(event) => void toggle(project.id, event.target.checked)}
              />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "linear-card",
    title: "Linear card",
    component: LinearCardButton,
  });
  app.slots.settingsSection({
    id: "projects",
    title: "Projects",
    description: "Show the Linear card chip in the thread header of these projects.",
    component: ProjectsSettings,
  });
});
