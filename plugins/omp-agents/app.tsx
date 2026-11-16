// alia-plugin-omp-agents — a VesnALIA plugin frontend entry.
//
// Compiled by `alia plugin build` into dist/app.js + dist/app.css. React and
// @vesnalia/plugin-sdk/app are provided by the VesnALIA app at load time (never
// bundled), so this file must be loaded by VesnALIA, not imported directly.
import { useEffect, useState } from "react";
import { definePluginApp, useAliaContext, useRpc } from "@vesnalia/plugin-sdk/app";
import type { AgentList, rpcContract } from "./server";
import { Icon } from "@/components/ui/icon";

const SCOPE_LABEL: Record<AgentList["agents"][number]["scope"], string> = {
  project: "Project",
  user: "User",
  extra: "Extra",
};

type Agent = AgentList["agents"][number];

/** The agents this thread (or project) can spawn, over the plugin's own RPC. */
function useAgents() {
  const rpc = useRpc<typeof rpcContract>();
  const { projectId, threadId } = useAliaContext();
  const [result, setResult] = useState<AgentList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("agents_list", { threadId, projectId }).then(
      (next) => {
        if (!cancelled) {
          setResult(next);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, projectId]);

  return { result, error };
}

function AgentRow({ agent }: { agent: Agent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="py-3">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 text-left"
      >
        <Icon name="Bot" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{agent.name}</span>
            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
              {SCOPE_LABEL[agent.scope]}
            </span>
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {agent.description}
          </span>
        </span>
        <Icon
          name={expanded ? "ChevronUp" : "ChevronDown"}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
      </button>
      {expanded ? (
        <dl className="mt-2 ml-7 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Tools</dt>
          <dd className="font-mono break-words">
            {agent.tools.length > 0 ? agent.tools.join(", ") : "inherits defaults"}
          </dd>
          <dt>Model</dt>
          <dd className="font-mono break-words">
            {agent.model.length > 0 ? agent.model.join(", ") : "inherits defaults"}
          </dd>
          {agent.spawns.length > 0 ? (
            <>
              <dt>Spawns</dt>
              <dd className="font-mono break-words">{agent.spawns.join(", ")}</dd>
            </>
          ) : null}
          <dt>Definition</dt>
          <dd className="font-mono break-all">{agent.filePath}</dd>
        </dl>
      ) : null}
    </li>
  );
}

// Tailwind classes compile against the host theme's live CSS variables —
// derive colors from the theme tokens, never hardcoded grays. The frame
// (scrolling page, centered column) matches VesnALIA's own nav-panel pages.
function AgentsPage() {
  const { result, error } = useAgents();
  const agents = result?.agents ?? null;
  const blocked = result !== null && !result.canSpawn;
  // The setting names no provider this server has: the @ menu is dead, and
  // nothing else on screen would explain why.
  const misconfigured =
    result !== null &&
    result.knownProviderIds.length > 0 &&
    result.configuredProviderIds.length > 0 &&
    !result.configuredProviderIds.some((id) => result.knownProviderIds.includes(id));

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {misconfigured ? (
          <p role="alert" className="text-sm text-destructive">
            The <strong>Providers that run OMP</strong> setting names{" "}
            <code>{result.configuredProviderIds.join(", ")}</code>, which this
            server does not have — so the <code>@</code> menu will never appear.
            Set it to one of{" "}
            <code>{result.knownProviderIds.join(", ")}</code>.
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          {blocked ? (
            <>
              These subagents run under <strong>OMP</strong>. The current surface
              runs on <code>{result.providerId ?? "no provider"}</code>, so the
              composer will not offer them — use an <code>omp</code> thread to
              mention one.
            </>
          ) : (
            <>
              Type <code>@</code> in the composer and pick a row under{" "}
              <strong>OMP agents</strong> to hand a task to one of these
              subagents. The menu lists the same agents this page does.
            </>
          )}
        </p>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4">
          {agents === null ? (
            <div
              role="status"
              className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            >
              Loading agents…
            </div>
          ) : agents.length === 0 ? (
            <div
              role="status"
              className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            >
              No OMP agents found. Add definitions under{" "}
              <code>.omp/agents/</code> in this workspace, or point the plugin at
              a directory in its settings.
            </div>
          ) : (
            <ul
              className={`divide-y divide-border overflow-hidden rounded-lg border border-border bg-card px-4${
                blocked ? " opacity-60" : ""
              }`}
            >
              {agents.map((agent) => (
                <AgentRow key={agent.name} agent={agent} />
              ))}
            </ul>
          )}
        </div>
        {result !== null && result.searchedDirs.length > 0 ? (
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Searched directories</summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {result.searchedDirs.map((dir) => (
                <li key={dir} className="break-all">
                  {dir}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "omp-agents",
    title: "OMP agents",
    icon: "Bot",
    path: "omp-agents",
    component: AgentsPage,
  });
});
