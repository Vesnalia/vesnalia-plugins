// The work's autopilot: the orchestrator — an agent thread with the Workshop tools — runs the work to the end on the owner's
// behalf: answers the stage agents, hands stages over, sends back on red reports, rolls the plugin out and accepts it. Each of its
// actions goes through the same engine or Rollout method as the owner's button: the same gates, versions, journal. The orchestrator's
// thread is not one of the stage threads (`stage_runs`): cleaning up the work, a rollback and a stage restart do not touch it.
//
// Waking: the work waits for a decision (state `owner`; a failure, an unknown or unexpected outcome — two reconciles in a row), the
// orchestrator's thread is free, SETTLE_MS have passed since the last message to the agent and the last action → the orchestrator gets a
// status packet. A situation key (stage, iteration, state, reason, gates, HEAD, the agent thread's stamp, attempt) does not wake twice; the
// orchestrator's answer (an action or «wait») records the key it answered. No answer for QUIET_MS — a reminder; none again — a stop.
//
// Hard stops (`hardStop`) are enforced here, in code, before an action reaches the engine: the orchestrator's own `force` does not lift
// them. Its decisions are made from text it does not control — stage agents' replies, work files, the plugin's code — so a prompt injection
// or a plain mistake must not be able to push a work past them. The owner's buttons keep their own force semantics.
import { createHash, randomUUID } from "node:crypto";
import type { WorkViewCore } from "../contract";
import { errText, SETTLE_MS, type Engine } from "./engine";
import { BUSY, type Ports } from "./ports";
import type { Rollout } from "./rollout";
import { redact, secretFileName } from "./secrets";
import { modelsOf, reviewersOf } from "./models";
import { atOrAfter, nextStage, stageOf, type StageNo } from "./stages";
import type { PilotRow, PilotState, Store, WorkRow } from "./store";

export const PILOT_TOOLS = ["plugin_workshop_status", "plugin_workshop_act", "plugin_workshop_file"] as const;
export const PILOT_ACTIONS = [
  "answer", "forward", "report_back", "back", "enter", "accept", "rollback", "reinstall", "restart", "review", "stop_reviews", "wait", "stop", "report",
] as const;
export type PilotActionName = (typeof PILOT_ACTIONS)[number];
export interface PilotAct {
  action: PilotActionName;
  /** The answer to the agent, the reason of a send-back / rollback / stop, the note of a hand-over or acceptance, the report text. */
  text?: string;
  toStage?: number;
  force?: boolean;
  fixForward?: boolean;
}

/** No answer to a wake for this long — a reminder; silence a second time — a stop. */
export const QUIET_MS = 10 * 60_000;
/** Actions (not counting «wait») per run; beyond that — a stop: something is going in circles. */
export const MAX_ACTIONS = 150;
export const MAX_AGE_MS = 24 * 3600_000;
/** The third red check in a row — a stop instead of a send-back. */
export const MAX_REDS = 3;
/** Reconciles in a row in a failing state before waking: transient errors (a thread status did not arrive) pass by themselves. */
export const ERROR_TICKS = 2;
/** `force` from the orchestrator needs a reason at least this long in `text`: it goes to the journal next to the warnings it lifted. */
export const MIN_FORCE_REASON = 20;
const OUTPUT_MAX = 6000;
const FAILING = new Set(["error", "unknown", "unexpected"]);

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The orchestrator's regulation: the first message of its thread. */
export function pilotRules(w: WorkRow, notes: string): string {
  return [
    `You are the autopilot orchestrator of the Plugin Workshop: you run work ${w.task_key} «${w.title}» (plugin \`${w.plugin_id}\`) to the end on the owner's behalf. The owner turned the autopilot on themselves and stepped away.`,
    "",
    "The owner's request (their will):",
    w.request,
    ...(notes.trim() ? ["", "What matters to the autopilot (from the owner):", notes.trim()] : []),
    "",
    "How you work:",
    "- You act only through the tools `plugin_workshop_status` (the work's state), `plugin_workshop_file` (a work file; screenshots come as images) and `plugin_workshop_act` (one owner action). You do not edit files, commit nothing, press no buttons any other way and do not write to the stage agents directly — only via `answer`.",
    "- The Workshop wakes you with a message carrying a status packet when the work is waiting for the owner's decision. For each wake — exactly one `plugin_workshop_act` action (or `wait` with a reason, if waiting is right just now), then end your turn.",
    "- Answer agents briefly and to the point. Choose the simplest reasonable option. Start every decision made for the owner with «Decided for the owner:» — it goes into the report.",
    "- Do not invent keys, passwords, accounts or paid plans. Do not agree to anything paid or irreversible in external systems (emails, publications, money, writes to other people's production systems) without the owner's explicit word in the request.",
    "",
    "By stage:",
    "- Context: the agent asks questions — answer from the request, «what matters» and common sense; pick the section badge (code and colour) to fit the plugin's meaning and the sections already on the bar. context.md ready with no open questions — `forward`.",
    "- Feasibility: verdict IMPOSSIBLE — `stop`. owner.md has open items about keys, accounts, money, access — `stop` with the list (only the owner can provide them). Decide the other owner.md items yourself and ask the agent (`answer`) to record each decision in owner.md and check the item off (`- [x] … — decided by the autopilot: …`), then `forward`. The Workshop does not let you move the work into Implementation or beyond while owner.md has an open item.",
    reviewersOf(modelsOf(w.models)).length === 0
      ? "- Spec: the work has no reviewers (the owner chose so) — the spec is ready and the gates are clean — `forward`."
      : "- Spec: the reviews run by themselves; wait until the agent has closed the items; the gates are clean — `forward`.",
    "- Mockup: you approve it yourself. Look at the screenshots (`plugin_workshop_file` desktop.png and phone.png) and compare them with the spec's interface description. A mismatch or something plainly ugly — `answer` with corrections. Everything matches — `forward` (that is «Approve mockup»).",
    "- Implementation: the agent has finished and the gates are clean — `forward`. Stuck and asking — `answer`.",
    "- Verification: FAIL — `report_back`. PASS — `enter` (roll out).",
    "- Rollout: the live check is green — `accept`. Red: the plugin does not load or breaks other things — `rollback` with a reason; otherwise — `report_back` (fix forward). The plugin asks for configuration (needs-configuration) with keys — `stop`.",
    "- A failed or unknown install outcome: `reinstall` only on an unknown outcome; otherwise `rollback` or `back` with fixForward and force; «the working copy is in an unexpected state» — `stop`.",
    "- The stage thread crashed or vanished — `restart`.",
    "- GitHub reports «the work branch looks like it contains keys» — `stop`: a key in the work branch is for the owner to sort out. Other GitHub failures are retried by the Workshop; until the current commit has a clean publication check, the hard stops below hold `forward`, `enter` and `accept`.",
    "- The Workshop handles GitHub itself: the work branch goes there with every commit, from Implementation on there is a PR, on «Accept» main goes to GitHub and the PR merges by itself — this is neither the owner's decision nor your action.",
    `- Gate warnings are lifted by \`force: true\` — only with an explanation of at least ${MIN_FORCE_REASON} characters in \`text\` of why it is safe; it goes to the journal. Force does not lift blockers.`,
    "- Hard stops, checked by the Workshop itself and not lifted by force: an IMPOSSIBLE feasibility verdict (no `forward` from Feasibility); open owner.md items or a missing owner.md (no move into Implementation or beyond); with GitHub on, anything but a clean publication check of the work branch's current commit — a key finding, a check that did not complete, no verdict (no `forward`, `enter` or `accept`); a red live check (no `accept`). Trying one of those stops you and calls the owner. Without a usable green live check report `accept` is refused.",
    "- A third red check in a row, the limits and silence stop you by themselves — then the owner decides.",
    "- After `accept` the Workshop wakes you one last time: write the summary with `report` — what was done, which decisions you made for the owner, where the mockup, the PR and the rolled-out commit are, what is left for the owner.",
  ].join("\n");
}

/** A short note for the orchestrator's thread (configure): who it is and what it acts with. */
export function pilotIdentity(w: WorkRow): string {
  return `You are the autopilot orchestrator of work ${w.task_key ?? w.id} «${w.title}» in the Plugin Workshop. You act only through the tools plugin_workshop_status / plugin_workshop_act / plugin_workshop_file; you do not edit files and do not commit.`;
}

export class Pilot {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly ports: Ports,
    private readonly engine: Engine,
    private readonly rollout: Rollout,
  ) {}

  /** One operation on a work's autopilot at a time: reconcile, action, start and stop do not overlap. */
  private serial<T>(workId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(workId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(workId, next.catch(() => undefined));
    return next;
  }

  private now(): number {
    return this.ports.now();
  }

  private log(workId: string, text: string): void {
    this.store.log(workId, "pilot", text, this.now());
    this.ports.changed(workId);
  }

  /** A task comment (notes, stop reasons, the final report): token-shaped text is redacted before it goes to the tracker. */
  private async comment(w: WorkRow, text: string): Promise<void> {
    if (w.task_id) await this.ports.tasks.comment(w.task_id, redact(text)).catch(() => undefined);
  }

  // --- owner buttons ---

  /** «Start autopilot» (and «Start again» after a stop): a new orchestrator thread, counters from zero. */
  start(workId: string, notes: string): Promise<void> {
    return this.serial(workId, async () => {
      const w = this.store.work(workId);
      if (!w || w.created !== 1 || !w.project_id || !w.task_key) throw new Error("the work is still being created — start the autopilot later");
      if (w.outcome) throw new Error("the work is finished");
      const p = this.store.pilot(workId);
      if (p?.state === "on") throw new Error("the autopilot is already running this work");
      const opKey = `pilot:${workId}:${randomUUID().slice(0, 8)}`;
      // The previous orchestrator thread («Start again») goes to the archive: VesnALIA cleans up its environment.
      if (p?.thread_id) await this.ports.archive(p.thread_id).catch(() => undefined);
      this.store.startPilot(workId, notes.trim().slice(0, 4000), opKey, this.now());
      this.log(workId, "autopilot started by the owner");
      await this.comment(w, `Autopilot started: the orchestrator runs the work to the end${notes.trim() ? `; what matters: ${clip(notes.trim(), 500)}` : ""}.`);
      await this.spawn(w, this.store.pilot(workId)!);
    });
  }

  /** «Resume autopilot» after a pause or a stop: the same thread if it is alive, otherwise a new one. The in-a-row counters start from zero. */
  resume(workId: string): Promise<void> {
    return this.serial(workId, async () => {
      const w = this.store.work(workId);
      const p = this.store.pilot(workId);
      if (!w || !p) throw new Error("the autopilot was never started for this work");
      if (w.outcome) throw new Error("the work is finished");
      if (p.state === "on") return;
      this.store.patchPilot(workId, { state: "on", reason: null, quiet: 0, error_ticks: 0, reds: 0, actions: 0, handled_key: null, wake_key: null, woken_at: null, started_at: this.now(), stopped_at: null }, this.now());
      this.log(workId, "autopilot resumed by the owner");
      const st = p.thread_id ? await this.ports.status(p.thread_id).catch(() => "unknown" as const) : "unknown";
      if (!p.thread_id || st === "error" || st === "unknown") await this.respawn(w, this.store.pilot(workId)!);
    });
  }

  /** «Stop autopilot»: the work stays as it is; the orchestrator's thread is stopped but stays readable. */
  stopByOwner(workId: string): Promise<void> {
    return this.serial(workId, async () => {
      const p = this.store.pilot(workId);
      if (!p || (p.state !== "on" && p.state !== "paused")) return;
      await this.halt(workId, "stopped", "stopped by the owner");
    });
  }

  /** The owner pressed a work button: the autopilot pauses — one work does not need two masters. */
  ownerActed(workId: string, what: string): Promise<void> {
    return this.serial(workId, async () => {
      const p = this.store.pilot(workId);
      if (p?.state !== "on") return;
      this.store.patchPilot(workId, { state: "paused", reason: `the owner pressed «${what}» — the autopilot is paused; «Resume autopilot» brings it back` }, this.now());
      this.log(workId, `autopilot paused: the owner pressed «${what}»`);
    });
  }

  /** `fromAct` — the orchestrator itself caused the stop with its tool: its turn is not cut off, otherwise the tool's answer would not reach it. */
  private async halt(workId: string, state: PilotState, reason: string, fromAct = false): Promise<void> {
    const p = this.store.pilot(workId);
    if (!p) return;
    this.store.patchPilot(workId, { state, reason, stopped_at: this.now() }, this.now());
    this.log(workId, `autopilot ${state === "done" ? "finished" : "stopped"}: ${reason}`);
    const w = this.store.work(workId);
    if (w && state === "stopped") await this.comment(w, `Autopilot stopped: ${reason}. The owner is needed — the work page, the «Autopilot» tab.`);
    if (p.thread_id && state !== "done" && !fromAct) {
      const st = await this.ports.status(p.thread_id).catch(() => "unknown" as const);
      if (BUSY.includes(st)) await this.ports.stop(p.thread_id).catch(() => undefined);
    }
  }

  // --- the orchestrator's thread ---

  private async spawn(w: WorkRow, p: PilotRow): Promise<void> {
    const now = this.now();
    this.store.patchPilot(w.id, { spawned_at: now, thread_id: null }, now);
    const packet = await this.packet(w.id, true).catch((e) => `The work's state was not read: ${errText(e)} — call plugin_workshop_status.`);
    const id = await this.ports.spawn({
      projectId: w.project_id!,
      // Its own environment: a stray edit by the orchestrator does not land in the work branch.
      environment: { kind: "new-worktree", hostId: w.host_id },
      providerId: modelsOf(w.models).pilot.providerId,
      model: modelsOf(w.models).pilot.model,
      reasoningLevel: modelsOf(w.models).pilot.effort,
      title: `${w.task_key} · Autopilot`,
      prompt: `${pilotRules(w, p.notes)}\n\n---\n\n${packet}`,
      hidden: false,
      metadata: { workId: w.id, opKey: p.op_key, stage: 0, role: "pilot", who: "claude" },
    });
    this.store.patchPilot(w.id, { thread_id: id, wake_key: null, woken_at: now, quiet: 0 }, this.now());
    this.log(w.id, `orchestrator thread: ${id}`);
  }

  private async respawn(w: WorkRow, p: PilotRow): Promise<void> {
    if (p.thread_id) await this.ports.archive(p.thread_id).catch(() => undefined);
    const opKey = `pilot:${w.id}:${randomUUID().slice(0, 8)}`;
    this.store.patchPilot(w.id, { op_key: opKey }, this.now());
    await this.spawn(w, { ...p, op_key: opKey });
  }

  /** The orchestrator's thread: the recorded one, or one found by the spawn key (the spawn answer got lost). */
  private async threadOf(w: WorkRow, p: PilotRow): Promise<string | null> {
    if (p.thread_id) return p.thread_id;
    if (!p.spawned_at || !w.project_id) return null;
    const found = await this.ports.findThread(w.project_id, p.op_key, p.spawned_at - 60_000);
    if (found) this.store.patchPilot(w.id, { thread_id: found }, this.now());
    return found;
  }

  /**
   * The thread that configure gives the tools and the note to: the recorded autopilot thread. Thread metadata can be written by any API
   * client or agent, so the spawn key in it counts only while the spawn is pending — the autopilot has no recorded thread yet (configure
   * runs at thread start, before `spawn` returns the id). Once the id is recorded, only that exact thread qualifies.
   */
  identity(threadId: string, meta: unknown): string | null {
    const byThread = this.store.pilotByThread(threadId);
    const m = (meta !== null && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
    const p = byThread ?? (m.role === "pilot" && typeof m.workId === "string" && typeof m.opKey === "string" ? this.store.pilot(m.workId) : null);
    if (!p) return null;
    if (!byThread && (p.thread_id !== null || p.spawned_at === null || p.op_key !== m.opKey)) return null;
    const w = this.store.work(p.work_id);
    return w ? pilotIdentity(w) : null;
  }

  // --- reconcile ---

  async tickAll(): Promise<void> {
    for (const p of this.store.pilots().filter((x) => x.state !== "done")) await this.tick(p.work_id).catch((e) => this.store.log(p.work_id, "warn", `autopilot: ${errText(e)}`, this.now()));
  }

  /** The work ended without the autopilot (canceled, or the owner accepted it while the autopilot was stopped): the autopilot closes, the thread is archived. */
  private async close(w: WorkRow, p: PilotRow): Promise<void> {
    await this.halt(w.id, "done", w.outcome === "canceled" ? "the work was canceled" : "the owner finished the work");
    if (p.thread_id) await this.ports.archive(p.thread_id).catch(() => undefined);
  }

  /** The reconcile of a work's autopilot: whether to wake the orchestrator, whether it is time to stop. */
  tick(workId: string): Promise<void> {
    return this.serial(workId, async () => {
      const p = this.store.pilot(workId);
      const w = this.store.work(workId);
      if (!p || !w || p.state === "done") return;
      if (w.outcome === "canceled" || (w.outcome === "done" && p.state !== "on")) return this.close(w, p);
      if (p.state !== "on") return;
      const now = this.now();
      if (w.outcome !== "done" && now - p.started_at > MAX_AGE_MS) return this.halt(workId, "stopped", "the autopilot has been running for more than a day");
      const thread = await this.threadOf(w, p);
      if (!thread) {
        if (p.spawned_at && now - p.spawned_at > 5 * 60_000) await this.respawn(w, p);
        return;
      }
      const st = await this.ports.status(thread);
      if (st === "error" || st === "unknown") {
        if (p.thread_failures + 1 >= 2) return this.halt(workId, "stopped", "the orchestrator thread crashed twice");
        this.store.patchPilot(workId, { thread_failures: p.thread_failures + 1 }, now);
        this.log(workId, "the orchestrator thread crashed — starting a new one");
        return this.respawn(w, this.store.pilot(workId)!);
      }
      if (BUSY.includes(st)) return;
      if (w.outcome === "done") return this.wakeFinal(w, p, thread);
      const s = await this.situation(w, p);
      this.store.patchPilot(workId, { error_ticks: s.failing ? p.error_ticks + 1 : 0 }, now);
      if (!s.decide || (s.failing && p.error_ticks + 1 < ERROR_TICKS)) return;
      if (s.settling) return;
      if (s.key === p.handled_key) {
        // It answered «wait» (or acted) and the situation has not changed since: after QUIET_MS — wake it, reminding it what it was waiting for.
        if (p.handled_at === null || now - p.handled_at < QUIET_MS) return;
        this.store.patchPilot(workId, { handled_at: now }, now);
        const waited = p.handled_note ? `You were waiting: «${p.handled_note}»` : "After your action";
        await this.ports.send(thread, `${waited} — the situation has not changed in ${Math.round(QUIET_MS / 60_000)} minutes. Decide again: one plugin_workshop_act action.\n\n${await this.packet(workId, false)}`);
        return;
      }
      if (s.key === p.wake_key) {
        if (p.woken_at !== null && now - p.woken_at < QUIET_MS) return;
        if (p.quiet + 1 >= 2) return this.halt(workId, "stopped", "the orchestrator does not respond to wakes");
        this.store.patchPilot(workId, { quiet: p.quiet + 1, woken_at: now }, now);
        await this.ports.send(thread, `Reminder: the work is waiting for your decision and there was no action. Take one plugin_workshop_act action (or wait with a reason).\n\n${await this.packet(workId, false)}`);
        return;
      }
      this.store.patchPilot(workId, { wake_key: s.key, woken_at: now, quiet: 0 }, now);
      await this.ports.send(thread, await this.packet(workId, false));
    });
  }

  private async wakeFinal(w: WorkRow, p: PilotRow, thread: string): Promise<void> {
    const now = this.now();
    if (p.report) return this.finish(w, p);
    if (p.wake_key !== "final") {
      this.store.patchPilot(w.id, { wake_key: "final", woken_at: now, quiet: 0 }, now);
      await this.ports.send(thread, `Work ${w.task_key} is accepted and closed. Write the final report to the owner with one plugin_workshop_act action {action: "report", text}: what was done, which decisions you made for the owner, where the mockup, the PR and the rolled-out commit are, what is left for the owner.`);
      return;
    }
    if (p.woken_at !== null && now - p.woken_at < QUIET_MS) return;
    this.store.patchPilot(w.id, { report: "The orchestrator did not write a final report; the work is accepted — the history is in the work's journal." }, now);
    await this.finish(w, this.store.pilot(w.id)!);
  }

  private async finish(w: WorkRow, p: PilotRow): Promise<void> {
    await this.halt(w.id, "done", "the work is accepted");
    if (p.thread_id) await this.ports.archive(p.thread_id).catch(() => undefined);
  }

  /** The work's situation for the autopilot: whether it waits for a decision, the key, whether it is too early (the agent was just written to, the orchestrator just acted). */
  private async situation(w: WorkRow, p: PilotRow): Promise<{ decide: boolean; failing: boolean; settling: boolean; key: string; view: WorkViewCore }> {
    const view = await this.engine.view(w.id);
    const state = view.work.state;
    const failing = FAILING.has(state);
    const current = view.stages.find((s) => s.no === view.work.stage);
    const stageRun = current?.threads.filter((t) => t.role === "stage").at(-1) ?? null;
    const stageThread = stageRun?.threadId ?? null;
    // The state in the database is set by the engine's reconcile; the live status of the agent's thread is fresher: the agent is already working — nothing to decide.
    const decide = (state === "owner" || failing) && !(stageRun !== null && (BUSY as readonly string[]).includes(stageRun.status));
    const stamp = stageThread ? await this.ports.threadStamp(stageThread).catch(() => null) : null;
    const now = this.now();
    const sent = stageThread ? this.store.lastOpAt(w.id, stageThread) : null;
    const settling = (sent !== null && now - sent < SETTLE_MS) || (p.acted_at !== null && now - p.acted_at < SETTLE_MS);
    const key = sha(
      JSON.stringify([view.work.stage, view.work.iteration, state, view.work.reason, view.blockers, view.warnings, view.version?.headSha ?? null, stageThread, stamp, view.attempt?.id ?? null, view.attempt?.status ?? null]),
    );
    return { decide, failing, settling, key, view };
  }

  /** The status packet: what the owner sees on the work page, in words — for a decision. */
  async packet(workId: string, first: boolean): Promise<string> {
    const w = this.store.work(workId);
    if (!w) throw new Error("work not found");
    const v = await this.engine.view(workId);
    const stage = stageOf(v.work.stage as StageNo);
    const place = v.stages.findIndex((s) => s.no === v.work.stage) + 1;
    const lines: string[] = [];
    lines.push(`${first ? "Start. " : ""}Work ${w.task_key} «${w.title}», plugin \`${w.plugin_id}\` — stage ${place}. ${stage.title}, iteration ${v.work.iteration}.`);
    lines.push(`State: ${v.work.state} — ${v.work.reason}`);
    if (v.blockers.length) lines.push("Holding it back (blockers; force does not lift them):", ...v.blockers.map((b) => `- ${b}`));
    if (v.warnings.length) lines.push(`Warnings (force with an explanation of at least ${MIN_FORCE_REASON} characters lifts them, except the hard stops):`, ...v.warnings.map((b) => `- ${b}`));
    if (v.ownerNeeds.length) lines.push("Open owner.md items (needed from the owner):", ...v.ownerNeeds.map((b) => `- ${b}`));
    if (v.returnByReport) lines.push(`Send-back per report available: to stage ${v.returnByReport.toStage}${v.returnByReport.fixForward ? " (fix forward)" : ""} — ${v.returnByReport.reason}`);
    if (v.sendBack.needsForce) lines.push("Undecided rollout failure: a send-back only with fixForward and force (or rollback / reinstall).");
    if (v.attempt) lines.push(`Install attempt: ${v.attempt.kind} ${v.attempt.id} — ${v.attempt.status}, step ${v.attempt.step}${v.attempt.error ? ` (${clip(v.attempt.error, 400)})` : ""}`);
    if (w.pr_url) lines.push(`PR of the work branch on GitHub: ${w.pr_url} — it merges by itself on «Accept».`);
    const gh = this.engine.githubProblem(workId);
    if (gh) lines.push(`GitHub: ${gh}`);
    if (v.reconfirm.length) lines.push(`Stale stage documents: ${v.reconfirm.join(", ")} — the owner reconfirms them; a reason to stop if it is in the way.`);
    const current = v.stages.find((s) => s.current);
    if (current?.files.length) lines.push("Stage files (plugin_workshop_file):", ...current.files.map((f) => `- ${f.path} — ${f.label}${f.verdict ? `, verdict ${f.verdict}` : ""}`));
    const stageThread = current?.threads.filter((t) => t.role === "stage").at(-1);
    if (v.work.environmentId) {
      const dir = await this.ports.worktreeDir(v.work.environmentId).catch(() => null);
      if (dir) lines.push(`The work's worktree (read-only): ${dir}`);
    }
    if (stageThread) {
      const out = await this.ports.threadOutput(stageThread.threadId).catch(() => null);
      lines.push(`Stage agent: ${stageThread.who}, thread ${stageThread.threadId}, ${stageThread.status}.`);
      if (out) lines.push("Its last reply:", "<<<", clip(out, OUTPUT_MAX), ">>>");
    }
    lines.push(`Actions: ${this.available(v, w).join(", ")}. One plugin_workshop_act action for this message.`);
    return lines.join("\n");
  }

  private available(v: WorkViewCore, w: WorkRow): PilotActionName[] {
    const s = v.work.stage;
    const reviews = reviewersOf(modelsOf(w.models)).length > 0;
    const base: PilotActionName[] = ["answer", "back", "restart", "wait", "stop"];
    if (s === 5) return ["enter", ...(v.returnByReport ? (["report_back"] as const) : []), ...(reviews ? (["review"] as const) : []), ...base];
    if (s === 6) return ["accept", ...(v.returnByReport ? (["report_back"] as const) : []), "rollback", "reinstall", ...base];
    return ["forward", ...(s === 3 && reviews ? (["review", "stop_reviews"] as const) : []), ...base];
  }

  // --- tools ---

  /** Only the work's autopilot thread, and only while the autopilot is not stopped; a thread not recorded yet is found by the spawn key. */
  private async authorize(threadId: string, needOn: boolean): Promise<{ p: PilotRow; w: WorkRow }> {
    let p = this.store.pilotByThread(threadId);
    if (!p) {
      for (const cand of this.store.pilots().filter((x) => x.thread_id === null && x.state === "on")) {
        const w = this.store.work(cand.work_id);
        if (w && (await this.threadOf(w, cand)) === threadId) {
          p = this.store.pilot(cand.work_id);
          break;
        }
      }
    }
    if (!p) throw new Error("this is a Plugin Workshop autopilot tool — it works only in a work's orchestrator thread");
    const w = this.store.work(p.work_id);
    if (!w) throw new Error("work not found");
    if (needOn && p.state !== "on") throw new Error(`the autopilot is ${p.state === "paused" ? "paused" : p.state === "done" ? "finished" : "stopped"}${p.reason ? `: ${p.reason}` : ""} — no actions`);
    return { p, w };
  }

  async statusTool(threadId: string): Promise<string> {
    const { w } = await this.authorize(threadId, false);
    return this.packet(w.id, false);
  }

  async fileTool(threadId: string, path: string): Promise<{ text: string } | { image: string; mime: string }> {
    const { w } = await this.authorize(threadId, false);
    // Key files are not handed to the orchestrator's model provider (the file endpoint refuses them too).
    if (secretFileName(path)) throw new Error("this file cannot be opened: a key file by name");
    const f = await this.engine.file(w.id, path);
    if (f.text !== null) return { text: clip(f.text, 60_000) };
    if (f.data !== null && f.mime.startsWith("image/")) return { image: f.data, mime: f.mime };
    return { text: `file ${path}: ${f.mime}, ${f.size} bytes — neither text nor an image` };
  }

  /**
   * What the orchestrator may never do on its own, whatever the gates say and whatever its `force`: `halt` — it is stopped and the owner is
   * called; `refuse` — the action is refused (there is simply nothing to accept yet). Checked for the actions that move a work on or publish
   * it: `forward`, `enter`, `accept`. A fact that cannot be established halts or refuses rather than passes: with GitHub on, only a `clean`
   * publication verdict on exactly the current commit lets a move through (without a verdict the check runs now); into Implementation and
   * beyond, `owner.md` must be readable and have no open item.
   */
  private async hardStop(w: WorkRow, a: PilotAct, v: WorkViewCore): Promise<{ halt: string } | { refuse: string } | null> {
    const stage = v.work.stage as StageNo;
    // A move from the wrong stage (forward from Verification, enter outside it, …) is refused by the action itself.
    const moves = (a.action === "forward" && stage !== 5 && stage !== 6) || (a.action === "enter" && stage === 5) || (a.action === "accept" && stage === 6);
    if (!moves) return null;
    if (!v.version) return { refuse: "the work's version could not be read — try again" };
    // What cannot be shown to be publishable is not handed on, rolled out or accepted by the autopilot: a key finding, a check that did not
    // complete, and no verdict at all for this commit.
    const scan = await this.engine.ensureScan(w, v.version);
    if (scan?.state === "findings") return { halt: `the work branch ${scan.text}` };
    if (scan?.state === "failed") return { halt: `the publication check of the work branch did not complete: ${scan.text}` };
    if (scan?.state === "unscanned") return { halt: `the work branch's current commit has no publication verdict${scan.text ? `: ${scan.text}` : ""}` };
    // The same target as the owner's «Next» (`Engine.handOver`): Spec goes to Mockup or straight to Implementation; enter and accept are beyond it.
    const into = a.action === "forward" ? nextStage(stage, this.engine.mockupStageOn()) : 6;
    if (atOrAfter(into, 4)) {
      // owner.md is a required document once Feasibility is passed: missing or unreadable is not «nothing open».
      let owner: { open: string[] } | null;
      try {
        owner = await this.engine.ownerChecklist(w);
      } catch (e) {
        return { halt: `owner.md could not be read (${clip(redact(errText(e)), 300)}) — what the owner provides before Implementation is unknown` };
      }
      if (owner === null) return { halt: "owner.md is missing — what the owner provides before Implementation is unknown" };
      if (owner.open.length > 0) return { halt: `owner.md has open items — only the owner provides them before Implementation: ${clip(owner.open.join("; "), 500)}` };
    }
    const f = await this.engine.gateFacts(w, v.version);
    if (a.action === "forward" && stage === 2 && f.tech === "impossible") return { halt: "the feasibility verdict is IMPOSSIBLE — whether to go on is the owner's decision" };
    if (a.action === "accept") {
      const live = f.live;
      if (live && !live.invalid && live.verdict === "fail") return { halt: "the live check is red — the autopilot accepts only on a green live check" };
      if (!live || live.invalid || live.verdict !== "pass") return { refuse: "the autopilot accepts only on a green live check report for this rollout — there is none yet" };
    }
    return null;
  }

  /** One orchestrator action. The answer is in words: what was done, or why not. */
  actTool(threadId: string, a: PilotAct): Promise<string> {
    return (async () => {
      const { w: w0 } = await this.authorize(threadId, a.action !== "report");
      return this.serial(w0.id, () => this.act(threadId, a));
    })();
  }

  private async act(threadId: string, a: PilotAct): Promise<string> {
    const { p, w } = await this.authorize(threadId, a.action !== "report");
    const now = this.now();
    const text = (a.text ?? "").trim();
    if (a.action === "report") {
      if (!text) throw new Error("the report text is required");
      this.store.patchPilot(w.id, { report: text.slice(0, 20000) }, now);
      this.log(w.id, "autopilot: final report");
      await this.comment(w, `Autopilot report:\n\n${text}`);
      if (w.outcome === "done") await this.finish(w, this.store.pilot(w.id)!);
      return "report recorded";
    }
    if (w.outcome) throw new Error("the work is finished — no actions except report");
    // The orchestrator's force lifts warnings only with a reason the owner can read later in the journal.
    if (a.force === true && text.length < MIN_FORCE_REASON) throw new Error(`force needs a reason of at least ${MIN_FORCE_REASON} characters in text: why passing the warnings is safe`);
    const s = await this.situation(w, p);
    const v = s.view;
    const stage = v.work.stage;
    const stop = await this.hardStop(w, a, v);
    if (stop && "halt" in stop) {
      await this.halt(w.id, "stopped", `hard stop: ${stop.halt}`, true);
      return `stopped: ${stop.halt}. This is a hard stop — force does not lift it; the owner decides.`;
    }
    if (stop) return `not done: ${stop.refuse}.`;
    /** The journal line of a forced action: which warnings were lifted, and why (the orchestrator's reason). */
    const forced = (warnings: string[]) => (a.force && warnings.length > 0 ? ` (despite warnings: ${clip(warnings.join("; "), 500)})` : "");
    /**
     * The action is done: the «answered» key is the situation after the action (not before: the message to the agent itself changes its
     * thread's stamp, and the same situation would wake the orchestrator a second time before the agent has started its turn).
     */
    const done = async (label: string, result: string, reds?: number): Promise<string> => {
      const fresh = this.store.pilot(w.id)!;
      const actions = fresh.actions + 1;
      const after = await this.situation(this.store.work(w.id)!, fresh).catch(() => null);
      this.store.patchPilot(w.id, { actions, acted_at: this.now(), handled_key: after?.key ?? s.key, handled_at: this.now(), handled_note: null, quiet: 0, ...(reds !== undefined ? { reds } : {}) }, this.now());
      this.log(w.id, `autopilot: ${label}${text ? `: ${clip(text, 300)}` : ""}`);
      if (actions >= MAX_ACTIONS) await this.halt(w.id, "stopped", `${MAX_ACTIONS} actions in one run — the work seems to be going in circles`, true);
      return result;
    };
    const red = async (label: string, run: () => Promise<void>): Promise<string> => {
      if (p.reds + 1 >= MAX_REDS) {
        await this.halt(w.id, "stopped", `third red check in a row (${label}) — the owner decides`, true);
        return "stopped: third red check in a row";
      }
      await run();
      return done(label, "done", p.reds + 1);
    };
    switch (a.action) {
      case "wait":
        this.store.patchPilot(w.id, { handled_key: s.key, handled_at: now, handled_note: text ? clip(text, 300) : null, quiet: 0 }, now);
        this.log(w.id, `autopilot waits${text ? `: ${clip(text, 300)}` : ""}`);
        return "waiting; you will be woken when the situation changes (or after 10 minutes without change)";
      case "stop":
        await this.halt(w.id, "stopped", text || "the orchestrator stopped", true);
        return "stopped; the owner will get the reason";
      case "answer": {
        if (!text) throw new Error("the answer text is required");
        const current = v.stages.find((x) => x.current);
        const t = current?.threads.filter((x) => x.role === "stage").at(-1);
        if (!t) throw new Error("the stage has no agent thread — restart");
        const st = await this.ports.status(t.threadId);
        if (BUSY.includes(st)) throw new Error("the stage agent is still working — wait");
        const key = `${w.id}:pilot:answer:${now}:${randomUUID().slice(0, 6)}`;
        this.store.beginOp(key, w.id, "send", null, now);
        await this.ports.send(t.threadId, `Owner (autopilot): ${text}`);
        this.store.finishOp(key, t.threadId, this.now());
        return done("answer to the stage agent", "answer sent to the stage agent");
      }
      case "forward": {
        if (stage === 5) throw new Error("from Verification — enter (roll out)");
        if (stage === 6) throw new Error("at Rollout — accept");
        const r = await this.engine.handOver(w.id, { expectedStage: stage, expectedVersion: v.version, note: `autopilot${text ? `: ${text}` : ""}`, force: a.force === true });
        if (!r.ok) return `not handed over. Blockers: ${r.blockers.join("; ") || "none"}. Warnings: ${r.warnings.join("; ") || "none"}.`;
        return done(`handed over the «${stageOf(stage as StageNo).title}» stage${forced(r.warnings)}`, "handed over");
      }
      case "report_back": {
        const rb = v.returnByReport;
        if (!rb) throw new Error("no send-back per report right now (the report is not red, or the force path is needed — back with fixForward and force)");
        return red("send-back to Implementation per report", () => this.engine.sendBack(w.id, { expectedStage: stage, toStage: rb.toStage, reason: rb.reason, fixForward: rb.fixForward }));
      }
      case "back": {
        if (typeof a.toStage !== "number") throw new Error("toStage is required");
        if (!text) throw new Error("a send-back reason is required (text)");
        const run = () => this.engine.sendBack(w.id, { expectedStage: stage, toStage: a.toStage!, reason: `autopilot: ${text}`, ...(a.fixForward ? { fixForward: true } : {}), ...(a.force ? { force: true } : {}) });
        if ((stage === 5 || stage === 6) && a.toStage === 4) return red(`send-back to Implementation${a.force ? " (with force)" : ""}`, run);
        await run();
        return done(`sent the work back to stage ${a.toStage}${a.force ? " (with force)" : ""}`, "sent back");
      }
      case "enter": {
        if (stage !== 5 || !v.version) throw new Error("roll out — only from Verification");
        const r = await this.rollout.enter(w.id, { expectedVersion: v.version, force: a.force === true });
        if (!r.ok) return `rollout not started. Blockers: ${r.blockers.join("; ") || "none"}. Warnings: ${r.warnings.join("; ") || "none"}.`;
        // The red counter is not reset: a red live check after the rollout is the same loop (it resets only on acceptance).
        return done(`roll out${forced(r.warnings)}`, "rollout started");
      }
      case "accept": {
        if (stage !== 6 || !v.version || !v.attempt) throw new Error("accept — only at Rollout with a finished attempt");
        const r = await this.rollout.accept(w.id, { expectedVersion: v.version, attemptId: v.attempt.id, force: a.force === true, note: `autopilot${text ? `: ${text}` : ""}` });
        if (!r.ok) return `not accepted. Blockers: ${r.blockers.join("; ") || "none"}. Warnings: ${r.warnings.join("; ") || "none"}.`;
        return done(`accepted the work${forced(r.warnings)}`, "accepted; wait for the request for the final report", 0);
      }
      case "rollback":
        if (!text) throw new Error("a rollback reason is required (text)");
        return red("rollback", () => this.rollout.rollback(w.plugin_id, `autopilot: ${text}`));
      case "reinstall":
        await this.rollout.reinstall(w.plugin_id);
        return done("install again", "reinstall started");
      case "restart":
        await this.engine.restartStage(w.id, stage);
        return done("restarted the stage", "stage restarted");
      case "review":
        await this.engine.requestReview(w.id, stage);
        return done("sent to review", "review started");
      case "stop_reviews":
        await this.engine.stopReviews(w.id, stage);
        return done("stopped the reviews", "reviews stopped");
    }
  }
}
