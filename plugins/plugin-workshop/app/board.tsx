import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { Board, PluginCard, workshopContract } from "../contract";
import { CREATE_SLOW_MS, SHOW_REASON, STAGE_TITLE, STATE, bbState, btn, errCls, errText, type Created } from "./common";
import { NewPlugin, isRefusal, sortProblems, type Draft, type Problems } from "./new-plugin";
import { PluginSummary } from "./plugin";
import { WorkPage } from "./work";

/** The column collapsed by default: plugins without a work — retired and not installed. */
const COLLAPSED = "off";
/** A plugin's path across the board columns — with «Mockup» while its stage is on. */
const path = (board: Board | null) => (board ? board.columns.filter((c) => c.key !== COLLAPSED).map((c) => c.title).join(" → ") : "Context → … → In production");

type Page = null | { kind: "plugin"; id: string } | { kind: "work"; id: string; notice?: string };
/** The open «New plugin» form: empty, or with what was typed, returned by a refusal. */
interface FormState {
  key: number;
  initial?: Draft & { problems: Problems };
}
/** A board notice; `retry` — what was typed in the form, which can be restored if the form did not come back by itself. */
interface Notice {
  text: string;
  retry?: Draft;
}
const NO_PROBLEMS: Problems = { name: [], id: [], request: [], form: [] };
/** A creation whose answer the form did not wait for. */
interface Pending {
  key: number;
  label: string;
}

function CardView({ card, onOpen }: { card: PluginCard; onOpen: () => void }) {
  const bb = bbState(card.bbState);
  const w = card.work;
  const s = w ? (STATE[w.state] ?? { text: w.state, cls: "" }) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex flex-col gap-1 rounded-md border bg-background p-2 text-left hover:bg-accent ${bb.alert ? "border-red-500/70" : "border-border"}`}
    >
      <span className="text-sm font-medium leading-snug">{card.name}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{card.id}</span>
      <span className={`text-[10px] ${bb.cls}`}>● {bb.text}</span>
      {card.labels.length > 0 ? (
        <span className="flex flex-wrap gap-1 text-[10px]">
          {card.labels.map((l) => (
            <span key={l} className="rounded border border-border px-1 text-muted-foreground">{l}</span>
          ))}
        </span>
      ) : null}
      {w && s ? (
        <span className="flex flex-col gap-0.5 border-t border-border pt-1 text-[10px]">
          <span className="text-muted-foreground">{w.key === null ? "being created" : `${w.key} · ${STAGE_TITLE[w.stage] ?? w.stage}`}</span>
          <span className="flex flex-wrap gap-2">
            <span className={s.cls}>● {s.text}</span>
            {w.stale ? <span className="text-orange-600 dark:text-orange-400">stale</span> : null}
            {w.pilot === "on" ? <span className="text-emerald-600 dark:text-emerald-400">autopilot</span> : null}
            {w.pilot === "paused" || w.pilot === "stopped" ? <span className="text-orange-600 dark:text-orange-400">autopilot halted</span> : null}
          </span>
          {w.reason && (SHOW_REASON.has(w.state) || w.key === null) ? <span className="line-clamp-3 text-muted-foreground">{w.reason}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export function WorkshopPanel({ createSlowMs = CREATE_SLOW_MS }: { subPath?: string; createSlowMs?: number }) {
  const rpc = useRpc<typeof workshopContract>();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(null);
  const pageRef = useRef<Page>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const formRef = useRef<FormState | null>(null);
  const formKeys = useRef(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const handoffs = useRef(0);
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
      .call("board", null)
      .then((d) => {
        if (mine !== seq.current) return;
        setBoard(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(errText(e));
      });
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime("plugin-workshop", () => load());

  const go = (p: Page) => {
    pageRef.current = p;
    setPage(p);
  };
  const back = () => {
    go(null);
    load();
  };
  const openForm = (initial?: FormState["initial"]) => {
    const f = { key: ++formKeys.current, ...(initial ? { initial } : {}) };
    formRef.current = f;
    setForm(f);
  };
  const closeForm = () => {
    formRef.current = null;
    setForm(null);
  };
  const openWork = (id: string, noticeText?: string) => go({ kind: "work", id, ...(noticeText ? { notice: noticeText } : {}) });

  // The form got the creation answer: the work is recorded. A creation step error is shown on the work page, which opens either way.
  const createdHere = (r: Created) => {
    closeForm();
    load();
    openWork(r.workId, r.error ?? undefined);
  };
  // The answer came after the form handed the wait to the board: the error goes on the board; the work opens only if the owner is still on the board.
  const createdLater = (label: string, r: Created) => {
    load();
    if (r.error) setNotice({ text: `Creation of «${label}»: ${r.error}` });
    if (pageRef.current === null) openWork(r.workId, r.error ?? undefined);
  };
  // The form did not wait for the answer (the scaffold takes a while, the call may have timed out): the board waits. The card appears on
  // the plugin's signal, the finished work opens by itself. A form validation refusal (a taken id) means the work was not recorded: the form
  // comes back with what was typed and the error under the field — at once or when the owner returns to the board. Any other failure proves
  // nothing: the form is left alone, what was typed can be restored with the button in the notice.
  const handoff = (label: string, call: Promise<Created>, draft?: Draft) => {
    const key = ++handoffs.current;
    closeForm();
    go(null);
    setNotice(null);
    setPending((p) => [...p, { key, label }]);
    const settle = () => setPending((p) => p.filter((x) => x.key !== key));
    call.then(
      (r) => {
        if (!alive.current) return;
        settle();
        createdLater(label, r);
      },
      (e: unknown) => {
        if (!alive.current) return;
        settle();
        const message = errText(e);
        const problems = draft ? sortProblems(message) : null;
        if (draft && problems && isRefusal(problems)) {
          const text = `Creation of «${label}»: the work was not recorded: ${message}`;
          // The owner is already filling in another form — it is not overwritten; what was typed comes back by the button.
          if (formRef.current === null) {
            setNotice({ text });
            openForm({ ...draft, problems });
          } else setNotice({ text, retry: draft });
        } else setNotice({ text: `Creation of «${label}» is not confirmed: ${message} — the work may have been recorded, check the board`, ...(draft ? { retry: draft } : {}) });
        load();
      },
    );
  };

  if (page?.kind === "work") return <WorkPage workId={page.id} notice={page.notice} onBack={back} onOpenPlugin={(id) => go({ kind: "plugin", id })} />;
  if (page?.kind === "plugin")
    return <PluginSummary pluginId={page.id} slowMs={createSlowMs} onBack={back} onOpenWork={(id) => openWork(id)} onCreated={createdHere} onHandoff={handoff} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
      <header className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{path(board)}; you hand over each stage</span>
        <span className="flex-1" />
        <button type="button" onClick={() => openForm()} className={btn}>
          New plugin
        </button>
      </header>
      {error ? <div className={errCls}>{error}</div> : null}
      {notice ? (
        <div className={`flex items-start gap-2 ${errCls}`}>
          <span className="flex-1">{notice.text}</span>
          {notice.retry ? (
            <button
              type="button"
              onClick={() => {
                openForm({ ...notice.retry!, problems: NO_PROBLEMS });
                setNotice(null);
              }}
              className="text-foreground hover:underline"
            >
              Restore what you typed
            </button>
          ) : null}
          <button type="button" onClick={() => setNotice(null)} className="text-muted-foreground hover:underline">
            dismiss
          </button>
        </div>
      ) : null}
      {pending.map((p) => (
        <div key={p.key} className="text-xs text-muted-foreground">
          «{p.label}» is being created… the scaffold takes a while; the card will appear on the board and the work will open by itself when ready.
        </div>
      ))}
      {form ? <NewPlugin key={form.key} slowMs={createSlowMs} initial={form.initial} onCancel={closeForm} onCreated={createdHere} onHandoff={handoff} /> : null}
      {board === null && error === null ? <div className="text-xs text-muted-foreground">loading…</div> : null}
      {board ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${board.columns.length}, minmax(0, 1fr))`, minWidth: board.columns.length * 185 }}>
          {board.columns.map((col) => {
            const cards = board.plugins.filter((p) => p.column === col.key);
            const collapsible = col.key === COLLAPSED;
            const shown = !collapsible || expanded[col.key] === true;
            const title = cards.length > 0 ? `${col.title} · ${cards.length}` : col.title;
            return (
              <section key={col.key} className="flex min-h-[260px] flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2">
                <h2 className="px-1 text-xs font-semibold text-muted-foreground">
                  {collapsible ? (
                    <button
                      type="button"
                      aria-expanded={shown}
                      onClick={() => setExpanded((o) => ({ ...o, [col.key]: !shown }))}
                      className="flex w-full items-center gap-1 text-left hover:text-foreground"
                    >
                      <span>{title}</span>
                      <span aria-hidden="true">{shown ? "▾" : "▸"}</span>
                    </button>
                  ) : (
                    title
                  )}
                </h2>
                {shown ? cards.map((c) => <CardView key={c.id} card={c} onOpen={() => (c.work ? openWork(c.work.id) : go({ kind: "plugin", id: c.id }))} />) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
