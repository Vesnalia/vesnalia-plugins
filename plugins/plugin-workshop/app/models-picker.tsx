import { useEffect, useState } from "react";
import { useRpc } from "@vesnalia/plugin-sdk/app";
import type { AgentChoice, ModelCatalog, WorkModels, workshopContract } from "../contract";
import { EFFORTS, GROUP_TITLE } from "../agent-models";
import { errCls, field } from "./common";

type Row = "docs" | "build" | "check" | "pilot" | "subagents";
type Effort = AgentChoice["effort"];
/** Row titles are the server's group titles: its errors about the choice name the group the same way. */
const ROWS: Array<{ key: Row; title: string; hint?: string }> = [
  { key: "docs", title: GROUP_TITLE.docs },
  { key: "build", title: GROUP_TITLE.build },
  { key: "check", title: GROUP_TITLE.check },
  { key: "pilot", title: GROUP_TITLE.pilot },
  { key: "subagents", title: GROUP_TITLE.subagents, hint: "Claude only" },
];

const keyOf = (c: AgentChoice) => `${c.providerId}|${c.model}`;
const label = (c: AgentChoice) => `${c.label || c.model}${c.effort ? ` · ${c.effort}` : ""}`;
const asEffort = (v: string): Effort => ((EFFORTS as readonly string[]).includes(v) ? (v as Effort) : null);
/** A short line of the choice — in the block header and on the work page. */
export function modelsSummary(m: WorkModels): string {
  const reviewers = m.reviewers.length === 0 ? "no reviewers" : `reviewers: ${m.reviewers.map(label).join(", ")}`;
  return `documents ${label(m.docs)} · implementation ${label(m.build)} · verification ${label(m.check)} · ${reviewers}`;
}

const modelIn = (catalog: ModelCatalog, c: AgentChoice) => catalog.providers.find((p) => p.id === c.providerId)?.models.find((m) => m.id === c.model) ?? null;
/** A model not in the list: the level is reset — there is nothing to check it against. */
const tidy = (catalog: ModelCatalog, c: AgentChoice): AgentChoice => (modelIn(catalog, c) || c.effort === null ? c : { ...c, effort: null });

/** The model and level of one row; kept out of the render so the selects are not recreated on every input. */
function ModelSelect({ catalog, c, set, onlyClaude, aria }: { catalog: ModelCatalog; c: AgentChoice; set: (c: AgentChoice) => void; onlyClaude: boolean; aria: string }) {
  const m = modelIn(catalog, c);
  const pick = (k: string) => {
    const [providerId, model] = k.split("|") as [string, string];
    const found = catalog.providers.find((x) => x.id === providerId)?.models.find((x) => x.id === model);
    if (found && (!onlyClaude || providerId === "claude-code")) set({ providerId, model, effort: null, label: found.label });
  };
  return (
    <span className="flex flex-wrap gap-1">
      <select aria-label={`${aria}: model`} className={field} value={keyOf(c)} onChange={(e) => pick(e.target.value)}>
        {m ? null : <option value={keyOf(c)}>{label(c)} (not in the list)</option>}
        {catalog.providers
          .filter((p) => !onlyClaude || p.id === "claude-code")
          .map((p) => (
            <optgroup key={p.id} label={p.error ? `${p.name} — unavailable: ${p.error}` : p.name}>
              {p.models.map((x) => (
                <option key={x.id} value={`${p.id}|${x.id}`}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      {!onlyClaude ? (
        <select aria-label={`${aria}: level`} className={field} value={m ? (c.effort ?? "") : ""} onChange={(e) => set({ ...c, effort: asEffort(e.target.value) })}>
          <option value="">default level{m?.defaultEffort ? ` (${m.defaultEffort})` : ""}</option>
          {(m?.efforts ?? []).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      ) : null}
    </span>
  );
}

/**
 * The work's agent models — chosen before the start, as in VesnALIA's new-thread dialog: model and reasoning level per stage group,
 * the orchestrator, the Implementation subagents and the reviewers (0–2). The list comes from VesnALIA; if it does not arrive, the defaults stay.
 */
export function ModelsPicker({ value, onChange }: { value: WorkModels | null; onChange: (m: WorkModels) => void }) {
  const rpc = useRpc<typeof workshopContract>();
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reviewers removed by lowering the count: they come back if the count goes up again.
  const [spare, setSpare] = useState<AgentChoice[]>([]);
  useEffect(() => {
    let live = true;
    rpc
      .call("models", null)
      .then((c) => {
        if (!live) return;
        setCatalog(c);
        if (c.error) setError(`the model list did not arrive: ${c.error} — the defaults will be used`);
        const v = value ?? c.defaults;
        onChange({ ...v, docs: tidy(c, v.docs), build: tidy(c, v.build), check: tidy(c, v.check), pilot: tidy(c, v.pilot), subagents: tidy(c, v.subagents), reviewers: v.reviewers.map((r) => tidy(c, r)) });
      })
      .catch((e: unknown) => live && setError(`the model list did not arrive: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live = false;
    };
    // The list is read once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc]);

  if (!catalog || !value) return error ? <p className={errCls}>{error}</p> : <p className="text-xs text-muted-foreground">models: loading…</p>;

  const setCount = (n: number) => {
    if (n < value.reviewers.length) {
      setSpare([...value.reviewers.slice(n), ...spare]);
      onChange({ ...value, reviewers: value.reviewers.slice(0, n) });
      return;
    }
    const add = n - value.reviewers.length;
    const from = [...spare, ...catalog.defaults.reviewers.slice(value.reviewers.length + spare.length)];
    setSpare(spare.slice(add));
    onChange({ ...value, reviewers: [...value.reviewers, ...from.slice(0, add)] });
  };

  return (
    <details className="rounded-md border border-border p-2 text-xs">
      <summary className="cursor-pointer">
        <span className="font-semibold">Agent models</span> <span className="text-muted-foreground">— {modelsSummary(value)}</span>
      </summary>
      <div className="mt-2 grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-2">
        {ROWS.map((r) => (
          <label key={r.key} className="contents">
            <span title={r.hint}>
              {r.title}
              {r.hint ? <span className="block text-[10px] text-muted-foreground">{r.hint}</span> : null}
            </span>
            <ModelSelect catalog={catalog} aria={r.title} c={value[r.key]} onlyClaude={r.key === "subagents"} set={(c) => onChange({ ...value, [r.key]: c })} />
          </label>
        ))}
        <span>Reviewers</span>
        <select aria-label="Reviewers: how many" className={`${field} w-max`} value={value.reviewers.length} onChange={(e) => setCount(Number(e.target.value))}>
          <option value={0}>no reviews</option>
          <option value={1}>one</option>
          <option value={2}>two</option>
        </select>
        {value.reviewers.map((c, i) => (
          <label key={i} className="contents">
            <span>Reviewer {i + 1}</span>
            <ModelSelect catalog={catalog} aria={`Reviewer ${i + 1}`} c={c} onlyClaude={false} set={(n) => onChange({ ...value, reviewers: value.reviewers.map((x, j) => (j === i ? n : x)) })} />
          </label>
        ))}
      </div>
      <p className="mt-2 text-muted-foreground">
        The choice is fixed when the work starts and does not change afterwards. Reviewers check the spec and the code; without reviews the work
        goes faster and costs less, but without a second opinion. Subagents are used only when Implementation runs on Claude.
      </p>
      {error ? <p className={errCls}>{error}</p> : null}
    </details>
  );
}
