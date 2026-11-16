// What is kept or sent on is redacted (the journal, errors, notes, reports, task comments), and key files are not shown or handed out.
import { describe, expect, test } from "vitest";
import { Catalog } from "./catalog";
import { Pilot } from "./pilot";
import { Rollout } from "./rollout";
import { idleStage, memoryStore, moveTo, started } from "./test-utils";
import { GITHUB_TOKEN, JWT, OPENAI_KEY, PEM_KEY, SLACK_TOKEN } from "./test-tokens";

const TOKENS = [OPENAI_KEY, GITHUB_TOKEN, JWT, SLACK_TOKEN, PEM_KEY];
const clean = (x: unknown) => {
  const text = JSON.stringify(x);
  for (const t of TOKENS) expect(text).not.toContain(t);
};

describe("the store keeps diagnostic text redacted", () => {
  test("journal, errors, reasons, notes, the autopilot's report and the scan verdict", () => {
    const s = memoryStore();
    s.addWork({ id: "w1", plugin_id: "hello", kind: "rework", tasks_project_id: "tp1", host_id: "h1", title: "T", request: "R", created_at: 1 });
    s.upsertSeen({ id: "hello", name: "hello", dir: "/p/bb-plugin-hello", source: null }, 1);
    s.log("w1", "warn", `npm: auth ${OPENAI_KEY} rejected`, 1);
    s.beginOp("op", "w1", "spawn", null, 1);
    s.failOp("op", `spawn failed: ${GITHUB_TOKEN}`, 2);
    s.setState("w1", "error", `reconcile error: ${JWT}`, false, 3);
    s.addHandover({ work_id: "w1", stage: 1, action: "back", to_stage: 1, version: null, note: `use ${SLACK_TOKEN}`, forced: false, problems: [`w ${OPENAI_KEY}`], at: 4 });
    s.setEntry("w1", { key: "k", stage: 1, from: 0, packet: "the packet stays as written", error: `boom ${PEM_KEY}` }, 5);
    s.setGithub("hello", { remote: null, ahead: null, behind: null, error: `git push: ${GITHUB_TOKEN}` }, 6);
    s.addAttempt({ id: "a1", plugin_id: "hello", work_id: "w1", kind: "enter", before_sha: "a", target_sha: "b", migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1, started_at: 7 });
    s.stepAttempt("a1", "recorded", "moved", { error: `step ${OPENAI_KEY}` }, 8);
    s.closeAttempt("a1", "failed", `npm exited: ${SLACK_TOKEN}`, 9);
    s.startPilot("w1", "notes", "op_key", 10);
    s.patchPilot("w1", { report: `done; used ${JWT}`, reason: `stopped: ${OPENAI_KEY}`, handled_note: `waiting for ${GITHUB_TOKEN}` }, 11);
    s.setScan("w1", JSON.stringify({ sha: "h1", kind: "scan", text: `git: ${OPENAI_KEY}` }));
    const everything = [s.events("w1"), s.op("op"), s.work("w1"), s.handovers("w1"), s.plugin("hello"), s.attempt("a1"), s.pilot("w1")];
    clean(everything);
    expect(s.events("w1")[0]!.text).toBe("npm: auth [redacted:sk-] rejected");
    expect(s.work("w1")!.state_reason).toBe("reconcile error: [redacted:jwt]");
    expect(s.entry(s.work("w1")!)).toMatchObject({ packet: "the packet stays as written", error: "boom [redacted:private_key]" });
    expect(s.pilot("w1")!.report).toBe("done; used [redacted:jwt]");
    // The same text a second time is still recognised as the same line (the journal does not grow every minute).
    s.log("w1", "warn", `npm: auth ${OPENAI_KEY} rejected`, 12);
    expect(s.events("w1").filter((e) => e.text.startsWith("npm: auth"))).toHaveLength(1);
  });
});

describe("tracker comments and the journal from the engine and the autopilot", () => {
  test("a send-back reason with a token: the task comment, the journal and the handover keep it redacted; the agent's packet keeps it", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 2);
    await s.engine.sendBack(s.id, { expectedStage: 2, toStage: 1, reason: `the key ${OPENAI_KEY} must not be hard-coded` });
    const comments = [...s.ports.taskRows.values()].flatMap((t) => t.comments);
    expect(comments.some((c) => c.includes("the key [redacted:sk-] must not be hard-coded"))).toBe(true);
    clean([comments, s.store.events(s.id), s.store.handovers(s.id)]);
  });

  test("the autopilot's final report and stop reason go to the task redacted", async () => {
    const s = await started();
    const catalog = new Catalog(s.store, s.ports);
    const pilot = new Pilot(s.store, s.ports, s.engine, new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true }));
    await pilot.start(s.id, `no paid services; token ${SLACK_TOKEN}`);
    const thread = s.store.pilot(s.id)!.thread_id!;
    expect(await pilot.actTool(thread, { action: "report", text: `report: configured ${GITHUB_TOKEN}` })).toBe("report recorded");
    await pilot.actTool(thread, { action: "stop", text: `needs ${JWT}` });
    const comments = [...s.ports.taskRows.values()].flatMap((t) => t.comments);
    expect(comments.some((c) => c.includes("report: configured [redacted:ghp_]"))).toBe(true);
    expect(comments.some((c) => c.includes("[redacted:xoxb-]"))).toBe(true);
    clean([comments, s.store.pilot(s.id)!.report, s.store.pilot(s.id)!.reason, s.store.events(s.id)]);
  });
});

describe("key files are not shown, copied or handed out", () => {
  test("the file endpoint and the autopilot file tool refuse key-file names and links, even inside the allowed folders", async () => {
    const s = await started();
    const work = `.superpowers/workshop/${s.key}`;
    s.ports.files.set(`${s.env}:${work}/keys.env`, "PASSWORD=hunter2");
    s.ports.files.set(`${s.env}:${work}/secrets/token.txt`, "x");
    s.ports.files.set(`${s.env}:${work}/notes.md`, "fine");
    s.ports.files.set(`${s.env}:${work}/link.md`, "(link)");
    s.ports.symlinks.add(`${s.env}:${work}/link.md`);
    for (const p of [`${work}/keys.env`, `${work}/secrets/token.txt`, `docs/workshop/${s.key}/mockup/id_rsa`]) await expect(s.engine.file(s.id, p)).rejects.toThrow("a key file by name");
    await expect(s.engine.file(s.id, `${work}/link.md`)).rejects.toThrow("a symbolic link");
    expect((await s.engine.file(s.id, `${work}/notes.md`)).text).toBe("fine");
    const catalog = new Catalog(s.store, s.ports);
    const pilot = new Pilot(s.store, s.ports, s.engine, new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true }));
    await pilot.start(s.id, "");
    const thread = s.store.pilot(s.id)!.thread_id!;
    await expect(pilot.fileTool(thread, `${work}/keys.env`)).rejects.toThrow("a key file by name");
    expect(await pilot.fileTool(thread, `${work}/notes.md`)).toEqual({ text: "fine" });
  });

  test("a work snapshot does not copy a document with a finding: the journal names it with labels, not the value", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# context");
    s.ports.files.set(`${s.env}:${s.docs.tech}`, `checked\nuse ${OPENAI_KEY}\nVERDICT: OK`);
    s.ports.files.set(`${s.env}:.superpowers/workshop/${s.key}/keys.env`, "PASSWORD=hunter2");
    const r = await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await s.engine.version(s.store.work(s.id)!), note: "", force: false });
    expect(r.ok).toBe(true);
    expect(s.ports.savedFiles.get(`${s.id}:${s.docs.context}`)).toBe("# context");
    expect(s.ports.savedFiles.has(`${s.id}:${s.docs.tech}`)).toBe(false);
    const line = s.store.events(s.id).find((e) => e.text.startsWith("not copied into the work files snapshot"))!.text;
    expect(line).toContain(`${s.docs.tech} (sk-)`);
    expect(line).toContain(`.superpowers/workshop/${s.key}/keys.env (key file by name)`);
    clean([s.store.events(s.id), [...s.ports.savedFiles.values()]]);
  });
});
