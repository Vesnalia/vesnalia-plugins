import Database from "better-sqlite3";
import { describe, expect, test, vi } from "vitest";
import { Catalog, labelsOf } from "./catalog";
import { Engine } from "./engine";
import { FakePorts } from "./fake-ports";
import { MIGRATIONS } from "./migrations";
import { classifyCopy, Rollout } from "./rollout";
import { livePath, pluginDir, SELF_ID, verifyPath } from "./stages";
import { UNEXPECTED_COPY } from "./state";
import { Store } from "./store";
import { attempt, commitWork, idleStage, moveTo, reviewed, setup, started, versionOf, type Setup, type Started } from "./test-utils";

type Rig = Started & { catalog: Catalog; rollout: Rollout; fresh: () => Rollout; before: string };

/**
 * A work on Verification with the rollout gate open: verification report PASS, reviews clean, the plugin's working copy clean on main, the work's
 * HEAD `h1` a descendant of its HEAD (`before`). By default the plugin is installed from its folder and running.
 */
async function ready(o: { installed?: boolean; enabled?: boolean; migrations?: boolean; s?: Setup } = {}): Promise<Rig> {
  const s = await started(o.s ?? setup());
  idleStage(s);
  s.ports.files.set(`${s.env}:${s.docs.tz}`, `### Task 1: A\nMIGRATIONS: ${o.migrations ? "yes" : "no"}\n`);
  await moveTo(s, 5);
  s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "all good\nVERDICT: PASS");
  reviewed(s, 5, "verify", await versionOf(s));
  if (o.installed !== false) s.ports.plugins.add({ id: "hello", ...(o.enabled === false ? { enabled: false, state: "disabled" as const } : {}) });
  const catalog = new Catalog(s.store, s.ports);
  const fresh = () => new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true });
  return { ...s, catalog, rollout: fresh(), fresh, before: (await s.ports.git.facts(s.dir)).head! };
}
const args = async (r: Rig, force = false) => ({ expectedVersion: await versionOf(r), force });
const current = (r: Rig) => r.store.currentAttempt("hello")!;
const plugin = async (r: Rig) => (await r.ports.plugins.list()).find((p) => p.id === "hello");
/** VesnALIA finished all running install jobs. */
async function finishJobs(r: Rig, state: "succeeded" | "failed" | "cancelled" = "succeeded"): Promise<void> {
  for (const j of await r.ports.plugins.jobs()) if (["queued", "running", "cancelling"].includes(j.state)) r.ports.plugins.setJob(j.id, state);
}
/** The rollout is done: the install job succeeded, the work is on Rollout, the live-check thread was created and finished its turn. */
async function enterDone(r: Rig): Promise<string> {
  expect(await r.rollout.enter(r.id, await args(r))).toMatchObject({ ok: true });
  await finishJobs(r);
  const a = current(r).id;
  await r.rollout.advance(a);
  expect(r.store.attempt(a)).toMatchObject({ status: "done" });
  idleStage(r, 6);
  return a;
}

describe("classifyCopy", () => {
  test("classifyCopy", () => {
    expect(classifyCopy({ head: "A", clean: true, equalsFrom: true }, "A", "B")).toBe("before");
    expect(classifyCopy({ head: "B", clean: true, equalsFrom: false }, "A", "B")).toBe("after");
    expect(classifyCopy({ head: "B", clean: false, equalsFrom: true }, "A", "B")).toBe("interrupted");
    expect(classifyCopy({ head: "B", clean: false, equalsFrom: false }, "A", "B")).toBe("unexpected"); // files as in A, but the index is a third version
    expect(classifyCopy({ head: "C", clean: true, equalsFrom: false }, "A", "B")).toBe("unexpected");
    expect(classifyCopy({ head: "A", clean: false, equalsFrom: false }, "A", "B")).toBe("unexpected");
    expect(classifyCopy({ head: null, clean: true, equalsFrom: false }, "A", "B")).toBe("unexpected");
  });
  test("a move onto the same commit is done when the copy is clean", () => {
    expect(classifyCopy({ head: "A", clean: true, equalsFrom: true }, "A", "A")).toBe("after");
    expect(classifyCopy({ head: "A", clean: false, equalsFrom: false }, "A", "A")).toBe("unexpected");
  });
});

describe("Rollout: rollout", () => {
  test("enter: refs before/target are written before the branch moves", async () => {
    const r = await ready();
    const mark = r.ports.calls.length;
    expect(await r.rollout.enter(r.id, await args(r))).toEqual({ ok: true, blockers: [], warnings: [] });
    // The GitHub check before the rollout comes before the attempt is recorded; the order of refs and the move is checked without it.
    expect(r.ports.calls.slice(mark).map((c) => c.effect).filter((e) => !e.startsWith("github.")).slice(0, 3)).toEqual(["updateRef", "updateRef", "resetKeep"]);
    expect(r.ports.git.ref(r.dir, `refs/workshop/${r.key}/before`)).toBe(r.before);
    expect(r.ports.git.ref(r.dir, `refs/workshop/${r.key}/target`)).toBe("h1");
    expect(current(r)).toMatchObject({
      kind: "enter", work_id: r.id, before_sha: r.before, target_sha: "h1", migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1,
      step: "installed", status: "running", job_id: "job_1", known_job_ids: "[]", lock_held: 1,
    });
    expect((await r.ports.git.facts(r.dir)).head).toBe("h1");
    expect(r.ports.calls.find((c) => c.effect === "startInstall")!.args).toEqual([r.dir]);
    // The work stays on Verification until the rollout succeeds; the handover is recorded.
    expect(r.store.work(r.id)!.stage).toBe(5);
    expect(r.store.handovers(r.id).at(-1)).toMatchObject({ stage: 5, action: "forward", to_stage: 6, forced: false });
    expect(r.store.work(r.id)).toMatchObject({ state: "installing", state_reason: "rollout: the plugin is being installed" });
  });

  test("the gates of «Roll out» are the gates of stage 5, with the screen's version", async () => {
    const r = await ready();
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 1)}`, "VERDICT: FAIL");
    expect(await r.rollout.enter(r.id, await args(r))).toEqual({ ok: false, blockers: ["verification is red — send it back to Implementation"], warnings: [] });
    expect(r.store.currentAttempt("hello")).toBeNull();
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 1)}`, "VERDICT: PASS");
    const v = await versionOf(r);
    commitWork(r, "h2");
    await expect(r.rollout.enter(r.id, { expectedVersion: v, force: false })).rejects.toThrow("the version has changed");
    expect(r.store.currentAttempt("hello")).toBeNull();
    expect(r.ports.count("updateRef")).toBe(0);
  });

  test("aborts when the copy moved since recording", async () => {
    const r = await ready();
    r.ports.failAt("resetKeep");
    await expect(r.rollout.enter(r.id, await args(r))).rejects.toThrow("failure before resetKeep");
    r.ports.failAt(null);
    expect(current(r)).toMatchObject({ step: "moved", status: "running" });
    // Someone committed to the working copy's main between recording the attempt and the merge.
    r.ports.git.commit(r.dir);
    await r.rollout.advance(current(r).id);
    const a = current(r);
    expect(a).toMatchObject({ status: "failed", step: "moved", lock_held: 0 });
    expect(a.error!.startsWith(UNEXPECTED_COPY)).toBe(true);
    expect(r.ports.count("resetKeep")).toBe(0);
    expect(r.ports.count("startInstall")).toBe(0);
    expect(r.store.work(r.id)).toMatchObject({ stage: 5, state: "unexpected" });
  });

  test("a refused reset --keep leaves the copy as it was; a recovery that fails is an unexpected copy", async () => {
    const r = await ready();
    r.ports.git.setRepo(r.dir, { keepRefuses: true });
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    expect(current(r)).toMatchObject({ status: "failed", step: "moved" });
    expect(current(r).error).toContain("git reset --keep");
    expect(current(r).error).not.toContain(UNEXPECTED_COPY);
    expect((await r.ports.git.facts(r.dir)).head).toBe(r.before);
    expect(r.store.work(r.id)).toMatchObject({ stage: 5, state: "error", state_reason: "rollout failed: the working copy is unchanged" });
    expect((await r.rollout.availability("hello")).rollback).toBe("the attempt did not reach the install — nothing to roll back");

    const t = await ready();
    t.ports.failAt("resetKeep");
    await t.rollout.enter(t.id, await args(t)).catch(() => undefined);
    t.ports.git.setRepo(t.dir, { head: "h1", tree: t.before });
    t.ports.failAt("resetHard");
    await t.rollout.advance(current(t).id);
    t.ports.failAt(null);
    expect(current(t)).toMatchObject({ status: "failed", step: "moved" });
    expect(current(t).error!.startsWith(`${UNEXPECTED_COPY}: the interrupted transition`)).toBe(true);
    expect(t.store.work(t.id)!.state).toBe("unexpected");
    expect(t.ports.count("startInstall")).toBe(0);
  });

  test("a refused reset --keep says what git said, cut to 300 characters", async () => {
    const r = await ready();
    const why = `error: Entry 'server.ts' not uptodate. Cannot merge.\nfatal: Could not reset index file to revision 'h1'. ${"x".repeat(400)}`;
    r.ports.git.setRepo(r.dir, { keepRefuses: why });
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    const a = current(r);
    expect(a).toMatchObject({ status: "failed", step: "moved", lock_held: 0 });
    expect(a.error).toContain("git reset --keep");
    expect(a.error).toContain("nothing changed");
    expect(a.error).toContain("error: Entry 'server.ts' not uptodate. Cannot merge.");
    expect(a.error).toContain(why.slice(0, 300));
    expect(a.error).not.toContain(why.slice(0, 301));
    expect(a.error).not.toContain(UNEXPECTED_COPY);
    expect(r.store.work(r.id)).toMatchObject({ stage: 5, state: "error" });
  });

  test("an unexpected copy after a successful reset --keep names the files from git status, up to 10", async () => {
    const r = await ready();
    const lines = Array.from({ length: 12 }, (_, i) => `?? junk-${i + 1}.ts`);
    const keep = r.ports.git.resetKeep.bind(r.ports.git);
    // During the transition someone wrote files into the working copy: `reset --keep` went through, but the copy is not «after».
    vi.spyOn(r.ports.git, "resetKeep").mockImplementation(async (dir, sha) => {
      const out = await keep(dir, sha);
      r.ports.git.setRepo(dir, { dirtyCount: lines.length, status: lines });
      return out;
    });
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    const a = current(r);
    expect(a).toMatchObject({ status: "failed", step: "moved" });
    expect(a.error!.startsWith(UNEXPECTED_COPY)).toBe(true);
    for (const l of lines.slice(0, 10)) expect(a.error).toContain(l);
    expect(a.error).not.toContain("junk-11.ts");
    expect(a.error).toContain("and 2 more");
    expect(r.ports.count("startInstall")).toBe(0);
    expect(r.store.work(r.id)!.state).toBe("unexpected");
  });

  test("interrupted move is snapshotted before recovery", async () => {
    const r = await ready();
    r.ports.failAt("resetKeep");
    await r.rollout.enter(r.id, await args(r)).catch(() => undefined);
    r.ports.failAt(null);
    // `git reset --keep` was interrupted: the branch is already at target, files and index are still before, no foreign changes.
    r.ports.git.setRepo(r.dir, { head: "h1", tree: r.before });
    const mark = r.ports.calls.length;
    await r.rollout.advance(current(r).id);
    const effects = r.ports.calls.slice(mark).map((c) => c.effect);
    expect(effects.indexOf("snapshotTree")).toBeGreaterThanOrEqual(0);
    expect(effects.indexOf("snapshotTree")).toBeLessThan(effects.indexOf("resetHard"));
    expect(r.ports.calls.find((c) => c.effect === "snapshotTree")!.args[1]).toBe(`refs/workshop/${r.key}/pre-recover`);
    expect(r.ports.git.ref(r.dir, `refs/workshop/${r.key}/pre-recover`)).not.toBeNull();
    expect(await r.ports.git.copyEquals(r.dir, "h1")).toBe(true);
    expect(r.ports.count("resetKeep")).toBe(0);
    expect(current(r)).toMatchObject({ step: "installed", status: "running" });
  });

  test("an install of about a second finishes within the same pass: no minute pause on «installed»", async () => {
    const r = await ready();
    // VesnALIA finishes the job a second after the start; the fake's time is moved only by the attempt's poll (`sleep`).
    const start = r.ports.plugins.startInstall.bind(r.ports.plugins);
    r.ports.plugins.startInstall = async (dir) => {
      const id = await start(dir);
      r.ports.after(1_000, () => r.ports.plugins.setJob(id, "succeeded"));
      return id;
    };
    expect(await r.rollout.enter(r.id, await args(r))).toMatchObject({ ok: true });
    expect(current(r)).toMatchObject({ status: "done", job_state: "succeeded", lock_held: 0 });
    expect(r.ports.slept).toBeGreaterThanOrEqual(1_000);
    expect(r.ports.slept).toBeLessThan(2_000);
    expect(r.store.work(r.id)!.stage).toBe(6);
  });

  test("the build lock taken a second after the request is waited for within the pass", async () => {
    const r = await ready();
    r.ports.lock.occupy(true);
    r.ports.after(1_000, () => r.ports.lock.occupy(false));
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    expect(current(r)).toMatchObject({ step: "installed", status: "running", job_id: "job_1" });
    expect(r.ports.count("lock.spawnedHolders")).toBe(1);
  });

  test("the short poll gives up after 10 seconds and leaves the rest to the next pass", async () => {
    const r = await ready();
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    expect(current(r)).toMatchObject({ step: "installed", status: "running" });
    expect(r.ports.slept).toBe(10_000);
    const s = await ready();
    s.ports.lock.occupy(true);
    await s.rollout.enter(s.id, await args(s));
    expect(current(s)).toMatchObject({ step: "locking", status: "running" });
    expect(s.ports.slept).toBe(10_000);
  });

  test("a stop signal ends the short poll at once: no step written, no failure noted, the next pass goes on", async () => {
    const r = await ready();
    const stop = new AbortController();
    const stoppable = new Rollout(r.store, r.ports, r.engine, r.catalog, { cancelSupported: true, stop: () => stop.signal });
    r.ports.lock.occupy(true);
    r.ports.after(1_000, () => stop.abort());
    expect((await stoppable.enter(r.id, await args(r))).ok).toBe(true);
    expect(current(r)).toMatchObject({ step: "locking", status: "running", lock_held: 1 });
    expect(r.ports.slept).toBe(1_000);
    expect(r.store.events(r.id).some((e) => e.text.includes("interrupted"))).toBe(false);
    // A stopped pass takes no further attempts; a new one finishes them.
    r.ports.lock.occupy(false);
    await stoppable.advanceAll();
    expect(current(r).step).toBe("locking");
    await r.fresh().advanceAll();
    expect(current(r)).toMatchObject({ step: "installed", job_id: "job_1" });
  });

  test("waits for the build lock", async () => {
    const r = await ready();
    r.ports.lock.occupy(true);
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    expect(current(r)).toMatchObject({ step: "locking", status: "running", lock_held: 1 });
    expect(r.ports.count("startInstall")).toBe(0);
    await r.engine.reconcile(r.id);
    expect(r.store.work(r.id)).toMatchObject({ state: "locking", state_reason: "rollout: waiting for the build lock — another build or install is running" });
    await r.rollout.advanceAll();
    await r.fresh().advanceAll();
    expect(current(r).step).toBe("locking");
    expect(r.ports.count("lock.spawnedHolders")).toBe(1);
    r.ports.lock.occupy(false);
    await r.rollout.advanceAll();
    expect(current(r)).toMatchObject({ step: "installed", job_id: "job_1" });
    expect(r.ports.count("lock.spawnedHolders")).toBe(1);
  });

  test("a dead holder is requested again with the same generation", async () => {
    const r = await ready();
    r.ports.lock.occupy(true);
    await r.rollout.enter(r.id, await args(r));
    const token = current(r).lock_token;
    r.ports.lock.kill(current(r).id);
    r.ports.lock.occupy(false);
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ step: "installed", lock_token: token });
    expect(r.ports.calls.filter((c) => c.effect === "lock.request").map((c) => c.args[1])).toEqual([token, token]);
  });

  test("lost startInstall answer with one new job is adopted", async () => {
    const r = await ready();
    r.ports.plugins.addJob({ id: "j1", source: `path:${r.dir}`, state: "succeeded" });
    r.ports.failAt("startInstall");
    await r.rollout.enter(r.id, await args(r)).catch(() => undefined);
    r.ports.failAt(null);
    expect(current(r)).toMatchObject({ step: "installing", known_job_ids: '["j1"]', job_id: null });
    r.ports.plugins.addJob({ id: "j2", source: `path:${r.dir}`, state: "running" });
    await r.fresh().advanceAll();
    expect(current(r)).toMatchObject({ step: "installed", job_id: "j2", status: "running" });
    expect(r.ports.count("startInstall")).toBe(0);
    await finishJobs(r);
    await r.rollout.advanceAll();
    expect(current(r).status).toBe("done");
  });

  test("lost answer with none or two new jobs → unknown, lock kept", async () => {
    for (const n of [0, 2]) {
      const r = await ready();
      r.ports.failAt("startInstall", n === 0 ? "before" : "after");
      await r.rollout.enter(r.id, await args(r)).catch(() => undefined);
      r.ports.failAt(null);
      // The second new job of the same folder has a bare path instead of `path:` (that is how the CLI records it): it belongs to this folder too.
      if (n === 2) r.ports.plugins.addJob({ id: "j9", source: r.dir, state: "queued" });
      await r.fresh().advance(current(r).id);
      const a = current(r);
      expect(a).toMatchObject({ status: "unknown", lock_held: 1, job_id: null });
      expect(a.error).toContain(`new jobs of this folder: ${n}`);
      expect(r.ports.count("lock.release")).toBe(0);
      expect(r.ports.lock.wantExists(a.id)).toBe(true);
      expect(r.ports.count("startInstall")).toBe(n === 0 ? 0 : 1);
      await r.engine.reconcile(r.id);
      expect(r.store.work(r.id)).toMatchObject({ stage: 5, state: "unknown" });
    }
  });

  test("unknown keeps the lock while a matching job runs, then releases", async () => {
    const r = await ready();
    r.ports.failAt("startInstall", "after");
    await r.rollout.enter(r.id, await args(r)).catch(() => undefined);
    r.ports.failAt(null);
    r.ports.plugins.addJob({ id: "j9", source: r.dir, state: "queued" });
    await r.rollout.advanceAll();
    const a = current(r);
    expect(a).toMatchObject({ status: "unknown", lock_held: 1 });
    await r.fresh().advanceAll(); // restart
    expect(r.store.attempt(a.id)!.lock_held).toBe(1);
    r.ports.plugins.setJob("job_1", "succeeded");
    await r.fresh().advanceAll();
    expect(r.store.attempt(a.id)!.lock_held).toBe(1); // j9 is still queued
    r.ports.plugins.setJob("j9", "cancelled");
    r.ports.plugins.failJobs = true; // the job list did not arrive — keep holding
    await r.fresh().advanceAll();
    expect(r.store.attempt(a.id)!.lock_held).toBe(1);
    r.ports.plugins.failJobs = false;
    await r.fresh().advanceAll();
    expect(r.store.attempt(a.id)).toMatchObject({ lock_held: 0, status: "unknown" });
    expect(r.ports.lock.wantExists(a.id)).toBe(false);
    expect(r.ports.count("lock.release")).toBe(1);
    expect(r.ports.count("startInstall")).toBe(1);
  });

  test("a job that vanished from VesnALIA's list is an unknown outcome; the lock is kept until no install of the folder runs", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.forgetJob("job_1");
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ status: "unknown", step: "installed", lock_held: 1 });
    expect(current(r).error).toContain("vanished");
    await r.rollout.advanceAll();
    expect(current(r).lock_held).toBe(0);
    expect(r.ports.count("startInstall")).toBe(1);
  });

  test("startInstall returned a known job → wait, start again, never adopt", async () => {
    const r = await ready();
    r.ports.lock.occupy(true);
    await r.rollout.enter(r.id, await args(r));
    // While the attempt waited for the lock, someone ran `alia plugin install` on the same folder: VesnALIA returns that job, which may have built old files.
    r.ports.plugins.addJob({ id: "j1", source: `path:${r.dir}`, state: "running" });
    r.ports.lock.occupy(false);
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ step: "installing", job_id: null, foreign_job_id: "j1", status: "running", lock_held: 1 });
    expect(r.ports.count("startInstall")).toBe(1);
    // After a restart — wait for the same foreign job, without a new start; it cannot be cancelled with the button.
    await r.fresh().advanceAll();
    expect(current(r)).toMatchObject({ step: "installing", foreign_job_id: "j1" });
    expect(r.ports.count("startInstall")).toBe(1);
    expect((await r.rollout.availability("hello")).cancelInstall).toBe("waiting for another install of this folder");
    await expect(r.rollout.cancelInstall("hello")).rejects.toThrow("waiting for another install of this folder");
    expect(r.ports.plugins.cancelled).toEqual([]);
    r.ports.plugins.setJob("j1", "succeeded");
    await r.rollout.advance(current(r).id);
    expect(r.ports.count("startInstall")).toBe(2);
    expect(current(r)).toMatchObject({ step: "installed", job_id: "job_1", known_job_ids: '["j1"]' });
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(current(r).status).toBe("done");
  });

  test("a second known answer after the foreign job ends → unknown, the lock stays", async () => {
    const r = await ready();
    r.ports.lock.occupy(true);
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.addJob({ id: "j1", source: `path:${r.dir}`, state: "running" });
    r.ports.lock.occupy(false);
    await r.rollout.advance(current(r).id);
    r.ports.plugins.setJob("j1", "succeeded");
    r.ports.plugins.startInstallReturns("j1");
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ status: "unknown", lock_held: 1, job_id: null });
    expect(r.ports.count("lock.release")).toBe(0);
    expect(r.ports.count("startInstall")).toBe(2);
  });

  test("cancel does not decide the outcome", async () => {
    for (const [end, status] of [["succeeded", "done"], ["cancelled", "failed"]] as const) {
      const r = await ready();
      await r.rollout.enter(r.id, await args(r));
      expect((await r.rollout.availability("hello")).cancelInstall).toBeNull();
      await r.rollout.cancelInstall("hello");
      expect(r.ports.plugins.cancelled).toEqual(["job_1"]);
      expect(current(r)).toMatchObject({ step: "installed", status: "running" });
      await r.rollout.advance(current(r).id);
      expect(current(r)).toMatchObject({ step: "installed", status: "running" }); // cancelling — the job is still running
      r.ports.plugins.setJob("job_1", end);
      await r.rollout.advance(current(r).id);
      expect(current(r)).toMatchObject({ status, job_state: end, lock_held: 0 });
      if (status === "failed") expect(current(r).error).toContain("install failed");
    }
  });

  test("cancelInstall is refused when not supported", async () => {
    const r = await ready();
    const off = new Rollout(r.store, r.ports, r.engine, r.catalog, { cancelSupported: false });
    expect((await off.availability("hello")).cancelInstall).toBe("cancelling an install is not supported");
    await off.enter(r.id, await args(r));
    expect((await off.availability("hello")).cancelInstall).toBe("cancelling an install is not supported");
    await expect(off.cancelInstall("hello")).rejects.toThrow("cancelling an install is not supported");
    expect(r.ports.plugins.cancelled).toEqual([]);
    await finishJobs(r);
    expect((await r.rollout.availability("hello")).cancelInstall).toBe("no install is running — nothing to cancel");
  });

  test("two concurrent advances start one install", async () => {
    const r = await ready();
    r.ports.failAt("updateRef");
    await r.rollout.enter(r.id, await args(r)).catch(() => undefined);
    r.ports.failAt(null);
    const a = current(r).id;
    expect(current(r).step).toBe("recorded");
    await Promise.all([r.rollout.advance(a), r.rollout.advance(a), r.fresh().advance(a)]);
    expect(r.ports.count("startInstall")).toBe(1);
    expect(r.ports.count("resetKeep")).toBe(1);
    expect(r.ports.count("lock.spawnedHolders")).toBe(1);
    expect(current(r)).toMatchObject({ step: "installed", job_id: "job_1" });
  });

  test("two writers without a shared queue still start one install: every step is a compare-and-swap", async () => {
    for (const start of ["recorded", "locking", "locked"] as const) {
      const db = new Database(":memory:");
      for (const sql of MIGRATIONS) db.exec(sql);
      const store = new Store(db);
      const ports = new FakePorts();
      const limits = () => ({ maxBuilding: 2, minFreeDiskGb: 2, autoReview: false });
      const r = await ready({ s: { store, ports, engine: new Engine(store, ports, limits) } });
      if (start === "recorded") r.ports.failAt("updateRef");
      else r.ports.lock.occupy(true);
      await r.rollout.enter(r.id, await args(r)).catch(() => undefined);
      r.ports.failAt(null);
      if (start === "locked") r.ports.plugins.failJobs = true; // lock taken, the job list before the start did not arrive
      r.ports.lock.occupy(false);
      if (start === "locked") {
        await r.rollout.advance(current(r).id).catch(() => undefined);
        r.ports.plugins.failJobs = false;
      }
      expect(current(r).step).toBe(start);
      // A second Store wrapper over the same database has its own queue: only the step records keep a step from being done twice.
      const other = new Store(db);
      const second = new Rollout(other, ports, new Engine(other, ports, limits), new Catalog(other, ports), { cancelSupported: true });
      const a = current(r).id;
      await Promise.all([r.rollout.advance(a), second.advance(a)]);
      expect(ports.count("startInstall")).toBe(1);
      expect(ports.count("resetKeep")).toBeLessThanOrEqual(1);
      expect(ports.count("lock.spawnedHolders")).toBe(1);
      expect(current(r)).toMatchObject({ step: "installed", job_id: "job_1", status: "running" });
    }
  });

  test("success writes installed sha and the live-check entry in one transaction", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    await finishJobs(r);
    const a = current(r).id;
    // A failure inside the outcome transaction — no «done» mark, no rolled-out commit, no stage change.
    const entry = r.engine.liveCheckEntry.bind(r.engine);
    r.engine.liveCheckEntry = () => {
      throw new Error("failure inside the outcome");
    };
    await expect(r.rollout.advance(a)).rejects.toThrow("failure inside the outcome");
    r.engine.liveCheckEntry = entry;
    expect(r.store.attempt(a)).toMatchObject({ status: "running", step: "checked" });
    expect(r.store.plugin("hello")!.installed_sha).toBeNull();
    expect(r.store.work(r.id)!.stage).toBe(5);
    // A restart right after the outcome transaction: everything is recorded together; the reconcile creates the check thread — once.
    const changed = r.ports.changed.bind(r.ports);
    r.ports.changed = (id) => {
      if (r.store.attempt(a)?.status === "done") throw new Error("restart right after the outcome transaction");
      changed(id);
    };
    await expect(r.rollout.advance(a)).rejects.toThrow("restart");
    r.ports.changed = changed;
    expect(r.store.attempt(a)).toMatchObject({ status: "done", lock_held: 0 });
    expect(r.store.plugin("hello")!.installed_sha).toBe("h1");
    expect(r.store.work(r.id)!.stage).toBe(6);
    expect(r.store.entry(r.store.work(r.id)!)).toMatchObject({ stage: 6, from: 5, attemptId: a });
    expect(r.store.stageThread(r.id, 6)).toBeNull();
    await r.fresh().advanceAll();
    await r.engine.reconcile(r.id);
    await r.engine.reconcile(r.id);
    expect(r.store.runs(r.id).filter((x) => x.stage === 6)).toHaveLength(1);
    expect(r.store.work(r.id)!.entry).toBeNull();
    expect(r.ports.taskRows.get(r.w.task_id!)!.status).toBe("in_review");
  });

  test("a job that succeeded while the plugin is in error is a failed install (succeeded ≠ working)", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    await finishJobs(r);
    Object.assign(r.ports.plugins.items.get("hello")!, { state: "error", error: "Build failed with 1 error" });
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ status: "failed", step: "checked", job_state: "succeeded" });
    expect(current(r).error).toBe("install failed: the plugin is in state error (Build failed with 1 error)");
    expect(r.store.work(r.id)!.stage).toBe(5);
  });

  test("a failed or cancelled install does not switch on a plugin that was off before the enter", async () => {
    for (const end of ["failed", "cancelled"] as const) {
      const r = await ready({ enabled: false });
      await r.rollout.enter(r.id, await args(r));
      r.ports.plugins.setJob("job_1", end);
      await r.rollout.advance(current(r).id);
      expect(current(r)).toMatchObject({ status: "failed", step: "checked", job_state: end });
      expect(current(r).error).toBe(`install failed: job job_1 — ${end}${end === "failed" ? " (install failed)" : ""}; the plugin is disabled`);
      expect(await plugin(r)).toMatchObject({ enabled: false, state: "disabled" });
      expect(r.ports.count("enable")).toBe(0);
    }
  });

  test("needs-configuration after the install is a success with the label «needs configuration» and an item for the live check", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    await finishJobs(r);
    Object.assign(r.ports.plugins.items.get("hello")!, { state: "needs-configuration", error: "missing setting apiKey" });
    await r.rollout.advance(current(r).id);
    expect(current(r).status).toBe("done");
    expect(r.store.work(r.id)!.stage).toBe(6);
    // The state confirmed by the list during the check is recorded with the outcome: the board says «needs configuration» right away.
    expect(r.store.plugin("hello")).toMatchObject({ last_state: "needs-configuration", last_enabled: 1 });
    expect(labelsOf((await r.catalog.one("hello"))!)).toContain("needs configuration");
    const live = r.ports.threads.get(r.store.stageThread(r.id, 6)!.thread_id)!;
    expect(live.prompt).toContain("the plugin came up in the `needs-configuration` state — it needs configuration");
    idleStage(r, 6);
    await r.engine.reconcile(r.id);
    expect(r.store.work(r.id)).toMatchObject({ state: "owner", state_reason: expect.stringContaining("needs configuration") });
  });

  test("failed install offers rollback by default", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.setJob("job_1", "failed", "esbuild: Transform failed");
    await r.rollout.advance(current(r).id);
    const a = current(r);
    expect(a).toMatchObject({ status: "failed", step: "checked", lock_held: 0, job_state: "failed" });
    expect(a.error).toContain("install failed");
    expect(a.error).toContain("esbuild: Transform failed");
    // A failed rollout leaves the work on Verification.
    expect(r.store.work(r.id)).toMatchObject({ stage: 5, state: "error" });
    expect(r.store.plugin("hello")!.installed_sha).toBeNull();
    expect(r.ports.lock.wantExists(a.id)).toBe(false);
    const av = await r.rollout.availability("hello");
    expect(av.rollback).toBeNull();
    expect(av.disable).toBeNull();
    expect(av.reinstall).toBe("a retry is only possible when the install outcome is unknown");
    // «Roll out» again — not blindly on top of a failure: the owner decides first.
    expect(await r.rollout.enter(r.id, await args(r))).toEqual({
      ok: false, blockers: ["rollout failed: the plugin is not in the expected state — roll back or disable the plugin"], warnings: [],
    });
  });

  test("an undecided unknown is repeated only by «Install again», and only with HEAD on the target", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.forgetJob("job_1");
    await r.rollout.advance(current(r).id);
    const unknown = current(r).id;
    await r.rollout.advanceAll();
    expect(await r.rollout.enter(r.id, await args(r))).toMatchObject({ ok: false, blockers: ["install outcome unknown — «Install again», «Roll back» or «Disable»"] });
    expect((await r.rollout.availability("hello")).reinstall).toBeNull();
    r.ports.git.commit(r.dir);
    expect((await r.rollout.availability("hello")).reinstall).toMatch(/^the working copy's main branch is not at the rolled-out commit .* — a retry is unsafe$/);
    r.ports.git.setRepo(r.dir, { head: "h1" });
    await r.rollout.reinstall("hello");
    const re = current(r);
    expect(re).toMatchObject({ kind: "reinstall", work_id: r.id, before_sha: r.before, target_sha: "h1", step: "installed", status: "running", origin_id: unknown });
    expect(r.store.attempt(unknown)!.resolved_at).not.toBeNull();
    expect(r.ports.count("resetKeep")).toBe(1); // HEAD is already at target: the retry does not move the branch
    await finishJobs(r);
    await r.rollout.advance(re.id);
    expect(current(r)).toMatchObject({ id: re.id, status: "done" });
    expect(r.store.work(r.id)!.stage).toBe(6);
    expect(r.store.stageThread(r.id, 6)).not.toBeNull();
    expect(r.store.plugin("hello")!.installed_sha).toBe("h1");
    expect((await r.rollout.availability("hello")).reinstall).toBe("a retry is only possible when the install outcome is unknown");
  });

  test("nothing on top of a running job or a waiting holder", async () => {
    const r = await ready();
    await enterDone(r);
    // A job of the same folder is still running (being cancelled) — started with a bare path.
    r.ports.plugins.addJob({ id: "jx", source: r.dir, state: "cancelling" });
    const busy = "an install is running — wait or cancel it";
    expect(await r.rollout.availability("hello")).toEqual({ rollback: busy, reinstall: busy, disable: busy, enable: busy, cancelInstall: null, adopt: busy });
    await expect(r.rollout.rollback("hello", "x")).rejects.toThrow(busy);
    await expect(r.rollout.setEnabled("hello", false)).rejects.toThrow(busy);
    await expect(r.rollout.reinstall("hello")).rejects.toThrow(busy);
    r.ports.plugins.setJob("jx", "cancelled");
    r.ports.plugins.failJobs = true;
    const noJobs = "the install job list did not arrive — the action does not start";
    expect(await r.rollout.availability("hello")).toMatchObject({ rollback: noJobs, disable: noJobs, enable: noJobs });
    await expect(r.rollout.rollback("hello", "x")).rejects.toThrow(noJobs);
    r.ports.plugins.failJobs = false;
    r.ports.plugins.failList = true;
    expect((await r.rollout.availability("hello")).rollback).toBe("the plugin list did not arrive — the action does not start");
    r.ports.plugins.failList = false;
    expect((await r.rollout.availability("hello")).rollback).toBeNull();

    const t = await ready();
    t.ports.plugins.addJob({ id: "jq", source: `path:${t.dir}`, state: "queued" });
    await expect(t.rollout.enter(t.id, await args(t))).rejects.toThrow(busy);
    expect(t.store.currentAttempt("hello")).toBeNull();

    const u = await ready();
    u.ports.lock.occupy(true);
    await u.rollout.enter(u.id, await args(u));
    const waiting = "a rollout is in progress — wait";
    expect(await u.rollout.availability("hello")).toMatchObject({ rollback: waiting, reinstall: waiting, disable: waiting, enable: waiting });
    await expect(u.rollout.setEnabled("hello", false)).rejects.toThrow(waiting);
    await expect(u.rollout.enter(u.id, await args(u))).rejects.toThrow(waiting);
  });
});

describe("Rollout: rollback", () => {
  test("rollback returns HEAD, files and installed_sha to the commit before the enter", async () => {
    const r = await ready();
    const e = await enterDone(r);
    expect(r.store.plugin("hello")!.installed_sha).toBe("h1");
    await r.rollout.rollback("hello", "it broke");
    const rb = current(r);
    expect(rb).toMatchObject({ kind: "rollback", work_id: r.id, before_sha: "h1", target_sha: r.before, want_enabled: 1, step: "installed", status: "running", origin_id: e, note: "it broke" });
    await finishJobs(r);
    await r.rollout.advance(rb.id);
    expect(r.store.attempt(rb.id)).toMatchObject({ status: "done", lock_held: 0 });
    expect((await r.ports.git.facts(r.dir)).head).toBe(r.before);
    expect(await r.ports.git.copyEquals(r.dir, r.before)).toBe(true);
    expect(r.store.plugin("hello")!.installed_sha).toBe(r.before);
    expect(r.store.attempt(e)!.resolved_at).not.toBeNull();
    expect(await plugin(r)).toMatchObject({ enabled: true, state: "running" });
    // The work went back to the implementer; the work's commits are intact in its branch and under the target ref.
    expect(r.store.work(r.id)).toMatchObject({ stage: 4, iteration: 2 });
    expect(r.ports.git.ref(r.dir, `refs/workshop/${r.key}/target`)).toBe("h1");
  });

  test("«Roll back» after a failed enter on «Verification» returns the code and the work, and resolves the failure", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    const e = current(r).id;
    r.ports.plugins.setJob("job_1", "failed");
    await r.rollout.advance(e);
    expect(r.store.attempt(e)).toMatchObject({ status: "failed" });
    await r.rollout.rollback("hello", "the build fails");
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ kind: "rollback", status: "done", origin_id: e });
    expect(r.store.attempt(e)!.resolved_at).not.toBeNull();
    expect((await r.ports.git.facts(r.dir)).head).toBe(r.before);
    expect(r.store.plugin("hello")!.installed_sha).toBe(r.before);
    expect(r.store.work(r.id)).toMatchObject({ stage: 4, iteration: 2 });
    expect(r.store.handovers(r.id).at(-1)).toMatchObject({ stage: 5, action: "back", to_stage: 4, note: "the build fails" });
  });

  test("«Disable» → «Roll out» keeps the rollback point of the failed enter: the chain of enters inherits it", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    const first = current(r).id;
    r.ports.plugins.setJob("job_1", "failed");
    await r.rollout.advance(first);
    expect(r.store.attempt(first)).toMatchObject({ status: "failed", step: "checked" });
    expect((await r.ports.git.facts(r.dir)).head).toBe("h1"); // the main branch already moved to the failed rollout's code
    await r.rollout.setEnabled("hello", false);
    // The implementer fixed the code: a new commit, a new verification.
    commitWork(r, "h2");
    await moveTo(r, 5);
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 2)}`, "fixed\nVERDICT: PASS");
    reviewed(r, 5, "verify", await versionOf(r), {}, 2);
    expect(await r.rollout.enter(r.id, await args(r))).toMatchObject({ ok: true });
    const second = current(r);
    expect(second).toMatchObject({ kind: "enter", before_sha: r.before, target_sha: "h2", was_installed: 1, was_enabled: 1 });
    expect(r.ports.git.ref(r.dir, `refs/workshop/${r.key}/before`)).toBe(r.before);
    expect(r.ports.count("resetKeep")).toBe(2); // h1 → h2: the branch moves from where it is now
    await finishJobs(r);
    await r.rollout.advance(second.id);
    expect(current(r)).toMatchObject({ id: second.id, status: "done" });
    idleStage(r, 6);
    expect((await r.rollout.availability("hello")).rollback).toBeNull();
    await r.rollout.rollback("hello", "still not right");
    expect(current(r)).toMatchObject({ kind: "rollback", before_sha: "h2", target_sha: r.before, want_enabled: 1 });
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(current(r).status).toBe("done");
    expect((await r.ports.git.facts(r.dir)).head).toBe(r.before);
    expect(r.store.plugin("hello")!.installed_sha).toBe(r.before);
    expect(await plugin(r)).toMatchObject({ enabled: true, state: "running" }); // as before the first attempt
  });

  test("a link of the chain that fails at the move keeps the point too: A→h1 fails, h1→h2 is refused, the third enter still rolls back to A", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.setJob("job_1", "failed");
    await r.rollout.advance(current(r).id);
    await r.rollout.setEnabled("hello", false);
    commitWork(r, "h2");
    await moveTo(r, 5);
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 2)}`, "fixed\nVERDICT: PASS");
    reviewed(r, 5, "verify", await versionOf(r), {}, 2);
    // Link 2: the point is inherited, the branch moves from h1 — and `reset --keep` refused.
    r.ports.git.setRepo(r.dir, { keepRefuses: true });
    await r.rollout.enter(r.id, await args(r));
    expect(current(r)).toMatchObject({ status: "failed", step: "moved", before_sha: r.before, from_sha: "h1" });
    // Link 3: from a failure at the merge the rollback point is inherited too, rather than becoming h1 (code that never ran).
    r.ports.git.setRepo(r.dir, { keepRefuses: false });
    await r.rollout.enter(r.id, await args(r));
    const third = current(r);
    expect(third).toMatchObject({ before_sha: r.before, from_sha: "h1", was_installed: 1, was_enabled: 1, step: "installed" });
    expect(r.ports.git.ref(r.dir, `refs/workshop/${r.key}/before`)).toBe(r.before);
    await finishJobs(r);
    await r.rollout.advance(third.id);
    expect(current(r).status).toBe("done");
    idleStage(r, 6);
    await r.rollout.rollback("hello", "back to the original");
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ kind: "rollback", status: "done", target_sha: r.before });
    expect((await r.ports.git.facts(r.dir)).head).toBe(r.before);
    expect(await plugin(r)).toMatchObject({ enabled: true, state: "running" });
  });

  test("an unexpected copy after the branch moved keeps the point: once the owner cleans the copy, the next enter rolls back to A", async () => {
    const r = await ready();
    r.ports.failAt("resetKeep");
    await r.rollout.enter(r.id, await args(r)).catch(() => undefined);
    r.ports.failAt(null);
    // The branch is already at h1, but the working copy has stray changes: neither «before», nor «after», nor «interrupted».
    r.ports.git.setRepo(r.dir, { head: "h1", dirtyCount: 1 });
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ status: "failed", step: "moved" });
    expect(current(r).error!.startsWith(UNEXPECTED_COPY)).toBe(true);
    r.ports.git.setRepo(r.dir, { dirtyCount: 0 }); // the owner sorted out the copy
    await r.rollout.enter(r.id, await args(r));
    const second = current(r);
    expect(second).toMatchObject({ before_sha: r.before, from_sha: "h1", target_sha: "h1", step: "installed" });
    await finishJobs(r);
    await r.rollout.advance(second.id);
    idleStage(r, 6);
    await r.rollout.rollback("hello", "back");
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ kind: "rollback", status: "done" });
    expect((await r.ports.git.facts(r.dir)).head).toBe(r.before);
    expect(r.store.plugin("hello")!.installed_sha).toBe(r.before);
  });

  test("migrations of the failed link count only once it got past the move: before it nothing could have run", async () => {
    const r = await ready({ migrations: true });
    r.ports.git.setRepo(r.dir, { keepRefuses: true });
    await r.rollout.enter(r.id, await args(r));
    expect(current(r)).toMatchObject({ status: "failed", step: "moved", migrations: 1 });
    r.ports.git.setRepo(r.dir, { keepRefuses: false });
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await r.rollout.enter(r.id, await args(r));
    expect(current(r)).toMatchObject({ before_sha: r.before, migrations: 0 });

    const t = await ready({ migrations: true });
    await t.rollout.enter(t.id, await args(t));
    t.ports.plugins.setJob("job_1", "failed");
    await t.rollout.advance(current(t).id);
    await t.rollout.setEnabled("hello", false);
    t.ports.files.set(`${t.env}:${t.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await t.rollout.enter(t.id, await args(t));
    expect(current(t)).toMatchObject({ before_sha: t.before, migrations: 1 });
  });

  test("migrations of a link past the move reach the third link through a link that failed at the move", async () => {
    const r = await ready({ migrations: true });
    // Link 1: A → h1 with migrations, the merge went through, the install failed — the migrations may have run.
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.setJob("job_1", "failed");
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ status: "failed", migrations: 1 });
    await r.rollout.setEnabled("hello", false);
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    commitWork(r, "h2");
    await moveTo(r, 5);
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 2)}`, "fixed\nVERDICT: PASS");
    reviewed(r, 5, "verify", await versionOf(r), {}, 2);
    // Link 2: the point is inherited, `reset --keep` refused — the link itself did not get past the merge, but it carries link 1's migrations.
    r.ports.git.setRepo(r.dir, { keepRefuses: true });
    await r.rollout.enter(r.id, await args(r));
    expect(current(r)).toMatchObject({ status: "failed", step: "moved", from_sha: "h1", migrations: 1 });
    // Link 3: inherits from link 2 — the inherited point carries the migrations too (conservative: rollback closed, not opened).
    r.ports.git.setRepo(r.dir, { keepRefuses: false });
    await r.rollout.enter(r.id, await args(r));
    expect(current(r)).toMatchObject({ before_sha: r.before, from_sha: "h1", migrations: 1 });
  });

  test("rollback of a new plugin after a failed enter leaves installed_sha as it was: that commit never worked", async () => {
    const r = await ready({ installed: false });
    await r.rollout.enter(r.id, await args(r));
    await finishJobs(r);
    Object.assign(r.ports.plugins.items.get("hello")!, { state: "error", error: "Build failed" });
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ status: "failed", was_installed: 0 });
    expect(r.store.plugin("hello")!.installed_sha).toBeNull();
    await r.rollout.rollback("hello", "never took off");
    expect(current(r)).toMatchObject({ kind: "rollback", status: "done" });
    expect(await plugin(r)).toMatchObject({ enabled: false });
    expect(r.store.plugin("hello")!.installed_sha).toBeNull();
    expect(r.store.work(r.id)!.stage).toBe(4);
  });

  test("the move to «Rollout» and the return after a rollback are snapshotted and told to the task, like any handover", async () => {
    const r = await ready();
    await enterDone(r);
    expect(r.ports.saved.at(-1)!.label).toMatch(/-s5-i1$/);
    const comments = r.ports.taskRows.get(r.w.task_id!)!.comments;
    expect(comments.at(-1)).toBe("«Verification» handed over — stage «Rollout»: plugin rolled out, commit h1.");
    await r.rollout.rollback("hello", "it broke");
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(r.ports.saved.at(-1)!.label).toMatch(/-s6-i1-back$/);
    expect(comments.at(-1)).toBe(`Rollback: plugin back on commit ${r.before.slice(0, 7)}. Sent back to «Implementation»: it broke`);
  });

  test("rollback of a never-installed plugin disables it", async () => {
    const r = await ready({ installed: false });
    const e = await enterDone(r);
    expect(r.store.attempt(e)).toMatchObject({ was_installed: 0, was_enabled: 0 });
    const effects = ["resetKeep", "resetHard", "lock.request", "startInstall", "disable"];
    const base = effects.map((x) => r.ports.count(x));
    r.ports.failAt("disable");
    await expect(r.rollout.rollback("hello", "not needed")).rejects.toThrow("failure before disable");
    r.ports.failAt(null);
    const rb = current(r);
    expect(rb).toMatchObject({ kind: "rollback", step: "state-set", status: "running", before_sha: "h1", target_sha: "h1", want_enabled: 0, lock_held: 0, lock_token: null });
    // While the rollback disables the new plugin, the card does not say «waiting for the build lock».
    await r.engine.reconcile(r.id);
    expect(r.store.work(r.id)).toMatchObject({ state: "installing", state_reason: "rollback running: disabling the plugin" });
    await r.rollout.advance(rb.id);
    expect(effects.map((x, i) => r.ports.count(x) - base[i]!)).toEqual([0, 0, 0, 0, 1]);
    expect(current(r)).toMatchObject({ id: rb.id, status: "done" });
    expect(await plugin(r)).toMatchObject({ enabled: false, state: "disabled" });
    // The code stays, the plugin is disabled: the rollout's commit remains the rolled-out one.
    expect(r.store.plugin("hello")!.installed_sha).toBe("h1");
    expect((await r.ports.git.facts(r.dir)).head).toBe("h1");
    expect(r.store.attempt(e)!.resolved_at).not.toBeNull();
    expect(r.store.work(r.id)!.stage).toBe(4);
  });

  test("rollback of a plugin that was disabled before the enter ends disabled and done", async () => {
    const r = await ready({ enabled: false });
    const e = await enterDone(r);
    expect(r.store.attempt(e)).toMatchObject({ was_installed: 1, was_enabled: 0 });
    expect(await plugin(r)).toMatchObject({ enabled: true }); // a rollout puts the plugin into production: the install enabled it
    await r.rollout.rollback("hello", "back");
    expect(current(r)).toMatchObject({ kind: "rollback", want_enabled: 0 });
    await finishJobs(r); // the install enables the disabled plugin again
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ status: "done", job_state: "succeeded" });
    expect(await plugin(r)).toMatchObject({ enabled: false, state: "disabled" });
  });

  test("work with migrations cannot be rolled back", async () => {
    const r = await ready({ migrations: true });
    await enterDone(r);
    expect(current(r).migrations).toBe(1);
    expect((await r.rollout.availability("hello")).rollback).toBe("the work added data migrations — rollback is impossible, only «Disable»");
    await expect(r.rollout.rollback("hello", "x")).rejects.toThrow("the work added data migrations — rollback is impossible, only «Disable»");
    expect((await r.rollout.availability("hello")).disable).toBeNull();
  });

  test("rollback at stage 6 stops the live check first and returns the work in the same transaction", async () => {
    const r = await ready();
    const e = await enterDone(r);
    const live = r.store.stageThread(r.id, 6)!.thread_id;
    r.ports.threads.get(live)!.status = "active";
    const stop = r.ports.stop.bind(r.ports);
    r.ports.stop = async (id) => void r.ports.stopped.push(id); // the thread does not stop
    await expect(r.rollout.rollback("hello", "it broke")).rejects.toThrow("wait: the work's threads are still stopping");
    expect(current(r).id).toBe(e);
    expect(r.ports.stopped).toContain(live);
    r.ports.stop = stop;
    await r.rollout.rollback("hello", "it broke");
    expect(r.ports.threads.get(live)!.status).toBe("idle");
    expect(r.store.work(r.id)!.stage).toBe(6);
    await finishJobs(r);
    const changed = r.ports.changed.bind(r.ports);
    r.ports.changed = (id) => {
      const a = r.store.currentAttempt("hello");
      if (a?.kind === "rollback" && a.status === "done") throw new Error("restart right after the outcome transaction");
      changed(id);
    };
    await expect(r.rollout.advance(current(r).id)).rejects.toThrow("restart");
    r.ports.changed = changed;
    expect(r.store.work(r.id)).toMatchObject({ stage: 4, iteration: 2 });
    expect(r.store.entry(r.store.work(r.id)!)).toMatchObject({ stage: 4, from: 6 });
    expect(r.store.handovers(r.id).at(-1)).toMatchObject({ stage: 6, action: "back", to_stage: 4, note: "it broke" });
    expect(r.store.plugin("hello")!.installed_sha).toBe(r.before);
    expect(r.store.stageThread(r.id, 4)).toBeNull();
    await r.fresh().advanceAll();
    await r.engine.reconcile(r.id);
    await r.engine.reconcile(r.id);
    const builders = r.store.runs(r.id).filter((x) => x.stage === 4 && x.role === "stage");
    expect(builders).toHaveLength(1);
    expect(r.ports.threads.get(builders[0]!.thread_id)!.prompt).toContain("it broke");
  });

  test("after rollback a second rollback is impossible", async () => {
    const r = await ready();
    await enterDone(r);
    await r.rollout.rollback("hello", "x");
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ kind: "rollback", status: "done" });
    expect((await r.rollout.availability("hello")).rollback).toBe("no rollback point");
    await expect(r.rollout.rollback("hello", "once more")).rejects.toThrow("no rollback point");
  });

  test("rollback checks the working copy and other works right before it starts; nothing is touched on refusal", async () => {
    const r = await ready();
    await enterDone(r);
    r.ports.git.setRepo(r.dir, { dirtyCount: 2 });
    expect((await r.rollout.availability("hello")).rollback).toBe("2 uncommitted changes in the working copy");
    r.ports.git.setRepo(r.dir, { dirtyCount: 0, branch: "fix" });
    expect((await r.rollout.availability("hello")).rollback).toBe("the working copy is on branch fix, not main");
    r.ports.git.setRepo(r.dir, { branch: "main" });
    const c = r.ports.git.commit(r.dir);
    expect((await r.rollout.availability("hello")).rollback).toBe(`the working copy's main branch is not at the rolled-out commit (${c.slice(0, 7)}, not h1) — rollback by the record is impossible`);
    await expect(r.rollout.rollback("hello", "x")).rejects.toThrow("rollback by the record is impossible");
    expect(current(r).kind).toBe("enter");
    expect(r.ports.count("resetKeep")).toBe(1);
    await expect(r.rollout.rollback("hello", "  ")).rejects.toThrow("a rollback reason is required");
  });

  test("after acceptance the rollback point stays with the plugin, and the accepted work is not touched", async () => {
    const r = await ready();
    const e = await enterDone(r);
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "works\nVERDICT: PASS");
    expect(await r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: e, force: false, note: "" })).toMatchObject({ ok: true });
    expect((await r.rollout.availability("hello")).rollback).toBeNull();
    await r.rollout.rollback("hello", "broke after acceptance");
    await finishJobs(r);
    await r.rollout.advance(current(r).id);
    expect(current(r)).toMatchObject({ kind: "rollback", status: "done" });
    expect(r.store.work(r.id)).toMatchObject({ stage: 6, outcome: "done" });
    expect(r.store.plugin("hello")!.installed_sha).toBe(r.before);
  });

  test("rollback survives a crash of its own and its repeat is a rollback again", async () => {
    const r = await ready();
    await enterDone(r);
    await r.rollout.rollback("hello", "it broke");
    r.ports.plugins.forgetJob(current(r).job_id!);
    await r.rollout.advance(current(r).id);
    const rb = current(r);
    expect(rb).toMatchObject({ kind: "rollback", status: "unknown" });
    await r.rollout.advanceAll();
    expect((await r.rollout.availability("hello")).rollback).toBe("no rollback point");
    await r.rollout.reinstall("hello");
    const again = current(r);
    expect(again).toMatchObject({ kind: "rollback", before_sha: "h1", target_sha: r.before, origin_id: rb.origin_id, note: "it broke" });
    expect(r.store.attempt(rb.id)!.resolved_at).not.toBeNull();
    await finishJobs(r);
    await r.rollout.advance(again.id);
    expect(current(r).status).toBe("done");
    expect(r.store.work(r.id)!.stage).toBe(4);
    expect(r.store.attempt(rb.origin_id!)!.resolved_at).not.toBeNull();
  });
});

describe("Rollout: acceptance, «Disable» and «Enable»", () => {
  test("accept refuses a stale attempt id or version", async () => {
    const r = await ready();
    const e = await enterDone(r);
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "works\nVERDICT: PASS");
    const v = await versionOf(r);
    await expect(r.rollout.accept(r.id, { expectedVersion: v, attemptId: "att_old", force: false, note: "" })).rejects.toThrow("the attempt has changed — refresh the page");
    await expect(r.rollout.accept(r.id, { expectedVersion: { ...v, headSha: "h0" }, attemptId: e, force: false, note: "" })).rejects.toThrow("the version has changed");
    expect(r.store.work(r.id)!.outcome).toBeNull();
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "not quite\nVERDICT: FAIL");
    expect(await r.rollout.accept(r.id, { expectedVersion: v, attemptId: e, force: false, note: "" })).toEqual({ ok: false, blockers: [], warnings: ["the live check is red — accept anyway?"] });
    expect(await r.rollout.accept(r.id, { expectedVersion: v, attemptId: e, force: true, note: "good enough" })).toEqual({ ok: true, blockers: [], warnings: ["the live check is red — accept anyway?"] });
    expect(r.store.work(r.id)).toMatchObject({ outcome: "done", stage: 6 });
    expect(r.store.handovers(r.id).at(-1)).toMatchObject({ stage: 6, action: "forward", forced: true, note: `accepted, attempt ${e}: good enough` });
  });

  test("accept takes only an attempt of this work: neither another work's nor one without a work", async () => {
    const r = await ready();
    const mine = await enterDone(r);
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "works\nVERDICT: PASS");
    const other = attempt(r, { work: "w_other" });
    await expect(r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: other, force: false, note: "" })).rejects.toThrow("the attempt has changed");
    const none = attempt(r, { work: null });
    await expect(r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: none, force: false, note: "" })).rejects.toThrow("the attempt has changed");
    const again = attempt(r, { work: r.id });
    expect(await r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: again, force: false, note: "" })).toMatchObject({ ok: true });
    expect(mine).not.toBe(again);
  });

  test("«Disable» and «Enable» go by the list of plugins; «Disable» after a failure is the owner's decision", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.setJob("job_1", "failed");
    await r.rollout.advance(current(r).id);
    const failed = current(r).id;
    expect(await r.rollout.availability("hello")).toMatchObject({ disable: null, enable: "the plugin is already enabled" });
    await r.rollout.setEnabled("hello", false);
    expect(await plugin(r)).toMatchObject({ enabled: false, state: "disabled" });
    expect(r.store.attempt(failed)!.resolved_at).not.toBeNull();
    expect(r.store.work(r.id)).toMatchObject({ stage: 5, state: "owner" });
    expect(await r.rollout.availability("hello")).toMatchObject({ disable: "the plugin is already disabled", enable: null });
    await r.rollout.setEnabled("hello", true);
    expect(await plugin(r)).toMatchObject({ enabled: true, state: "running" });
    // A failure the owner resolved with «Disable» no longer holds «Roll out».
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
  });

  test("«Disable» after a failure is resolved as soon as disable succeeds, even if the list then fails", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.setJob("job_1", "failed");
    await r.rollout.advance(current(r).id);
    const failed = current(r).id;
    const disable = r.ports.plugins.disable.bind(r.ports.plugins);
    r.ports.plugins.disable = async (id: string) => {
      await disable(id);
      r.ports.plugins.failList = true;
    };
    await expect(r.rollout.setEnabled("hello", false)).rejects.toThrow("plugins.list failed");
    expect(r.store.attempt(failed)!.resolved_at).not.toBeNull();
  });

  test("«Disable» resolves an undecided failure also when the plugin is already off or disable's answer was lost", async () => {
    const r = await ready();
    await r.rollout.enter(r.id, await args(r));
    r.ports.plugins.setJob("job_1", "failed");
    await r.rollout.advance(current(r).id);
    const failed = current(r).id;
    const disable = r.ports.plugins.disable.bind(r.ports.plugins);
    r.ports.plugins.disable = async (id: string) => {
      await disable(id);
      throw new Error("timeout");
    };
    await r.rollout.setEnabled("hello", false); // the answer was lost, but the list says: disabled
    expect(await plugin(r)).toMatchObject({ enabled: false });
    expect(r.store.attempt(failed)!.resolved_at).not.toBeNull();

    const t = await ready();
    await t.rollout.enter(t.id, await args(t));
    t.ports.plugins.setJob("job_1", "failed");
    await t.rollout.advance(current(t).id);
    Object.assign(t.ports.plugins.items.get("hello")!, { enabled: false, state: "disabled" }); // an earlier «Disable» went through, its answer did not
    expect((await t.rollout.availability("hello")).disable).toBeNull();
    await t.rollout.setEnabled("hello", false);
    expect(t.store.attempt(current(t).id)!.resolved_at).not.toBeNull();
    expect(t.ports.count("disable")).toBe(0);
    expect((await t.rollout.availability("hello")).disable).toBe("the plugin is already disabled");
    // A disable refusal while the plugin is enabled is a refusal: no decision.
    const u = await ready();
    await u.rollout.enter(u.id, await args(u));
    u.ports.plugins.setJob("job_1", "failed");
    await u.rollout.advance(current(u).id);
    u.ports.failAt("disable");
    await expect(u.rollout.setEnabled("hello", false)).rejects.toThrow("failure before disable");
    expect(current(u).resolved_at).toBeNull();
  });

  test("«Enable» is offered by enabled === false, also when VesnALIA says missing", async () => {
    const r = await ready();
    r.ports.plugins.add({ id: "hello", enabled: false, state: "missing", name: null });
    await r.ports.fs.remove(r.dir);
    expect(await r.rollout.availability("hello")).toMatchObject({ enable: null, disable: "the plugin is already disabled" });
    await expect(r.rollout.setEnabled("hello", true)).rejects.toThrow("the plugin is enabled but not working: missing");
    expect(await plugin(r)).toMatchObject({ enabled: true, state: "missing", name: null });
  });

  test("the workshop itself is not removed from itself; an unknown plugin has nothing", async () => {
    const r = await ready();
    r.store.upsertSeen({ id: SELF_ID, name: "Plugin Workshop", dir: pluginDir(SELF_ID), source: null }, 1);
    r.ports.plugins.add({ id: SELF_ID });
    expect((await r.rollout.availability(SELF_ID)).disable).toBe("the Workshop cannot disable itself");
    await expect(r.rollout.setEnabled(SELF_ID, false)).rejects.toThrow("the Workshop cannot disable itself");
    expect((await r.rollout.availability("ghost")).rollback).toBe("the plugin is not on the board");
  });
});

describe("Rollout: crash points", () => {
  const ENTER_EFFECTS = ["updateRef", "resetKeep", "lock.request", "startInstall", "lock.release", "enable"] as const;
  const ROLLBACK_EFFECTS = ["resetKeep", "lock.request", "startInstall", "disable"] as const;
  const WHEN = ["before", "after"] as const;
  const cartesian = <A, B>(as: readonly A[], bs: readonly B[]): Array<[A, B]> => as.flatMap((a) => bs.map((b): [A, B] => [a, b]));
  const COUNTED = ["startInstall", "resetKeep", "resetHard", "lock.spawnedHolders"] as const;
  const counts = (r: Rig) => COUNTED.map((e) => r.ports.count(e));

  /**
   * The old instance runs until it crashes at the effect (VesnALIA manages to finish the install job); then a «restart» —
   * a new instance finishes the attempt by its record. `enable` gets into the rollout flow only if the install left the plugin disabled.
   */
  async function crash(r: Rig, start: () => Promise<unknown>, effect: string, when: "before" | "after"): Promise<void> {
    r.ports.failAt(effect, when);
    await start().catch(() => undefined);
    await finishJobs(r);
    if (effect === "enable") Object.assign(r.ports.plugins.items.get("hello")!, { enabled: false, state: "disabled" });
    await r.rollout.advanceAll();
    // The failure really happened — otherwise the recovery check is empty.
    expect(r.ports.tripped).toContainEqual({ effect, when });
    r.ports.failAt(null);
    const fresh = r.fresh();
    await fresh.advanceAll();
    await finishJobs(r);
    await fresh.advanceAll();
    await fresh.advanceAll();
  }

  test.each(cartesian(ENTER_EFFECTS, WHEN))("enter survives a crash at %s/%s", async (effect, when) => {
    const r = await ready();
    await crash(r, async () => r.rollout.enter(r.id, await args(r)), effect, when);
    const a = current(r);
    expect(r.ports.count("startInstall")).toBeLessThanOrEqual(1);
    expect(r.ports.count("resetKeep") + r.ports.count("resetHard")).toBeLessThanOrEqual(1);
    expect(r.ports.count("lock.spawnedHolders")).toBeLessThanOrEqual(1);
    if (effect === "startInstall") expect(a.status).toBe(when === "after" ? "done" : "unknown");
    else expect(a.status).toBe("done");
    // No dangling request and no lock_held: for unknown the reconcile released the lock — no job of this folder is running.
    expect(a.lock_held).toBe(0);
    expect(r.ports.lock.wantExists(a.id)).toBe(false);
    if (a.status === "done") {
      expect(r.store.work(r.id)!.stage).toBe(6);
      expect(r.store.plugin("hello")!.installed_sha).toBe("h1");
      expect(await plugin(r)).toMatchObject({ enabled: true, state: "running" });
    } else expect(r.store.work(r.id)!.stage).toBe(5);
  });

  test.each(cartesian(ROLLBACK_EFFECTS, WHEN))("rollback survives a crash at %s/%s", async (effect, when) => {
    const r = await ready({ enabled: false }); // the rollback disables the plugin after its install
    await enterDone(r);
    const base = counts(r);
    await crash(r, () => r.rollout.rollback("hello", "it broke"), effect, when);
    const a = current(r);
    expect(a.kind).toBe("rollback");
    const [startInstall, resetKeep, resetHard, holders] = counts(r).map((n, i) => n - base[i]!);
    expect(startInstall).toBeLessThanOrEqual(1);
    expect(resetKeep! + resetHard!).toBeLessThanOrEqual(1);
    expect(holders).toBeLessThanOrEqual(1);
    if (effect === "startInstall") expect(a.status).toBe(when === "after" ? "done" : "unknown");
    else expect(a.status).toBe("done");
    expect(a.lock_held).toBe(0);
    expect(r.ports.lock.wantExists(a.id)).toBe(false);
    if (a.status === "done") {
      expect((await r.ports.git.facts(r.dir)).head).toBe(r.before);
      expect(r.store.plugin("hello")!.installed_sha).toBe(r.before);
      expect(await plugin(r)).toMatchObject({ enabled: false });
      expect(r.store.work(r.id)!.stage).toBe(4);
    } else expect(r.store.work(r.id)!.stage).toBe(6);
  });
});

describe("Rollout: availability for the board", () => {
  test("availabilityFor answers like availability, with one list and one jobs request for every card", async () => {
    const r = await ready();
    r.store.upsertSeen({ id: "other", name: "Other", dir: pluginDir("other"), source: null }, 1);
    r.ports.plugins.add({ id: "other", enabled: false, state: "disabled" });
    const facts = await r.catalog.cachedFacts();
    const list = vi.spyOn(r.ports.plugins, "list");
    const jobs = vi.spyOn(r.ports.plugins, "jobs");
    const all = await r.rollout.availabilityFor(facts);
    expect([list.mock.calls.length, jobs.mock.calls.length]).toEqual([1, 1]);
    expect([...all.keys()].sort()).toEqual(["hello", "other"]);
    expect(all.get("hello")).toEqual(await r.rollout.availability("hello"));
    expect(all.get("other")).toEqual(await r.rollout.availability("other"));
    expect(all.get("other")).toMatchObject({ enable: null, disable: "the plugin is already disabled" });
  });
  test("a list that did not come closes every card the same way", async () => {
    const r = await ready();
    r.ports.plugins.failList = true;
    const all = await r.rollout.availabilityFor(await r.catalog.cachedFacts());
    expect(all.get("hello")).toMatchObject({ rollback: "the plugin list did not arrive — the action does not start", disable: "the plugin list did not arrive — the action does not start" });
  });
  test("no cards — no requests", async () => {
    const r = await ready();
    const list = vi.spyOn(r.ports.plugins, "list");
    expect((await r.rollout.availabilityFor([])).size).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("Rollout: the working copy's dependencies", () => {
  test("installs the working copy's dependencies under the held lock before the install, then installs", async () => {
    const r = await ready();
    r.ports.depsStates.set(r.dir, { kind: "need" });
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    expect(r.ports.depsStarts).toEqual([r.dir]);
    expect(current(r)).toMatchObject({ step: "locked", status: "running", lock_held: 1 });
    expect(r.ports.count("startInstall")).toBe(0);
    // Still installing: no second install, the attempt waits on «lock taken».
    await r.rollout.advanceAll();
    expect(r.ports.depsStarts).toHaveLength(1);
    expect(current(r).step).toBe("locked");
    r.ports.depsStates.set(r.dir, { kind: "ok" });
    await r.rollout.advanceAll();
    expect(r.ports.count("startInstall")).toBe(1);
    const events = r.store.events(r.id).map((e) => e.text);
    expect(events).toContain("rollout: installing the working copy's dependencies (npm ci)");
  });

  test("a failed install of this attempt fails it with npm's words; a failure left from before is installed again", async () => {
    const r = await ready();
    r.ports.depsStates.set(r.dir, { kind: "failed", text: "npm exited with code 1: old", startedAt: 0 });
    expect((await r.rollout.enter(r.id, await args(r))).ok).toBe(true);
    expect(r.ports.depsStarts).toEqual([r.dir]);
    r.ports.depsStates.set(r.dir, { kind: "failed", text: "npm exited with code 1: E404 yaml", startedAt: r.ports.now() });
    await r.rollout.advanceAll();
    expect(current(r)).toMatchObject({ status: "failed", step: "locked" });
    expect(current(r).error).toContain("the working copy's dependencies failed to install — npm exited with code 1: E404 yaml");
    expect(r.ports.count("startInstall")).toBe(0);
  });
});
