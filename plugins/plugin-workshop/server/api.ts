// What the plugin serves to the interface and the CLI: the board (a card is a plugin), the plugin summary, the work page. Assembled from the catalog,
// the engine and Rollout; no state of its own. The board reads git from the catalog cache and asks bb for the lists once for all cards, not per card.
import type { AvailabilityView, Board, PilotView, PluginCard, PluginView, WorkView } from "../contract";
import { bbStateOf, columnOf, labelsOf, reworkBlockers, type Catalog, type PluginFacts } from "./catalog";
import { attemptView, type Engine } from "./engine";
import type { Availability, Rollout } from "./rollout";
import { COLUMNS } from "./stages";
import { modelsOf } from "./models";
import { shownPrUrl } from "./publish";
import { repoOf } from "./sdk-ports";
import type { PilotRow, Store, WorkRow } from "./store";

/** A board card from the facts and the availability of actions. Why the plugin is gone is shown as a label: it does not leave «Retired». */
export function cardOf(f: PluginFacts, availability: Availability): PluginCard {
  const { state, stale } = bbStateOf(f);
  const labels = labelsOf(f);
  if (f.row.gone_reason !== null) labels.push(`gone: ${f.row.gone_reason}`);
  const w = f.work;
  return {
    id: f.row.id, name: f.row.name, column: columnOf(f), bbState: state, stateStale: stale, labels, reworkBlockers: reworkBlockers(f), availability,
    work: w ? { id: w.id, key: w.task_key, stage: w.stage, state: w.state, reason: w.state_reason, stale: w.stale === 1, pilot: f.pilot ?? null } : null,
  };
}

/** The autopilot block of the work page; null — the autopilot was never started. */
export function pilotView(p: PilotRow | null): PilotView | null {
  if (!p) return null;
  return {
    state: p.state, reason: p.reason, notes: p.notes, threadId: p.thread_id, actions: p.actions, reds: p.reds, startedAt: p.started_at, stoppedAt: p.stopped_at, report: p.report,
  };
}

/** The page of a work whose creation steps (scaffold, git, project, task) are not finished: there are no stages, version or files yet. */
function creatingView(w: WorkRow, store: Store, availability: AvailabilityView): WorkView {
  return {
    work: {
      id: w.id, key: w.task_key, title: w.title, request: w.request, pluginId: w.plugin_id, kind: w.kind, created: false, projectId: w.project_id, stage: w.stage,
      iteration: w.iteration, state: w.state, reason: w.state_reason, stale: w.stale === 1, queued: false, environmentId: null, outcome: w.outcome,
      createdAt: w.created_at, canRestart: false,
    },
    version: null, blockers: [], warnings: [], stages: [],
    events: store.events(w.id).map((e) => ({ at: e.at, kind: e.kind, text: e.text })),
    baseAhead: false, attempt: null, sendBack: { needsForce: false, fixForwardOffered: false }, reconfirm: [], ownerNeeds: [], returnByReport: null, availability,
    pilot: null, prUrl: null, models: modelsOf(w.models),
  };
}

export class Api {
  constructor(private readonly d: { store: Store; catalog: Catalog; engine: Engine; rollout: Rollout }) {}

  async board(): Promise<Board> {
    // Gone plugins the owner hid from the board are not shown (the row and the history stay).
    const facts = (await this.d.catalog.cachedFacts()).filter((f) => f.row.hidden_at === null);
    const availability = await this.d.rollout.availabilityFor(facts);
    const plugins = facts.map((f) => cardOf(f, availability.get(f.row.id)!));
    // The «Mockup» stage is off and nobody is on it — the board does not need an empty column.
    const hideMockup = !this.d.engine.mockupStageOn() && !plugins.some((p) => p.column === "mockup");
    return {
      columns: COLUMNS.filter((c) => !(hideMockup && c.key === "mockup")).map((c) => ({ key: c.key, title: c.title })),
      plugins,
    };
  }

  /** Plugin summary: git read live (one card), past tasks from the database. */
  async plugin(pluginId: string): Promise<PluginView> {
    const f = await this.d.catalog.one(pluginId);
    if (!f) throw new Error(`plugin ${pluginId} is not on the board`);
    const card = cardOf(f, (await this.d.rollout.availabilityFor([f])).get(pluginId)!);
    const g = f.git;
    return {
      ...card,
      source: f.row.source, dir: f.row.dir, branch: g?.branch ?? null, head: g?.head ?? null, dirtyCount: g ? g.dirtyCount : null,
      installedSha: f.row.installed_sha,
      githubUrl: f.row.gh_remote ? (repoOf(f.row.gh_remote) ? `https://github.com/${repoOf(f.row.gh_remote)}` : null) : null,
      attempt: f.attempt ? attemptView(f.attempt) : null,
      pastTasks: this.d.store
        .pastWorks(pluginId)
        .filter((w) => w.task_key !== null)
        .map((w) => ({ key: w.task_key!, outcome: w.outcome!, finishedAt: w.finished_at })),
    };
  }

  /** Work page: the engine's view and the availability of actions on the plugin (the same buttons in the plugin summary and at stage 6). */
  async work(workId: string): Promise<WorkView> {
    const w = this.d.store.work(workId);
    if (!w) throw new Error("work not found");
    const availability = await this.d.rollout.availability(w.plugin_id);
    if (w.created === 0) return creatingView(w, this.d.store, availability);
    return { ...(await this.d.engine.view(workId)), availability, pilot: pilotView(this.d.store.pilot(workId)), prUrl: shownPrUrl(w.pr_url), models: modelsOf(w.models) };
  }
}
