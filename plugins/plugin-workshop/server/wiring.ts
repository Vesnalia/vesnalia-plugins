// Wiring of the Plugin Workshop into bb: settings, one instance each of the store, catalog, engine, creation and Rollout, panel calls,
// the per-minute reconcile, events, agent instructions, CLI. No logic lives here — it is in server/*.ts; here only ordering and failure handling.
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { z } from "zod";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { BbPluginApi, ExperimentalPluginRpcHandlerContext, ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { workshopContract } from "../contract";
import { Api } from "./api";
import { runCli } from "./cli";
import { Catalog } from "./catalog";
import { Creation, CreationError } from "./create";
import { Engine, errText } from "./engine";
import { MIGRATIONS } from "./migrations";
import { DEFAULT_MODELS } from "./models";
import { pathSettingProblem, setBuildLock, setDocsRoot } from "./rules";
import { FORWARD_BUTTON, SELF_ID, setPluginsRoot, type StageNo } from "./stages";
import { MIN_FORCE_REASON, Pilot, PILOT_ACTIONS, PILOT_TOOLS } from "./pilot";
import type { Ports } from "./ports";
import { Rollout } from "./rollout";
import { redact } from "./secrets";
import { BUILD_LOCK, LOCKS_DIR, sdkPorts } from "./sdk-ports";
import { join } from "node:path";
import { Store } from "./store";

/**
 * Cancelling an install job is reliable for a job still waiting in the queue; a running one may finish installing first — the
 * card then shows the outcome. That is why the panel button is called «Try to cancel install».
 */
const CANCEL_SUPPORTED = true;
/** Tracker project for work tasks (setting `tasksProject`): there is no default — the owner selects it. */
export const DEFAULT_TASKS_PROJECT = "";
const TICK_MS = 60_000;
/**
 * After the service is stopped, its loop waits for the running pass no longer than this: bb 0.46 waits 5 s for a service to stop,
 * after that the service counts as hung and the plugin reload discards the new instance. The next reconcile finishes whatever is
 * left, from the intent and attempt records.
 */
const STOP_GRACE_MS = 1_000;
const CATALOG_EVERY_MS = 5 * 60_000;
/** Reconcile with GitHub: fetch of every working copy — one at a time, decoupled from the tick. */
const GITHUB_EVERY_MS = 15 * 60_000;
const MIN_EVENT_SYNC_GAP_MS = 10_000;
/** `system:changed` changes after which the catalog is reconciled with bb (`event.changes`). */
const SYNC_ON: ReadonlySet<string> = new Set(["plugins-changed", "plugin-install-jobs-changed", "plugin-update-jobs-changed"]);
/** Changes that trigger an immediate rollout attempt pass: an install job changed state, the plugin list changed. */
const ADVANCE_ON: ReadonlySet<string> = new Set(["plugins-changed", "plugin-install-jobs-changed"]);
/** Channel through which the UI learns that something changed: `{ workId, pluginId }`; for a catalog reconcile both are null. */
const CHANNEL = SELF_ID;

/** RPC methods that only read: open to every caller. Every other method — including any added later — changes works or plugins. */
export const READ_ONLY_RPC: ReadonlySet<string> = new Set(["board", "plugin", "work", "file", "models"]);

/**
 * A changing RPC call from another plugin is refused. The host verifies a plugin caller (`experimental_caller` is set from a per-load token
 * only the server knows), so another plugin cannot press the owner's buttons through `bb.sdk.plugins.callRpc`. Every other caller — the
 * panel, the `bb` CLI, an agent with access to bb — is a `client`: bb does not tell a person's click from an agent's call, so within the
 * Workshop every client is the owner (README, «Security»).
 */
export function refuseOtherPlugin(method: string, ctx: ExperimentalPluginRpcHandlerContext | undefined): void {
  const c = ctx?.experimental_caller;
  if (c?.kind === "plugin" && c.pluginId !== SELF_ID) throw new Error(`plugin ${c.pluginId} may not call ${method}: Plugin Workshop actions are taken only from the owner's panel (or the bb CLI)`);
}

type Handlers = ExperimentalPluginRpcHandlersWithContext<typeof workshopContract>;
type AnyHandler = (input: unknown, ctx: ExperimentalPluginRpcHandlerContext) => unknown;
/** Every method outside `READ_ONLY_RPC` refuses another plugin before it runs. */
function ownerOnly(handlers: Handlers): Handlers {
  const out: Record<string, AnyHandler> = {};
  for (const [name, fn] of Object.entries(handlers) as Array<[string, AnyHandler]>) {
    out[name] = READ_ONLY_RPC.has(name)
      ? fn
      : async (input, ctx) => {
          refuseOtherPlugin(name, ctx);
          return fn(input, ctx);
        };
  }
  return out as unknown as Handlers;
}

export interface WireDeps {
  /** Outbound ports; by default the real ones on top of the SDK. `onChange` — "a work changed": refreshes the board cache and notifies the UI. */
  ports?: (bb: BbPluginApi, onChange: (workId: string) => void) => Ports;
  /** Folders created at startup: the lock request folder and the build lock folder. */
  lockDirs?: string[];
  /** Pause within which consecutive `system:changed` events merge into one catalog reconcile, ms. */
  debounceMs?: number;
  /** At most one event-driven catalog reconcile per this interval, ms: a storm of events does not become a storm of git reads. */
  minGapMs?: number;
}

/** The same set of objects for panel calls, the CLI and the per-minute reconcile — and for tests. */
export interface Wiring {
  store: Store;
  catalog: Catalog;
  engine: Engine;
  creation: Creation;
  rollout: Rollout;
  api: Api;
  pilot: Pilot;
  /**
   * One reconcile pass: the engine and the rollout attempts — independently of each other (each in its own `catch`); work creation
   * runs detached and the tick does not wait for it — the scaffold may wait for the build lock up to 15 minutes.
   */
  tick(): Promise<void>;
  /** Reconcile the catalog with bb; a burst of requests merges into one or two passes. Does not throw. */
  syncCatalog(): Promise<void>;
}

export async function wire(bb: BbPluginApi, deps: WireDeps = {}): Promise<Wiring> {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new Store(db);
  // The log throws after the plugin is unloaded; a late failure there is no reason to crash.
  const warn = (m: string) => {
    try {
      bb.log.warn(redact(m));
    } catch {
      /* plugin already unloaded */
    }
  };

  // --- settings: values are read through getters and updated by onChange ---
  const settings = bb.settings.define({
    maxBuilding: {
      type: "number",
      label: "Max works in Building",
      description: "Implementation and Verification on one machine; beyond this a work waits in the queue. Limits works, not processes.",
      default: 2,
    },
    minFreeDiskGb: {
      type: "number",
      label: "Free disk for rollout, GB",
      description: "Below this, «Roll out» does not start.",
      default: 2,
    },
    autoReview: {
      type: "boolean",
      label: "Automatic reviews",
      description: "The work's reviewers (Fable and Astra by default) start on their own: on Spec — when the agent has finished the spec (on blocking findings — another round), on Verification — together with the verifier. Off — only via the «Send to review» button.",
      default: true,
    },
    mockupStage: {
      type: "boolean",
      label: "Mockup stage",
      description: "Between Spec and Implementation the agent draws a mockup of the plugin's section; the owner edits and approves it, and the plugin is then built to the mockup. Off — Implementation right after Spec.",
      default: true,
    },
    githubOwner: {
      type: "string",
      label: "GitHub repository owner",
      description: "The plugin repository is <owner>/bb-plugin-<id>, private. Empty — GitHub is not used. Sign-in — gh on the bb server.",
      default: "",
    },
    allowPublicRepos: {
      type: "boolean",
      label: "Allow public repositories",
      description: "Off (default): code is pushed only to a private (or internal) repository owned by the GitHub repository owner; a public or foreign repository refuses the push. On: such repositories are allowed too. The Workshop never changes a repository's visibility.",
      default: false,
    },
    pluginsRoot: {
      type: "string",
      label: "Plugins folder",
      description: "Where the plugin working copies live (<folder>/bb-plugin-<id>) and where the Workshop creates new ones. Empty — ~/plugins. An absolute path of letters, digits and . _ / @ + - only; anything else is ignored (the plugin status says why). Change it only with no open works; takes effect after a plugin restart.",
      default: "",
    },
    buildLock: {
      type: "string",
      label: "Build lock",
      description: "flock file under which heavy commands run (npm, tsc, tests, install). Empty — ~/.bb/locks/build.lock. An absolute path of letters, digits and . _ / @ + - only; anything else is ignored (the plugin status says why). Takes effect after a plugin restart.",
      default: "",
    },
    tasksProject: {
      type: "string",
      label: "Tracker project for work tasks",
      description: "Id of the tracker project where the Workshop creates a task for every work. There is no default: until a project is selected, new works are refused (project ids: `bb tasks project list`).",
      default: DEFAULT_TASKS_PROJECT,
    },
  });
  const read = (v: {
    maxBuilding?: number; minFreeDiskGb?: number; autoReview?: boolean; mockupStage?: boolean; githubOwner?: string; allowPublicRepos?: boolean; tasksProject?: string; pluginsRoot?: string;
    buildLock?: string;
  }) => ({
    // At least one work per machine: 0 or a negative number would stop all starts.
    maxBuilding: typeof v.maxBuilding === "number" && Number.isFinite(v.maxBuilding) ? Math.max(1, Math.floor(v.maxBuilding)) : 2,
    minFreeDiskGb: typeof v.minFreeDiskGb === "number" && Number.isFinite(v.minFreeDiskGb) && v.minFreeDiskGb >= 0 ? v.minFreeDiskGb : 2,
    autoReview: v.autoReview !== false,
    mockup: v.mockupStage !== false,
    // The GitHub port validates the name before calling gh; empty — GitHub is off.
    githubOwner: typeof v.githubOwner === "string" ? v.githubOwner.trim() : "",
    // Only an explicit true: anything else keeps publication to private repositories of the owner.
    allowPublicRepos: v.allowPublicRepos === true,
    pluginsRoot: typeof v.pluginsRoot === "string" ? v.pluginsRoot.trim() : "",
    buildLock: typeof v.buildLock === "string" ? v.buildLock.trim() : "",
    tasksProject: typeof v.tasksProject === "string" && v.tasksProject.trim() !== "" ? v.tasksProject.trim() : DEFAULT_TASKS_PROJECT,
  });
  let current = read(await settings.get());
  // Paths — once at startup: the catalog, the lock and the agent texts depend on them (a change takes effect after a plugin restart). A path
  // that is not absolute, normalized and plain (`pathSettingProblem`) is ignored for the default; the reason goes to the log and the status.
  const pathProblems: string[] = [];
  const pathSetting = (name: string, value: string): string | null => {
    if (!value) return null;
    const p = value.length > 1 ? value.replace(/\/+$/, "") : value;
    const problem = pathSettingProblem(p);
    if (problem === null) return p;
    pathProblems.push(`setting ${name} «${value.slice(0, 200)}» is ignored: ${problem} — the default is used`);
    return null;
  };
  setPluginsRoot(pathSetting("pluginsRoot", current.pluginsRoot) ?? join(homedir(), "plugins"));
  const lockSetting = pathSetting("buildLock", current.buildLock);
  if (lockSetting) setBuildLock(lockSetting);
  if (pathProblems.length > 0) {
    for (const m of pathProblems) warn(m);
    try {
      bb.status.needsConfiguration(`${pathProblems.join("; ")}. Fix the setting and reload the plugin.`);
    } catch (e) {
      warn(`status: ${errText(e)}`);
    }
  }
  settings.onChange((next) => {
    current = read(next);
  });

  // --- signals to the UI and the board cache ---
  const signal = (workId: string | null, pluginId: string | null) => {
    try {
      bb.realtime.publish(CHANNEL, { workId, pluginId });
    } catch (e) {
      warn(`realtime: ${errText(e)}`);
    }
  };
  /**
   * A work changed (including by a step or the outcome of a rollout attempt): its plugin alone is reconciled with bb — state in the
   * list and git into the board cache — and only then is the UI notified; otherwise it would fetch stale data (the column and the
   * state in bb come from this reconcile).
   */
  const onChange = (workId: string) => {
    let pluginId: string | null = null;
    try {
      pluginId = store.work(workId)?.plugin_id ?? null;
    } catch {
      /* database closed: the plugin is unloading */
    }
    void (pluginId === null ? Promise.resolve() : catalog.refreshPlugin(pluginId))
      .catch((e) => warn(`plugin reconcile ${pluginId}: ${errText(e)}`))
      .finally(() => signal(workId, pluginId));
  };

  const ports = (deps.ports ?? ((b, c) => sdkPorts(b, c)))(bb, onChange);
  // Stop signal for the short attempt polls: aborted when the service stops and when the plugin is unloaded; a new service start
  // (if the plugin is not unloaded) begins with a fresh one.
  let disposed = false;
  let halt = new AbortController();
  // One instance of each for the whole plugin: the per-work and per-plugin queues live inside them.
  // The catalog publishes accepted main only through the engine's publication gate (the same policy, the same scan).
  const catalog = new Catalog(store, ports, (dir, sha, branch) => engine.publish(dir, sha, branch));
  const engine = new Engine(store, ports, () => ({
    maxBuilding: current.maxBuilding, minFreeDiskGb: current.minFreeDiskGb, autoReview: current.autoReview, mockup: current.mockup, githubOwner: current.githubOwner,
    allowPublicRepos: current.allowPublicRepos,
  }));
  const creation = new Creation(store, ports, catalog, () => ({ tasksProject: current.tasksProject }), engine);
  const rollout = new Rollout(store, ports, engine, catalog, { cancelSupported: CANCEL_SUPPORTED, stop: () => halt.signal });
  const api = new Api({ store, catalog, engine, rollout });
  const pilot = new Pilot(store, ports, engine, rollout);

  // --- startup: before the first call ---
  // Lock folders; requests and marks of attempts that cannot be holding the lock are removed (a live holder process then exits on its own).
  // `keep` also includes attempts on the `locking` step: their request is written together with the `lock_held` mark.
  for (const dir of deps.lockDirs ?? [LOCKS_DIR, dirname(BUILD_LOCK)]) await mkdir(dir, { recursive: true }).catch((e) => warn(`lock folder ${dir}: ${errText(e)}`));
  await ports.lock.sweep(store.lockedAttempts().map((a) => a.id)).catch((e) => warn(`lock: request sweep failed: ${errText(e)}`));

  // --- catalog reconcile: at startup, every five minutes and on system:changed ---
  let lastSync = 0;
  let syncing: Promise<void> | null = null;
  let syncAgain = false;
  const syncCatalog = (): Promise<void> => {
    // One pass at a time; a request during a pass means one more pass after it (the running one may have missed the change).
    if (syncing) {
      syncAgain = true;
      return syncing;
    }
    syncing = (async () => {
      try {
        do {
          syncAgain = false;
          lastSync = Date.now();
          await catalog.sync().catch((e) => warn(`catalog: ${errText(e)}`));
        } while (syncAgain);
        signal(null, null);
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  };
  /** The bb event changes what the catalog sees: the plugin list, install or update jobs. Other system events do not. */
  const aboutPlugins = (event: { changes?: readonly string[] } | undefined): boolean =>
    Array.isArray(event?.changes) && event.changes.some((c) => SYNC_ON.has(c));
  const aboutAttempts = (event: { changes?: readonly string[] } | undefined): boolean =>
    Array.isArray(event?.changes) && event.changes.some((c) => ADVANCE_ON.has(c));

  // --- rollout attempt pass: the per-minute reconcile and bb events about install jobs ---
  let rolling: Promise<void> | null = null;
  let rollAgain = false;
  /** One pass at a time; a request during a pass means one more after it (the event may have arrived after a step had already read the job). */
  const rolloutPass = (): Promise<void> => {
    if (rolling) {
      rollAgain = true;
      return rolling;
    }
    rolling = (async () => {
      try {
        do {
          rollAgain = false;
          await rollout.advanceAll().catch((e) => warn(`rollout.advanceAll: ${errText(e)}`));
        } while (rollAgain);
      } finally {
        rolling = null;
      }
    })();
    return rolling;
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const syncSoon = () => {
    if (timer) return;
    const wait = Math.max(deps.debounceMs ?? 1500, (deps.minGapMs ?? MIN_EVENT_SYNC_GAP_MS) - (Date.now() - lastSync));
    timer = setTimeout(() => {
      timer = null;
      void syncCatalog();
    }, wait);
    timer.unref?.();
  };
  let unsubscribe: (() => void) | null = null;
  const unsubscribeAll = () => {
    const u = unsubscribe;
    unsubscribe = null;
    try {
      u?.();
    } catch (e) {
      warn(`unsubscribe from system:changed: ${errText(e)}`);
    }
  };
  bb.onDispose(() => {
    disposed = true;
    halt.abort();
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribeAll();
  });

  // --- per-minute reconcile ---
  let creating: Promise<void> | null = null;
  /**
   * Work creation pass — detached from the tick: the scaffold (`flock -w 900`) may wait for the build lock up to 15 minutes, and neither
   * the rollout attempts — the only ones that release this lock — nor the engine reconcile must wait for it. While the previous pass
   * runs, a new one does not start.
   */
  const creationPass = (): void => {
    if (creating) return;
    creating = creation
      .advanceAll()
      .catch((e) => warn(`creation.advanceAll: ${errText(e)}`))
      .finally(() => {
        creating = null;
      });
  };
  /** GitHub reconcile pass — detached: fetching dozens of repositories does not hold up the tick. While the previous one runs, a new one does not start. */
  let githubing: Promise<void> | null = null;
  let lastGithub = 0;
  const githubPass = (): void => {
    if (githubing || Date.now() - lastGithub < GITHUB_EVERY_MS) return;
    lastGithub = Date.now();
    githubing = rollout
      .syncGithub()
      .catch((e) => warn(`github: ${errText(e)}`))
      .finally(() => {
        githubing = null;
        signal(null, null);
      });
  };
  const wiring: Wiring = {
    store, catalog, engine, creation, rollout, api, pilot,
    async tick() {
      creationPass();
      githubPass();
      await Promise.allSettled([engine.reconcileAll().catch((e) => warn(`reconcileAll: ${errText(e)}`)), rolloutPass()]);
      await pilot.tickAll().catch((e) => warn(`pilot: ${errText(e)}`));
    },
    syncCatalog,
  };
  // Events only speed up the reconcile of the work whose thread changed.
  for (const ev of ["thread.idle", "thread.failed", "thread.active"] as const) {
    bb.events.on(ev, ({ thread }) => {
      const run = store.run(thread.id);
      if (run)
        void engine
          .reconcile(run.work_id)
          .then(() => pilot.tick(run.work_id))
          .catch((e) => warn(`reconcile ${run.work_id}: ${errText(e)}`));
      const own = store.pilotByThread(thread.id);
      if (own) void pilot.tick(own.work_id).catch((e) => warn(`pilot ${own.work_id}: ${errText(e)}`));
    });
  }
  /** Wait for a pass; after the service stops — no longer than STOP_GRACE_MS (the pass itself goes on outside the service loop). */
  const settle = async (p: Promise<unknown>, abort: AbortSignal): Promise<void> => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => {
      onAbort = () => {
        grace = setTimeout(resolve, STOP_GRACE_MS);
        grace.unref?.();
      };
      if (abort.aborted) onAbort();
      else abort.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([p.catch((e) => warn(`reconcile: ${errText(e)}`)), stopped]);
    } finally {
      if (grace) clearTimeout(grace);
      if (onAbort) abort.removeEventListener("abort", onAbort);
    }
  };
  bb.background.service("reconcile", {
    async start(abort) {
      if (!disposed && halt.signal.aborted) halt = new AbortController();
      const mine = halt;
      const stopPolls = () => mine.abort();
      if (abort.aborted) stopPolls();
      else abort.addEventListener("abort", stopPolls, { once: true });
      // `bb.sdk` is available only after the server starts — so the subscription and the first catalog reconcile are here, not at load.
      unsubscribeAll();
      try {
        unsubscribe = bb.sdk.subscribe({
          event: "system:changed",
          callback: (event) => {
            if (aboutPlugins(event)) syncSoon();
            if (aboutAttempts(event)) void rolloutPass();
          },
        });
      } catch (e) {
        warn(`subscribe to system:changed: ${errText(e)}`);
      }
      // The Workshop's reference docs for agents are in the docs/ folder of the installed plugin.
      await ports.plugins
        .list()
        .then((list) => {
          const me = list.find((p) => p.id === SELF_ID);
          if (me?.rootDir) setDocsRoot(join(me.rootDir, "docs"));
        })
        .catch((e) => warn(`docs folder: ${errText(e)}`));
      try {
        await settle(syncCatalog(), abort);
        while (!abort.aborted) {
          if (Date.now() - lastSync >= CATALOG_EVERY_MS) await settle(syncCatalog(), abort);
          await settle(wiring.tick(), abort);
          await sleep(TICK_MS, undefined, { signal: abort }).catch(() => undefined);
        }
      } finally {
        abort.removeEventListener("abort", stopPolls);
        unsubscribeAll();
      }
    },
  });

  // --- panel calls ---
  /**
   * An owner action on a plugin: after it — also when it was refused — the plugin alone is reconciled with bb (state in the list, git of
   * the copy), then the UI is notified. Otherwise, until the full catalog reconcile, the card would show the old column and state.
   */
  const touched = async <T>(pluginId: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } finally {
      await catalog.refreshPlugin(pluginId).catch((e) => warn(`plugin reconcile ${pluginId}: ${errText(e)}`));
      signal(null, pluginId);
    }
  };
  /** The same for a work action that moves the plugin (rollout, acceptance). No such work — the action refuses on its own. */
  const touchedWork = <T>(workId: string, run: () => Promise<T>): Promise<T> => {
    const pluginId = store.work(workId)?.plugin_id;
    return pluginId === undefined ? run() : touched(pluginId, run);
  };
  /** An error after the work is recorded is returned together with its id: the UI opens the work being created instead of losing it. */
  const created = async (run: () => Promise<string>): Promise<{ workId: string; error: string | null }> => {
    try {
      return { workId: await run(), error: null };
    } catch (e) {
      if (e instanceof CreationError) return { workId: e.workId, error: e.message };
      throw e;
    }
  };
  /** The owner pressed a work button: this work's autopilot is paused; `what` is the button as the panel names it. */
  const byOwner = async <T>(workId: string, what: string, run: () => Promise<T>): Promise<T> => {
    await pilot.ownerActed(workId, what).catch((e) => warn(`pilot pause: ${errText(e)}`));
    return run();
  };
  /** The same for plugin buttons: pauses the autopilot of the plugin's open work. */
  const byOwnerPlugin = async <T>(pluginId: string, what: string, run: () => Promise<T>): Promise<T> => {
    const open = store.openWorkOf(pluginId);
    if (open) await pilot.ownerActed(open.id, what).catch((e) => warn(`pilot pause: ${errText(e)}`));
    return run();
  };
  bb.rpc.register(workshopContract, ownerOnly({
    board: () => api.board(),
    plugin: ({ pluginId }) => api.plugin(pluginId),
    work: ({ workId }) => api.work(workId),
    file: ({ workId, path }) => engine.file(workId, path),
    newPlugin: (input) => created(() => creation.newPlugin(input)),
    rework: ({ pluginId, request, models }) => created(() => creation.rework(pluginId, request, models)),
    async models() {
      try {
        return { providers: await ports.modelCatalog(), defaults: DEFAULT_MODELS, error: null };
      } catch (e) {
        return { providers: [], defaults: DEFAULT_MODELS, error: errText(e) };
      }
    },
    async restartStage({ workId, expectedStage }) {
      await byOwner(workId, "Restart stage", () => engine.restartStage(workId, expectedStage));
      return null;
    },
    async review({ workId, expectedStage }) {
      await byOwner(workId, "Send to review", () => engine.requestReview(workId, expectedStage));
      return null;
    },
    async reconfirm({ workId, ...a }) {
      await byOwner(workId, "Reconfirm", () => engine.reconfirm(workId, a));
      return null;
    },
    async stopReviews({ workId, expectedStage }) {
      await byOwner(workId, "Stop reviewers", () => engine.stopReviews(workId, expectedStage));
      return null;
    },
    // The forward button is named by the stage: «Next», «Approve mockup», «To verification».
    handOver: ({ workId, ...a }) => byOwner(workId, FORWARD_BUTTON[a.expectedStage as StageNo] ?? "Next", () => engine.handOver(workId, a)),
    async sendBack({ workId, ...a }) {
      await byOwner(workId, "Send back", () => engine.sendBack(workId, a));
      return null;
    },
    // A work whose creation is unfinished is canceled by Creation (removes the temporary folder and the task); the others by the engine, with a snapshot.
    async cancel({ workId, reason }) {
      const w = store.work(workId);
      if (!w) throw new Error("work not found");
      await pilot.ownerActed(workId, "Cancel work").catch(() => undefined);
      if (w.created === 0) await creation.cancel(workId, reason);
      else await engine.cancel(workId, reason);
      await pilot.tick(workId).catch(() => undefined);
      return null;
    },
    async pilotStart({ workId, notes }) {
      await pilot.start(workId, notes);
      return null;
    },
    async pilotStop({ workId }) {
      await pilot.stopByOwner(workId);
      return null;
    },
    async pilotResume({ workId }) {
      await pilot.resume(workId);
      return null;
    },
    enter: ({ workId, ...a }) => byOwner(workId, "Roll out", () => touchedWork(workId, () => rollout.enter(workId, a))),
    accept: ({ workId, ...a }) => byOwner(workId, "Accept", () => touchedWork(workId, () => rollout.accept(workId, a))),
    async rollback({ pluginId, reason }) {
      await byOwnerPlugin(pluginId, "Roll back", () => touched(pluginId, () => rollout.rollback(pluginId, reason)));
      return null;
    },
    async hidePlugin({ pluginId }) {
      const row = store.plugin(pluginId);
      if (!row) throw new Error("plugin is not on the board");
      if (row.gone_reason === null) throw new Error("the plugin is not gone (it is in bb or its folder exists) — only a gone plugin can be hidden from the board; first «Disable» it and remove the folder");
      if (store.openWorkOf(pluginId)) throw new Error("a work is open on the plugin — cancel it first");
      store.hidePlugin(pluginId, Date.now());
      signal(null, pluginId);
      return null;
    },
    async adopt({ pluginId, note }) {
      await touched(pluginId, () => rollout.adopt(pluginId, note));
      return null;
    },
    async reinstall({ pluginId }) {
      await byOwnerPlugin(pluginId, "Install again", () => touched(pluginId, () => rollout.reinstall(pluginId)));
      return null;
    },
    async cancelInstall({ pluginId }) {
      await byOwnerPlugin(pluginId, "Try to cancel install", () => touched(pluginId, () => rollout.cancelInstall(pluginId)));
      return null;
    },
    async setEnabled({ pluginId, on }) {
      await byOwnerPlugin(pluginId, on ? "Enable" : "Disable", () => touched(pluginId, () => rollout.setEnabled(pluginId, on)));
      return null;
    },
  }));

  // The autopilot orchestrator: the Workshop tools are given only to its thread; Pilot re-checks the thread on every call.
  const failed = (e: unknown) => ({ content: [{ type: "text" as const, text: `Not done: ${errText(e)}` }], isError: true });
  bb.agents.registerTool({
    name: PILOT_TOOLS[0],
    description: "Plugin Workshop autopilot: the work's status packet — stage, state, gates, owner items, stage files, the agent's last reply, available actions.",
    parameters: z.object({}).strict(),
    execute: (_p, ctx) => pilot.statusTool(ctx.threadId).catch(failed),
  });
  bb.agents.registerTool({
    name: PILOT_TOOLS[1],
    description:
      `Plugin Workshop autopilot: one action on the owner's behalf. answer {text} — reply to the stage agent; forward {force?, text?} — hand over the stage (on Mockup — approve the mockup); report_back — return to Implementation by the red report; back {toStage, text, fixForward?, force?}; enter {force?, text?} — roll out from Verification; accept {text?, force?} — accept on Rollout; rollback {text}; reinstall; restart; review; stop_reviews; wait {text}; stop {text} — stop and call the owner; report {text} — the final report. force lifts gate warnings only and needs a reason of at least ${MIN_FORCE_REASON} characters in text; hard stops (IMPOSSIBLE verdict, open or missing owner.md before Implementation, with GitHub on anything but a clean publication check of the current commit, a red live check) are not lifted by force and stop the autopilot.`,
    parameters: z
      .object({
        action: z.enum(PILOT_ACTIONS),
        text: z.string().max(20000).optional(),
        toStage: z.number().int().optional(),
        force: z.boolean().optional(),
        fixForward: z.boolean().optional(),
      })
      .strict(),
    execute: (p, ctx) => pilot.actTool(ctx.threadId, p).catch(failed),
  });
  bb.agents.registerTool({
    name: PILOT_TOOLS[2],
    description: "Plugin Workshop autopilot: a work file by its path from the status packet (documents, reports, mockup); images come back as images.",
    parameters: z.object({ path: z.string().min(1).max(500) }).strict(),
    execute: (p, ctx) =>
      pilot
        .fileTool(ctx.threadId, p.path)
        .then((f) => ("image" in f ? { content: [{ type: "image" as const, data: f.image, mimeType: f.mime }] } : f.text))
        .catch(failed),
  });
  // Every work thread knows who it is — from its row or from the spawn metadata; other threads get no instructions.
  bb.agents.configure((ctx) => {
    const pilotText = pilot.identity(ctx.thread.id, ctx.pluginMetadata);
    if (pilotText) return { tools: [...PILOT_TOOLS], skills: [], instructions: pilotText };
    const text = engine.identityOf(ctx.thread.id, ctx.pluginMetadata);
    return text ? { tools: [], skills: [], instructions: text } : { tools: [], skills: [] };
  });

  bb.cli.register({
    name: SELF_ID,
    summary: "Plugin Workshop: board and works (read-only)",
    commands: [
      { name: "list", summary: "Plugins: column, state in bb, work", usage: "bb plugin-workshop list [--json]" },
      { name: "show", summary: "A plugin (by id) or a work (by task key or work id)", usage: "bb plugin-workshop show <id|KEY> [--json]" },
    ],
    run: (argv) => runCli(argv, { api, store }),
  });

  bb.log.info(`workshop plugin loaded (${store.unsettledWorks().length} works under reconcile, ${store.creatingWorks().length} being created)`);
  return wiring;
}
