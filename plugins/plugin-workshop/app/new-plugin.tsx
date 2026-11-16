import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { WorkModels, workshopContract } from "../contract";
import { slugify } from "../server/stages";
import { btn, errCls, field, primary, raceCreation, type Created } from "./common";
import { ModelsPicker } from "./models-picker";

export type Problems = { name: string[]; id: string[]; request: string[]; form: string[] };
const NONE: Problems = { name: [], id: [], request: [], form: [] };

/** What was typed in the form: so a refusal that arrives after the form left the screen does not wipe the name, id and description. */
export interface Draft {
  name: string;
  id: string;
  idTouched: boolean;
  request: string;
  /** Agent models; null — not loaded yet (the server takes the defaults). */
  models?: WorkModels | null;
}
/** A form validation refusal (name, id, description) — the work was not recorded then. Anything else (a timeout, a failure) does not prove it is not there. */
export const isRefusal = (p: Problems) => p.name.length + p.id.length + p.request.length > 0;

/**
 * The server's refusal (`validateNewPlugin`) is one line «reason; reason; …». Each reason goes under its field;
 * an unrecognised one goes under the form, nothing is lost.
 */
export function sortProblems(message: string): Problems {
  const out: Problems = { name: [], id: [], request: [], form: [] };
  for (const part of message.split("; ")) {
    const p = part.trim();
    if (!p) continue;
    if (/^(a name is required|name )/.test(p)) out.name.push(p);
    else if (/^(an id is required|id )/.test(p)) out.id.push(p);
    else if (/^(a description is required|description )/.test(p)) out.request.push(p);
    else out.form.push(p);
  }
  return out;
}

// The new plugin form: a human name, the id (filled in from the name, editable), the description.
// A fast creation answer (a form refusal) — errors under the fields; a slow one (the scaffold takes a while) — the wait goes to the board.
export function NewPlugin({
  slowMs,
  initial,
  onCancel,
  onCreated,
  onHandoff,
}: {
  slowMs: number;
  /** Returned after a refusal: what was typed and the errors under the fields. */
  initial?: Draft & { problems: Problems };
  onCancel: () => void;
  onCreated: (created: Created) => void;
  onHandoff: (label: string, call: Promise<Created>, draft: Draft) => void;
}) {
  const rpc = useRpc<typeof workshopContract>();
  const [name, setName] = useState(initial?.name ?? "");
  const [idRaw, setIdRaw] = useState(initial?.id ?? "");
  const [idTouched, setIdTouched] = useState(initial?.idTouched ?? false);
  const [request, setRequest] = useState(initial?.request ?? "");
  const [models, setModels] = useState<WorkModels | null>(initial?.models ?? null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problems>(initial?.problems ?? NONE);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Until the owner edits the id, it follows the name.
  const id = idTouched ? idRaw : name.trim() ? slugify(name) : "";
  const ready = name.trim() !== "" && id.trim() !== "" && request.trim() !== "";

  const submit = async () => {
    setBusy(true);
    setProblems(NONE);
    const call = rpc.call("newPlugin", { name: name.trim(), id: id.trim(), request: request.trim(), ...(models ? { models } : {}) });
    const r = await raceCreation(call, slowMs);
    if (!alive.current) return;
    if (r.kind === "slow") return onHandoff(name.trim(), call, { name, id, idTouched: true, request, models });
    setBusy(false);
    if (r.kind === "fail") setProblems(sortProblems(r.message));
    else onCreated(r.value);
  };
  const under = (key: keyof Problems) => (problems[key].length > 0 ? <p role="alert" className={errCls}>{problems[key].join("; ")}</p> : null);

  return (
    <section className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">New plugin</h2>
      <div data-field="name" className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Name</span>
          <input
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setProblems((p) => ({ ...p, name: [] }));
            }}
            placeholder="In plain words — e.g. «Expense tracker»"
            className={field}
          />
        </label>
        {under("name")}
      </div>
      <div data-field="id" className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Id</span>
          <input
            value={id}
            maxLength={40}
            onChange={(e) => {
              setIdRaw(e.target.value);
              setIdTouched(true);
              setProblems((p) => ({ ...p, id: [] }));
            }}
            placeholder="lowercase Latin letters, digits and hyphens — filled in from the name"
            className={`${field} font-mono`}
          />
        </label>
        {under("id")}
      </div>
      <div data-field="request" className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Description</span>
          <textarea
            value={request}
            rows={6}
            maxLength={20000}
            onChange={(e) => {
              setRequest(e.target.value);
              setProblems((p) => ({ ...p, request: [] }));
            }}
            placeholder="What the plugin should do — in your own words. The Context agent will clarify the details in conversation."
            className={field}
          />
        </label>
        {under("request")}
      </div>
      <ModelsPicker value={models} onChange={setModels} />
      {problems.form.length > 0 ? <p role="alert" className={errCls}>{problems.form.join("; ")}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !ready} onClick={() => void submit()} className={primary}>
          {busy ? "creating…" : "Create"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={btn}>
          Cancel
        </button>
      </div>
    </section>
  );
}
