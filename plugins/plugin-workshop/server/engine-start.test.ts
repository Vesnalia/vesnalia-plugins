import { describe, expect, it } from "vitest";
import { kickoff } from "./regulations";
import { stageOf } from "./stages";
import { madeWork, setup } from "./test-utils";

/** A created work (as Creation leaves it) and the first reconcile. */
async function created(s = setup()) {
  const id = await madeWork(s);
  await s.engine.reconcile(id);
  return { ...s, id };
}

describe("Engine: first stage and restart", () => {
  it("does not touch a work whose creation is not finished: no board card, no reconcile, no view", async () => {
    const { store, ports, engine } = setup();
    store.addWork({ id: "w_new", plugin_id: "hello", kind: "new", tasks_project_id: "tp1", host_id: "host_1", title: "Hello", request: "R", created_at: 1 });
    await engine.reconcileAll();
    await engine.reconcile("w_new");
    expect(engine.board()).toEqual([]);
    await expect(engine.view("w_new")).rejects.toThrow("the work is still being created");
    await expect(engine.file("w_new", "x")).rejects.toThrow("the work is still being created");
    await expect(engine.cancel("w_new", "x")).rejects.toThrow("the work is still being created");
    expect(engine.identityOf("thr_x", { workId: "w_new" })).toBeNull();
    expect(store.work("w_new")).toMatchObject({ stage: 1, state: "new", created: 0 });
    expect(ports.threads.size).toBe(0);
  });

  it("starts the Context in a new worktree on the first reconcile, records the environment and clears the entry", async () => {
    const { store, ports, engine, id } = await created();
    const w = store.work(id)!;
    expect(w).toMatchObject({ stage: 1, entry: null, state: "agent" });
    const run = store.stageThread(id, 1)!;
    const th = ports.threads.get(run.thread_id)!;
    expect(th.environment).toEqual({ kind: "new-worktree", hostId: "host_1" });
    expect(th).toMatchObject({ projectId: "p1", providerId: "claude-code", model: "claude-opus-5-5", hidden: false, title: `${w.task_key} · ${stageOf(1).title}` });
    expect(th.metadata).toMatchObject({ workId: id, stage: 1, role: "stage", who: "claude" });
    expect(th.prompt).toBe(kickoff(w, stageOf(1), 1));
    expect(th.prompt).toContain("`brainstorming`");
    expect(w.environment_id).toBe(th.env);
    expect(ports.files.get(`${th.env}:.superpowers/.gitignore`)).toBe("*\n");
    expect(run.attached).toBe(1);
    const task = ports.taskRows.get(w.task_id!)!;
    expect(task.status).toBe("in_progress");
    expect(task.threads).toEqual([run.thread_id]);
    await engine.reconcile(id);
    expect(ports.threads.size).toBe(1);
  });

  it("does not spawn twice when the spawn call failed after creating the thread", async () => {
    const s = setup();
    s.ports.spawnThenThrow = true;
    const { store, ports, id } = await created(s);
    expect(ports.threads.size).toBe(1);
    expect(store.stageThread(id, 1)).not.toBeNull();
    expect(store.work(id)!.entry).toBeNull();
  });

  it("keeps the entry with its error when the spawn really failed", async () => {
    const s = setup();
    s.ports.spawnFails = true;
    const { store, id } = await created(s);
    expect(store.work(id)).toMatchObject({ stage: 1, state: "error" });
    expect(store.entry(store.work(id)!)?.error).toContain("spawn failed");
    expect(store.work(id)!.state_reason).toContain("could not start the stage: spawn failed");
    expect(store.stageThread(id, 1)).toBeNull();
  });

  it("restarts a failed stage thread with a replacement, never while an agent works", async () => {
    const { store, ports, engine, id } = await created();
    const first = store.stageThread(id, 1)!;
    await expect(engine.restartStage(id, 1)).rejects.toThrow("is still working");
    ports.threads.get(first.thread_id)!.status = "error";
    await engine.restartStage(id, 1);
    const second = store.stageThread(id, 1)!;
    expect(second.round).toBe(2);
    expect(ports.threads.get(second.thread_id)!.environment).toEqual({ kind: "reuse", environmentId: store.work(id)!.environment_id });
    expect(ports.threads.get(second.thread_id)!.prompt).toContain(first.thread_id);
  });

  it("refuses to restart while a spawn is unconfirmed, and starts afresh after the give-up window", async () => {
    const s = setup();
    s.ports.spawnThenThrow = true;
    s.ports.findMisses = 1;
    const { store, ports, engine, id } = await created(s);
    expect(store.stageThread(id, 1)).toBeNull();
    await expect(engine.restartStage(id, 1)).rejects.toThrow("not confirmed yet");
    expect(ports.threads.size).toBe(1);
  });

  it("does not spawn a second stage thread over an unconfirmed spawn when the environment is already set", async () => {
    const { store, ports, engine, id } = await created();
    const first = store.stageThread(id, 1)!;
    ports.threads.get(first.thread_id)!.status = "error";
    const input = { iteration: 1, headSha: null, dirty: false, contextSha: null, techSha: null, tzSha: null };
    store.beginOp(`${id}:enter:other:spawn`, id, "spawn", JSON.stringify({ stage: 1, role: "stage", who: "claude", round: 2, input }), ports.now());
    await expect(engine.restartStage(id, 1)).rejects.toThrow("not confirmed yet");
    expect(ports.threads.size).toBe(1);
  });

  it("restarts after a really failed spawn once the give-up window passed", async () => {
    const s = setup();
    s.ports.spawnFails = true;
    const { store, ports, engine, id } = await created(s);
    ports.spawnFails = false;
    await expect(engine.restartStage(id, 1)).rejects.toThrow("not confirmed yet");
    ports.t += 6 * 60_000;
    await engine.restartStage(id, 1);
    expect(store.stageThread(id, 1)).not.toBeNull();
    expect(ports.threads.size).toBe(1);
  });

  it("keeps the owner's packet when restarting a stage whose entry failed", async () => {
    const { store, ports, engine, id } = await created();
    const first = store.stageThread(id, 1)!;
    ports.threads.get(first.thread_id)!.status = "error";
    store.setEntry(id, { key: "e1", stage: 1, from: 5, packet: "Owner's reason: wrong format", error: "spawn failed" }, ports.now());
    await engine.restartStage(id, 1);
    expect(ports.threads.get(store.stageThread(id, 1)!.thread_id)!.prompt).toContain("wrong format");
    expect(store.work(id)!.entry).toBeNull();
  });

  it("does not put a second writer next to a healthy stage thread, and the view says when a restart is needed", async () => {
    const { store, ports, engine, id } = await created();
    const first = store.stageThread(id, 1)!;
    ports.idle(first.thread_id);
    await expect(engine.restartStage(id, 1)).rejects.toThrow("the stage thread is alive — no restart needed; write to the agent in the chat");
    expect(ports.threads.size).toBe(1);
    expect((await engine.view(id)).work.canRestart).toBe(false);
    // The stage entry failed (the packet did not arrive) — a restart is needed even with a live thread.
    store.setEntry(id, { key: "e1", stage: 1, from: 5, packet: "Owner's reason: x", error: "send failed" }, ports.now());
    expect((await engine.view(id)).work.canRestart).toBe(true);
    store.setEntry(id, null, ports.now());
    ports.threads.get(first.thread_id)!.status = "error";
    expect((await engine.view(id)).work.canRestart).toBe(true);
    await engine.restartStage(id, 1);
    expect(store.stageThread(id, 1)!.round).toBe(2);
    ports.idle(store.stageThread(id, 1)!.thread_id);
    await engine.cancel(id, "x");
    expect((await engine.view(id)).work.canRestart).toBe(false);
  });
});
