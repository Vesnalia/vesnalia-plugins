import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown, ThreadChat, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { FileView, StageView, WorkView, workshopContract } from "../contract";
import { FORWARD_BUTTON } from "../server/stages";
import { REASON_MAX, STATE, btn, errCls, errText, input, primary, uniq, when, withMockupCsp } from "./common";
import { modelsSummary } from "./models-picker";
import { AttemptLine, PluginActions } from "./plugin";

const THREAD_STATUS: Record<string, string> = {
  active: "working",
  starting: "starting",
  pending: "queued",
  idle: "waiting",
  error: "error",
  stopping: "stopping",
  unknown: "?",
};
const ROLE: Record<string, string> = { stage: "stage agent", review: "review" };

const ACTION: Record<string, string> = { forward: "forward", back: "sent back", cancel: "canceled", reconfirm: "reconfirmed" };
const VERDICT: Record<string, string> = { clear: "no blocking findings", blocking: "blocking findings", pass: "green", fail: "red" };
const KIND: Record<string, string> = { new: "new plugin", rework: "rework" };
/** The forward button of each stage — the server names the autopilot pause after it too. */
const FORWARD: Record<number, string> = FORWARD_BUTTON;

const verdictCls = (v: string) =>
  v === "clear" || v === "pass"
    ? "text-emerald-600 dark:text-emerald-400"
    : v === "blocking" || v === "fail"
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";

// The default stage thread: the stage agent's last round (role «stage»).
function lastStageThread(stage: StageView | undefined): string | null {
  const own = stage?.threads.filter((t) => t.role === "stage") ?? [];
  let best: (typeof own)[number] | null = null;
  for (const t of own) if (best === null || t.round >= best.round) best = t;
  return best?.threadId ?? null;
}

// One work: on the left the version, the stages as tabs and the actions; on the right the conversation with the agent.
export function WorkPage({ workId, notice, onBack, onOpenPlugin }: { workId: string; notice?: string; onBack: () => void; onOpenPlugin: (pluginId: string) => void }) {
  const rpc = useRpc<typeof workshopContract>();
  const [view, setView] = useState<WorkView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The action error lives here, not in the actions block: the block is recreated when the stage changes.
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<number | null>(null);
  const [chat, setChat] = useState<string | null>(null);
  // The tab of the «Context» stage: the conversation with the agent or the autopilot.
  const [ctxTab, setCtxTab] = useState<"talk" | "pilot">("talk");

  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    rpc
      .call("work", { workId })
      .then((v) => {
        if (mine !== seq.current) return;
        setView(v);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(errText(e));
      });
  }, [rpc, workId]);
  useEffect(load, [load]);
  // The page changes with its work, with actions on its plugin (rollback, disable — a signal with the plugin only) and with the catalog reconcile.
  const pluginId = useRef<string | null>(null);
  pluginId.current = view?.work.pluginId ?? null;
  useRealtime("plugin-workshop", (p) => {
    const s = p as { workId?: string | null; pluginId?: string | null } | null;
    const wid = s?.workId ?? null;
    const pid = s?.pluginId ?? null;
    if (wid === workId || (wid === null && pid === null) || (pid !== null && pid === pluginId.current)) load();
  });

  if (!view)
    return (
      <div className="p-6 text-xs">
        <button type="button" onClick={onBack} className="mb-3 rounded-md border border-border px-2 py-1 hover:bg-accent">
          ← Board
        </button>
        <div className={error ? errCls : "text-muted-foreground"}>{error ?? "loading…"}</div>
      </div>
    );

  const w = view.work;
  // A work whose creation is not finished (scaffold, git, project, task) has no stages, version or files yet.
  const s = !w.created && w.state !== "error" ? { text: "being created", cls: STATE.agent!.cls } : (STATE[w.state] ?? { text: w.state, cls: "" });
  const shown = tab ?? w.stage;
  const stage = view.stages.find((x) => x.no === shown) ?? view.stages[0];
  const currentStage = view.stages.find((x) => x.current);
  const defaultThread = lastStageThread(currentStage);
  const threadId = chat ?? defaultThread;
  const v = view.version;

  // After an action, show the current stage and its agent: the stage may have changed.
  const reload = () => {
    setActionError(null);
    setTab(null);
    setChat(null);
    load();
  };
  // Canceling a work at stages 1–5 (the server takes the snapshot and cleans up) or an unfinished creation.
  const cancel = () => {
    const reason = window.prompt(w.created ? "Reason for canceling the work" : "Reason for canceling the creation");
    if (reason === null) return;
    if (reason.length > REASON_MAX) {
      setActionError(`The reason must be up to ${REASON_MAX} characters, now ${reason.length}`);
      return;
    }
    setActionError(null);
    rpc
      .call("cancel", { workId, reason })
      .then(reload)
      .catch((e: unknown) => {
        setActionError(errText(e));
        load();
      });
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(420px,1fr)_minmax(420px,1fr)]">
      <div className="flex min-w-0 flex-col gap-3 overflow-auto p-5">
        <header className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
            ← Board
          </button>
          <h1 className="text-base font-semibold">{w.key ?? "being created"} · {w.title}</h1>
          <span className={`text-xs ${s.cls}`}>● {s.text}</span>
          {w.reason ? <span className="text-xs text-muted-foreground">{w.reason}</span> : null}
          {w.stale ? <span className="text-xs text-orange-600 dark:text-orange-400">stale</span> : null}
          {view.baseAhead ? <span className="text-xs text-orange-600 dark:text-orange-400">the main branch moved ahead</span> : null}
          {w.queued ? <span className="text-xs text-muted-foreground">queued</span> : null}
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">{KIND[w.kind] ?? w.kind} · <span className="font-mono">{w.pluginId}</span></span>
          <button type="button" onClick={() => onOpenPlugin(w.pluginId)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" title="plugin state, working copy, past works">
            Plugin summary
          </button>
          <button type="button" onClick={load} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" title="reload the work from the server">
            Refresh
          </button>
          {w.outcome === null && w.stage !== 6 ? (
            <button type="button" onClick={cancel} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
              {w.created ? "Cancel work" : "Cancel creation"}
            </button>
          ) : null}
        </header>
        <div className="text-xs text-muted-foreground">
          {v ? `iteration ${v.iteration} · HEAD ${v.headSha?.slice(0, 7) ?? "—"}${v.dirty ? " · uncommitted changes" : ""}` : `iteration ${w.iteration}`}
          {view.prUrl ? (
            <>
              {" · "}
              <a href={view.prUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                PR on GitHub
              </a>
            </>
          ) : null}
        </div>
        {notice && notice !== w.reason ? <div role="alert" className={errCls}>{notice}</div> : null}
        {error ? <div className={errCls}>{error}</div> : null}

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Owner's request</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3">{w.request}</pre>
        </details>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Agent models</summary>
          <p className="mt-2">{modelsSummary(view.models)} · orchestrator {view.models.pilot.label} · Implementation subagents {view.models.subagents.label}</p>
          <p className="text-muted-foreground">Chosen when the work started; they do not change.</p>
        </details>

        {w.created && stage ? (
          <>
            <nav className="flex flex-wrap gap-1">
              {view.stages.map((x) => (
                <button
                  key={x.no}
                  type="button"
                  onClick={() => setTab(x.no)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${x.no === shown ? "border-foreground/40 bg-accent" : "border-border hover:bg-accent"} ${x.current ? "font-semibold" : ""}`}
                >
                  {x.stale ? <span className="mr-1 text-orange-500" title="stale">●</span> : null}
                  {view.stages.indexOf(x) + 1}. {x.title}
                </button>
              ))}
            </nav>

            <PilotBanner view={view} onOpenChat={setChat} onOpenTab={() => { setTab(1); setCtxTab("pilot"); }} refresh={load} onError={setActionError} />

            {stage.no === 1 ? (
              <nav className="flex gap-1 border-b border-border text-xs" aria-label="Context">
                {(["talk", "pilot"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCtxTab(k)}
                    className={`-mb-px border-b-2 px-2.5 py-1 ${ctxTab === k ? "border-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {k === "talk" ? "Conversation" : "Autopilot"}
                  </button>
                ))}
              </nav>
            ) : null}

            {stage.no === 1 && ctxTab === "pilot" ? (
              <PilotPanel view={view} onOpenChat={setChat} refresh={load} onError={setActionError} />
            ) : (
              <>
                <StageBody key={`stage-${shown}`} workId={workId} stamp={JSON.stringify(v)} stage={stage} chatId={threadId} onOpenChat={setChat} />

                {stage.current && w.outcome === null ? (
                  <>
                    {view.pilot?.state === "on" ? (
                      <p className="text-xs text-orange-600 dark:text-orange-400">The autopilot is running this work: any button below pauses it.</p>
                    ) : null}
                    <Actions key={`actions-${w.stage}`} view={view} stage={stage} reload={reload} refresh={load} onError={setActionError} />
                  </>
                ) : null}
              </>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Creation is not finished yet: the scaffold, git, the execution project and the task appear step by step. The page updates by itself; if a
            step failed, the reason is above — the reconcile retries it, and «Cancel creation» removes the temporary scaffold folder and closes the task.
          </p>
        )}
        {actionError ? <div className={errCls}>{actionError}</div> : null}

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">work journal</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {view.events.slice(0, 50).map((e, i) => (
              <li key={i} className="whitespace-pre-wrap">
                <span className="text-muted-foreground">{when(e.at)}</span> {e.text}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <aside className="flex h-full min-h-0 flex-col border-l border-border bg-background">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          <h2 className="truncate text-sm font-semibold">{chat && chat === view.pilot?.threadId ? "Autopilot orchestrator" : chat ? "Stage thread" : `Agent · ${currentStage?.title ?? ""}`}</h2>
          <span className="flex-1" />
          {chat ? (
            <button type="button" onClick={() => setChat(null)} className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent">
              back to the stage agent
            </button>
          ) : null}
        </header>
        <div className="min-h-0 flex-1">
          {threadId ? (
            <ThreadChat key={threadId} threadId={threadId} variant="compact" />
          ) : (
            <div className="p-4 text-xs text-muted-foreground">
              {!w.created ? "Creation is not finished — there is no stage agent yet" : currentStage?.agent ? "The stage thread has not been created yet" : "The stage has no agent"}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

const PILOT_STATE: Record<string, { text: string; cls: string }> = {
  on: { text: "running the work", cls: "text-emerald-600 dark:text-emerald-400" },
  paused: { text: "paused", cls: "text-orange-600 dark:text-orange-400" },
  stopped: { text: "stopped", cls: "text-red-600 dark:text-red-400" },
  done: { text: "finished", cls: "text-muted-foreground" },
};

/** Starting, stopping and resuming the autopilot; the page shows the error. */
function usePilotCall(workId: string, refresh: () => void, onError: (e: string | null) => void) {
  const rpc = useRpc<typeof workshopContract>();
  const [busy, setBusy] = useState(false);
  const run = (call: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    call()
      .then(refresh)
      .catch((e: unknown) => {
        onError(errText(e));
        refresh();
      })
      .finally(() => setBusy(false));
  };
  return {
    busy,
    start: (notes: string) => run(() => rpc.call("pilotStart", { workId, notes })),
    stop: () => run(() => rpc.call("pilotStop", { workId })),
    resume: () => run(() => rpc.call("pilotResume", { workId })),
  };
}

/** The autopilot banner on every stage: who runs the work and how to change that. */
function PilotBanner({ view, onOpenChat, onOpenTab, refresh, onError }: { view: WorkView; onOpenChat: (id: string) => void; onOpenTab: () => void; refresh: () => void; onError: (e: string | null) => void }) {
  const p = view.pilot;
  const call = usePilotCall(view.work.id, refresh, onError);
  if (!p) return null;
  const s = PILOT_STATE[p.state] ?? { text: p.state, cls: "" };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs" role="status">
      <span className="font-semibold">Autopilot</span>
      <span className={s.cls}>● {s.text}</span>
      {p.reason ? <span className="text-muted-foreground">{p.reason}</span> : null}
      <span className="flex-1" />
      {p.threadId ? (
        <button type="button" className={btn} onClick={() => onOpenChat(p.threadId!)}>
          Orchestrator chat
        </button>
      ) : null}
      <button type="button" className={btn} onClick={onOpenTab}>
        Details
      </button>
      {p.state === "on" ? (
        <button type="button" className={btn} disabled={call.busy} onClick={call.stop}>
          Stop autopilot
        </button>
      ) : null}
      {(p.state === "paused" || p.state === "stopped") && view.work.outcome === null ? (
        <button type="button" className={primary} disabled={call.busy} onClick={call.resume}>
          Resume autopilot
        </button>
      ) : null}
    </div>
  );
}

/** The «Autopilot» tab of the «Context» stage: what it does, the start with «what matters», the log of its actions and the final report. */
function PilotPanel({ view, onOpenChat, refresh, onError }: { view: WorkView; onOpenChat: (id: string) => void; refresh: () => void; onError: (e: string | null) => void }) {
  const p = view.pilot;
  const [notes, setNotes] = useState(p?.notes ?? "");
  const call = usePilotCall(view.work.id, refresh, onError);
  const open = view.work.outcome === null;
  const log = view.events.filter((e) => e.kind === "pilot").slice(0, 40);
  return (
    <section className="flex flex-col gap-3 text-xs">
      <p className="text-muted-foreground">
        The orchestrator runs the work to the end in your place: it answers the stage agents, hands stages over, approves the mockup against the spec
        itself, sends the work back to Implementation on red reports, rolls the plugin out and accepts it when the live check is green; the PR on
        GitHub is merged on acceptance. The Workshop itself stops it, whatever it decides, before it passes an «impossible» feasibility verdict,
        moves into Implementation with open owner.md items, hands on, rolls out or accepts a work branch with a key finding, or accepts a red live
        check; also after three red checks in a row or if the work goes in circles. It is told to stop when keys, accounts or money are needed.
        Its thread has full permissions and decides from text written by agents and from the plugin's code. Any button you press on the work page
        pauses the autopilot.
      </p>
      {p ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={PILOT_STATE[p.state]?.cls}>● {PILOT_STATE[p.state]?.text ?? p.state}</span>
          <span className="text-muted-foreground">
            since {when(p.startedAt)} · actions {p.actions}
            {p.reds ? ` · red checks in a row ${p.reds}` : ""}
          </span>
          {p.reason ? <span>{p.reason}</span> : null}
          {p.threadId ? (
            <button type="button" className={btn} onClick={() => onOpenChat(p.threadId!)}>
              Orchestrator chat
            </button>
          ) : null}
        </div>
      ) : null}
      {open && p?.state !== "on" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">What matters to the autopilot</span>
            <textarea
              className={`${input} min-h-[96px]`}
              value={notes}
              maxLength={4000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional: what is a must, what not to do, which decisions to leave to me"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={call.busy} onClick={() => call.start(notes)}>
              {p ? "Start again" : "Start autopilot"}
            </button>
            {p && (p.state === "paused" || p.state === "stopped") ? (
              <button type="button" className={btn} disabled={call.busy} onClick={call.resume}>
                Resume where it stopped
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {p?.state === "on" ? (
        <div>
          <button type="button" className={btn} disabled={call.busy} onClick={call.stop}>
            Stop autopilot
          </button>
        </div>
      ) : null}
      {p?.report ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Autopilot report</h3>
          <div className="rounded-md border border-border p-3">
            <Markdown content={p.report} />
          </div>
        </section>
      ) : null}
      {log.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">What the autopilot did</h3>
          <ul className="flex flex-col gap-1">
            {log.map((e, i) => (
              <li key={i} className="whitespace-pre-wrap">
                <span className="text-muted-foreground">{when(e.at)}</span> {e.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function StageBody({
  workId,
  stamp,
  stage,
  chatId,
  onOpenChat,
}: {
  workId: string;
  stamp: string;
  stage: StageView;
  chatId: string | null;
  onOpenChat: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const h = stage.handover;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{stage.ownerCheck}</p>

      {stage.files.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Stage files</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {stage.files.map((f) => (
              <li key={f.path}>
                <span className="flex flex-wrap items-baseline gap-2">
                  <button type="button" onClick={() => setOpen(open === f.path ? null : f.path)} className="text-left hover:underline" title={f.path}>
                    {f.label}
                  </button>
                  {f.verdict ? <span className={verdictCls(f.verdict)}>{VERDICT[f.verdict] ?? f.verdict}</span> : null}
                </span>
                {open === f.path ? (
                  <div className="mt-1">
                    <FileViewer workId={workId} path={f.path} stamp={stamp} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stage.progress ? (
        <p className="text-xs">{stage.progress.done} of {stage.progress.total} tasks done</p>
      ) : null}

      {stage.threads.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Stage threads</h3>
          <ul className="flex flex-col gap-0.5 text-xs">
            {stage.threads.map((t) => (
              <li key={t.threadId}>
                <button
                  type="button"
                  onClick={() => onOpenChat(t.threadId)}
                  className={`text-left hover:underline ${t.threadId === chatId ? "font-semibold" : ""}`}
                >
                  {ROLE[t.role] ?? t.role} · {t.who} · round {t.round} · {t.done ? "done" : (THREAD_STATUS[t.status] ?? t.status)}
                </button>
                {t.invalid ? <span className="text-orange-600 dark:text-orange-400"> · invalid: {t.invalid}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {h ? (
        <p className="text-xs text-muted-foreground">
          Last hand-over: {when(h.at)} · {ACTION[h.action] ?? h.action}
          {h.note ? ` — ${h.note}` : ""}
          {h.forced ? " · despite warnings" : ""}
        </p>
      ) : null}
    </div>
  );
}

// A work file: .md as markup, other text as is, an image by a data URL.
// stamp is the work version: when it changes (an edit of the spec or the plan) the file is read again,
// otherwise the owner would approve a version they have not seen.
function FileViewer({ workId, path, stamp }: { workId: string; path: string; stamp: string }) {
  const rpc = useRpc<typeof workshopContract>();
  const [file, setFile] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    setError(null);
    rpc
      .call("file", { workId, path })
      .then((f) => live && setFile(f))
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [rpc, workId, path, stamp]);

  if (error) return <div className={errCls}>{error}</div>;
  if (!file) return <div className="text-xs text-muted-foreground">loading…</div>;
  if (file.text !== null && /\.html?$/i.test(path)) return <MockupFrame key={`${path}:${stamp}`} path={path} html={file.text} />;
  // Agent-written Markdown: links and embedded HTML are handled by bb's Markdown component (its sanitizer), not by this plugin.
  if (file.text !== null)
    return path.toLowerCase().endsWith(".md") ? (
      <div className="max-h-[60vh] overflow-auto rounded-md border border-border p-3">
        <Markdown content={file.text} />
      </div>
    ) : (
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">{file.text}</pre>
    );
  if (file.data !== null && file.mime.startsWith("image/"))
    return <img src={`data:${file.mime};base64,${file.data}`} alt={path} className="max-h-[70vh] max-w-full rounded-md border border-border" />;
  return <div className="text-xs text-muted-foreground">{file.mime}, {file.size} bytes — cannot be shown</div>;
}

/**
 * An HTML mockup: untrusted (an agent wrote it from text it read), shown in a sandbox without allow-same-origin and under MOCKUP_CSP. Its
 * scripts (screen switchers) run in their own opaque origin — no access to bb, its cookies or storage — and cannot reach the network,
 * open frames or submit forms. A script can still navigate its own frame, carrying data in the URL; CSP cannot block that. The frame is
 * expected to load once: a second load means the mockup navigated away, and the preview is replaced with a notice until the next file or version.
 */
function MockupFrame({ path, html }: { path: string; html: string }) {
  const loads = useRef(0);
  const [away, setAway] = useState(false);
  const doc = useMemo(() => withMockupCsp(html), [html]);
  if (away)
    return (
      <div className={errCls}>
        The mockup navigated away from its own page, so the preview was stopped. A mockup is one self-contained page that loads nothing — ask
        the agent to fix it.
      </div>
    );
  return (
    <iframe
      title={path}
      srcDoc={doc}
      sandbox="allow-scripts"
      onLoad={() => {
        loads.current += 1;
        if (loads.current > 1) setAway(true);
      }}
      className="h-[75vh] w-full rounded-md border border-border bg-white"
    />
  );
}

function Actions({
  view,
  stage,
  reload,
  refresh,
  onError,
}: {
  view: WorkView;
  stage: StageView;
  reload: () => void;
  refresh: () => void;
  onError: (message: string | null) => void;
}) {
  const rpc = useRpc<typeof workshopContract>();
  const w = view.work;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ key: string; blockers: string[]; warnings: string[] } | null>(null);
  const [back, setBack] = useState(false);
  // Stages in work order, as the server returns them («Mockup», number 7, stands between Spec and Implementation).
  const order = view.stages.map((x) => x.no);
  const here = order.indexOf(w.stage);
  const [toStage, setToStage] = useState(w.stage === 6 ? 4 : (order[Math.max(0, here - 1)] ?? 1));
  const [reason, setReason] = useState("");
  // The «Fix forward» tick is never preset and belongs to the stage and attempt it was set at: when the attempt changes
  // (a new failure) the tick is cleared — an old consent does not force a new failure.
  const [ticked, setTicked] = useState<string | null>(null);

  // A «did not pass» answer belongs to the stage, version and attempt it was received at.
  const attemptId = view.attempt?.id ?? null;
  const key = `${w.stage}:${JSON.stringify(view.version)}:${attemptId ?? ""}`;
  const live = answer?.key === key ? answer : null;
  const blockers = uniq([...view.blockers, ...(live?.blockers ?? [])]);
  const warnings = uniq([...view.warnings, ...(live?.warnings ?? [])]);
  const canForce = live !== null && live.blockers.length === 0 && live.warnings.length > 0 && view.blockers.length === 0;
  // What the server accepts on a send-back is its own decision (`view.sendBack`): the interface does not parse refusal texts.
  const offer = view.sendBack;
  const fixKey = `${w.stage}:${attemptId ?? ""}`;
  const fix = offer.fixForwardOffered && ticked === fixKey;

  // An action error most often means the page is out of date («the stage is already different», «the version changed»):
  // show it and re-read the work at once.
  const fail = (e: unknown) => {
    onError(errText(e));
    refresh();
  };
  const run = (p: Promise<unknown>) => {
    setBusy(true);
    onError(null);
    p.then(reload).catch(fail).finally(() => setBusy(false));
  };
  // «Next» / «Approve mockup» / «To verification» / «Roll out» / «Accept»: always with the version the owner sees on the screen
  // (and the attempt id for acceptance). Only the server allows it: did not pass — blockers/warnings above the button.
  const forward = (force: boolean) => {
    const version = view.version;
    let call;
    if (w.stage === 5) call = rpc.call("enter", { workId: w.id, expectedVersion: version!, force });
    else if (w.stage === 6) call = rpc.call("accept", { workId: w.id, expectedVersion: version!, attemptId: attemptId!, force, note });
    else call = rpc.call("handOver", { workId: w.id, expectedStage: w.stage, expectedVersion: version, note, force });
    setBusy(true);
    onError(null);
    call
      .then((r) => {
        if (r.ok) {
          setAnswer(null);
          setNote("");
          reload();
        } else setAnswer({ key, blockers: r.blockers, warnings: r.warnings });
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };
  // «Fix forward» goes with `fixForward`, and on top of an undecided rollout failure («Hand over anyway») — with `force` too.
  const sendBack = () => {
    setBusy(true);
    onError(null);
    rpc
      .call("sendBack", { workId: w.id, expectedStage: w.stage, toStage, reason: reason.trim(), ...(fix ? { fixForward: true } : {}), ...(fix && offer.needsForce ? { force: true } : {}) })
      .then(() => {
        setBack(false);
        setReason("");
        setTicked(null);
        reload();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  // «Send back to Implementation per report»: the server has already put together the reason and the variant from the red report.
  const byReport = () => {
    const r = view.returnByReport;
    if (!r) return;
    run(rpc.call("sendBack", { workId: w.id, expectedStage: w.stage, toStage: r.toStage, reason: r.reason, ...(r.fixForward ? { fixForward: true } : {}) }));
  };
  const reconfirm = (no: number) => run(rpc.call("reconfirm", { workId: w.id, expectedStage: w.stage, stage: no, expectedVersion: view.version! }));

  const reviewersLive = stage.threads.some((t) => t.role === "review" && !t.done);
  // The server knows whether a restart is needed: the stage thread crashed or is gone, or entering the stage failed. Not on any card error.
  const restart = w.canRestart;
  // Without a version on the screen (and an attempt for acceptance) there is nothing to hand over: the server checks exactly that.
  const lacksInput = ((w.stage === 5 || w.stage === 6) && view.version === null) || (w.stage === 6 && attemptId === null);
  const earlier = here < 0 ? [] : view.stages.slice(0, here);
  // Plugin rollout: always at Rollout; at Verification — if this work already had an attempt (after a failure the owner decides).
  const showPlugin = w.stage === 6 || (w.stage === 5 && view.attempt !== null);

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
      {blockers.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-red-600 dark:text-red-400">
          {blockers.map((b, i) => (
            <li key={i} className="whitespace-pre-wrap">• {b}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
          {warnings.map((m, i) => (
            <li key={i} className="whitespace-pre-wrap">• {m}</li>
          ))}
        </ul>
      ) : null}

      {view.reconfirm.length > 0 && view.version ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">The document was edited after the hand-over — review it and:</span>
          {view.reconfirm.map((no) => (
            <button key={no} type="button" disabled={busy} onClick={() => reconfirm(no)} className={btn}>
              Reconfirm «{view.stages.find((x) => x.no === no)?.title ?? no}»
            </button>
          ))}
        </div>
      ) : null}

      {view.ownerNeeds.length > 0 && w.stage !== 5 && w.stage !== 6 ? (
        <div className="rounded-md border border-amber-300 p-2 text-xs dark:border-amber-800">
          <p className="font-medium">Needed from you before implementation:</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {view.ownerNeeds.map((n, i) => (
              <li key={i} className="whitespace-pre-wrap">• {n}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">Done one? Tell the stage agent in the chat: it will check and tick the item. Keys go through the secrets skill, not into the chat.</p>
        </div>
      ) : null}

      {showPlugin ? (
        <div className="flex flex-col gap-2 border-b border-border pb-2">
          <AttemptLine attempt={view.attempt} rollbackAvailable={view.availability.rollback === null} />
          <PluginActions pluginId={w.pluginId} availability={view.availability} attempt={view.attempt} onDone={refresh} onError={onError} />
        </div>
      ) : null}

      {w.stage !== 5 ? (
        <textarea
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Note — optional (goes to the journal)"
          className={input}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {stage.reviewed ? (
          <button type="button" disabled={busy || reviewersLive} onClick={() => run(rpc.call("review", { workId: w.id, expectedStage: w.stage }))} className={btn} title="The review starts on its own; the button runs another round by hand">
            {stage.threads.some((t) => t.role === "review") ? "Another review round" : "Send to review"}
          </button>
        ) : null}
        {stage.reviewed && reviewersLive ? (
          <button type="button" disabled={busy} onClick={() => run(rpc.call("stopReviews", { workId: w.id, expectedStage: w.stage }))} className={btn}>
            Stop reviewers
          </button>
        ) : null}
        {restart ? (
          <button type="button" disabled={busy} onClick={() => run(rpc.call("restartStage", { workId: w.id, expectedStage: w.stage }))} className={btn}>
            Restart stage
          </button>
        ) : null}
        {view.returnByReport ? (
          <button type="button" disabled={busy} onClick={byReport} className={primary} title={view.returnByReport.reason}>
            {view.returnByReport.fixForward ? "Fix forward per report" : "Send back to Implementation per report"}
          </button>
        ) : null}
        <button type="button" disabled={busy || view.blockers.length > 0 || lacksInput} onClick={() => forward(false)} className={primary}>
          {busy ? "checking…" : (FORWARD[w.stage] ?? "Next")}
        </button>
        {canForce ? (
          <button type="button" disabled={busy} onClick={() => forward(true)} className={btn}>
            {w.stage === 6 ? "Accept anyway" : "Hand over anyway"}
          </button>
        ) : null}
        {w.stage >= 2 && !back ? (
          <button type="button" onClick={() => setBack(true)} className={btn}>
            Send back…
          </button>
        ) : null}
      </div>

      {back ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <select aria-label="Send back to stage" value={toStage} onChange={(e) => setToStage(Number(e.target.value))} className={input}>
            {earlier.map((x) => (
              <option key={x.no} value={x.no}>{view.stages.indexOf(x) + 1}. {x.title}</option>
            ))}
          </select>
          {offer.fixForwardOffered ? (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={fix} onChange={(e) => setTicked(e.target.checked ? fixKey : null)} />
                <span>Fix forward — the rolled-out code stays, the implementer fixes on top of it</span>
              </label>
              {offer.needsForce ? (
                <p className="text-[11px] text-muted-foreground">
                  The rollout failed or its outcome is unknown: the work can be sent back only by fixing forward — or first «Roll back» / «Disable».
                </p>
              ) : null}
            </>
          ) : null}
          <textarea
            aria-label="Reason for sending back"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What is wrong and why it goes back — the stage agent gets this as a message"
            className={input}
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy || reason.trim() === "" || (offer.fixForwardOffered && !fix)} onClick={sendBack} className={btn}>
              {offer.needsForce ? "Hand over anyway" : "Send back"}
            </button>
            <button type="button" onClick={() => setBack(false)} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
