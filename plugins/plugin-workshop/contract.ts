import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { EFFORTS } from "./agent-models";

const version = z
  .object({
    iteration: z.number(), headSha: z.string().nullable(), dirty: z.boolean(), contextSha: z.string().nullable(), techSha: z.string().nullable(), tzSha: z.string().nullable(),
    /** Mockup fingerprint; versions from before the Mockup stage existed lack this field. */
    mockupSha: z.string().nullable().optional(),
  })
  .strict();

/** A work card (`Engine.board`) — for the reconcile and tests; the panel board is built from plugins (`boardSchema`). */
export const cardSchema = z
  .object({ id: z.string(), key: z.string(), title: z.string(), projectId: z.string(), stage: z.number(), state: z.string(), reason: z.string(), stale: z.boolean(), iteration: z.number(), updatedAt: z.number() })
  .strict();
export type Card = z.infer<typeof cardSchema>;

export const stageViewSchema = z
  .object({
    no: z.number(), title: z.string(), ownerCheck: z.string(), agent: z.boolean(), reviewed: z.boolean(), current: z.boolean(), stale: z.boolean(),
    threads: z.array(z.object({ threadId: z.string(), role: z.string(), who: z.string(), round: z.number(), status: z.string(), done: z.boolean(), invalid: z.string().nullable() }).strict()),
    files: z.array(z.object({ path: z.string(), label: z.string(), verdict: z.string().nullable() }).strict()),
    progress: z.object({ done: z.number(), total: z.number() }).strict().nullable(),
    handover: z.object({ at: z.number(), action: z.string(), note: z.string(), forced: z.boolean() }).strict().nullable(),
  })
  .strict();
export type StageView = z.infer<typeof stageViewSchema>;

/** A plugin rollout attempt (rollout, rollback, reinstall) as the UI sees it. «Accept» needs the `id`. */
export const attemptViewSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["enter", "rollback", "reinstall"]),
    step: z.string(),
    status: z.enum(["running", "done", "failed", "unknown"]),
    error: z.string().nullable(),
    /** The working copy commit before the attempt — the rollback point. */
    beforeSha: z.string().nullable(),
    /** The commit the attempt brings the working copy to. */
    targetSha: z.string().nullable(),
    /** The rollback reason or the «Adopt as rolled out» note; null for a work's rollout. */
    note: z.string().nullable(),
  })
  .strict();
export type AttemptView = z.infer<typeof attemptViewSchema>;

/** What can be done with the plugin now: null — available, otherwise the reason (the disabled button's caption). */
export const availabilitySchema = z
  .object({
    rollback: z.string().nullable(), reinstall: z.string().nullable(), disable: z.string().nullable(), enable: z.string().nullable(), cancelInstall: z.string().nullable(),
    /** «Adopt as rolled out»: a change made in the working copy outside the Workshop, approved by the owner. */
    adopt: z.string().nullable(),
  })
  .strict();
export type AvailabilityView = z.infer<typeof availabilitySchema>;

/** Everything the engine knows about a work; the wiring adds `availability` (it knows Rollout). */
export const workViewCoreSchema = z
  .object({
    work: z
      .object({
        id: z.string(),
        /** The tracker task key; null until work creation has reached the task. */
        key: z.string().nullable(),
        title: z.string(),
        request: z.string(),
        pluginId: z.string(),
        kind: z.enum(["new", "rework"]),
        /** false — the creation steps (scaffold, git, project, task) are unfinished: there are no stages, version or files yet. */
        created: z.boolean(),
        projectId: z.string().nullable(),
        stage: z.number(),
        iteration: z.number(),
        state: z.string(),
        reason: z.string(),
        stale: z.boolean(),
        queued: z.boolean(),
        environmentId: z.string().nullable(),
        outcome: z.string().nullable(),
        createdAt: z.number(),
        /** The stage thread is missing, failed or gone, or entering the stage failed — «Restart stage» makes sense. */
        canRestart: z.boolean(),
      })
      .strict(),
    version: version.nullable(),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
    stages: z.array(stageViewSchema),
    events: z.array(z.object({ at: z.number(), kind: z.string(), text: z.string() }).strict()),
    /** The working copy's main branch has moved ahead of the work branch (the implementer merges it in). */
    baseAhead: z.boolean(),
    /** The plugin's current rollout attempt, if it belongs to this work; on Rollout its id goes into «Accept». */
    attempt: attemptViewSchema.nullable(),
    /**
     * What the server accepts on a send-back: `fixForwardOffered` — sending back is possible only as «Fix forward» (the rolled-out
     * code stays: `fixForward: true`); `needsForce` — over an unresolved rollout failure it goes only via «Hand over anyway»
     * (`force: true` together with `fixForward: true`). Both false — a normal send-back. The server decides; the UI only shows it.
     */
    sendBack: z.object({ needsForce: z.boolean(), fixForwardOffered: z.boolean() }).strict(),
    /** Stale document stages (1–3) the owner can confirm again without restarting the agents. */
    reconfirm: z.array(z.number()),
    /** Open items of `owner.md` — what is needed from the owner before implementation. */
    ownerNeeds: z.array(z.string()),
    /** A red verification or live check report: return to Implementation with one button and a ready-made reason; null — no button. */
    returnByReport: z.object({ toStage: z.number(), reason: z.string(), fixForward: z.boolean() }).strict().nullable(),
  })
  .strict();
export type WorkViewCore = z.infer<typeof workViewCoreSchema>;

/**
 * The work's agent models: the owner chooses before the start — per stage group, the reviewers (model and count 0–2), the autopilot
 * orchestrator, the Implementation subagents; the choice does not change after the start. `effort` — reasoning level (null — the model's default).
 */
export const agentChoiceSchema = z
  .object({ providerId: z.string().min(1).max(60), model: z.string().min(1).max(100), effort: z.enum(EFFORTS).nullable(), label: z.string().max(80) })
  .strict();
export type AgentChoice = z.infer<typeof agentChoiceSchema>;
export const workModelsSchema = z
  .object({
    /** Context, Feasibility, Spec, Mockup. */
    docs: agentChoiceSchema,
    /** Implementation. */
    build: agentChoiceSchema,
    /** Verification and Rollout. */
    check: agentChoiceSchema,
    /** The autopilot orchestrator. */
    pilot: agentChoiceSchema,
    /** Task-implementer subagents inside Implementation (Claude: opus / sonnet / haiku / fable). */
    subagents: agentChoiceSchema,
    /** Reviewers of Spec and Verification: 0, 1 or 2. */
    reviewers: z.array(agentChoiceSchema).max(2),
  })
  .strict();
export type WorkModels = z.infer<typeof workModelsSchema>;
/** What can be chosen: bb providers and their models with reasoning levels (as when starting a thread). */
export const modelCatalogSchema = z
  .object({
    providers: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          models: z.array(z.object({ id: z.string(), label: z.string(), efforts: z.array(z.string()), defaultEffort: z.string().nullable() }).strict()),
          /** The provider did not return models (sign-in expired, timeout); its models cannot be chosen right now. */
          error: z.string().nullable(),
        })
        .strict(),
    ),
    defaults: workModelsSchema,
    /** The list did not arrive (the providers did not answer): the form shows the defaults. */
    error: z.string().nullable(),
  })
  .strict();
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

/** A work's autopilot: the orchestrator drives the work to the end on the owner's behalf. */
export const pilotViewSchema = z
  .object({
    /** on — driving; paused — the owner stepped in; stopped — stopped (reason in `reason`); done — the work is accepted, the report is written. */
    state: z.enum(["on", "paused", "stopped", "done"]),
    reason: z.string().nullable(),
    notes: z.string(),
    /** The orchestrator thread — its chat on the work page. */
    threadId: z.string().nullable(),
    actions: z.number(),
    reds: z.number(),
    startedAt: z.number(),
    stoppedAt: z.number().nullable(),
    report: z.string().nullable(),
  })
  .strict();
export type PilotView = z.infer<typeof pilotViewSchema>;

export const workViewSchema = workViewCoreSchema
  .extend({
    availability: availabilitySchema,
    pilot: pilotViewSchema.nullable(),
    /** The work branch's PR on GitHub; null — none yet. */
    prUrl: z.string().nullable(),
    /** The work's agent models, selected at start. */
    models: workModelsSchema,
  })
  .strict();
export type WorkView = z.infer<typeof workViewSchema>;

export const fileViewSchema = z.object({ mime: z.string(), text: z.string().nullable(), data: z.string().nullable(), size: z.number() }).strict();
export type FileView = z.infer<typeof fileViewSchema>;

// --- board and plugin card ---

const column = z.enum(["context", "tech", "tz", "mockup", "build", "live", "off"]);
const bbState = z.enum(["running", "needs-configuration", "degraded", "error", "incompatible", "missing", "disabled", "starting", "not-installed"]);

export const pluginCardSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    column,
    /** The plugin's state in bb per the last confirmed list; `not-installed` — not installed. */
    bbState,
    /** The last plugin list failed to load: `bbState` is the last confirmed one. */
    stateStale: z.boolean(),
    labels: z.array(z.string()),
    /** Why «Rework» is unavailable; empty — available. */
    reworkBlockers: z.array(z.string()),
    availability: availabilitySchema,
    /** The open work (including one still being created). */
    work: z
      .object({
        id: z.string(), key: z.string().nullable(), stage: z.number(), state: z.string(), reason: z.string(), stale: z.boolean(),
        /** The work's autopilot: on / paused / stopped / done; null — never started. */
        pilot: z.enum(["on", "paused", "stopped", "done"]).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PluginCard = z.infer<typeof pluginCardSchema>;

export const pluginViewSchema = pluginCardSchema
  .extend({
    source: z.string().nullable(),
    dir: z.string().nullable(),
    branch: z.string().nullable(),
    head: z.string().nullable(),
    dirtyCount: z.number().nullable(),
    /** The commit the plugin last rolled out. */
    installedSha: z.string().nullable(),
    /** The latest rollout attempt, whatever its outcome. */
    attempt: attemptViewSchema.nullable(),
    /** The plugin's GitHub repository; null — none, or not reconciled yet. */
    githubUrl: z.string().nullable(),
    pastTasks: z.array(z.object({ key: z.string(), outcome: z.string(), finishedAt: z.number().nullable() }).strict()),
  })
  .strict();
export type PluginView = z.infer<typeof pluginViewSchema>;

export const boardSchema = z.object({ columns: z.array(z.object({ key: column, title: z.string() }).strict()), plugins: z.array(pluginCardSchema) }).strict();
export type Board = z.infer<typeof boardSchema>;

// --- calls ---

/** Work, plugin and attempt ids are short: a long string is not an id but garbage, and it goes nowhere near the database, lookups or the journal. */
const id = z.string().max(100);
const handOverResult = z.object({ ok: z.boolean(), blockers: z.array(z.string()), warnings: z.array(z.string()) }).strict();
const workId = z.object({ workId: id }).strict();
const pluginId = z.object({ pluginId: id }).strict();
const atStage = z.object({ workId: id, expectedStage: z.number().int() }).strict();
const request = z.string().min(1).max(20000);
/**
 * Work creation: `error` — the work is recorded (`workId`), but a creation step failed or creation was canceled; the work page shows
 * the reason and the reconcile retries the steps. An error before the work is recorded (form, id taken) is a plain call error, without `workId`.
 */
const created = z.object({ workId: z.string(), error: z.string().nullable() }).strict();

export const workshopContract = defineRpcContract({
  board: { input: z.null(), output: boardSchema },
  plugin: { input: pluginId, output: pluginViewSchema },
  work: { input: workId, output: workViewSchema },
  file: { input: z.object({ workId: id, path: z.string().max(500) }).strict(), output: fileViewSchema },
  newPlugin: { input: z.object({ name: z.string().min(1).max(80), id: z.string().min(1).max(40), request, models: workModelsSchema.optional() }).strict(), output: created },
  rework: { input: z.object({ pluginId: id, request, models: workModelsSchema.optional() }).strict(), output: created },
  /** Providers and models to choose from before starting a work. */
  models: { input: z.null(), output: modelCatalogSchema },
  restartStage: { input: atStage, output: z.null() },
  review: { input: atStage, output: z.null() },
  stopReviews: { input: atStage, output: z.null() },
  /** «Reconfirm» a stale stage 1–3 document — at the version the owner sees. */
  reconfirm: { input: z.object({ workId: id, expectedStage: z.number().int(), stage: z.number().int(), expectedVersion: version }).strict(), output: z.null() },
  handOver: {
    input: z.object({ workId: id, expectedStage: z.number().int(), expectedVersion: version.nullable(), note: z.string().max(2000), force: z.boolean() }).strict(),
    output: handOverResult,
  },
  sendBack: {
    input: z
      .object({
        workId: id,
        expectedStage: z.number().int(),
        toStage: z.number().int(),
        reason: z.string().min(1).max(4000),
        /** From Rollout: «Fix forward» — the rolled-out code stays. Without a rollback there is no other way back from Rollout. */
        fixForward: z.boolean().optional(),
        /** Over an unresolved rollout failure («Hand over anyway») — together with `fixForward`; `force` alone is not enough. */
        force: z.boolean().optional(),
      })
      .strict(),
    output: z.null(),
  },
  cancel: { input: z.object({ workId: id, reason: z.string().max(2000) }).strict(), output: z.null() },
  /** Autopilot: start with the owner's priorities («What matters to the autopilot»), stop, resume after a pause or stop. */
  pilotStart: { input: z.object({ workId: id, notes: z.string().max(4000) }).strict(), output: z.null() },
  pilotStop: { input: workId, output: z.null() },
  pilotResume: { input: workId, output: z.null() },
  enter: { input: z.object({ workId: id, expectedVersion: version, force: z.boolean() }).strict(), output: handOverResult },
  accept: {
    input: z.object({ workId: id, expectedVersion: version, attemptId: id, force: z.boolean(), note: z.string().max(2000) }).strict(),
    output: handOverResult,
  },
  rollback: { input: z.object({ pluginId: id, reason: z.string().min(1).max(2000) }).strict(), output: z.null() },
  /** «Hide from board» a gone plugin (neither in bb nor a working copy folder) without an open work. */
  hidePlugin: { input: pluginId, output: z.null() },
  /** «Adopt as rolled out»: install the current main branch under the lock and record the previous rolled-out commit as the rollback point. */
  adopt: { input: z.object({ pluginId: id, note: z.string().min(1).max(2000) }).strict(), output: z.null() },
  reinstall: { input: pluginId, output: z.null() },
  cancelInstall: { input: pluginId, output: z.null() },
  setEnabled: { input: z.object({ pluginId: id, on: z.boolean() }).strict(), output: z.null() },
});
