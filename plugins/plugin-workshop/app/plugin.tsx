import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import type { AttemptView, AvailabilityView, PluginView, workshopContract, WorkModels } from "../contract";
import { REASON_MAX, STAGE_TITLE, STATE, attemptText, aliaState, btn, errCls, errText, input, primary, raceCreation, short, when, type Created } from "./common";
import { ModelsPicker } from "./models-picker";

// --- the rollout attempt and the plugin actions: the same on the plugin summary and on the work page (stage 6) ---

/**
 * The plugin's last rollout attempt: what it is doing or where it stopped, the error, the commits. The «rollback point» is the commit
 * before a rollout attempt, and only while a rollback to it is available (`rollbackAvailable`); for a rollback and a reinstall, and once
 * the rollback is closed, it is just «before the attempt».
 */
export function AttemptLine({ attempt, rollbackAvailable }: { attempt: AttemptView | null; rollbackAvailable: boolean }) {
  if (!attempt) return null;
  const bad = attempt.status === "failed" || attempt.status === "unknown";
  const point = attempt.kind === "enter" && rollbackAvailable;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className={bad ? errCls : ""}>{attemptText(attempt)}</span>
      {attempt.error ? <span className="text-muted-foreground">{attempt.error}</span> : null}
      {attempt.note ? <span className="text-muted-foreground">{attempt.note}</span> : null}
      {attempt.beforeSha || attempt.targetSha ? (
        <span className="text-muted-foreground">
          before the attempt{point ? " (rollback point)" : ""} {short(attempt.beforeSha)} · target {short(attempt.targetSha)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Buttons by `availability` from the server: available — `null`, otherwise the reason. The interface allows nothing by itself.
 * After every press (a refusal too) — `onDone`: the card and the page are re-read and show the outcome. «Try to cancel install»
 * promises nothing: the job may have finished installing — the card will show the outcome.
 */
export function PluginActions({
  pluginId,
  availability,
  attempt,
  aliaState: pluginState,
  onDone,
  onError,
}: {
  pluginId: string;
  availability: AvailabilityView;
  attempt: AttemptView | null;
  /** The plugin's state in VesnALIA, if known (the summary): a disabled plugin shows «Enable» even when both actions are closed. */
  aliaState?: string;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const rpc = useRpc<typeof workshopContract>();
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [reason, setReason] = useState("");
  const [adopting, setAdopting] = useState(false);
  const [note, setNote] = useState("");
  const a = availability;

  const run = (p: Promise<unknown>, after?: () => void) => {
    setBusy(true);
    onError(null);
    p.then(() => after?.())
      .catch((e: unknown) => onError(errText(e)))
      .finally(() => {
        setBusy(false);
        onDone();
      });
  };

  const canDisable = a.disable === null;
  const canEnable = a.enable === null;
  // «Disable» and «Enable» are one switch: the available one is shown; with both closed — the one that fits the plugin:
  // «Enable» (with the reason) for a disabled plugin, otherwise «Disable». «Disable» on a disabled plugin only records the decision on a failure.
  const off = pluginState === "disabled";
  const showEnable = canEnable || off;
  const showDisable = canDisable || (!canEnable && !off);
  const showReinstall = a.reinstall === null || attempt?.status === "unknown";
  const showCancel = a.cancelInstall === null;
  const rows: Array<[string, string | null]> = [["Roll back", a.rollback]];
  if (showDisable) rows.push(["Disable", a.disable]);
  if (showEnable) rows.push(["Enable", a.enable]);
  if (showReinstall) rows.push(["Install again", a.reinstall]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || a.rollback !== null} title={a.rollback ?? undefined} onClick={() => setRolling(true)} className={btn}>
          Roll back…
        </button>
        {showDisable ? (
          <button type="button" disabled={busy || !canDisable} title={a.disable ?? undefined} onClick={() => run(rpc.call("setEnabled", { pluginId, on: false }))} className={btn}>
            Disable
          </button>
        ) : null}
        {showEnable ? (
          <button type="button" disabled={busy || !canEnable} title={a.enable ?? undefined} onClick={() => run(rpc.call("setEnabled", { pluginId, on: true }))} className={btn}>
            Enable
          </button>
        ) : null}
        {showReinstall ? (
          <button type="button" disabled={busy || a.reinstall !== null} title={a.reinstall ?? undefined} onClick={() => run(rpc.call("reinstall", { pluginId }))} className={btn}>
            Install again
          </button>
        ) : null}
        {showCancel ? (
          <button type="button" disabled={busy} onClick={() => run(rpc.call("cancelInstall", { pluginId }))} className={btn}>
            Try to cancel install
          </button>
        ) : null}
        {/* Only when there is something to adopt: the main branch moved ahead of the rolled-out commit outside the Workshop. */}
        {a.adopt === null ? (
          <button type="button" disabled={busy} onClick={() => setAdopting(true)} className={btn} title="The working copy was changed outside the Workshop: install it and record the previous version as the rollback point">
            Adopt as rolled out…
          </button>
        ) : null}
      </div>
      {showCancel ? (
        <p className="text-[11px] text-muted-foreground">A queued job is dropped at once; a running one may still finish installing — the card will show the outcome.</p>
      ) : null}
      {rows.some(([, why]) => why !== null) ? (
        <ul className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          {rows
            .filter(([, why]) => why !== null)
            .map(([name, why]) => (
              <li key={name}>{name}: {why}</li>
            ))}
        </ul>
      ) : null}
      {adopting && a.adopt === null ? (
        <div className="flex max-w-2xl flex-col gap-2 rounded-md border border-border p-2">
          <p className="text-xs">
            The plugin's main branch moved ahead of the rolled-out commit outside the Workshop. The Workshop will install it under the build
            lock and record the previous rolled-out commit as the rollback point.
          </p>
          <textarea
            aria-label="What the change is"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={REASON_MAX}
            placeholder="What the change is and why we adopt it — goes to the journal"
            className={input}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || note.trim() === ""}
              onClick={() =>
                run(rpc.call("adopt", { pluginId, note: note.trim() }), () => {
                  setAdopting(false);
                  setNote("");
                })
              }
              className={btn}
            >
              Adopt as rolled out
            </button>
            <button type="button" onClick={() => setAdopting(false)} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {rolling && a.rollback === null ? (
        <div className="flex max-w-2xl flex-col gap-2 rounded-md border border-border p-2">
          <p className="text-xs">A rollback restores only the code, not the plugin's data.</p>
          <textarea
            aria-label="Rollback reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={REASON_MAX}
            placeholder="Why we roll back — the reason is required and goes to the journal"
            className={input}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || reason.trim() === ""}
              onClick={() =>
                run(rpc.call("rollback", { pluginId, reason: reason.trim() }), () => {
                  setRolling(false);
                  setReason("");
                })
              }
              className={btn}
            >
              Roll back
            </button>
            <button type="button" onClick={() => setRolling(false)} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- the plugin summary ---

const OUTCOME: Record<string, string> = { done: "accepted", canceled: "canceled" };

/** A short summary of a plugin without an open work: its state in VesnALIA, source, working copy, rolled-out commit, rollback point, buttons. */
export function PluginSummary({
  pluginId,
  slowMs,
  onBack,
  onOpenWork,
  onCreated,
  onHandoff,
}: {
  pluginId: string;
  slowMs: number;
  onBack: () => void;
  onOpenWork: (workId: string) => void;
  onCreated: (created: Created) => void;
  onHandoff: (label: string, call: Promise<Created>) => void;
}) {
  const rpc = useRpc<typeof workshopContract>();
  const [view, setView] = useState<PluginView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reworking, setReworking] = useState(false);
  const [request, setRequest] = useState("");
  const [models, setModels] = useState<WorkModels | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    rpc
      .call("plugin", { pluginId })
      .then((v) => {
        if (mine !== seq.current) return;
        setView(v);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(errText(e));
      });
  }, [rpc, pluginId]);
  useEffect(load, [load]);
  useRealtime("plugin-workshop", (p) => {
    const s = p as { pluginId?: string | null } | null;
    if (s?.pluginId == null || s.pluginId === pluginId) load();
  });

  const back = (
    <button type="button" onClick={onBack} className="mb-3 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
      ← Board
    </button>
  );
  if (!view)
    return (
      <div className="p-6 text-xs">
        {back}
        <div className={error ? errCls : "text-muted-foreground"}>{error ?? "loading…"}</div>
      </div>
    );

  const alia = aliaState(view.aliaState);
  const w = view.work;
  const ws = w ? (STATE[w.state] ?? { text: w.state, cls: "" }) : null;
  const closed = view.reworkBlockers.length > 0;

  const startRework = async () => {
    setBusy(true);
    setFormError(null);
    const call = rpc.call("rework", { pluginId, request: request.trim(), ...(models ? { models } : {}) });
    const r = await raceCreation(call, slowMs);
    if (!alive.current) return;
    if (r.kind === "slow") return onHandoff(view.name, call);
    setBusy(false);
    if (r.kind === "fail") setFormError(r.message);
    else onCreated(r.value);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
      <div>{back}</div>
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-base font-semibold">{view.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">{view.id}</span>
        <span className={`text-xs ${alia.cls}`}>● {alia.text}</span>
        <span className="flex-1" />
        <button type="button" onClick={load} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" title="reload the summary from the server">
          Refresh
        </button>
      </header>
      {view.labels.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {view.labels.map((l) => (
            <span key={l} className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{l}</span>
          ))}
        </div>
      ) : null}
      {error ? <div className={errCls}>{error}</div> : null}

      {!w && view.labels.some((l) => l.startsWith("gone:")) ? (
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-xs">
          <span className="text-muted-foreground">The plugin is neither in VesnALIA nor in its folder. The card can be hidden from the board: the history and the id stay; if the plugin reappears, the card comes back.</span>
          <span className="flex-1" />
          <button
            type="button"
            className={btn}
            onClick={() => {
              setError(null);
              rpc
                .call("hidePlugin", { pluginId })
                .then(onBack)
                .catch((e: unknown) => setError(errText(e)));
            }}
          >
            Hide from board
          </button>
        </section>
      ) : null}

      {w && ws ? (
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-xs">
          <span>Work in progress: {w.key ?? "(being created)"} · {STAGE_TITLE[w.stage] ?? w.stage}</span>
          <span className={ws.cls}>● {ws.text}</span>
          {w.reason ? <span className="text-muted-foreground">{w.reason}</span> : null}
          <span className="flex-1" />
          <button type="button" onClick={() => onOpenWork(w.id)} className={btn}>
            Open work
          </button>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Working copy</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Source</dt>
          <dd className="break-all">{view.source ?? "—"}</dd>
          <dt className="text-muted-foreground">Folder</dt>
          <dd className="break-all">{view.dir ?? "—"}</dd>
          <dt className="text-muted-foreground">Branch</dt>
          <dd>{view.branch ?? "—"}</dd>
          <dt className="text-muted-foreground">HEAD</dt>
          <dd className="font-mono">{short(view.head)}</dd>
          <dt className="text-muted-foreground">Uncommitted changes</dt>
          <dd>{view.dirtyCount ?? "—"}</dd>
          <dt className="text-muted-foreground">Rolled-out commit</dt>
          <dd className="font-mono">{short(view.installedSha)}</dd>
          <dt className="text-muted-foreground">GitHub</dt>
          <dd className="break-all">
            {view.githubUrl ? (
              <a href={view.githubUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                {view.githubUrl.replace(/^https:\/\//, "")}
              </a>
            ) : (
              "no repository (or not reconciled yet)"
            )}
          </dd>
        </dl>
      </section>

      {view.attempt ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Last rollout attempt</h2>
          <AttemptLine attempt={view.attempt} rollbackAvailable={view.availability.rollback === null} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Actions</h2>
        <div className="flex flex-col gap-1">
          <div>
            <button type="button" disabled={closed || reworking} onClick={() => setReworking(true)} className={primary}>
              Rework
            </button>
          </div>
          {closed ? (
            <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
              <span>«Rework» is closed:</span>
              <ul className="flex flex-col gap-0.5">
                {view.reworkBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {reworking && !closed ? (
          <div className="flex max-w-2xl flex-col gap-2 rounded-lg border border-border p-3">
            <textarea
              aria-label="What to rework"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={5}
              maxLength={20000}
              placeholder="What to change in the plugin — in your own words. The Context agent will clarify the details in conversation."
              className={input}
            />
            <ModelsPicker value={models} onChange={setModels} />
            {formError ? <div role="alert" className={errCls}>{formError}</div> : null}
            <div className="flex gap-2">
              <button type="button" disabled={busy || request.trim() === ""} onClick={() => void startRework()} className={primary}>
                {busy ? "creating…" : "Start rework"}
              </button>
              <button type="button" disabled={busy} onClick={() => setReworking(false)} className={btn}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <PluginActions pluginId={view.id} availability={view.availability} attempt={view.attempt} aliaState={view.aliaState} onDone={load} onError={setActionError} />
        {actionError ? <div className={errCls}>{actionError}</div> : null}
      </section>

      {view.pastTasks.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Past works</h2>
          <ul className="flex flex-col gap-0.5 text-xs">
            {view.pastTasks.map((t) => (
              <li key={t.key}>
                {t.key} · {OUTCOME[t.outcome] ?? t.outcome}
                {t.finishedAt ? ` · ${when(t.finishedAt)}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
