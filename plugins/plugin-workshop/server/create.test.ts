import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Catalog } from "./catalog";
import { Creation, SCAFFOLD_FILES, SCAFFOLD_RETRY_MS, taskMarker, tmpDirOf, validateNewPlugin, type CreationEngine } from "./create";
import { Engine } from "./engine";
import { FakePorts } from "./fake-ports";
import { SCAFFOLD_FILES as PORT_SCAFFOLD_FILES } from "./ports";
import { PLUGINS_ROOT, pluginDir, SELF_ID, slugify } from "./stages";
import type { Entry, Store } from "./store";
import { memoryStore } from "./test-utils";
import { OPENAI_KEY } from "./test-tokens";

const input = { name: "Greeter", id: "hello", request: "the VesnALIA hello command" };
const EFFECTS = ["scaffold", "rename", "initCommit", "projects.create", "tasks.create"] as const;
const whens = ["before", "after"] as const;

let store: Store;
let ports: FakePorts;
let catalog: Catalog;
let engine: { firstStageEntry: Mock<CreationEngine["firstStageEntry"]>; reconcile: Mock<CreationEngine["reconcile"]> };
let creation: Creation;

const settings = () => ({ tasksProject: "tp1" });
const makeCreation = () => new Creation(store, ports, catalog, settings, engine);
const effects = () => ports.calls.map((c) => c.effect);
/** After a failure the scaffold is retried no sooner than five minutes later: that much time passes before the next pass. */
const later = () => void (ports.t += SCAFFOLD_RETRY_MS);
/** A creation that crashed at an effect: the work id is taken from the error. If the scaffold failed, time moves on to its retry. */
async function crashAt(effect: string, when: "before" | "after", i = input): Promise<string> {
  ports.failAt(effect, when);
  const workId = await creation.newPlugin(i).then(
    () => {
      throw new Error(`expected a refusal at ${effect}/${when}`);
    },
    (e) => (e as { workId: string }).workId,
  );
  ports.failAt(null);
  if (effect === "scaffold") later();
  return workId;
}

beforeEach(() => {
  store = memoryStore();
  ports = new FakePorts();
  catalog = new Catalog(store, ports);
  engine = {
    firstStageEntry: vi.fn<CreationEngine["firstStageEntry"]>((w, _now): Entry => ({ key: `${w.id}:enter:s1:i1`, stage: 1, from: 0, packet: null, error: null })),
    reconcile: vi.fn<CreationEngine["reconcile"]>(async () => {}),
  };
  creation = makeCreation();
});

describe("validateNewPlugin", () => {
  const BAD_ID = "id — lowercase Latin letters, digits and hyphens, up to 40 characters";
  const taken = new Set(["mail", SELF_ID, "draft"]);
  it("rejects taken ids and bad input", () => {
    expect(validateNewPlugin({ name: "Mail", id: "mail", request: "x" }, taken)).toContain("id mail is already taken");
    expect(validateNewPlugin({ name: "", id: "", request: "x" }, taken)).toEqual(expect.arrayContaining(["a name is required", "an id is required"]));
    expect(validateNewPlugin({ name: "x", id: "Hello World", request: "x" }, taken)).toContain(BAD_ID);
  });
  it("accepts a good form", () => {
    expect(validateNewPlugin({ name: "Greeter", id: "hello", request: "a command" }, taken)).toEqual([]);
    expect(validateNewPlugin({ name: "x", id: "my-plugin-2", request: "x" }, taken)).toEqual([]);
    expect(validateNewPlugin({ name: "x", id: "2fa", request: "x" }, taken)).toEqual([]);
    expect(validateNewPlugin({ name: "x", id: "a".repeat(40), request: "x" }, taken)).toEqual([]);
  });
  it("id: only lower-case latin, digits and single dashes, up to 40", () => {
    const bad = ["Hello", "hello world", "héllo", "under_score", "-hello", "hello-", "he--llo", "a".repeat(41), "he.llo", "he/llo", "../x"];
    for (const id of bad) expect(validateNewPlugin({ name: "x", id, request: "x" }, taken), id).toContain(BAD_ID);
  });
  const RESERVED = [
    "browser", "diagnostics", "environment", "file", "guide", "help", "machine", "marketplace", "plugin", "project", "prompt-history",
    "provider", "server", "settings", "skill", "status", "terminal", "theme", "thread", "updates", "voice",
  ];
  it("ids that VesnALIA keeps for its own commands are refused with a word about it", () => {
    for (const id of RESERVED) expect(validateNewPlugin({ name: "x", id, request: "x" }, taken), id).toEqual([`id ${id} is taken by a VesnALIA command — choose another one`]);
  });
  it("a Cyrillic name that transliterates to `status` gives a VesnALIA command", () => {
    const name = "Статус"; // Cyrillic on purpose: slugify transliterates it
    expect(slugify(name)).toBe("status");
    expect(validateNewPlugin({ name, id: slugify(name), request: "x" }, taken)).toContain("id status is taken by a VesnALIA command — choose another one");
  });
  it("an id similar to a reserved one is fine", () => {
    for (const id of ["status-board", "my-status", "files", "servers", "plugins"]) expect(validateNewPlugin({ name: "x", id, request: "x" }, taken), id).toEqual([]);
  });
  it("the prefix alia-plugin- is refused: the folder would be alia-plugin-alia-plugin-x", () => {
    expect(validateNewPlugin({ name: "x", id: "alia-plugin-hello", request: "x" }, taken)).toEqual(["id must not start with alia-plugin-"]);
    expect(validateNewPlugin({ name: "x", id: "alia-plugins", request: "x" }, taken)).toEqual([]);
  });
  it("an id of a plugin that is gone but left a history says whose it was", () => {
    const retired = new Map([["old", "Old one"]]);
    expect(validateNewPlugin({ name: "x", id: "old", request: "x" }, taken, retired)).toEqual(["id old belonged to plugin «Old one» (gone) — choose another one"]);
    expect(validateNewPlugin({ name: "x", id: "other", request: "x" }, taken, retired)).toEqual([]);
    expect(validateNewPlugin({ name: "x", id: "mail", request: "x" }, new Set(["mail"]), new Map([["mail", "Mail"]]))).toEqual(["id mail is already taken"]);
  });
  it("an empty id is «an id is required» only, a taken id is not reported twice", () => {
    expect(validateNewPlugin({ name: "x", id: "  ", request: "x" }, taken)).toEqual(["an id is required"]);
    expect(validateNewPlugin({ name: "x", id: SELF_ID, request: "x" }, taken)).toEqual([`id ${SELF_ID} is already taken`]);
  });
  it("name and request: not blank, not too long", () => {
    expect(validateNewPlugin({ name: "   ", id: "hello", request: "x" }, taken)).toContain("a name is required");
    // Cyrillic on purpose: the limits count characters, not bytes.
    expect(validateNewPlugin({ name: "я".repeat(81), id: "hello", request: "x" }, taken)).toContain("name — up to 80 characters");
    expect(validateNewPlugin({ name: "я".repeat(80), id: "hello", request: "x" }, taken)).toEqual([]);
    expect(validateNewPlugin({ name: "x", id: "hello", request: " \n " }, taken)).toContain("a description is required: what the plugin should do");
    expect(validateNewPlugin({ name: "x", id: "hello", request: "я".repeat(20_001) }, taken)).toContain("description — up to 20000 characters");
  });
  it("reports every problem at once", () => {
    expect(validateNewPlugin({ name: "", id: "Bad Id", request: "" }, taken)).toHaveLength(3);
  });
});

describe("the helpers", () => {
  it("transliterates", () => expect(slugify("Учёт расходов")).toBe("uchet-rashodov"));
  it("marks a task with the work id", () => expect(taskMarker("w_1")).toBe("[workshop:w_1]"));
  it("the scaffold file list is the one of the ports", () => expect(SCAFFOLD_FILES).toBe(PORT_SCAFFOLD_FILES));
  it("the scaffold folder lives under the plugins root, one per work", () => expect(tmpDirOf("w_1")).toBe(`${PLUGINS_ROOT}/.workshop-new/w_1`));
});

describe("Creation.newPlugin", () => {
  it("new plugin happy path order", async () => {
    const workId = await creation.newPlugin(input);
    expect(ports.calls.map((c) => c.effect)).toEqual(["scaffold", "rename", "initCommit", "projects.create", "tasks.create"]);
    expect(store.entry(store.work(workId)!)?.stage).toBe(1);
  });
  it("records the plugin, the project, the task and the first stage", async () => {
    const workId = await creation.newPlugin(input);
    const w = store.work(workId)!;
    expect(w).toMatchObject({ plugin_id: "hello", kind: "new", created: 1, stage: 1, tasks_project_id: "tp1", host_id: "host_1", request: "the VesnALIA hello command", outcome: null });
    expect(store.plugin("hello")).toMatchObject({ name: "Greeter", dir: pluginDir("hello"), source: null, project_id: w.project_id });
    expect(ports.projects.rows.get(w.project_id!)).toMatchObject({ name: "Plugin · Greeter", dir: pluginDir("hello"), hostId: "host_1" });
    const task = ports.taskRows.get(w.task_id!)!;
    expect(task.key).toBe(w.task_key);
    expect(task.projectId).toBe("tp1");
    expect(task.description).toContain("the VesnALIA hello command");
    expect(task.description).toContain(taskMarker(workId));
    expect(store.entry(w)).toEqual({ key: `${workId}:enter:s1:i1`, stage: 1, from: 0, packet: null, error: null });
    expect(store.pendingOps(workId)).toEqual([]);
    expect(store.creatingWorks()).toEqual([]);
  });
  it("a token pasted into the request reaches the tracker task redacted; the work keeps the request for its agents", async () => {
    const workId = await creation.newPlugin({ ...input, request: `the VesnALIA hello command, key ${OPENAI_KEY}` });
    const w = store.work(workId)!;
    const task = ports.taskRows.get(w.task_id!)!;
    expect(task.description).toContain("the VesnALIA hello command, key [redacted:sk-]");
    expect(task.description).not.toContain(OPENAI_KEY);
    expect(task.description).toContain(taskMarker(workId));
  });
  it("makes the first commit with a message and a git repository in the plugin folder", async () => {
    await creation.newPlugin(input);
    expect(ports.calls.find((c) => c.effect === "initCommit")!.args).toEqual([pluginDir("hello"), "chore: scaffold plugin hello (VesnALIA plugin new)"]);
    expect((await ports.git.facts(pluginDir("hello"))).head).not.toBeNull();
  });
  it("the nested scaffold is renamed and tmpDir removed", async () => {
    const workId = await creation.newPlugin(input);
    const tmp = tmpDirOf(workId);
    expect(ports.calls.find((c) => c.effect === "rename")!.args).toEqual([`${tmp}/alia-plugin-hello`, pluginDir("hello")]);
    expect(await ports.fs.exists(tmp)).toBe(false);
    expect(await ports.fs.exists(pluginDir("hello"))).toBe(true);
    expect((await ports.fs.list(pluginDir("hello"))).sort()).toEqual([...SCAFFOLD_FILES].sort());
  });
  it("a crash after rename and before tmpDir is removed: the next pass removes it, rename is not repeated", async () => {
    const workId = await crashAt("rename", "after");
    expect(await ports.fs.exists(pluginDir("hello"))).toBe(true);
    expect(await ports.fs.exists(tmpDirOf(workId))).toBe(true);
    await makeCreation().advanceAll();
    expect(await ports.fs.exists(tmpDirOf(workId))).toBe(false);
    expect(ports.count("rename")).toBe(1);
    expect(store.work(workId)!.created).toBe(1);
  });
  it("scaffold files right in tmpDir, without the nested folder, are not a scaffold: it is made again", async () => {
    const workId = await crashAt("scaffold", "before");
    const tmp = tmpDirOf(workId);
    for (const f of SCAFFOLD_FILES) ports.fs.put(`${tmp}/${f}`);
    await makeCreation().advanceAll();
    expect(ports.count("scaffold")).toBe(1);
    expect(ports.count("rename")).toBe(1);
    expect(await ports.fs.exists(`${tmp}/package.json`)).toBe(false);
    expect(store.work(workId)!.created).toBe(1);
  });
  it("partial scaffold is redone, never adopted", async () => {
    const workId = await crashAt("scaffold", "after");
    const tmp = tmpDirOf(workId);
    await ports.fs.remove(`${tmp}/alia-plugin-hello/node_modules`);
    await ports.fs.remove(`${tmp}/alia-plugin-hello/package-lock.json`);
    // A leftover of the interrupted scaffold must not reach the plugin: the temporary folder is removed as a whole, not patched up.
    ports.fs.put(`${tmp}/alia-plugin-hello/leftover.tmp`);
    await makeCreation().advanceAll();
    expect(await ports.fs.exists(`${pluginDir("hello")}/leftover.tmp`)).toBe(false);
    expect(ports.count("scaffold")).toBe(2);
    expect(ports.count("rename")).toBe(1);
    expect((await ports.fs.list(pluginDir("hello"))).sort()).toEqual([...SCAFFOLD_FILES].sort());
    expect(await ports.fs.exists(tmp)).toBe(false);
  });

  describe("rejects before anything is made", () => {
    /** For tests where the gone plugin's row is made by the test itself: no works, no actions, the row is not revived. */
    const nothingMade2 = () => {
      expect(store.works().filter((w) => w.kind === "new" && w.outcome === null)).toEqual([]);
      expect(ports.calls).toEqual([]);
      expect(store.plugin("old")!.gone_reason).not.toBeNull();
    };
    const nothingMade = () => {
      expect(store.works()).toEqual([]);
      expect(store.plugins()).toEqual([]);
      expect(ports.calls).toEqual([]);
    };
    it("a taken id: installed, a folder of the plugins root, the board, or the Workshop itself", async () => {
      ports.plugins.add({ id: "mail" });
      ports.fs.put(pluginDir("draft"));
      store.upsertSeen({ id: "known", name: "Known", dir: null, source: null }, 1);
      for (const id of ["mail", "draft", "known", SELF_ID]) {
        await expect(creation.newPlugin({ ...input, id }), id).rejects.toThrow(`id ${id} is already taken`);
      }
      expect(store.works()).toEqual([]);
      expect(ports.calls).toEqual([]);
    });
    describe("the id of a plugin that is gone", () => {
      const gone = (id: string, name = "Old one") => {
        store.upsertSeen({ id, name, dir: null, source: null }, 1);
        store.markGone(id, "plugin not installed, no folder", 2);
      };
      const SHA = "a".repeat(40);
      const refused = (id: string, name = "Old one") => expect(creation.newPlugin({ ...input, id })).rejects.toThrow(`id ${id} belonged to plugin «${name}» (gone) — choose another one`);

      it("that rolled out a commit keeps its id: a new plugin would inherit the commit and «Roll back» would send it there", async () => {
        gone("old");
        store.setInstalled("old", SHA);
        await refused("old");
        nothingMade2();
      });
      it("that had an attempt keeps its id: its running attempt would close the new plugin's entry", async () => {
        gone("old");
        store.addAttempt({ id: "a1", plugin_id: "old", work_id: null, kind: "enter", before_sha: null, target_sha: SHA, migrations: 0, was_installed: 0, was_enabled: 0, want_enabled: 1, started_at: 1 });
        await refused("old");
        nothingMade2();
      });
      it("that had an accepted work keeps its id", async () => {
        gone("old");
        store.addWork({ id: "w_old", plugin_id: "old", kind: "rework", tasks_project_id: "tp1", host_id: "host_1", title: "T", request: "R", created_at: 1 });
        store.markCreated("w_old", 1);
        store.finish("w_old", "done", 2);
        await refused("old");
        nothingMade2();
      });
      it("that had a canceled work of an existing plugin keeps its id", async () => {
        gone("old");
        store.addWork({ id: "w_old", plugin_id: "old", kind: "rework", tasks_project_id: "tp1", host_id: "host_1", title: "T", request: "R", created_at: 1 });
        store.markCreated("w_old", 1);
        store.finish("w_old", "canceled", 2);
        await refused("old");
        nothingMade2();
      });
      it("whose only past is a canceled creation has no history: its id is free", async () => {
        gone("old");
        store.addWork({ id: "w_old", plugin_id: "old", kind: "new", tasks_project_id: "tp1", host_id: "host_1", title: "T", request: "R", created_at: 1 });
        store.finish("w_old", "canceled", 2);
        const workId = await creation.newPlugin({ ...input, id: "old" });
        expect(store.plugin("old")).toMatchObject({ gone_reason: null, name: "Greeter", installed_sha: null, current_attempt: null });
        expect(store.work(workId)).toMatchObject({ plugin_id: "old", created: 1 });
      });
      it("with no history at all is free", async () => {
        gone("old");
        await expect(creation.newPlugin({ ...input, id: "old" })).resolves.toEqual(expect.any(String));
      });
      it("is refused with the name of the plugin it had, not a name of the new one", async () => {
        gone("old", "Old mail");
        store.setInstalled("old", SHA);
        await refused("old", "Old mail");
      });
      it("a folder of a gone plugin that is back is taken as before", async () => {
        gone("old");
        ports.fs.put(pluginDir("old"));
        await expect(creation.newPlugin({ ...input, id: "old" })).rejects.toThrow("id old is already taken");
      });
    });
    it("a reserved id or the prefix is refused, nothing is made", async () => {
      await expect(creation.newPlugin({ ...input, id: "status" })).rejects.toThrow("id status is taken by a VesnALIA command — choose another one");
      await expect(creation.newPlugin({ ...input, id: "alia-plugin-x" })).rejects.toThrow("id must not start with alia-plugin-");
      nothingMade();
    });
    it("a folder that nobody listed but that exists is taken too", async () => {
      ports.plugins.failFolders = true;
      ports.fs.put(pluginDir("hello"));
      await expect(creation.newPlugin(input)).rejects.toThrow("id hello is already taken");
      nothingMade();
    });
    it("bad input, with all the reasons in one message", async () => {
      await expect(creation.newPlugin({ name: "", id: "Hello World", request: "" })).rejects.toThrow(/a name is required.*id — lowercase Latin.*a description is required/);
      nothingMade();
    });
    it("the error of the refusal carries no work id: there is no work", async () => {
      const e = await creation.newPlugin({ ...input, id: SELF_ID }).catch((x) => x);
      expect((e as { workId?: string }).workId).toBeUndefined();
    });
    it("the plugin list cannot be read: nothing is made", async () => {
      ports.plugins.failList = true;
      await expect(creation.newPlugin(input)).rejects.toThrow("plugins.list failed");
      nothingMade();
    });
    it("the machine of VesnALIA cannot be told: nothing is made", async () => {
      ports.serverHostId = async () => {
        throw new Error("hosts unavailable");
      };
      await expect(creation.newPlugin(input)).rejects.toThrow("hosts unavailable");
      nothingMade();
    });
  });

  it("trims the form before it is checked and stored", async () => {
    const workId = await creation.newPlugin({ name: "  Greeter ", id: " hello ", request: "  a command  \n" });
    expect(store.work(workId)).toMatchObject({ plugin_id: "hello", request: "a command" });
    expect(store.plugin("hello")!.name).toBe("Greeter");
  });
  it("the plugin row exists before any step, so a later attempt can be recorded", async () => {
    await crashAt("scaffold", "before");
    expect(store.plugin("hello")).toMatchObject({ name: "Greeter", dir: pluginDir("hello"), source: null });
    expect(() =>
      store.addAttempt({ id: "a1", plugin_id: "hello", work_id: null, kind: "enter", before_sha: null, target_sha: null, migrations: 0, was_installed: 0, was_enabled: 0, want_enabled: 1, started_at: 1 }),
    ).not.toThrow();
  });
  it("a sync in the middle of the creation does not replace the owner's name with the scaffold's", async () => {
    await crashAt("initCommit", "before");
    ports.plugins.folderNames.set("hello", "hello");
    await catalog.sync();
    expect(store.plugin("hello")!.name).toBe("Greeter");
  });
  it("asks the engine to spawn the first thread and tells the panel", async () => {
    const workId = await creation.newPlugin(input);
    expect(engine.reconcile).toHaveBeenCalledTimes(1);
    expect(engine.reconcile).toHaveBeenCalledWith(workId);
    expect(ports.changes).toContain(workId);
  });
  it("a failing reconcile after the work is made does not fail the creation", async () => {
    engine.reconcile.mockRejectedValueOnce(new Error("reconcile failed"));
    const workId = await creation.newPlugin(input);
    expect(store.work(workId)!.created).toBe(1);
    expect(store.events(workId).some((e) => e.text.includes("reconcile failed"))).toBe(true);
  });
  it("crash between markCreated and the first thread: reconcile spawns it exactly once", async () => {
    const limits = () => ({ maxBuilding: 2, minFreeDiskGb: 2 });
    // VesnALIA died right after the transaction markCreated + entry into the first stage: the reconcile after creation did not run.
    const real = new Engine(store, ports, limits);
    engine.firstStageEntry.mockImplementation((w, now) => real.firstStageEntry(w, now));
    const first = await creation.newPlugin(input);
    expect(store.work(first)).toMatchObject({ created: 1, stage: 1 });
    expect(store.entry(store.work(first)!)).toMatchObject({ stage: 1, from: 0, error: null });
    expect(ports.threads.size).toBe(0);
    const fresh = new Engine(store, ports, limits);
    await fresh.reconcileAll();
    await fresh.reconcileAll();
    expect(ports.threads.size).toBe(1);
    expect(store.stageThread(first, 1)).not.toBeNull();
    expect(store.work(first)).toMatchObject({ entry: null, task_synced: "in_progress" });

    // The reconcile after creation got as far as spawn: the thread appeared, the reply was lost, the search does not see it yet. After a restart — the same thread.
    ports.spawnThenThrow = true;
    ports.findMisses = 1;
    const second = await new Creation(store, ports, catalog, settings, real).newPlugin({ name: "Second", id: "second", request: "a command" });
    expect(ports.threads.size).toBe(2);
    expect(store.stageThread(second, 1)).toBeNull();
    expect(store.entry(store.work(second)!)?.error).toBe("timeout after create");
    ports.spawnThenThrow = false;
    const again = new Engine(store, ports, limits);
    await again.reconcileAll();
    await again.reconcileAll();
    expect(ports.threads.size).toBe(2);
    expect(store.stageThread(second, 1)).not.toBeNull();
    expect(store.work(second)!.entry).toBeNull();
  });
});

describe("the failure points", () => {
  const cases = EFFECTS.flatMap((e) => whens.map((w) => [e, w] as const));
  it.each(cases)("creation survives a crash at %s/%s", async (effect, when) => {
    ports.failAt(effect, when);
    const workId = await creation.newPlugin(input).catch((e) => e.workId as string);
    ports.failAt(null);
    expect(store.work(workId)!.created).toBe(0);
    later();
    await new Creation(store, ports, catalog, settings, engine).advanceAll();
    for (const e of EFFECTS) expect(ports.count(e), e).toBe(1);
    expect(store.work(workId)!.created).toBe(1);
    expect(store.entry(store.work(workId)!)?.stage).toBe(1);
    expect(store.pendingOps(workId)).toEqual([]);
    expect(ports.projects.rows.size).toBe(1);
    expect(ports.taskRows.size).toBe(1);
    expect(await ports.fs.exists(tmpDirOf(workId))).toBe(false);
    expect(await ports.fs.exists(pluginDir("hello"))).toBe(true);
    expect((await ports.git.facts(pluginDir("hello"))).head).not.toBeNull();
    expect(store.work(workId)!.project_id).toBe(store.plugin("hello")!.project_id);
    expect(store.work(workId)!.task_key).toBe("TEST-1");
  });
  it.each(cases)("a crash at %s/%s is shown on the work, with the reason, until it is mended", async (effect, when) => {
    const workId = await crashAt(effect, when);
    expect(store.work(workId)).toMatchObject({ state: "error", created: 0 });
    expect(store.work(workId)!.state_reason).toContain(`failure ${when} ${effect}`);
    await makeCreation().advance(workId);
    expect(store.work(workId)!.state).not.toBe("error");
  });
  it.each(cases)("the same crash again on the retry at %s/%s duplicates nothing", async (effect, when) => {
    const workId = await crashAt(effect, when);
    ports.failAt(effect, when);
    // «before»: the action is repeated and fails again; «after»: the pass finds what was done and never gets to the action.
    const again = makeCreation().advance(workId);
    if (when === "before") await expect(again).rejects.toThrow();
    else await again;
    ports.failAt(null);
    later();
    await makeCreation().advance(workId);
    for (const e of EFFECTS) expect(ports.count(e), e).toBe(1);
    expect(ports.projects.rows.size).toBe(1);
    expect(ports.taskRows.size).toBe(1);
    expect(store.work(workId)!.created).toBe(1);
  });
  it("two passes over the same work at once make every effect once", async () => {
    const workId = await crashAt("scaffold", "before");
    await Promise.all([creation.advance(workId), creation.advance(workId)]);
    for (const e of EFFECTS) expect(ports.count(e), e).toBe(1);
  });
  it("advancing a finished work does nothing", async () => {
    const workId = await creation.newPlugin(input);
    const before = ports.calls.length;
    await creation.advance(workId);
    await creation.advanceAll();
    expect(ports.calls.length).toBe(before);
    expect(engine.reconcile).toHaveBeenCalledTimes(1);
  });
  it("advancing a work that does not exist or was canceled does nothing", async () => {
    await creation.advance("w_nope");
    const workId = await crashAt("scaffold", "before");
    store.finish(workId, "canceled", 5);
    await creation.advanceAll();
    await creation.advance(workId);
    expect(ports.calls).toEqual([]);
  });
  it("the last step is one transaction: a failing first-stage entry leaves the work as it was", async () => {
    engine.firstStageEntry.mockImplementationOnce(() => {
      throw new Error("no entry");
    });
    const workId = await creation.newPlugin(input).catch((e) => e.workId as string);
    const w = store.work(workId)!;
    expect([w.created, w.entry]).toEqual([0, null]);
    expect(engine.reconcile).not.toHaveBeenCalled();
    await creation.advance(workId);
    expect(store.work(workId)!.created).toBe(1);
    expect(store.entry(store.work(workId)!)?.stage).toBe(1);
    for (const e of EFFECTS) expect(ports.count(e), e).toBe(1);
  });
  it("the entry is made for the work as it is after markCreated, with task and project already in", async () => {
    const workId = await creation.newPlugin(input);
    const [w, now] = engine.firstStageEntry.mock.calls[0]!;
    expect(w).toMatchObject({ id: workId, created: 1, task_key: "TEST-1" });
    expect(w.project_id).not.toBeNull();
    expect(now).toBe(ports.now());
  });
  it("a scaffold that VesnALIA plugin new left incomplete (exit 0, npm install failed) is not taken: tmpDir is removed and it is made again", async () => {
    const orig = ports.fs.scaffold.bind(ports.fs);
    let calls = 0;
    ports.fs.scaffold = async (id, tmp) => {
      await orig(id, tmp);
      if (++calls === 1) {
        await ports.fs.remove(`${tmp}/alia-plugin-${id}/node_modules`);
        await ports.fs.remove(`${tmp}/alia-plugin-${id}/package-lock.json`);
      }
    };
    const e = await creation.newPlugin(input).then(
      () => {
        throw new Error("expected a refusal");
      },
      (x) => x as Error & { workId: string },
    );
    expect(e.message).toMatch(/scaffold incomplete/);
    const tmp = tmpDirOf(e.workId);
    expect(await ports.fs.exists(tmp)).toBe(false);
    expect(store.op(`${e.workId}:create:scaffold`)!.status).toBe("pending");
    expect(ports.count("rename")).toBe(0);
    later();
    await makeCreation().advanceAll();
    expect(ports.count("scaffold")).toBe(2);
    expect(ports.count("rename")).toBe(1);
    expect((await ports.fs.list(pluginDir("hello"))).sort()).toEqual([...SCAFFOLD_FILES].sort());
    expect(store.work(e.workId)!.created).toBe(1);
  });
  it("a scaffold that is damaged after it was made (before the rename) stops the work for good: no new scaffold, no automatic retry", async () => {
    const workId = await crashAt("rename", "before");
    await ports.fs.remove(`${tmpDirOf(workId)}/alia-plugin-hello/package.json`);
    for (let pass = 1; pass <= 3; pass++) {
      await makeCreation().advanceAll();
      expect(store.work(workId), `pass ${pass}`).toMatchObject({ state: "error", created: 0 });
      expect(store.work(workId)!.state_reason, `pass ${pass}`).toMatch(/scaffold .* is gone or incomplete/);
    }
    expect(store.op(`${workId}:create:rename`)!.status).toBe("failed");
    expect(ports.count("scaffold")).toBe(1);
    expect(ports.count("rename")).toBe(0);
    expect(ports.count("initCommit")).toBe(0);
  });
});

describe("a folder that is not ours at the place of the plugin", () => {
  const foreign = () => `${pluginDir("hello")}/foreign.txt`;
  /** Three passes over the work: the foreign folder is never taken for ours, `initCommit` never runs in it, the work stays in `error`. */
  const threePassesStayRefused = async (workId: string) => {
    for (let pass = 1; pass <= 3; pass++) {
      await makeCreation().advanceAll();
      expect(ports.count("initCommit"), `pass ${pass}`).toBe(0);
      expect(store.work(workId), `pass ${pass}`).toMatchObject({ state: "error", created: 0 });
      expect(store.work(workId)!.state_reason, `pass ${pass}`).toContain(pluginDir("hello"));
      expect(await ports.fs.exists(foreign()), `pass ${pass}`).toBe(true);
    }
    expect(ports.count("projects.create")).toBe(0);
    expect(ports.count("tasks.create")).toBe(0);
  };

  it("already there when the scaffold starts: refused before the heavy command, the intent is closed as failed", async () => {
    ports.fs.put(foreign());
    store.tx(() => {
      store.upsertSeen({ id: "hello", name: "Greeter", dir: pluginDir("hello"), source: null }, 1);
      store.addWork({ id: "w_x", plugin_id: "hello", kind: "new", tasks_project_id: "tp1", host_id: "host_1", title: "Greeter", request: "R", created_at: 1 });
    });
    await expect(creation.advance("w_x")).rejects.toThrow(pluginDir("hello"));
    expect(ports.count("scaffold")).toBe(0);
    expect(store.op("w_x:create:scaffold")!.status).toBe("failed");
    await threePassesStayRefused("w_x");
    expect(ports.count("scaffold")).toBe(0);
  });
  it("A: appears while the scaffold is being made: the rename refuses, the folder is never taken for ours", async () => {
    const orig = ports.fs.scaffold.bind(ports.fs);
    ports.fs.scaffold = async (id, tmp) => {
      await orig(id, tmp);
      ports.fs.put(foreign());
    };
    const e = await creation.newPlugin(input).then(
      () => {
        throw new Error("expected a refusal");
      },
      (x) => x as Error & { workId: string },
    );
    expect(e.message).toContain(pluginDir("hello"));
    expect(ports.count("scaffold")).toBe(1);
    expect(ports.count("rename")).toBe(0);
    expect(store.op(`${e.workId}:create:rename`)!.status).toBe("failed");
    await threePassesStayRefused(e.workId);
    expect(ports.count("scaffold")).toBe(1);
    expect(ports.count("rename")).toBe(0);
  });
  it("B: a crash before the scaffold, then the folder appears", async () => {
    const workId = await crashAt("scaffold", "before");
    ports.fs.put(foreign());
    await threePassesStayRefused(workId);
    expect(ports.count("scaffold")).toBe(0);
    // The folder does not count as a finished scaffold: the scaffold intent is closed by a refusal, not «done».
    expect(store.op(`${workId}:create:scaffold`)!.status).toBe("failed");
  });
  it("C: a crash before the rename, then the folder appears: the scaffold still waits in tmpDir, so the folder is not ours", async () => {
    const workId = await crashAt("rename", "before");
    ports.fs.put(foreign());
    await threePassesStayRefused(workId);
    expect(ports.count("rename")).toBe(0);
    expect(await ports.fs.exists(`${tmpDirOf(workId)}/alia-plugin-hello`)).toBe(true);
  });
  it("a refused work does not go on by itself when the owner removes the folder: it waits for a decision", async () => {
    const workId = await crashAt("rename", "before");
    ports.fs.put(foreign());
    await makeCreation().advanceAll();
    await ports.fs.remove(pluginDir("hello"));
    await makeCreation().advanceAll();
    expect(store.work(workId)).toMatchObject({ state: "error", created: 0 });
    expect(ports.count("rename")).toBe(0);
  });
  it("the folder that our own rename made is ours: scaffold done, the nested folder gone, the folder there", async () => {
    const workId = await crashAt("rename", "after");
    await makeCreation().advanceAll();
    expect(store.work(workId)).toMatchObject({ created: 1 });
    expect(ports.count("initCommit")).toBe(1);
  });
});

describe("the project and the task", () => {
  it("two projects on the folder is an error with their ids", async () => {
    ports.projects.add({ id: "p1", name: "A", dir: pluginDir("hello"), hostId: "host_1" });
    ports.projects.add({ id: "p2", name: "B", dir: pluginDir("hello"), hostId: "host_1" });
    const workId = await creation.newPlugin(input).catch((e) => e.workId as string);
    const w = store.work(workId)!;
    expect(w.state).toBe("error");
    expect(w.state_reason).toContain("p1");
    expect(w.state_reason).toContain("p2");
    expect(w.created).toBe(0);
    expect(ports.count("projects.create")).toBe(0);
    expect(ports.count("tasks.create")).toBe(0);
    await creation.advanceAll();
    expect(store.work(workId)!.state).toBe("error");
    ports.projects.rows.delete("p2");
    await creation.advanceAll();
    expect(store.work(workId)).toMatchObject({ created: 1, project_id: "p1" });
    expect(ports.count("projects.create")).toBe(0);
  });
  it("a project of another machine on the same path is not ours", async () => {
    ports.projects.add({ id: "p1", name: "A", dir: pluginDir("hello"), hostId: "host_other" });
    const workId = await creation.newPlugin(input);
    expect(store.work(workId)!.project_id).not.toBe("p1");
    expect(ports.count("projects.create")).toBe(1);
  });
  it("two tasks with the mark of one work is an error with their keys", async () => {
    const workId = await crashAt("tasks.create", "after");
    await ports.tasks.create({ tasksProjectId: "tp1", title: "Duplicate", description: `x ${taskMarker(workId)}` });
    await expect(makeCreation().advance(workId)).rejects.toThrow(/TEST-1.*TEST-2/);
    expect(store.work(workId)).toMatchObject({ state: "error", created: 0 });
    expect(ports.count("tasks.create")).toBe(2);
  });
  it("a task with the mark of another work is not ours", async () => {
    await ports.tasks.create({ tasksProjectId: "tp1", title: "Someone else's", description: "[workshop:w_other]" });
    const workId = await creation.newPlugin(input);
    expect(store.work(workId)!.task_key).toBe("TEST-2");
  });
  it("the task goes to the tracker project from the settings at the time the work was made", async () => {
    creation = new Creation(store, ports, catalog, () => ({ tasksProject: "tp2" }), engine);
    const workId = await creation.newPlugin(input);
    expect(store.work(workId)!.tasks_project_id).toBe("tp2");
    expect(ports.taskRows.get(store.work(workId)!.task_id!)!.projectId).toBe("tp2");
  });
});

describe("scaffold: the retry limit", () => {
  const GAVE_UP = "the scaffold keeps failing (3 attempts) — cancel the creation and try again later";
  const tries = () => ports.tripped.filter((t) => t.effect === "scaffold").length;
  const payload = (workId: string) => JSON.parse(store.op(`${workId}:create:scaffold`)!.payload ?? "null") as { failures: number; at: number } | null;

  it("a failing scaffold is retried at most every 5 minutes; after 3 failures the work stops with a refusal and is never retried", async () => {
    ports.failAt("scaffold", "before"); // VesnALIA plugin new fails every time
    const e = (await creation.newPlugin(input).catch((x: unknown) => x)) as Error & { workId: string };
    const workId = e.workId;
    expect(e.message).toContain("retry in 5 minutes at the earliest");
    expect(tries()).toBe(1);
    expect(payload(workId)).toEqual({ failures: 1, at: ports.now() });
    // The every-minute pass before the interval runs nothing and does not touch the work's error.
    const reason = store.work(workId)!.state_reason;
    for (let m = 1; m <= 4; m++) {
      ports.t += 60_000;
      await makeCreation().advanceAll();
    }
    expect(tries()).toBe(1);
    expect(store.work(workId)).toMatchObject({ created: 0, state: "error", state_reason: reason });
    ports.t += 60_000; // five minutes after the failure
    await makeCreation().advanceAll();
    expect(tries()).toBe(2);
    expect(payload(workId)).toEqual({ failures: 2, at: ports.now() });
    expect(store.op(`${workId}:create:scaffold`)!.status).toBe("pending");
    ports.t += 5 * 60_000;
    await makeCreation().advanceAll();
    expect(tries()).toBe(3);
    expect(store.op(`${workId}:create:scaffold`)).toMatchObject({ status: "failed" });
    expect(store.op(`${workId}:create:scaffold`)!.error).toContain(GAVE_UP);
    expect(store.work(workId)).toMatchObject({ created: 0, state: "error" });
    expect(store.work(workId)!.state_reason).toContain(GAVE_UP);
    ports.t += 60 * 60_000;
    await makeCreation().advanceAll();
    expect(tries()).toBe(3);
    // Cancel works as usual.
    ports.failAt(null);
    await creation.cancel(workId, "later");
    expect(store.work(workId)).toMatchObject({ outcome: "canceled" });
  });

  it("a scaffold that succeeds on the second try finishes the creation", async () => {
    ports.failAt("scaffold", "after"); // VesnALIA plugin new ran, but its reply was lost or failed — the scaffold may be in place
    const workId = await creation.newPlugin(input).catch((x: { workId: string }) => x.workId);
    ports.failAt(null);
    ports.t += 5 * 60_000;
    await makeCreation().advanceAll();
    expect(store.work(workId)!.created).toBe(1);
  });

  it("the count lives in the intent: three failures across restarts are still three, and a fourth pass refuses before the heavy command", async () => {
    ports.failAt("scaffold", "before");
    const workId = await creation.newPlugin(input).catch((x: { workId: string }) => x.workId);
    // The counter reached the limit, but the refusal was not recorded in time (a restart): the intent is still pending.
    store.beginOp(`${workId}:create:scaffold`, workId, "create", JSON.stringify({ failures: 3, at: ports.now() }), ports.now());
    ports.failAt(null);
    ports.t += 5 * 60_000;
    await makeCreation().advanceAll();
    expect(ports.count("scaffold")).toBe(0);
    expect(store.op(`${workId}:create:scaffold`)).toMatchObject({ status: "failed" });
    expect(store.work(workId)!.state_reason).toContain(GAVE_UP);
  });
});

describe("advanceAll", () => {
  it("goes through every creating work; a stuck one does not hold the others", async () => {
    const b = await crashAt("scaffold", "before", { name: "Beta", id: "beta", request: "b" });
    ports.projects.add({ id: "p1", name: "A", dir: pluginDir("alpha"), hostId: "host_1" });
    ports.projects.add({ id: "p2", name: "B", dir: pluginDir("alpha"), hostId: "host_1" });
    const a = await creation.newPlugin({ name: "Alpha", id: "alpha", request: "a" }).catch((e) => e.workId as string);
    expect(store.creatingWorks().map((w) => w.id).sort()).toEqual([a, b].sort());
    await expect(creation.advanceAll()).resolves.toBeUndefined();
    expect(store.work(b)!.created).toBe(1);
    expect(store.work(a)).toMatchObject({ created: 0, state: "error" });
    expect(store.creatingWorks().map((w) => w.id)).toEqual([a]);
  });
  it("makes the effects of the works one after another, not at once", async () => {
    await crashAt("scaffold", "before", { name: "Beta", id: "beta", request: "b" });
    await crashAt("scaffold", "before", { name: "Gamma", id: "gamma", request: "g" });
    let running = 0;
    let peak = 0;
    const scaffold = ports.fs.scaffold.bind(ports.fs);
    ports.fs.scaffold = async (id, tmp) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      await scaffold(id, tmp);
      running--;
    };
    await creation.advanceAll();
    expect(peak).toBe(1);
    expect(store.creatingWorks()).toEqual([]);
  });
});

describe("Creation.rework", () => {
  /** An installed plugin from its own working copy on main, clean. */
  const install = async (id: string, name: string, repo: { dirtyCount?: number; branch?: string } = {}) => {
    ports.plugins.add({ id, name });
    ports.git.setRepo(pluginDir(id), repo);
    await catalog.sync();
  };

  it("rework refuses with the catalog reasons", async () => {
    await install("newproject", "New project", { dirtyCount: 4 });
    await expect(creation.rework("newproject", "x")).rejects.toThrow("4 uncommitted changes in the working copy");
    expect(store.works()).toEqual([]);
    expect(ports.calls).toEqual([]);
  });
  it("names every reason in one message", async () => {
    await install("slack", "Slack", { dirtyCount: 2, branch: "chore/plugin-sdk-update" });
    const e = await creation.rework("slack", "x").then(
      () => {
        throw new Error("expected a refusal");
      },
      (x) => x as Error,
    );
    expect(e.message).toContain("the working copy is on branch chore/plugin-sdk-update, not main");
    expect(e.message).toContain("2 uncommitted changes in the working copy");
    expect((e as { workId?: string }).workId).toBeUndefined();
  });
  it("refuses the Workshop itself, a plugin not on the board and an empty or oversized request", async () => {
    await install(SELF_ID, "Plugin Workshop");
    await install("mail", "Mail");
    await expect(creation.rework(SELF_ID, "x")).rejects.toThrow("the Workshop is not reworked through itself");
    await expect(creation.rework("nobody", "x")).rejects.toThrow("plugin nobody is not on the board");
    await expect(creation.rework("mail", "  \n")).rejects.toThrow("a description is required");
    await expect(creation.rework("mail", "x".repeat(20_001))).rejects.toThrow("description — up to 20000 characters");
    expect(store.works()).toEqual([]);
  });
  it("makes the project and the task, no scaffold, no commit", async () => {
    await install("mail", "Mail");
    const workId = await creation.rework("mail", "  add search\n");
    expect(effects()).toEqual(["projects.create", "tasks.create"]);
    const w = store.work(workId)!;
    expect(w).toMatchObject({ plugin_id: "mail", kind: "rework", created: 1, stage: 1, request: "add search", host_id: "host_1", tasks_project_id: "tp1" });
    expect(ports.projects.rows.get(w.project_id!)).toMatchObject({ name: "Plugin · Mail", dir: pluginDir("mail"), hostId: "host_1" });
    expect(store.plugin("mail")!.project_id).toBe(w.project_id);
    expect(ports.taskRows.get(w.task_id!)!.description).toContain(taskMarker(workId));
    expect(store.entry(w)?.stage).toBe(1);
    expect(engine.reconcile).toHaveBeenCalledWith(workId);
    expect(await ports.fs.exists(`${PLUGINS_ROOT}/.workshop-new`)).toBe(false);
  });
  it("takes the project that is already there for the folder", async () => {
    await install("runner", "Runner");
    ports.projects.add({ id: "proj_runner", name: "Runner project", dir: pluginDir("runner"), hostId: "host_1" });
    const workId = await creation.rework("runner", "x");
    expect(store.work(workId)!.project_id).toBe("proj_runner");
    expect(store.plugin("runner")!.project_id).toBe("proj_runner");
    expect(ports.count("projects.create")).toBe(0);
  });
  it("a second work on a plugin is refused, with the reason of the catalog", async () => {
    await install("mail", "Mail");
    await creation.rework("mail", "x");
    await expect(creation.rework("mail", "y")).rejects.toThrow("work TEST-1 is already in progress");
  });
  it("a plugin whose work is still being made is not taken a second time", async () => {
    await install("mail", "Mail");
    ports.failAt("tasks.create", "before");
    await creation.rework("mail", "x").catch(() => undefined);
    ports.failAt(null);
    await expect(creation.rework("mail", "y")).rejects.toThrow("a work is already in progress (being created)");
  });
  it("two works on one plugin raced past the check: the second says so in words", async () => {
    await install("mail", "Mail");
    const [a, b] = await Promise.allSettled([creation.rework("mail", "x"), creation.rework("mail", "y")]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const lost = [a, b].find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as Error).message).toMatch(/already has a work in progress|is already in progress/);
    expect(store.works()).toHaveLength(1);
  });

  const cases = (["projects.create", "tasks.create"] as const).flatMap((e) => whens.map((w) => [e, w] as const));
  it.each(cases)("rework survives a crash at %s/%s", async (effect, when) => {
    await install("mail", "Mail");
    ports.failAt(effect, when);
    const workId = await creation.rework("mail", "x").catch((e) => e.workId as string);
    ports.failAt(null);
    expect(store.work(workId)!.created).toBe(0);
    await new Creation(store, ports, catalog, settings, engine).advanceAll();
    expect(effects().filter((e) => e === "projects.create")).toHaveLength(1);
    expect(effects().filter((e) => e === "tasks.create")).toHaveLength(1);
    expect(ports.count("scaffold") + ports.count("rename") + ports.count("initCommit")).toBe(0);
    expect(store.work(workId)).toMatchObject({ created: 1, kind: "rework" });
    expect(store.entry(store.work(workId)!)?.stage).toBe(1);
  });
});

describe("the tracker project for work tasks", () => {
  it("is required: with no tasksProject in the settings, newPlugin and rework are refused and nothing is made", async () => {
    ports.plugins.add({ id: "mail", name: "Mail" });
    ports.git.setRepo(pluginDir("mail"), {});
    await catalog.sync();
    const plugins = store.plugins();
    const list = vi.spyOn(ports.plugins, "list");
    const host = vi.spyOn(ports, "serverHostId");
    const unset = new Creation(store, ports, catalog, () => ({ tasksProject: "" }), engine);
    const NO_PROJECT = "no tracker project for work tasks is selected in the plugin settings (tasksProject) — project ids: `alia tasks project list`";
    const e = await unset.newPlugin(input).catch((x: unknown) => x);
    expect((e as Error).message).toBe(NO_PROJECT);
    expect((e as { workId?: string }).workId).toBeUndefined();
    await expect(unset.rework("mail", "x")).rejects.toThrow(NO_PROJECT);
    expect(store.works()).toEqual([]);
    expect(store.plugins()).toEqual(plugins);
    expect(ports.calls).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
    expect(engine.reconcile).not.toHaveBeenCalled();
  });
});

describe("Creation.cancel", () => {
  const cases = EFFECTS.flatMap((e) => whens.map((w) => [e, w] as const));
  const reason = "changed my mind";

  it.each(cases)("a creation that crashed at %s/%s can be canceled", async (effect, when) => {
    const workId = await crashAt(effect, when);
    const before = ports.calls.length;
    await creation.cancel(workId, reason);
    const w = store.work(workId)!;
    expect(w).toMatchObject({ outcome: "canceled", state: "canceled", state_reason: "canceled", cleanup_done: 1, task_synced: "canceled", created: 0 });
    expect(w.finished_at).not.toBeNull();
    expect(await ports.fs.exists(tmpDirOf(workId))).toBe(false);
    for (const t of ports.taskRows.values()) {
      expect(t.status).toBe("canceled");
      expect(t.comments.join("\n")).toContain(reason);
    }
    expect(store.openWorkOf("hello")).toBeNull();
    expect(store.creatingWorks()).toEqual([]);
    expect(store.unsettledWorks()).toEqual([]);
    expect(store.pendingOps(workId)).toEqual([]);
    expect(store.plugin("hello")!.gone_reason).toBe((await ports.fs.exists(pluginDir("hello"))) ? null : "creation canceled");
    expect(ports.calls.length).toBe(before);
    await expect(creation.cancel(workId, "once more")).rejects.toThrow("the work is already canceled");
    await creation.advanceAll();
    expect(ports.calls.length).toBe(before);
    expect(engine.reconcile).not.toHaveBeenCalled();
    expect(ports.changes).toContain(workId);
  });
  it("a task that was made but not yet written to the work is found by its mark and canceled", async () => {
    const workId = await crashAt("tasks.create", "after");
    expect(store.work(workId)!.task_id).toBeNull();
    await creation.cancel(workId, reason);
    expect([...ports.taskRows.values()].map((t) => t.status)).toEqual(["canceled"]);
  });
  it("a creation that is done but for the last step: the task is written to the work and canceled, the plugin folder stays", async () => {
    engine.firstStageEntry.mockImplementationOnce(() => {
      throw new Error("no entry");
    });
    const workId = await creation.newPlugin(input).catch((e) => e.workId as string);
    expect(store.work(workId)!.task_id).not.toBeNull();
    await creation.cancel(workId, reason);
    expect(ports.taskRows.get(store.work(workId)!.task_id!)).toMatchObject({ status: "canceled" });
    expect(await ports.fs.exists(pluginDir("hello"))).toBe(true);
    expect(store.plugin("hello")!.gone_reason).toBeNull();
    expect(store.work(workId)).toMatchObject({ outcome: "canceled", created: 0, entry: null });
  });
  it("a folder of the plugin that is not ours is left alone, only the scaffold of the work is removed", async () => {
    const workId = await crashAt("rename", "before");
    ports.fs.put(`${pluginDir("hello")}/foreign.txt`);
    await makeCreation().advanceAll();
    expect(store.work(workId)!.state).toBe("error");
    await creation.cancel(workId, reason);
    expect(await ports.fs.exists(`${pluginDir("hello")}/foreign.txt`)).toBe(true);
    expect(await ports.fs.exists(tmpDirOf(workId))).toBe(false);
    expect(store.plugin("hello")!.gone_reason).toBeNull();
    expect(store.work(workId)!.outcome).toBe("canceled");
  });
  it("the project that was made stays: there is no port to remove it", async () => {
    const workId = await crashAt("tasks.create", "before");
    await creation.cancel(workId, reason);
    expect(ports.projects.rows.size).toBe(1);
    expect(store.work(workId)!.project_id).not.toBeNull();
  });
  it("a rework is canceled the same way, and its plugin is not marked gone", async () => {
    ports.plugins.add({ id: "mail", name: "Mail" });
    ports.git.setRepo(pluginDir("mail"), {});
    await catalog.sync();
    ports.failAt("tasks.create", "before");
    const workId = await creation.rework("mail", "x").catch((e) => e.workId as string);
    ports.failAt(null);
    await creation.cancel(workId, reason);
    expect(store.work(workId)).toMatchObject({ outcome: "canceled", kind: "rework" });
    expect(store.plugin("mail")!.gone_reason).toBeNull();
    expect(store.openWorkOf("mail")).toBeNull();
    // «Rework» is possible again.
    await expect(creation.rework("mail", "y")).resolves.toEqual(expect.any(String));
  });
  it("the id of a creation that was canceled before the folder was made is free again", async () => {
    const workId = await crashAt("scaffold", "before");
    await creation.cancel(workId, reason);
    expect(store.plugin("hello")!.gone_reason).toBe("creation canceled");
    const again = await creation.newPlugin(input);
    expect(again).not.toBe(workId);
    expect(store.work(again)).toMatchObject({ created: 1, outcome: null });
    expect(store.plugin("hello")).toMatchObject({ gone_reason: null, name: "Greeter", dir: pluginDir("hello") });
    expect(store.work(workId)!.outcome).toBe("canceled");
  });
  it("only a creation that is not finished can be canceled here", async () => {
    const done = await creation.newPlugin(input);
    await expect(creation.cancel(done, reason)).rejects.toThrow(/creation is already finished/);
    await expect(creation.cancel("w_nope", reason)).rejects.toThrow("work w_nope not found");
    expect(store.work(done)!.outcome).toBeNull();
  });
  it("canceling without a reason still says so on the task", async () => {
    const workId = await crashAt("tasks.create", "after");
    await creation.cancel(workId, "  ");
    expect([...ports.taskRows.values()][0]!.comments.join("\n")).toContain("no reason given");
  });
  it("waits for the step that is running and stops the creation after it: no more steps are made", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = ports.fs.scaffold.bind(ports.fs);
    ports.fs.scaffold = async (id, tmp) => {
      await gate;
      await orig(id, tmp);
    };
    const creating = creation.newPlugin(input);
    while (store.works().length === 0) await new Promise((r) => setTimeout(r, 1));
    const workId = store.works()[0]!.id;
    let canceled = false;
    const canceling = creation.cancel(workId, reason).then(() => (canceled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(canceled).toBe(false);
    release();
    await canceling;
    // A creation canceled while running does not report success.
    await expect(creating).rejects.toMatchObject({ message: "creation canceled", workId });
    expect(store.work(workId)).toMatchObject({ outcome: "canceled", created: 0 });
    expect(ports.count("scaffold")).toBe(1);
    expect(ports.count("rename")).toBe(0);
    expect(ports.count("initCommit")).toBe(0);
    expect(await ports.fs.exists(tmpDirOf(workId))).toBe(false);
    expect(store.plugin("hello")!.gone_reason).toBe("creation canceled");
  });
  it("a newPlugin that was canceled while it ran does not report success: it throws with the work id", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = ports.fs.scaffold.bind(ports.fs);
    ports.fs.scaffold = async (id, tmp) => {
      await gate;
      await orig(id, tmp);
    };
    const creating = creation.newPlugin(input).then(
      (id) => ({ ok: id }),
      (e) => e as Error & { workId: string },
    );
    while (store.works().length === 0) await new Promise((r) => setTimeout(r, 1));
    const workId = store.works()[0]!.id;
    const canceling = creation.cancel(workId, reason);
    release();
    await canceling;
    const result = await creating;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error & { workId: string }).workId).toBe(workId);
    expect((result as Error).message).toBe("creation canceled");
    expect(store.work(workId)!.outcome).toBe("canceled");
  });
  it("the same when the cancel is asked and not yet carried out: the creation stops and says so", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = ports.fs.scaffold.bind(ports.fs);
    ports.fs.scaffold = async (id, tmp) => {
      await gate;
      await orig(id, tmp);
    };
    const creating = creation.newPlugin(input).then(
      () => null,
      (e) => e as Error & { workId: string },
    );
    while (store.works().length === 0) await new Promise((r) => setTimeout(r, 1));
    const workId = store.works()[0]!.id;
    // The cancel is recorded but the queue has not reached it yet: the pass has already stopped, the work is not closed yet.
    store.beginOp(`${workId}:create:cancel`, workId, "create", "changed my mind", ports.now());
    release();
    const e = await creating;
    expect(e).toMatchObject({ message: "creation canceled", workId });
    expect(ports.count("rename")).toBe(0);
  });
  it("a rework that was canceled while it ran throws too", async () => {
    ports.plugins.add({ id: "mail", name: "Mail" });
    ports.git.setRepo(pluginDir("mail"), {});
    await catalog.sync();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const find = ports.projects.findByPath.bind(ports.projects);
    ports.projects.findByPath = async (host, dir) => {
      await gate;
      return find(host, dir);
    };
    const working = creation.rework("mail", "x").then(
      () => null,
      (e) => e as Error & { workId: string },
    );
    while (store.works().length === 0) await new Promise((r) => setTimeout(r, 1));
    const workId = store.works()[0]!.id;
    const canceling = creation.cancel(workId, reason);
    release();
    await canceling;
    expect(await working).toMatchObject({ message: "creation canceled", workId });
    expect(ports.count("tasks.create")).toBe(0);
    expect(store.work(workId)!.outcome).toBe("canceled");
  });
  it("two cancels at once: the second is refused", async () => {
    const workId = await crashAt("scaffold", "before");
    const [a, b] = await Promise.allSettled([creation.cancel(workId, reason), creation.cancel(workId, reason)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(((a.status === "rejected" ? a : b) as PromiseRejectedResult).reason.message).toBe("the work is already canceled");
  });
  it("a cancel that broke in the middle is finished by the next pass, and the creation does not go on meanwhile", async () => {
    const workId = await crashAt("rename", "before");
    const setStatus = ports.tasks.setStatus;
    ports.tasks.setStatus = async () => {
      throw new Error("tracker unavailable");
    };
    // There is no task yet — so break it differently: `findByMarker` fails.
    const find = ports.tasks.findByMarker;
    ports.tasks.findByMarker = async () => {
      throw new Error("tracker unavailable");
    };
    await expect(creation.cancel(workId, reason)).rejects.toThrow(/cancel: .*tracker unavailable/);
    expect(store.work(workId)).toMatchObject({ outcome: null, created: 0 });
    await makeCreation().advanceAll();
    expect(store.work(workId)!.outcome).toBeNull();
    expect(ports.count("rename")).toBe(0);
    ports.tasks.setStatus = setStatus;
    ports.tasks.findByMarker = find;
    await makeCreation().advanceAll();
    expect(store.work(workId)).toMatchObject({ outcome: "canceled", created: 0 });
    expect(ports.count("rename")).toBe(0);
    expect(await ports.fs.exists(tmpDirOf(workId))).toBe(false);
  });
});
