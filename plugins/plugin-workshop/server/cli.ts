// `bb plugin-workshop list | show <id|KEY>` — read only. The CLI has no handoffs, rollbacks or installs: those happen only on the owner's buttons in the panel.
import type { Board, PluginView, WorkView } from "../contract";
import type { Api } from "./api";
import { COLUMNS, pos, stageOf } from "./stages";
import type { Store } from "./store";

export interface CliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

const COLUMN_TITLE = new Map(COLUMNS.map((c) => [c.key, c.title] as const));
const COLUMN_ORDER = new Map(COLUMNS.map((c, i) => [c.key, i] as const));

const stateText = (c: { bbState: string; stateStale: boolean }) => `${c.bbState}${c.stateStale ? " (stale)" : ""}`;
/** The stage number shown to people — its place in the work's order («Mockup» is 4th), not the stage's own number. */
const place = (no: number) => pos(no) + 1;
const workText = (w: NonNullable<Board["plugins"][number]["work"]>) => `${w.key ?? "(creating)"} ${place(w.stage)}. ${stageOf(w.stage).title} · ${w.state}${w.stale ? " · stale" : ""}`;

/** Plugins by board column, within a column — by id. */
export function renderList(board: Board): string {
  if (board.plugins.length === 0) return "no plugins";
  const sorted = [...board.plugins].sort((a, b) => (COLUMN_ORDER.get(a.column) ?? 0) - (COLUMN_ORDER.get(b.column) ?? 0) || a.id.localeCompare(b.id));
  return sorted
    .map((p) => `${(COLUMN_TITLE.get(p.column) ?? p.column).padEnd(15)} ${p.id.padEnd(22)} ${stateText(p).padEnd(20)} ${p.work ? workText(p.work) : "—"}`)
    .join("\n");
}

const short = (s: string | null) => (s ? s.slice(0, 7) : "—");
/** An attempt's error can be long (git or bb output): the text shows the first 500 characters, `--json` has all of it. */
const ERROR_MAX = 500;
const clip = (s: string) => ([...s].length > ERROR_MAX ? `${[...s].slice(0, ERROR_MAX).join("")}…` : s);

export function renderPlugin(p: PluginView): string {
  const lines = [`${p.id} «${p.name}» — ${COLUMN_TITLE.get(p.column) ?? p.column} — ${stateText(p)}`];
  lines.push(`  source: ${p.source ?? "—"}`);
  lines.push(`  working copy: ${p.dir ?? "—"} · branch ${p.branch ?? "—"} · HEAD ${short(p.head)} · uncommitted ${p.dirtyCount ?? "—"}`);
  lines.push(`  rolled-out commit: ${short(p.installedSha)}`);
  if (p.attempt) lines.push(`  last attempt: ${p.attempt.kind} ${p.attempt.id} — ${p.attempt.status}, step ${p.attempt.step}${p.attempt.error ? ` (${clip(p.attempt.error)})` : ""}${p.attempt.note ? `; ${clip(p.attempt.note)}` : ""}; before ${short(p.attempt.beforeSha)} → ${short(p.attempt.targetSha)}`);
  if (p.labels.length) lines.push(`  labels: ${p.labels.join("; ")}`);
  if (p.work) lines.push(`  work: ${workText(p.work)} — ${p.work.reason}`);
  lines.push(p.reworkBlockers.length ? "  «Rework» is closed:" : "  «Rework» is available", ...p.reworkBlockers.map((r) => `    - ${r}`));
  // «Adopt as rolled out» is a special case, not a regular button: it is mentioned only when there is something to adopt or something blocks it.
  const closed = Object.entries(p.availability).filter(([k, why]) => why !== null && !(k === "adopt" && why.includes("nothing to adopt")));
  const NAMES: Record<string, string> = { rollback: "roll back", reinstall: "install again", disable: "disable", enable: "enable", cancelInstall: "cancel install", adopt: "adopt as rolled out" };
  if (closed.length) lines.push("  unavailable:", ...closed.map(([k, why]) => `    - ${NAMES[k] ?? k}: ${why}`));
  if (p.pastTasks.length) lines.push(`  past tasks: ${p.pastTasks.map((t) => `${t.key} (${t.outcome})`).join(", ")}`);
  return lines.join("\n");
}

export function renderWork(v: WorkView): string {
  const w = v.work;
  if (!w.created) {
    const lines = [`(creating) «${w.title}» — being created — ${w.state}: ${w.reason}`, `  plugin: ${w.pluginId}`];
    if (v.events.length) lines.push("  journal:", ...v.events.slice(0, 5).map((e) => `    - ${e.text}`));
    return lines.join("\n");
  }
  const lines = [`${w.key} «${w.title}» — ${place(w.stage)}. ${stageOf(w.stage).title} — ${w.state}: ${w.reason}`];
  for (const s of v.stages) lines.push(`  ${place(s.no)}. ${s.title.padEnd(14)} threads ${s.threads.length} · files ${s.files.length}${s.stale ? " · stale" : ""}`);
  if (v.attempt) lines.push(`  attempt: ${v.attempt.kind} ${v.attempt.id} — ${v.attempt.status}, step ${v.attempt.step}${v.attempt.error ? ` (${clip(v.attempt.error)})` : ""}${v.attempt.note ? `; ${clip(v.attempt.note)}` : ""}`);
  if (v.baseAhead) lines.push("  the main branch of the working copy has moved ahead");
  if (v.blockers.length) lines.push("  blockers:", ...v.blockers.map((p) => `    - ${p}`));
  if (v.warnings.length) lines.push("  warnings:", ...v.warnings.map((p) => `    - ${p}`));
  return lines.join("\n");
}

export async function runCli(argv: string[], d: { api: Api; store: Store }): Promise<CliResult> {
  const [sub, ...rest] = argv;
  const json = rest.includes("--json");
  const arg = rest.find((a) => !a.startsWith("--"));
  if (sub === "list" || sub === undefined) {
    const board = await d.api.board();
    return { exitCode: 0, stdout: json ? JSON.stringify(board, null, 2) : renderList(board) };
  }
  if (sub === "show") {
    if (!arg) return { exitCode: 1, stderr: "a plugin id or a work key is required: bb plugin-workshop show <id|KEY>\n" };
    // First the plugin id (exact match), then a work — by its id or by the task key.
    if (d.store.plugin(arg)) {
      const view = await d.api.plugin(arg);
      return { exitCode: 0, stdout: json ? JSON.stringify(view, null, 2) : renderPlugin(view) };
    }
    const w = d.store.work(arg) ?? d.store.workByKey(arg.toUpperCase());
    if (!w) return { exitCode: 1, stderr: `not found: ${arg} — neither a plugin nor a work\n` };
    const view = await d.api.work(w.id);
    return { exitCode: 0, stdout: json ? JSON.stringify(view, null, 2) : renderWork(view) };
  }
  return { exitCode: 1, stderr: "commands: list, show\n" };
}
