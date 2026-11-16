// File Versions page: latest copy of each document, older ones on demand.
import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract, VersionsOutput } from "./server";
import { ICONS } from "./lib/icons";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const when = (mtime: number) => new Date(mtime).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

type Group = VersionsOutput["groups"][number];

function Row({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={group.latest.path}>{group.latest.name}</div>
          <div className="truncate text-xs text-muted-foreground">{group.latest.folder || "Project folder"} · {when(group.latest.mtime)}</div>
        </div>
        {group.older.length === 0 ? null : (
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {group.older.length} older
            <Icon name={open ? "file-versions/up" : "file-versions/down"} className="size-4" />
          </Button>
        )}
      </div>
      {open ? (
        <ul className="mt-1 space-y-0.5 border-l border-border pl-3 text-xs text-muted-foreground">
          {group.older.map((file) => (
            <li key={file.path} className="truncate" title={file.path}>
              {file.name} · {file.folder || "Project folder"} · {when(file.mtime)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function VersionsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<VersionsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyMulti, setOnlyMulti] = useState(true);
  const load = useCallback(() => {
    setData(null);
    rpc.call("scan").then(setData, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [rpc]);
  useEffect(load, [load]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.groups ?? []).filter((g) => (!onlyMulti || g.older.length > 0) && (needle === "" || g.title.toLowerCase().includes(needle))).slice(0, 300);
  }, [data, query, onlyMulti]);
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a document"
            aria-label="Find a document"
            className="h-8 min-w-40 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={onlyMulti} onChange={(event) => setOnlyMulti(event.target.checked)} />
            Only with several versions
          </label>
          <Button variant="ghost" size="sm" onClick={load}>
            <Icon name="file-versions/refresh" className="size-4" />
            Rescan
          </Button>
        </div>
        {error === null ? null : <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {data === null ? (
          error === null ? <p className="mt-4 text-sm text-muted-foreground">Looking through your project folders…</p> : null
        ) : (
          <>
            <p className="mt-3 text-xs text-muted-foreground">{data.files} files in {data.roots.length} folders. The highest version number counts as the latest, then the newest file.</p>
            {shown.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nothing matches.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
                {shown.map((g) => <Row key={g.key} group={g} />)}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  for (const [name, component] of Object.entries(ICONS)) {
    app.experimental_icons.register({ name, component });
  }
  app.slots.navPanel({ id: "file-versions", title: "File Versions", icon: "file-versions/stack", path: "file-versions", component: VersionsPage });
});
