// alia-plugin-xlsx-preview — renders .xlsx/.xlsm files as HTML tables in the file panel.
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { definePluginApp, useAliaNavigate, useSdk } from "@vesnalia/plugin-sdk/app";
import type { ExperimentalLiveFileTarget, PluginFileOpenerProps, PluginThreadHeaderActionProps } from "@vesnalia/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { colName, parseXlsx, type Sheet } from "@/lib/xlsx";
import { cn } from "@/lib/utils";

type Sdk = ReturnType<typeof useSdk>;
type Source = PluginFileOpenerProps["source"];

async function loadBytes(sdk: Sdk, path: string, source: Source): Promise<Uint8Array> {
  let file: { content: string; contentEncoding: "base64" | "utf8" };
  if (source.kind === "workspace") {
    const projectId = source.projectId ?? (source.environmentId
      ? (await sdk.environments.get({ environmentId: source.environmentId })).projectId
      : null);
    if (!projectId) throw new Error("Workspace file has no project or environment");
    file = await sdk.projects.fileContent(
      source.environmentId
        ? { projectId, environmentId: source.environmentId, path }
        : source.experimental_hostId
          ? { projectId, hostId: source.experimental_hostId, path }
          : { projectId, path },
    );
  } else if (source.kind === "thread-storage") {
    if (!source.threadId) throw new Error("Thread-storage file has no thread");
    const loc = await sdk.threads.storageLocation({ threadId: source.threadId });
    // ponytail: tolerate either a per-thread root or the shared storage root.
    const root = loc.storageRootPath.replace(/\/$/, "");
    const threadRoot = root.endsWith(`/${source.threadId}`) ? root : `${root}/${source.threadId}`;
    file = await sdk.files.read({ hostId: loc.hostId, rootPath: threadRoot, path: `${threadRoot}/${path}` });
  } else {
    let hostId = source.experimental_hostId;
    if (!hostId && source.threadId) hostId = (await sdk.threads.storageLocation({ threadId: source.threadId })).hostId;
    file = await sdk.files.read({ hostId, path });
  }
  if (file.contentEncoding !== "base64") throw new Error("File content was returned as text, not binary");
  return Uint8Array.from(atob(file.content), (ch) => ch.charCodeAt(0));
}

function SheetTable({ sheet }: { sheet: Sheet }) {
  if (sheet.rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">This sheet is empty.</p>;
  const spans = new Map(sheet.merges.map((m) => [`${m.r}:${m.c}`, m]));
  const hidden = new Set<string>();
  for (const m of sheet.merges)
    for (let r = m.r; r < m.r + m.rows; r++)
      for (let c = m.c; c < m.c + m.cols; c++) if (r !== m.r || c !== m.c) hidden.add(`${r}:${c}`);
  const cols = sheet.rows[0]!.length;
  const cell = "border border-border px-2 py-1 whitespace-pre-wrap align-top";
  const head = "sticky bg-muted text-muted-foreground font-medium border border-border px-2 py-1 text-xs";
  return (
    <table className="border-collapse text-xs tabular-nums">
      <thead>
        <tr>
          <th className={cn(head, "top-0 left-0 z-20")} />
          {Array.from({ length: cols }, (_, c) => (
            <th key={c} className={cn(head, "top-0 z-10")}>{colName(c)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.rows.map((row, r) => (
          <tr key={r}>
            <th className={cn(head, "left-0 z-10 text-right")}>{r + 1}</th>
            {row.map((value, c) => {
              const key = `${r}:${c}`;
              if (hidden.has(key)) return null;
              const span = spans.get(key);
              const numeric = value !== "" && !Number.isNaN(Number(value));
              return (
                <td key={c} rowSpan={span?.rows} colSpan={span?.cols} className={cn(cell, numeric && "text-right")}>
                  {value}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function XlsxPreview({ path, source, Original }: PluginFileOpenerProps) {
  const sdk = useSdk();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    loadBytes(sdk, path, source)
      .then(parseXlsx)
      .then((s) => !cancelled && (setSheets(s), setActive(0)))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [sdk, path, source.kind, source.threadId, source.environmentId, source.projectId, source.experimental_hostId]);

  if (error)
    return (
      <div className="flex h-full flex-col">
        <p className="border-b border-border p-3 text-sm text-destructive">Could not preview spreadsheet: {error}</p>
        <div className="min-h-0 flex-1"><Original /></div>
      </div>
    );
  if (!sheets) return <p className="p-4 text-sm text-muted-foreground">Loading spreadsheet…</p>;
  const sheet = sheets[active];
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">{sheet && <SheetTable sheet={sheet} />}</div>
      {sheet && (sheet.totalRows > sheet.rows.length || sheet.totalCols > (sheet.rows[0]?.length ?? 0)) && (
        <p className="border-t border-border px-3 py-1 text-xs text-muted-foreground">
          Showing first {sheet.rows.length} of {sheet.totalRows} rows and {sheet.rows[0]?.length ?? 0} of {sheet.totalCols} columns.
        </p>
      )}
      <div className="flex gap-1 overflow-x-auto border-t border-border px-2 py-1">
        {sheets.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "rounded px-2 py-0.5 text-xs whitespace-nowrap",
              i === active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

type Found = { name: string; target: ExperimentalLiveFileTarget };
const isSheet = (p: string) => /\.(xlsx|xlsm)$/i.test(p);

/** Thread-header button: lists spreadsheets in this thread's storage and workspace. */
function SpreadsheetsButton({ threadId, projectId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const sdk = useSdk();
  const nav = useAliaNavigate();
  const [files, setFiles] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const found: Found[] = [];
      const storage = await sdk.threads.storageFiles({ threadId, query: "xls", limit: "200" });
      const root = storage.storageRootPath.replace(/\/$/, "") + "/";
      for (const f of storage.files)
        if (isSheet(f.path))
          found.push({ name: f.name, target: { kind: "thread-storage", threadId, path: f.path.startsWith(root) ? f.path.slice(root.length) : f.path } });
      const { environmentId } = await sdk.threads.get({ threadId });
      if (environmentId) {
        const ws = await sdk.projects.files({ projectId, environmentId, query: "xls", limit: "200" });
        for (const f of ws.files) if (isSheet(f.path)) found.push({ name: f.name, target: { kind: "workspace", environmentId, path: f.path } });
      }
      setFiles(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Popover.Root onOpenChange={(open) => open && load()}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Spreadsheets"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Icon name="Table" aria-hidden />
          {!isCompactViewport && "Spreadsheets"}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 w-80 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {error ? (
            <p className="p-2 text-xs text-destructive">{error}</p>
          ) : files === null ? (
            <p className="p-2 text-xs text-muted-foreground">Looking for spreadsheets…</p>
          ) : files.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No .xlsx files in this thread or its workspace. Attach one to the chat and it shows up here.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {files.map((f) => (
                <li key={`${f.target.kind}:${f.target.path}`}>
                  <Popover.Close asChild>
                    <button
                      type="button"
                      onClick={() => nav.experimental_openFilePreview({ target: f.target, location: null })}
                      className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-muted"
                    >
                      <span className="truncate text-xs font-medium">{f.name}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {f.target.kind === "workspace" ? "Workspace" : "Thread files"} · {f.target.path}
                      </span>
                    </button>
                  </Popover.Close>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({ id: "xlsx-table", title: "Spreadsheet table", extensions: ["xlsx", "xlsm"], component: XlsxPreview });
  app.slots.experimental_threadHeaderAction({ id: "spreadsheets", title: "Spreadsheets", component: SpreadsheetsButton });
});
