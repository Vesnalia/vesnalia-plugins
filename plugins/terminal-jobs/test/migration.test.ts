import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { JOB_MIGRATIONS, JobStore } from "../src/store.js";

describe("0.1.1 database upgrade", () => {
  it("adds the prune claim and keeps an original row decodable and pruneable", () => {
    const db = new Database(":memory:");
    db.exec(JOB_MIGRATIONS[0]!);
    db.prepare(
      `INSERT INTO jobs (
        job_id, marker, source, schema_version, owner_thread_id, delivery_mode,
        title, scope_kind, scope_json, host_id, argv_json, created_at,
        artifact_root, job_directory, launch_path, log_path, outcome_path,
        terminal_id, terminal_state, last_bb_status, exit_code, close_reason,
        observed_at, exited_at, outcome_state, outcome_json, outcome_checked_at,
        delivery_state, delivery_attempt_count, accepted_delivery_kind,
        delivered_at, ambiguous_attempt_count, updated_at
      ) VALUES (
        @jobId, @marker, 'run', 1, 'thr_owner', 'queue',
        'old job', 'thread', @scope, 'host_target', @argv, 1,
        '/tmp/jobs', @jobDirectory, @launchPath, @logPath, @outcomePath,
        'term_old', 'exited', 'exited', 0, 'process-exit',
        1, 1, 'missing', NULL, 1,
        'delivered', 1, 'sent', 1, 0, 1
      )`,
    ).run({
      jobId: "job_original_schema",
      marker: "[terminal-job:job_original_schema]",
      scope: JSON.stringify({ kind: "thread", threadId: "thr_owner" }),
      argv: JSON.stringify(["true"]),
      jobDirectory: "/tmp/jobs/job_original_schema",
      launchPath: "/tmp/jobs/job_original_schema/launch.json",
      logPath: "/tmp/jobs/job_original_schema/output.log",
      outcomePath: "/tmp/jobs/job_original_schema/outcome.json",
    });
    const originalColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    expect(originalColumns.map((column) => column.name)).not.toContain("prune_claim_token");

    db.exec(JOB_MIGRATIONS[1]!);
    const migratedColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    expect(migratedColumns.map((column) => column.name)).toContain("prune_claim_token");

    const store = new JobStore(db);
    expect(store.get("job_original_schema")).toMatchObject({
      jobId: "job_original_schema",
      terminalState: "exited",
      outcomeState: "missing",
      deliveryState: "delivered",
      pruneClaimToken: null,
    });
    expect(store.pruneCandidates(2, 100, "generation").jobs.map((job) => job.jobId)).toEqual([
      "job_original_schema",
    ]);
    expect(store.claimPrune("job_original_schema", "generation:test", 2, null)).toBe(true);
    expect(store.deletePruned("job_original_schema", "generation:test")).toBe(true);
    expect(store.get("job_original_schema")).toBeNull();
    db.close();
  });
});
