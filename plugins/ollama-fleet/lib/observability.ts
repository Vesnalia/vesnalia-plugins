import { randomUUID } from "node:crypto";
import { z } from "zod";
import { taskTypeSchema, type TaskType } from "./task-type";

export const JOBS_KEY = "observability-v1";
export const JOBS_CHANGED = "fleet-jobs-changed";
export const jobStateSchema = z.enum(["routing", "running", "completed", "failed", "cancelled"]);
export type JobState = z.infer<typeof jobStateSchema>;
const text = (max: number) => z.string().max(max);
export const jobSchema = z.object({
  jobId: text(80), revision: z.number().int().positive(), state: jobStateSchema,
  origin: z.object({ threadId: text(120), projectId: text(120) }).nullable(),
  taskType: taskTypeSchema, label: text(120), actualModel: text(120).nullable(),
  server: z.object({ id: text(120), name: text(120) }).nullable(),
  startedAt: z.iso.datetime(), updatedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  durationMs: z.number().nonnegative().nullable(), attemptCount: z.number().int().nonnegative(),
  latestActivity: text(120).nullable(), errorPreview: text(360).nullable(),
});
export type Job = z.infer<typeof jobSchema>;
export const snapshotInputSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  activeOnly: z.boolean().optional(), originThreadId: text(120).optional(),
});
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1), observedAt: z.iso.datetime(), truncated: z.boolean(),
  jobs: z.array(jobSchema).max(20),
});
const storedSchema = z.object({ schemaVersion: z.literal(1), jobs: z.array(jobSchema).max(120) });
export const active = (job: Pick<Job, "state">) => job.state === "routing" || job.state === "running";

/** Display metadata only. Never pass a prompt, result, provider error or reasoning here. */
export function safeDisplay(value: string, max = 120): string {
  return value.replace(/https?:\/\/\S+|\b(?:Bearer\s+\S+|sk-[\w-]+)\b/gi, "[redacted]")
    .replace(/\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Deliberately categorical: arbitrary provider messages cannot be safely redacted. */
export function safeError(value: unknown): string {
  if (value === "No eligible models are available") return value;
  if (value === "Request timed out") return value;
  return "Generation failed";
}

type Host = {
  read: () => Promise<unknown>;
  write: (value: unknown) => Promise<unknown>;
  publish: (value: { jobId: string; revision: number; state: JobState }) => unknown;
};

export class JobRegistry {
  private jobs = new Map<string, Job>();
  private dirty = false;
  private writing: Promise<void> | null = null;
  constructor(private host: Host) {}

  async initialize() {
    try {
      const parsed = storedSchema.safeParse(await this.host.read());
      if (!parsed.success) return;
      for (const row of parsed.data.jobs) {
        // Re-project even stored metadata; unknown fields never survive a reload.
        const job = this.clean(row);
        if (active(job)) {
          job.state = "cancelled"; job.revision++;
          job.finishedAt = job.updatedAt = new Date().toISOString();
          job.durationMs = Math.max(0, Date.parse(job.finishedAt) - Date.parse(job.startedAt));
          job.latestActivity = "Cancelled";
          job.errorPreview = "Fleet reloaded before the job reached a recorded terminal state.";
        }
        this.jobs.set(job.jobId, job);
      }
      this.prune(); this.persist();
    } catch { /* Instrumentation is fail-open, including malformed/unavailable KV. */ }
  }

  private clean(row: Job): Job {
    return { ...row, label: safeDisplay(row.label), actualModel: row.actualModel === null ? null : safeDisplay(row.actualModel),
      server: row.server === null ? null : { id: safeDisplay(row.server.id), name: safeDisplay(row.server.name) },
      latestActivity: row.latestActivity === null ? null : safeDisplay(row.latestActivity),
      errorPreview: row.errorPreview === null ? null : safeError(row.errorPreview) };
  }

  start(taskType: TaskType, label?: string, origin: Job["origin"] = null): string | null {
    try {
      const now = new Date().toISOString();
      const job: Job = { jobId: randomUUID(), revision: 1, state: "routing", taskType,
        origin: origin ? { threadId: origin.threadId.slice(0,120), projectId: origin.projectId.slice(0,120) } : null,
        label: safeDisplay(label ?? "") || `Local ${taskType} task`, actualModel: null, server: null,
        startedAt: now, updatedAt: now, finishedAt: null, durationMs: null, attemptCount: 0,
        latestActivity: "Selecting local model", errorPreview: null };
      this.jobs.set(job.jobId, job); this.changed(job); return job.jobId;
    } catch { return null; }
  }

  attempt(id: string | null, model: string, server: { id: string; name: string }) {
    this.update(id, job => ({ ...job, state: "running", attemptCount: job.attemptCount + 1,
      actualModel: safeDisplay(model), server: { id: safeDisplay(server.id), name: safeDisplay(server.name) },
      latestActivity: job.attemptCount ? "Retrying with fallback model" : "Generating response" }));
  }

  finish(id: string | null, state: "completed" | "failed" | "cancelled", error?: unknown) {
    this.update(id, job => ({ ...job, state, finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - Date.parse(job.startedAt)),
      latestActivity: state === "completed" ? "Completed" : state === "cancelled" ? "Cancelled" : "Generation failed",
      errorPreview: state === "failed" ? safeError(error) : null }));
  }

  private update(id: string | null, transform: (job: Job) => Job) {
    try {
      const old = id ? this.jobs.get(id) : null;
      if (!old || !active(old)) return; // Late completions cannot resurrect cancellation.
      const job = { ...transform(old), revision: old.revision + 1, updatedAt: new Date().toISOString() };
      // Map order breaks equal-millisecond timestamps by transition order.
      this.jobs.delete(job.jobId);
      this.jobs.set(job.jobId, job); this.prune(); this.changed(job);
    } catch { /* Tracking cannot control execution. */ }
  }

  snapshot(input: z.infer<typeof snapshotInputSchema> = {}): z.infer<typeof snapshotSchema> {
    const rows = [...this.jobs.values()].reverse().filter(j => (!input.activeOnly || active(j)) &&
      (!input.originThreadId || j.origin?.threadId === input.originThreadId))
      .sort((a,b) => Number(active(b))-Number(active(a)) || b.updatedAt.localeCompare(a.updatedAt));
    const limit = Math.max(1, Math.min(20, input.limit ?? 20));
    return { schemaVersion: 1, observedAt: new Date().toISOString(), truncated: rows.length > limit,
      jobs: structuredClone(rows.slice(0,limit)) };
  }

  private prune() {
    const terminal = [...this.jobs.values()].reverse().filter(j => !active(j))
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const job of terminal.slice(100)) this.jobs.delete(job.jobId);
  }
  private changed(job: Job) {
    this.persist();
    try { Promise.resolve(this.host.publish({ jobId: job.jobId, revision: job.revision, state: job.state })).catch(() => {}); }
    catch { /* Signal delivery is best effort. */ }
  }
  private persist() {
    this.dirty = true;
    if (this.writing) return;
    // Coalesced serial writes of CURRENT state; never serialize generation.
    this.writing = Promise.resolve().then(async () => {
      while (this.dirty) {
        this.dirty = false;
        const rows = [...this.jobs.values()];
        const jobs = [...rows.filter(active).slice(-20), ...rows.filter(j => !active(j))];
        // Respect the SDK's 256 KiB KV limit even for multibyte display text.
        while (Buffer.byteLength(JSON.stringify(jobs), "utf8") > 240_000) jobs.pop();
        try { await this.host.write({ schemaVersion: 1, jobs: structuredClone(jobs) }); } catch { /* fail open */ }
      }
    }).finally(() => { this.writing = null; if (this.dirty) this.persist(); });
  }
  async flush() { while (this.writing) await this.writing; }
}
