// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkshopPanel } from "./app/board";
import { MOCKUP_CSP, withMockupCsp } from "./app/common";

type Handlers = Record<string, (input: never) => unknown>;

// Without globals RTL does not clean up the markup itself: a failed check must not leave it to the next test.
afterEach(cleanup);

const COLUMNS = [
  { key: "context", title: "Context" },
  { key: "tech", title: "Feasibility" },
  { key: "tz", title: "Spec" },
  { key: "mockup", title: "Mockup" },
  { key: "build", title: "Building" },
  { key: "live", title: "In production" },
  { key: "off", title: "Retired" },
];
const COLUMN_OF_STAGE: Record<number, string> = { 1: "context", 2: "tech", 3: "tz", 7: "mockup", 4: "build", 5: "build", 6: "live" };

const availability = (over: Partial<Record<"rollback" | "reinstall" | "disable" | "enable" | "cancelInstall" | "adopt", string | null>> = {}) => ({
  rollback: "no rollback point" as string | null,
  reinstall: "a retry is only possible when the install outcome is unknown" as string | null,
  disable: null as string | null,
  enable: "the plugin is already enabled" as string | null,
  cancelInstall: "no install is running — nothing to cancel" as string | null,
  adopt: "the main branch is at the rolled-out commit — nothing to adopt" as string | null,
  ...over,
});
type PluginWork = { id: string; key: string | null; stage: number; state: string; reason: string; stale: boolean };
const pcard = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  column: "live",
  bbState: "running",
  stateStale: false,
  labels: [] as string[],
  reworkBlockers: [] as string[],
  availability: availability(),
  work: null as PluginWork | null,
  ...over,
});
const board = (plugins: ReturnType<typeof pcard>[]) => ({ columns: COLUMNS, plugins });
const pluginView = (over: Record<string, unknown> = {}) => ({
  ...pcard("demo", { name: "Demo" }),
  source: "path:/srv/plugins/bb-plugin-demo",
  dir: "/srv/plugins/bb-plugin-demo",
  branch: "main",
  head: "abcdef1234567",
  dirtyCount: 0,
  installedSha: "1234567abcdef",
  attempt: null as Attempt | null,
  pastTasks: [] as Array<{ key: string; outcome: string; finishedAt: number | null }>,
  ...over,
});

type Slot = Awaited<ReturnType<typeof mount>>;
const mount = async (handlers: Handlers, props: { subPath?: string; createSlowMs?: number } = {}) => {
  await loadPluginApp(() => import("./app"));
  return renderSlot({ component: WorkshopPanel }, { subPath: "", ...props }, { rpc: handlers as never });
};
const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((c) => c.method === method);

const version = { iteration: 1, headSha: "abcdef1234567", dirty: false, contextSha: "s", techSha: "t", tzSha: "p" };
type Attempt = { id: string; kind: "enter" | "rollback" | "reinstall"; step: string; status: "running" | "done" | "failed" | "unknown"; error: string | null; beforeSha: string | null; targetSha: string | null; note: string | null };
const attempt = (over: Partial<Attempt> = {}): Attempt => ({ id: "att_1", kind: "enter", step: "checked", status: "done", error: null, beforeSha: "0000000aaaa", targetSha: "abcdef1234567", note: null, ...over });

interface ViewOver {
  stage?: number;
  state?: string;
  reason?: string;
  blockers?: string[];
  warnings?: string[];
  version?: typeof version | null;
  attempt?: Attempt | null;
  availability?: ReturnType<typeof availability>;
  canRestart?: boolean;
  files?: Array<{ path: string; label: string; verdict: string | null }>;
  created?: boolean;
  key?: string | null;
  baseAhead?: boolean;
  /** What the server accepts on a send-back (`WorkView.sendBack`). */
  sendBack?: { needsForce: boolean; fixForwardOffered: boolean };
  reconfirm?: number[];
  ownerNeeds?: string[];
  returnByReport?: { toStage: number; reason: string; fixForward: boolean } | null;
  /** The stage order (numbers); by default six stages without «Mockup». */
  order?: number[];
  pilot?: ReturnType<typeof pilotOf> | null;
  prUrl?: string | null;
}
type PilotState = "on" | "paused" | "stopped" | "done";
const opus = { providerId: "claude-code", model: "claude-opus-5-5", effort: null as string | null, label: "Opus 5.5" };
const MODELS = {
  docs: opus, build: opus, check: opus, pilot: opus, subagents: { ...opus, model: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  reviewers: [{ ...opus, model: "claude-fable-5-1", label: "Fable 5.1" }, { providerId: "codex", model: "gpt-6-astra", effort: null as string | null, label: "GPT-6-Astra" }],
};
const CATALOG = {
  providers: [
    { id: "claude-code", name: "Claude Code", models: [
      { id: "claude-opus-5-5", label: "Opus 5.5", efforts: ["low", "medium", "high", "max"], defaultEffort: "high" },
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5", efforts: ["low", "medium", "high"], defaultEffort: "medium" },
      { id: "claude-fable-5-1", label: "Fable 5.1", efforts: ["high", "max"], defaultEffort: "high" },
    ] },
    { id: "codex", name: "Codex", models: [{ id: "gpt-6-astra", label: "GPT-6-Astra", efforts: ["medium", "high"], defaultEffort: "medium" }] },
  ],
  defaults: MODELS,
  error: null as string | null,
};
const pilotOf = (over: Partial<{ state: PilotState; reason: string | null; threadId: string | null; report: string | null }> = {}) => ({
  state: "on" as PilotState, reason: null as string | null, notes: "", threadId: "thr_pilot" as string | null, actions: 3, reds: 0, startedAt: 1, stoppedAt: null as number | null,
  report: null as string | null, ...over,
});
const TITLE_OF: Record<number, string> = { 1: "Context", 2: "Feasibility", 3: "Spec", 7: "Mockup", 4: "Implementation", 5: "Verification", 6: "Rollout" };
const workView = (over: ViewOver = {}) => {
  const stage = over.stage ?? 2;
  const created = over.created ?? true;
  return {
    work: {
      id: "w1", key: over.key === undefined ? "TEST-1" : over.key, title: "Rework of plugin «Demo»", request: "Make an export", pluginId: "demo", kind: "rework" as const,
      created, projectId: created ? "p1" : null, stage, iteration: 1, state: over.state ?? "owner", reason: over.reason ?? "the agent finished its turn", stale: false, queued: false,
      environmentId: null, outcome: null as string | null, createdAt: 1, canRestart: over.canRestart ?? false,
    },
    version: created ? (over.version === undefined ? version : over.version) : null,
    blockers: over.blockers ?? [],
    warnings: over.warnings ?? [],
    stages: created
      ? (over.order ?? [1, 2, 3, 4, 5, 6]).map((no) => ({
          no, title: TITLE_OF[no]!, ownerCheck: `check ${no}`, agent: true, reviewed: no === 3 || no === 5, current: no === stage, stale: false,
          threads: no === stage ? [{ threadId: "t1", role: "stage", who: "Claude", round: 1, status: "idle", done: false, invalid: null as string | null }] : [],
          files: no === stage ? (over.files ?? [{ path: "docs/workshop/TEST-1/tz.md", label: "Spec", verdict: null as string | null }]) : [],
          progress: null, handover: null as { at: number; action: string; note: string; forced: boolean } | null,
        }))
      : [],
    events: [] as Array<{ at: number; kind: string; text: string }>,
    baseAhead: over.baseAhead ?? false,
    attempt: over.attempt === undefined ? null : over.attempt,
    sendBack: over.sendBack ?? { needsForce: false, fixForwardOffered: false },
    reconfirm: over.reconfirm ?? [],
    ownerNeeds: over.ownerNeeds ?? [],
    returnByReport: over.returnByReport ?? null,
    availability: over.availability ?? availability(),
    pilot: over.pilot ?? null,
    prUrl: over.prUrl ?? null,
    models: MODELS,
  };
};

/** A board with one card «Demo» and an open work; a click opens the work page. */
const openWork = async (view: ReturnType<typeof workView>, extra: Handlers = {}) => {
  const stage = view.work.stage;
  const slot = await mount({
    board: () => board([pcard("demo", { name: "Demo", column: COLUMN_OF_STAGE[stage], work: { id: "w1", key: view.work.key, stage, state: view.work.state, reason: view.work.reason, stale: false } })]),
    work: () => view,
    ...extra,
  });
  fireEvent.click(await slot.findByText("Demo"));
  await slot.findByText("Owner's request");
  return slot;
};

describe("workshop board", () => {
  it("board shows seven columns with «Mockup» and collapses «Retired»", async () => {
    const slot = await mount({
      board: () =>
        board([
          pcard("alpha", { name: "Alpha", labels: ["main branch ≠ rolled-out commit"] }),
          pcard("betta", { name: "Beta", column: "context", work: { id: "w2", key: "TEST-2", stage: 1, state: "agent", reason: "", stale: false } }),
          pcard("old1", { name: "Old1", column: "off", bbState: "disabled" }),
          pcard("old2", { name: "Old2", column: "off", bbState: "disabled" }),
          pcard("old3", { name: "Old3", column: "off", bbState: "not-installed", labels: ["not installed"] }),
        ]),
    });
    expect(await slot.findByText("Context · 1")).toBeTruthy();
    for (const t of ["Feasibility", "Spec", "Mockup", "Building", "In production · 1", "Retired · 3"]) expect(slot.getByText(t)).toBeTruthy();
    expect(slot.getAllByRole("heading", { level: 2 }).length).toBe(7);
    // The path in the header and the grid follow the server's columns: «Mockup» in the path, all seven columns in one row.
    expect(slot.getByText("Context → Feasibility → Spec → Mockup → Building → In production; you hand over each stage")).toBeTruthy();
    expect((slot.getByText("Alpha").closest(".grid") as HTMLElement).style.gridTemplateColumns).toBe("repeat(7, minmax(0, 1fr))");
    expect(slot.getByText("Alpha")).toBeTruthy();
    expect(slot.getByText("main branch ≠ rolled-out commit")).toBeTruthy();
    expect(slot.getByText("TEST-2 · Context")).toBeTruthy();
    // «Retired» is collapsed: no cards, but the count
    expect(slot.queryByText("Old1")).toBeNull();
    expect(slot.queryByText("Old3")).toBeNull();
    fireEvent.click(slot.getByText("Retired · 3"));
    expect(slot.getByText("Old1")).toBeTruthy();
    expect(slot.getByText("not installed")).toBeTruthy();
    fireEvent.click(slot.getByText("Retired · 3"));
    expect(slot.queryByText("Old1")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("puts a red frame on error, incompatible and missing plugins only, and says the bb state in words", async () => {
    const slot = await mount({
      board: () =>
        board([
          pcard("ok", { name: "Healthy" }),
          pcard("bad", { name: "Broken", bbState: "error" }),
          pcard("inc", { name: "Mismatch", bbState: "incompatible" }),
          pcard("gone", { name: "Vanished", bbState: "missing" }),
          pcard("conf", { name: "Configure", bbState: "needs-configuration", labels: ["needs configuration"] }),
        ]),
    });
    const frame = async (name: string) => (await slot.findByText(name)).closest("button")!.className;
    for (const n of ["Broken", "Mismatch", "Vanished"]) expect(await frame(n)).toContain("border-red-500");
    for (const n of ["Healthy", "Configure"]) expect(await frame(n)).not.toContain("border-red-500");
    for (const t of ["error", "incompatible", "folder missing", "running", "needs configuration"]) expect(slot.getAllByText(new RegExp(`● ${t}$`)).length).toBe(1);
    slot.lifecycle.unmount();
  });

  it("names the state of an installing work in words and shows the reason of a stuck one", async () => {
    const states: Array<[string, string]> = [
      ["locking", "waiting for the build lock"],
      ["installing", "installing"],
      ["unknown", "install outcome unknown"],
      ["unexpected", "working copy in an unexpected state"],
    ];
    const slot = await mount({
      board: () => board(states.map(([s], i) => pcard(`p${i}`, { name: `Plan${i}`, column: "live", work: { id: `w${i}`, key: `TEST-${i + 1}`, stage: 6, state: s, reason: `reason ${s}`, stale: false } }))),
    });
    for (const [s, text] of states) {
      expect(await slot.findByText(new RegExp(`● ${text}$`))).toBeTruthy();
      expect(slot.getByText(`reason ${s}`)).toBeTruthy();
    }
    slot.lifecycle.unmount();
  });

  it("shows a work whose creation is not finished, with its error, opens it and cancels the creation", async () => {
    const reason = "scaffold not created: bb plugin new failed";
    const view = workView({ created: false, key: null, stage: 1, state: "error", reason });
    const slot = await mount({
      board: () => board([pcard("fresh", { name: "Fresh", column: "context", bbState: "not-installed", work: { id: "w1", key: null, stage: 1, state: "error", reason, stale: false } })]),
      work: () => view,
      cancel: () => null,
    });
    expect(await slot.findByText("being created")).toBeTruthy();
    expect(slot.getByText(/● failed$/)).toBeTruthy();
    fireEvent.click(slot.getByText("Fresh"));
    await slot.findByText("Owner's request");
    expect((await slot.findAllByText(new RegExp(reason))).length).toBeGreaterThan(0);
    expect(slot.queryByText("Next")).toBeNull();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("not needed");
    fireEvent.click(slot.getByText("Cancel creation"));
    await waitFor(() => expect(calls(slot, "cancel").length).toBe(1));
    expect(calls(slot, "cancel")[0]!.input).toEqual({ workId: "w1", reason: "not needed" });
    prompt.mockRestore();
    slot.lifecycle.unmount();
  });

  it("reloads the board when the plugin signals a change", async () => {
    let n = 0;
    const slot = await mount({ board: () => board([n++ === 0 ? pcard("first", { name: "First" }) : pcard("second", { name: "Second" })]) });
    expect(await slot.findByText("First")).toBeTruthy();
    await slot.behavior.emitRealtime("plugin-workshop", { workId: null, pluginId: null });
    expect(await slot.findByText("Second")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});

describe("plugin summary", () => {
  const openSummary = async (view: ReturnType<typeof pluginView>, extra: Handlers = {}) => {
    const slot = await mount({ board: () => board([pcard("demo", { name: "Demo" })]), plugin: () => view, ...extra });
    fireEvent.click(await slot.findByText("Demo"));
    await slot.findByText("Working copy");
    return slot;
  };

  it("disabled «Rework» lists the reasons", async () => {
    const slot = await openSummary(pluginView({ dirtyCount: 4, reworkBlockers: ["4 uncommitted changes in the working copy", "the working copy is on branch feature/x, not main"] }));
    const rework = slot.getByText("Rework") as HTMLButtonElement;
    expect(rework.disabled).toBe(true);
    expect(slot.getByText("4 uncommitted changes in the working copy")).toBeTruthy();
    expect(slot.getByText("the working copy is on branch feature/x, not main")).toBeTruthy();
    fireEvent.click(rework);
    expect(slot.queryByLabelText("What to rework")).toBeNull();
    expect(calls(slot, "rework").length).toBe(0);
    slot.lifecycle.unmount();
  });

  it("shows the facts: source, working copy, rolled-out commit, last attempt and past tasks", async () => {
    const slot = await openSummary(
      pluginView({
        dirtyCount: 2,
        attempt: attempt({ kind: "rollback", status: "failed", step: "installed", error: "install failed" }),
        pastTasks: [{ key: "TEST-7", outcome: "done", finishedAt: 1_700_000_000_000 }, { key: "TEST-9", outcome: "canceled", finishedAt: null }],
      }),
    );
    expect(slot.getByText("path:/srv/plugins/bb-plugin-demo")).toBeTruthy();
    expect(slot.getByText("main")).toBeTruthy();
    expect(slot.getByText("abcdef1")).toBeTruthy();
    expect(slot.getByText("1234567")).toBeTruthy();
    expect(slot.getByText(/rollback · failed/)).toBeTruthy();
    expect(slot.getByText("install failed")).toBeTruthy();
    expect(slot.queryByText(/\(rollback point\)/)).toBeNull();
    expect(slot.getByText(/before the attempt 0000000 · target abcdef1/)).toBeTruthy();
    expect(slot.getByText(/TEST-7/)).toBeTruthy();
    expect(slot.getByText(/TEST-9/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("says «stale data» once, though the server also puts it into the labels", async () => {
    const slot = await openSummary(pluginView({ stateStale: true, labels: ["stale data"] }));
    expect(slot.getAllByText("stale data").length).toBe(1);
    slot.lifecycle.unmount();
  });

  it("calls the commit the «rollback point» only for a rollout attempt whose rollback is still available", async () => {
    const withPoint = await openSummary(pluginView({ attempt: attempt({ kind: "enter" }), availability: availability({ rollback: null }) }));
    expect(withPoint.queryByText("Adopt as rolled out…")).toBeNull();
    expect(withPoint.getByText(/\(rollback point\)/)).toBeTruthy();
    withPoint.lifecycle.unmount();
    const closed = await openSummary(pluginView({ attempt: attempt({ kind: "enter" }), availability: availability({ rollback: "the work added data migrations — rollback is impossible, only «Disable»" }) }));
    expect(closed.queryByText(/\(rollback point\)/)).toBeNull();
    expect(closed.getByText(/before the attempt 0000000 · target abcdef1/)).toBeTruthy();
    closed.lifecycle.unmount();
  });

  it("starts a rework from the summary and opens the created work", async () => {
    const slot = await openSummary(pluginView(), { rework: () => ({ workId: "w1", error: null }), work: () => workView({ stage: 1 }) });
    expect((slot.getByText("Rework") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(slot.getByText("Rework"));
    const go = slot.getByText("Start rework") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(slot.getByLabelText("What to rework"), { target: { value: "add an export" } });
    fireEvent.click(go);
    await waitFor(() => expect(calls(slot, "rework").length).toBe(1));
    expect(calls(slot, "rework")[0]!.input).toEqual({ pluginId: "demo", request: "add an export" });
    expect(await slot.findByText(/TEST-1 · Rework of plugin/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("opens a work whose creation failed and shows the error", async () => {
    const slot = await openSummary(pluginView(), {
      rework: () => ({ workId: "w1", error: "execution project not created" }),
      work: () => workView({ created: false, key: null, stage: 1, state: "error", reason: "execution project not created" }),
    });
    fireEvent.click(slot.getByText("Rework"));
    fireEvent.change(slot.getByLabelText("What to rework"), { target: { value: "add an export" } });
    fireEvent.click(slot.getByText("Start rework"));
    expect(await slot.findByText("Cancel creation")).toBeTruthy();
    expect((await slot.findAllByText(/execution project not created/)).length).toBeGreaterThan(0);
    slot.lifecycle.unmount();
  });

  it("shows the open work and goes to it", async () => {
    const withWork = { id: "w1", key: "TEST-5", stage: 4, state: "agent", reason: "", stale: false };
    const slot = await openSummary(pluginView({ work: withWork, reworkBlockers: ["work TEST-5 is already in progress"] }), { work: () => workView({ stage: 4 }) });
    fireEvent.click(slot.getByText("Open work"));
    expect(await slot.findByText(/TEST-1 · Rework of plugin/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("reloads on a signal about this plugin and ignores one about another", async () => {
    let n = 0;
    const slot = await openSummary(pluginView(), { plugin: () => pluginView({ branch: n++ === 0 ? "main" : "feature/x" }) });
    const loads = () => calls(slot, "plugin").length;
    const before = loads();
    await slot.behavior.emitRealtime("plugin-workshop", { workId: "w9", pluginId: "other" });
    expect(loads()).toBe(before);
    await slot.behavior.emitRealtime("plugin-workshop", { workId: null, pluginId: "demo" });
    expect(await slot.findByText("feature/x")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});

describe("plugin actions by availability", () => {
  const summary = async (av: ReturnType<typeof availability>, attemptOver: Attempt | null = null, extra: Handlers = {}) => {
    const view = pluginView({ availability: av, attempt: attemptOver });
    const slot = await mount({ board: () => board([pcard("demo", { name: "Demo" })]), plugin: () => view, ...extra });
    fireEvent.click(await slot.findByText("Demo"));
    await slot.findByText("Working copy");
    return slot;
  };

  it("«Adopt as rolled out» appears only when there is something to adopt and goes with a reason", async () => {
    const slot = await summary(availability({ adopt: null }), null, { adopt: () => null });
    fireEvent.click(slot.getByText("Adopt as rolled out…"));
    expect(slot.getByText(/record the previous rolled-out commit as the rollback point/)).toBeTruthy();
    const go = slot.getByText("Adopt as rolled out", { selector: "button" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(slot.getByLabelText("What the change is"), { target: { value: "hotfix of the export command, committed by hand" } });
    fireEvent.click(go);
    await waitFor(() => expect(calls(slot, "adopt").length).toBe(1));
    expect(calls(slot, "adopt")[0]!.input).toEqual({ pluginId: "demo", note: "hotfix of the export command, committed by hand" });
    slot.lifecycle.unmount();
  });

  it("rolls back only with a reason and says that the data stays", async () => {
    const slot = await summary(availability({ rollback: null }), attempt(), { rollback: () => null });
    expect((slot.getByText("Roll back…") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(slot.getByText("Roll back…"));
    expect(slot.getByText(/A rollback restores only the code, not the plugin's data/)).toBeTruthy();
    const go = slot.getByText("Roll back") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(slot.getByLabelText("Rollback reason"), { target: { value: "export is broken" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(calls(slot, "rollback").length).toBe(1));
    expect(calls(slot, "rollback")[0]!.input).toEqual({ pluginId: "demo", reason: "export is broken" });
    slot.lifecycle.unmount();
  });

  it("disables an unavailable action and gives its reason", async () => {
    const slot = await summary(availability({ rollback: "the work added data migrations — rollback is impossible, only «Disable»" }));
    expect((slot.getByText("Roll back…") as HTMLButtonElement).disabled).toBe(true);
    expect(slot.getByText(/data migrations — rollback is impossible/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows «Disable» for an enabled plugin and «Enable» for a disabled one, and sends the right switch", async () => {
    const on = await summary(availability({ disable: null, enable: "the plugin is already enabled" }), null, { setEnabled: () => null });
    expect((on.getByText("Disable") as HTMLButtonElement).disabled).toBe(false);
    expect(on.queryByText("Enable")).toBeNull();
    fireEvent.click(on.getByText("Disable"));
    await waitFor(() => expect(calls(on, "setEnabled").length).toBe(1));
    expect(calls(on, "setEnabled")[0]!.input).toEqual({ pluginId: "demo", on: false });
    on.lifecycle.unmount();
    const off = await summary(availability({ disable: "the plugin is already disabled", enable: null }), null, { setEnabled: () => null });
    expect((off.getByText("Enable") as HTMLButtonElement).disabled).toBe(false);
    expect(off.queryByText("Disable")).toBeNull();
    fireEvent.click(off.getByText("Enable"));
    await waitFor(() => expect(calls(off, "setEnabled").length).toBe(1));
    expect(calls(off, "setEnabled")[0]!.input).toEqual({ pluginId: "demo", on: true });
    off.lifecycle.unmount();
  });

  it("shows «Enable», not «Disable», for a disabled plugin even while an action is running, with the reason", async () => {
    const view = pluginView({ bbState: "disabled", availability: availability({ disable: "a rollout is in progress — wait", enable: "a rollout is in progress — wait", rollback: "a rollout is in progress — wait" }) });
    const slot = await mount({ board: () => board([pcard("demo", { name: "Demo" })]), plugin: () => view });
    fireEvent.click(await slot.findByText("Demo"));
    await slot.findByText("Working copy");
    expect((slot.getByText("Enable") as HTMLButtonElement).disabled).toBe(true);
    expect(slot.queryByText("Disable")).toBeNull();
    expect(slot.getByText("Enable: a rollout is in progress — wait")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("limits the reason of a rollback to 2000 characters", async () => {
    const slot = await summary(availability({ rollback: null }), attempt());
    fireEvent.click(slot.getByText("Roll back…"));
    expect((slot.getByLabelText("Rollback reason") as HTMLTextAreaElement).maxLength).toBe(2000);
    slot.lifecycle.unmount();
  });

  it("offers «Install again» only when the outcome is unknown", async () => {
    const plain = await summary(availability());
    expect(plain.queryByText("Install again")).toBeNull();
    plain.lifecycle.unmount();
    const unknown = await summary(availability({ reinstall: null }), attempt({ status: "unknown", step: "installed" }), { reinstall: () => null });
    fireEvent.click(unknown.getByText("Install again"));
    await waitFor(() => expect(calls(unknown, "reinstall").length).toBe(1));
    expect(calls(unknown, "reinstall")[0]!.input).toEqual({ pluginId: "demo" });
    unknown.lifecycle.unmount();
    // the outcome is unknown but a retry is closed (another install is running): the button is there, disabled, with the reason
    const busy = await summary(availability({ reinstall: "an install is running — wait or cancel it" }), attempt({ status: "unknown", step: "installed" }));
    expect((busy.getByText("Install again") as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAllByText(/an install is running — wait or cancel it/).length).toBeGreaterThan(0);
    busy.lifecycle.unmount();
  });

  it("offers «Try to cancel install» with a hint and promises nothing afterwards", async () => {
    const slot = await summary(availability({ cancelInstall: null }), null, { cancelInstall: () => null });
    expect(slot.getByText(/a running one may still finish installing — the card will show the outcome/)).toBeTruthy();
    const before = calls(slot, "plugin").length;
    fireEvent.click(slot.getByText("Try to cancel install"));
    await waitFor(() => expect(calls(slot, "cancelInstall").length).toBe(1));
    expect(calls(slot, "cancelInstall")[0]!.input).toEqual({ pluginId: "demo" });
    await waitFor(() => expect(calls(slot, "plugin").length).toBeGreaterThan(before));
    expect(slot.queryByText(/\bcancell?ed\b/i)).toBeNull();
    slot.lifecycle.unmount();
    const none = await summary(availability());
    expect(none.queryByText("Try to cancel install")).toBeNull();
    none.lifecycle.unmount();
  });

  it("shows a refusal of the server as an error and reloads", async () => {
    const slot = await summary(availability({ disable: null }), null, {
      setEnabled: () => {
        throw new Error("a rollout is in progress — wait");
      },
    });
    const before = calls(slot, "plugin").length;
    fireEvent.click(slot.getByText("Disable"));
    expect(await slot.findByText(/a rollout is in progress — wait/)).toBeTruthy();
    await waitFor(() => expect(calls(slot, "plugin").length).toBeGreaterThan(before));
    slot.lifecycle.unmount();
  });
});

describe("new plugin form", () => {
  const openForm = async (extra: Handlers = {}, props: { createSlowMs?: number } = {}) => {
    const slot = await mount({ board: () => board([]), ...extra }, props);
    fireEvent.click(await slot.findByText("New plugin"));
    return slot;
  };
  const fill = (slot: Slot, name: string, request: string) => {
    fireEvent.change(slot.getByLabelText("Name"), { target: { value: name } });
    fireEvent.change(slot.getByLabelText("Description"), { target: { value: request } });
  };

  it("new plugin form: models by group with a reasoning level, reviewers 0–2 — sent with the work", async () => {
    const slot = await openForm({ models: () => CATALOG, newPlugin: () => ({ workId: "w1", error: null }), work: () => workView({ stage: 1 }) });
    fill(slot, "Expense tracker", "count money");
    await slot.findByText("Agent models");
    fireEvent.change(slot.getByLabelText("Documents (Context, Feasibility, Spec, Mockup): model"), { target: { value: "claude-code|claude-sonnet-5-5" } });
    fireEvent.change(slot.getByLabelText("Documents (Context, Feasibility, Spec, Mockup): level"), { target: { value: "low" } });
    fireEvent.change(slot.getByLabelText("Reviewers: how many"), { target: { value: "1" } });
    fireEvent.change(slot.getByLabelText("Reviewer 1: model"), { target: { value: "codex|gpt-6-astra" } });
    expect(slot.queryByLabelText("Reviewer 2: model")).toBeNull();
    // Subagents are Claude only: Codex is not in their list.
    const sub = Array.from((slot.getByLabelText("Implementation subagents (task implementers): model") as HTMLSelectElement).querySelectorAll("option")).map((o) => o.textContent);
    expect(sub).toEqual(["Opus 5.5", "Sonnet 5.5", "Fable 5.1"]);
    fireEvent.click(slot.getByText("Create"));
    await waitFor(() => expect(calls(slot, "newPlugin").length).toBe(1));
    const input = calls(slot, "newPlugin")[0]!.input as { models: typeof MODELS };
    expect(input.models.docs).toEqual({ providerId: "claude-code", model: "claude-sonnet-5-5", effort: "low", label: "Sonnet 5.5" });
    expect(input.models.reviewers).toEqual([{ providerId: "codex", model: "gpt-6-astra", effort: null, label: "GPT-6-Astra" }]);
    expect(input.models.build).toEqual(MODELS.build);
    slot.lifecycle.unmount();
  });

  it("new plugin form suggests the id", async () => {
    const slot = await openForm({ newPlugin: () => ({ workId: "w1", error: null }), work: () => workView({ stage: 1 }) });
    const id = slot.getByLabelText("Id") as HTMLInputElement;
    fireEvent.change(slot.getByLabelText("Name"), { target: { value: "Expense tracker" } });
    expect(id.value).toBe("expense-tracker");
    fireEvent.change(id, { target: { value: "my-id" } });
    fireEvent.change(slot.getByLabelText("Name"), { target: { value: "Income tracker" } });
    expect(id.value).toBe("my-id");
    fireEvent.change(slot.getByLabelText("Description"), { target: { value: "count money" } });
    fireEvent.click(slot.getByText("Create"));
    await waitFor(() => expect(calls(slot, "newPlugin").length).toBe(1));
    expect(calls(slot, "newPlugin")[0]!.input).toEqual({ name: "Income tracker", id: "my-id", request: "count money" });
    expect(await slot.findByText(/TEST-1 · Rework of plugin/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("keeps «Create» closed until name, id and description are filled", async () => {
    const slot = await openForm();
    const go = slot.getByText("Create") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(slot.getByLabelText("Name"), { target: { value: "Budget" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(slot.getByLabelText("Description"), { target: { value: "x" } });
    expect(go.disabled).toBe(false);
    fireEvent.change(slot.getByLabelText("Id"), { target: { value: "" } });
    expect(go.disabled).toBe(true);
    slot.lifecycle.unmount();
  });

  it("puts the server's problems under the fields they belong to", async () => {
    const slot = await openForm({
      newPlugin: () => {
        throw new Error("id status is taken by a bb command — choose another one; a description is required: what the plugin should do; something else");
      },
    });
    fill(slot, "Status", "x");
    fireEvent.click(slot.getByText("Create"));
    const under = async (field: string) =>
      (
        await waitFor(() => {
          const el = slot.container.querySelector(`[data-field="${field}"] [role="alert"]`);
          expect(el).not.toBeNull();
          return el!;
        })
      ).textContent;
    expect(await under("id")).toBe("id status is taken by a bb command — choose another one");
    expect(await under("request")).toBe("a description is required: what the plugin should do");
    expect(slot.container.querySelector('[data-field="name"] [role="alert"]')).toBeNull();
    expect(slot.getByText("something else")).toBeTruthy();
    // the form stays: it can be corrected and sent again
    expect((slot.getByLabelText("Id") as HTMLInputElement).value).toBe("status");
    slot.lifecycle.unmount();
  });

  it("does not wait forever for a slow creation: the board shows it and the finished work opens by itself", async () => {
    let finish: (v: { workId: string; error: string | null }) => void = () => undefined;
    const slow = new Promise<{ workId: string; error: string | null }>((r) => (finish = r));
    const slot = await openForm({ newPlugin: () => slow, work: () => workView({ stage: 1 }) }, { createSlowMs: 20 });
    fill(slot, "Expense tracker", "count");
    fireEvent.click(slot.getByText("Create"));
    expect(await slot.findByText(/«Expense tracker» is being created/)).toBeTruthy();
    expect(slot.queryByLabelText("Name")).toBeNull();
    expect(slot.getByText("New plugin")).toBeTruthy();
    finish({ workId: "w1", error: null });
    expect(await slot.findByText(/TEST-1 · Rework of plugin/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows the error of a slow creation that failed with a work number, and opens that work", async () => {
    let finish: (v: { workId: string; error: string | null }) => void = () => undefined;
    const slow = new Promise<{ workId: string; error: string | null }>((r) => (finish = r));
    const slot = await openForm(
      { newPlugin: () => slow, work: () => workView({ created: false, key: null, stage: 1, state: "error", reason: "git init failed" }) },
      { createSlowMs: 20 },
    );
    fill(slot, "Budget", "count");
    fireEvent.click(slot.getByText("Create"));
    await slot.findByText(/«Budget» is being created/);
    finish({ workId: "w1", error: "git init failed" });
    expect(await slot.findByText("Cancel creation")).toBeTruthy();
    expect((await slot.findAllByText(/git init failed/)).length).toBeGreaterThan(0);
    slot.lifecycle.unmount();
  });

  it("brings the form back with everything typed and the error under the field when a slow creation is refused", async () => {
    let fail: (e: Error) => void = () => undefined;
    const slow = new Promise<{ workId: string; error: string | null }>((_, r) => (fail = r));
    const slot = await openForm({ newPlugin: () => slow }, { createSlowMs: 20 });
    fill(slot, "Status", "show the status");
    fireEvent.change(slot.getByLabelText("Id"), { target: { value: "status" } });
    fireEvent.click(slot.getByText("Create"));
    await slot.findByText(/«Status» is being created/);
    expect(slot.queryByLabelText("Name")).toBeNull();
    fail(new Error("id status is taken by a bb command — choose another one"));
    expect((await slot.findByLabelText("Name") as HTMLInputElement).value).toBe("Status");
    expect((slot.getByLabelText("Id") as HTMLInputElement).value).toBe("status");
    expect((slot.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("show the status");
    expect(slot.container.querySelector('[data-field="id"] [role="alert"]')!.textContent).toBe("id status is taken by a bb command — choose another one");
    expect(slot.getByText("Creation of «Status»: the work was not recorded: id status is taken by a bb command — choose another one")).toBeTruthy();
    expect(slot.queryByText(/«Status» is being created/)).toBeNull();
    expect(calls(slot, "newPlugin").length).toBe(1);
    slot.lifecycle.unmount();
  });

  it("keeps the refused draft for a panel that is closed and shows it on return", async () => {
    let fail: (e: Error) => void = () => undefined;
    const slow = new Promise<{ workId: string; error: string | null }>((_, r) => (fail = r));
    const slot = await mount(
      {
        board: () => board([pcard("other", { name: "Other" })]),
        plugin: () => pluginView({ id: "other", name: "Other" }),
        newPlugin: () => slow,
      },
      { createSlowMs: 20 },
    );
    fireEvent.click(await slot.findByText("New plugin"));
    fill(slot, "Status", "show the status");
    fireEvent.click(slot.getByText("Create"));
    await slot.findByText(/«Status» is being created/);
    fireEvent.click(slot.getByText("Other"));
    await slot.findByText("Working copy");
    fail(new Error("a description is required: what the plugin should do"));
    await waitFor(() => expect(slot.queryByText(/«Status» is being created/)).toBeNull());
    fireEvent.click(slot.getByText("← Board"));
    expect((await slot.findByLabelText("Name") as HTMLInputElement).value).toBe("Status");
    expect(slot.container.querySelector('[data-field="request"] [role="alert"]')!.textContent).toBe("a description is required: what the plugin should do");
    slot.lifecycle.unmount();
  });

  it("does not overwrite a form the owner has started meanwhile; the refused draft comes back by the button", async () => {
    let fail: (e: Error) => void = () => undefined;
    const slow = new Promise<{ workId: string; error: string | null }>((_, r) => (fail = r));
    const slot = await openForm({ newPlugin: () => slow }, { createSlowMs: 20 });
    fill(slot, "Status", "show the status");
    fireEvent.click(slot.getByText("Create"));
    await slot.findByText(/«Status» is being created/);
    fireEvent.click(slot.getByText("New plugin"));
    fill(slot, "Mail", "read mail");
    fail(new Error("id status is taken by a bb command — choose another one"));
    await slot.findByText("Creation of «Status»: the work was not recorded: id status is taken by a bb command — choose another one");
    expect((slot.getByLabelText("Name") as HTMLInputElement).value).toBe("Mail");
    fireEvent.click(slot.getByText("Restore what you typed"));
    expect((slot.getByLabelText("Name") as HTMLInputElement).value).toBe("Status");
    slot.lifecycle.unmount();
  });

  it("offers the typed text back after an unclear failure without reopening the form behind the owner's back", async () => {
    let fail: (e: Error) => void = () => undefined;
    const slow = new Promise<{ workId: string; error: string | null }>((_, r) => (fail = r));
    const slot = await openForm({ newPlugin: () => slow }, { createSlowMs: 20 });
    fill(slot, "Budget", "count");
    fireEvent.click(slot.getByText("Create"));
    await slot.findByText(/«Budget» is being created/);
    fail(new Error("call timed out"));
    await slot.findByText(/Creation of «Budget» is not confirmed: call timed out/);
    expect(slot.queryByLabelText("Name")).toBeNull();
    fireEvent.click(slot.getByText("Restore what you typed"));
    expect((slot.getByLabelText("Name") as HTMLInputElement).value).toBe("Budget");
    expect((slot.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("count");
    slot.lifecycle.unmount();
  });

  it("shows a slow creation's rejection on the board instead of hanging", async () => {
    let fail: (e: Error) => void = () => undefined;
    const slow = new Promise<{ workId: string; error: string | null }>((_, r) => (fail = r));
    const slot = await openForm({ newPlugin: () => slow }, { createSlowMs: 20 });
    fill(slot, "Budget", "count");
    fireEvent.click(slot.getByText("Create"));
    await slot.findByText(/«Budget» is being created/);
    fail(new Error("call timed out"));
    expect(await slot.findByText(/Creation of «Budget» is not confirmed: call timed out/)).toBeTruthy();
    expect(slot.queryByText(/«Budget» is being created/)).toBeNull();
    slot.lifecycle.unmount();
  });
});

describe("work page", () => {
  it("shows the stage tabs and opens a file of the stage", async () => {
    const slot = await openWork(workView({ stage: 3, files: [{ path: "docs/workshop/TEST-1/tz.md", label: "Spec", verdict: "blocking" }] }), {
      file: () => ({ mime: "text/markdown", text: "Work plan", data: null, size: 5 }),
    });
    for (const t of ["1. Context", "2. Feasibility", "3. Spec", "4. Implementation", "5. Verification", "6. Rollout"]) expect(slot.getByText(t)).toBeTruthy();
    expect(slot.getByText("blocking findings")).toBeTruthy();
    fireEvent.click(slot.getByText("Spec"));
    expect(await slot.findByText("Work plan")).toBeTruthy();
    expect(calls(slot, "file")[0]!.input).toEqual({ workId: "w1", path: "docs/workshop/TEST-1/tz.md" });
    slot.lifecycle.unmount();
  });

  it("«Autopilot»: a tab on Context starts it with what matters; the banner on every stage stops and resumes it", async () => {
    const slot = await openWork(workView({ stage: 1 }));
    expect(slot.queryByText("Orchestrator chat")).toBeNull();
    fireEvent.click(slot.getByText("Autopilot"));
    expect(slot.getByText(/The orchestrator runs the work to the end in your place/)).toBeTruthy();
    fireEvent.change(slot.getByPlaceholderText(/Optional/), { target: { value: "no paid services" } });
    fireEvent.click(slot.getByText("Start autopilot"));
    await waitFor(() => expect(calls(slot, "pilotStart")).toHaveLength(1));
    expect(calls(slot, "pilotStart")[0]!.input).toEqual({ workId: "w1", notes: "no paid services" });
    slot.lifecycle.unmount();

    const on = await openWork(workView({ stage: 4, pilot: pilotOf(), prUrl: "https://github.com/acme/bb-plugin-demo/pull/1" }));
    expect(on.getByText("The autopilot is running this work: any button below pauses it.")).toBeTruthy();
    expect(on.getByText("PR on GitHub").getAttribute("href")).toBe("https://github.com/acme/bb-plugin-demo/pull/1");
    fireEvent.click(on.getByText("Orchestrator chat"));
    expect(on.getByText("Autopilot orchestrator")).toBeTruthy();
    fireEvent.click(on.getByText("Stop autopilot"));
    await waitFor(() => expect(calls(on, "pilotStop")).toHaveLength(1));
    on.lifecycle.unmount();

    const paused = await openWork(workView({ stage: 4, pilot: pilotOf({ state: "paused", reason: "the owner pressed «Next»" }) }));
    expect(paused.getByText("the owner pressed «Next»")).toBeTruthy();
    fireEvent.click(paused.getByText("Resume autopilot"));
    await waitFor(() => expect(calls(paused, "pilotResume")).toHaveLength(1));
    paused.lifecycle.unmount();

    const done = await openWork(workView({ stage: 1, pilot: pilotOf({ state: "done", report: "Done: a notes section." }) }));
    fireEvent.click(done.getByRole("button", { name: "Autopilot" }));
    expect(done.getByText("Autopilot report")).toBeTruthy();
    expect(done.getByText("Done: a notes section.")).toBeTruthy();
    done.lifecycle.unmount();
  });

  it("«Mockup»: «Approve mockup», send back only to earlier stages by work order, the mockup in a sandbox", async () => {
    const path = "docs/workshop/TEST-1/mockup/index.html";
    const view = workView({ stage: 7, order: [1, 2, 3, 7, 4, 5, 6], files: [{ path, label: "Mockup", verdict: null }] });
    const slot = await openWork(view, { file: () => ({ mime: "text/html", text: "<html><body>mockup of the panel</body></html>", data: null, size: 40 }) });
    for (const t of ["1. Context", "3. Spec", "4. Mockup", "5. Implementation", "7. Rollout"]) expect(slot.getByText(t)).toBeTruthy();
    expect(slot.getByText("Approve mockup")).toBeTruthy();
    expect(slot.getByText("Cancel work")).toBeTruthy();
    fireEvent.click(slot.getByText("Mockup"));
    const frame = await waitFor(() => {
      const f = slot.container.querySelector(`iframe[title="${path}"]`) as HTMLIFrameElement | null;
      if (!f) throw new Error("no iframe");
      return f;
    });
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("mockup of the panel");
    // The CSP comes first: before anything of the mockup, so the parser puts it into the head; standards mode.
    expect(frame.getAttribute("srcdoc")!.startsWith(`<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">`)).toBe(true);
    fireEvent.click(slot.getByText("Send back…"));
    const options = Array.from((slot.getByLabelText("Send back to stage") as HTMLSelectElement).querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["1. Context", "2. Feasibility", "3. Spec"]);
    slot.lifecycle.unmount();
  });

  it("the mockup preview: a CSP that blocks the network; a mockup that navigates its frame away is not shown again", async () => {
    const path = "docs/workshop/TEST-1/mockup/index.html";
    const view = workView({ stage: 7, order: [1, 2, 3, 7, 4, 5, 6], files: [{ path, label: "Mockup", verdict: null }] });
    const html = "<!-- <head> --><html lang=\"en\"><body><script>location.href = 'https://example.invalid/?' + document.body.innerText</script>panel</body></html>";
    const slot = await openWork(view, { file: () => ({ mime: "text/html", text: html, data: null, size: html.length }) });
    fireEvent.click(slot.getByText("Mockup"));
    const frame = await waitFor(() => {
      const f = slot.container.querySelector(`iframe[title="${path}"]`) as HTMLIFrameElement | null;
      if (!f) throw new Error("no iframe");
      return f;
    });
    // The fake <head> inside a comment does not take the CSP with it: the meta is in front of everything.
    expect(frame.getAttribute("srcdoc")).toBe(`<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">${html}`);
    for (const d of ["default-src 'none'", "connect-src 'none'", "img-src data: blob:", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) expect(MOCKUP_CSP).toContain(d);
    expect(MOCKUP_CSP).not.toMatch(/https?:|\*/);
    // The first load (the document itself; jsdom loads the frame on its own): the preview stays.
    await waitFor(() => expect(frame.contentDocument?.readyState).toBe("complete"));
    await new Promise((r) => setTimeout(r, 10));
    expect(slot.container.querySelector(`iframe[title="${path}"]`)).not.toBeNull();
    // The second load: the mockup navigated its own frame away — the preview is replaced with a notice.
    fireEvent.load(frame);
    await waitFor(() => expect(slot.getByText(/The mockup navigated away from its own page/)).toBeTruthy());
    expect(slot.container.querySelector(`iframe[title="${path}"]`)).toBeNull();
    slot.lifecycle.unmount();
  });

  it("withMockupCsp: the mockup's own doctype is replaced, a legacy one included; the rest is kept as it is", () => {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">`;
    expect(withMockupCsp("<!doctype html><html><head><title>x</title></head></html>")).toBe(`<!DOCTYPE html>${meta}<html><head><title>x</title></head></html>`);
    expect(withMockupCsp('\uFEFF <!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><p>x</p>')).toBe(`<!DOCTYPE html>${meta}<p>x</p>`);
    expect(withMockupCsp("<p>x</p>")).toBe(`<!DOCTYPE html>${meta}<p>x</p>`);
  });

  it("offers the buttons of each stage and no others", async () => {
    const table: Array<{ stage: number; has: string[]; hasNot: string[] }> = [
      { stage: 1, has: ["Next", "Cancel work"], hasNot: ["Send to review", "To verification", "Roll out", "Accept", "Send back…"] },
      { stage: 2, has: ["Next", "Send back…", "Cancel work"], hasNot: ["Send to review", "To verification", "Roll out", "Accept"] },
      { stage: 3, has: ["Next", "Send to review", "Send back…", "Cancel work"], hasNot: ["To verification", "Roll out", "Accept"] },
      { stage: 4, has: ["To verification", "Send back…", "Cancel work"], hasNot: ["Next", "Send to review", "Roll out", "Accept"] },
      { stage: 5, has: ["Send to review", "Roll out", "Send back…", "Cancel work"], hasNot: ["Next", "To verification", "Accept"] },
      { stage: 6, has: ["Accept", "Send back…"], hasNot: ["Next", "Send to review", "To verification", "Roll out", "Cancel work"] },
    ];
    for (const row of table) {
      const slot = await openWork(workView({ stage: row.stage, attempt: row.stage === 6 ? attempt() : null }));
      for (const t of row.has) expect(slot.queryByText(t), `stage ${row.stage}: has «${t}»`).not.toBeNull();
      for (const t of row.hasNot) expect(slot.queryByText(t), `stage ${row.stage}: no «${t}»`).toBeNull();
      slot.lifecycle.unmount();
    }
  });

  it("keeps the forward button disabled while the view has blockers and shows blockers and warnings above it", async () => {
    const slot = await openWork(workView({ blockers: ["no plan"], warnings: ["2 of 5 plan tasks done"] }));
    expect(slot.getByText(/no plan/)).toBeTruthy();
    expect(slot.getByText(/2 of 5 plan tasks done/)).toBeTruthy();
    expect((slot.getByText("Next") as HTMLButtonElement).disabled).toBe(true);
    expect(slot.queryByText("Hand over anyway")).toBeNull();
    expect(slot.getByText(/HEAD abcdef1/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("offers a forced hand-over only after the server answered with warnings, and sends the shown version", async () => {
    const answers = [
      { ok: false, blockers: [], warnings: ["Fable: blocking findings"] },
      { ok: true, blockers: [], warnings: [] },
    ];
    const slot = await openWork(workView({}), { handOver: () => answers.shift() });
    expect(slot.queryByText("Hand over anyway")).toBeNull();
    fireEvent.change(slot.getByLabelText("Note"), { target: { value: "taking it as is" } });
    fireEvent.click(slot.getByText("Next"));
    fireEvent.click(await slot.findByText("Hand over anyway"));
    await waitFor(() => expect(calls(slot, "handOver").length).toBe(2));
    const sent = calls(slot, "handOver").map((c) => c.input);
    expect(sent[0]).toEqual({ workId: "w1", expectedStage: 2, expectedVersion: version, note: "taking it as is", force: false });
    expect(sent[1]).toEqual({ workId: "w1", expectedStage: 2, expectedVersion: version, note: "taking it as is", force: true });
    slot.lifecycle.unmount();
  });

  it("enter sends the version from the screen", async () => {
    const slot = await openWork(workView({ stage: 5 }), { enter: () => ({ ok: true, blockers: [], warnings: [] }) });
    fireEvent.click(slot.getByText("Roll out"));
    await waitFor(() => expect(calls(slot, "enter").length).toBe(1));
    expect(calls(slot, "enter")[0]!.input).toEqual({ workId: "w1", expectedVersion: version, force: false });
    expect(calls(slot, "handOver").length).toBe(0);
    slot.lifecycle.unmount();
  });

  it("does not let enter go without a version, and forces it only after warnings", async () => {
    const none = await openWork(workView({ stage: 5, version: null }));
    expect((none.getByText("Roll out") as HTMLButtonElement).disabled).toBe(true);
    none.lifecycle.unmount();
    const answers = [
      { ok: false, blockers: [], warnings: ["Astra: blocking findings"] },
      { ok: true, blockers: [], warnings: [] },
    ];
    const slot = await openWork(workView({ stage: 5 }), { enter: () => answers.shift() });
    fireEvent.click(slot.getByText("Roll out"));
    fireEvent.click(await slot.findByText("Hand over anyway"));
    await waitFor(() => expect(calls(slot, "enter").length).toBe(2));
    expect(calls(slot, "enter").map((c) => c.input)).toEqual([
      { workId: "w1", expectedVersion: version, force: false },
      { workId: "w1", expectedVersion: version, force: true },
    ]);
    slot.lifecycle.unmount();
  });

  it("accept sends version and attempt id", async () => {
    const slot = await openWork(workView({ stage: 6, attempt: attempt({ id: "att_77" }) }), { accept: () => ({ ok: true, blockers: [], warnings: [] }) });
    fireEvent.change(slot.getByLabelText("Note"), { target: { value: "all works" } });
    fireEvent.click(slot.getByText("Accept"));
    await waitFor(() => expect(calls(slot, "accept").length).toBe(1));
    expect(calls(slot, "accept")[0]!.input).toEqual({ workId: "w1", expectedVersion: version, attemptId: "att_77", force: false, note: "all works" });
    slot.lifecycle.unmount();
  });

  it("accepts anyway only after the server answered with warnings", async () => {
    const answers = [
      { ok: false, blockers: [], warnings: ["the live check is red — accept anyway?"] },
      { ok: true, blockers: [], warnings: [] },
    ];
    const slot = await openWork(workView({ stage: 6, attempt: attempt({ id: "att_5" }) }), { accept: () => answers.shift() });
    expect(slot.queryByText("Accept anyway")).toBeNull();
    fireEvent.click(slot.getByText("Accept"));
    fireEvent.click(await slot.findByText("Accept anyway"));
    await waitFor(() => expect(calls(slot, "accept").length).toBe(2));
    expect(calls(slot, "accept").map((c) => (c.input as { force: boolean }).force)).toEqual([false, true]);
    expect((calls(slot, "accept")[1]!.input as { attemptId: string }).attemptId).toBe("att_5");
    slot.lifecycle.unmount();
  });

  it("does not offer «Accept» without an attempt to accept", async () => {
    const slot = await openWork(workView({ stage: 6, attempt: null }));
    expect((slot.getByText("Accept") as HTMLButtonElement).disabled).toBe(true);
    slot.lifecycle.unmount();
  });

  it("stage 6 shows rollback and disable by availability, and the attempt", async () => {
    const slot = await openWork(
      workView({ stage: 6, attempt: attempt({ status: "failed", step: "checked", error: "the plugin is not in the expected state" }), availability: availability({ rollback: null, disable: null, cancelInstall: null }) }),
      { rollback: () => null, setEnabled: () => null },
    );
    expect((slot.getByText("Roll back…") as HTMLButtonElement).disabled).toBe(false);
    expect((slot.getByText("Disable") as HTMLButtonElement).disabled).toBe(false);
    expect(slot.getByText("Try to cancel install")).toBeTruthy();
    expect(slot.queryByText("Install again")).toBeNull();
    expect(slot.getByText(/rollout · failed/)).toBeTruthy();
    fireEvent.click(slot.getByText("Roll back…"));
    expect(slot.getByText(/A rollback restores only the code, not the plugin's data/)).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Rollback reason"), { target: { value: "did not come up" } });
    fireEvent.click(slot.getByText("Roll back"));
    await waitFor(() => expect(calls(slot, "rollback").length).toBe(1));
    expect(calls(slot, "rollback")[0]!.input).toEqual({ pluginId: "demo", reason: "did not come up" });
    slot.lifecycle.unmount();
    const closed = await openWork(
      workView({ stage: 6, attempt: attempt(), availability: availability({ rollback: "the work added data migrations — rollback is impossible, only «Disable»", disable: "a rollout is in progress — wait" }) }),
    );
    expect((closed.getByText("Roll back…") as HTMLButtonElement).disabled).toBe(true);
    expect((closed.getByText("Disable") as HTMLButtonElement).disabled).toBe(true);
    expect(closed.getByText(/data migrations — rollback is impossible/)).toBeTruthy();
    closed.lifecycle.unmount();
  });

  it("shows the plugin actions on stage 5 only when this work has an attempt", async () => {
    const without = await openWork(workView({ stage: 5, attempt: null }));
    expect(without.queryByText("Roll back…")).toBeNull();
    without.lifecycle.unmount();
    const withAttempt = await openWork(workView({ stage: 5, attempt: attempt({ status: "unknown", step: "installed" }), availability: availability({ reinstall: null }) }));
    expect(withAttempt.getByText("Install again")).toBeTruthy();
    withAttempt.lifecycle.unmount();
  });

  it("sends back to an earlier stage only with a reason", async () => {
    const slot = await openWork(workView({}), { sendBack: () => null });
    fireEvent.click(slot.getByText("Send back…"));
    const go = slot.getByText("Send back") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(slot.getByLabelText("Send back to stage"), { target: { value: "1" } });
    fireEvent.change(slot.getByLabelText("Reason for sending back"), { target: { value: "the spec has no boundaries" } });
    expect(go.disabled).toBe(false);
    expect(slot.queryByLabelText(/Fix forward/)).toBeNull();
    fireEvent.click(go);
    await waitFor(() => expect(calls(slot, "sendBack").length).toBe(1));
    expect(calls(slot, "sendBack")[0]!.input).toEqual({ workId: "w1", expectedStage: 2, toStage: 1, reason: "the spec has no boundaries" });
    slot.lifecycle.unmount();
  });

  it("offers «Fix forward» from stage 6 by the server's flag, unticked, and sends only fixForward without a failure", async () => {
    const slot = await openWork(workView({ stage: 6, attempt: attempt(), sendBack: { needsForce: false, fixForwardOffered: true } }), { sendBack: () => null });
    fireEvent.click(slot.getByText("Send back…"));
    const fix = slot.getByLabelText(/Fix forward/) as HTMLInputElement;
    expect(fix.checked).toBe(false);
    fireEvent.change(slot.getByLabelText("Send back to stage"), { target: { value: "4" } });
    fireEvent.change(slot.getByLabelText("Reason for sending back"), { target: { value: "fix the migration" } });
    const go = slot.getByText("Send back") as HTMLButtonElement;
    // until the box is ticked there is nothing to send: the server would refuse
    expect(go.disabled).toBe(true);
    expect(slot.queryByText("Hand over anyway")).toBeNull();
    fireEvent.click(fix);
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(calls(slot, "sendBack").length).toBe(1));
    expect(calls(slot, "sendBack")[0]!.input).toEqual({ workId: "w1", expectedStage: 6, toStage: 4, reason: "fix the migration", fixForward: true });
    slot.lifecycle.unmount();
  });

  it("stage 6 after a failure shows «Hand over anyway» by the flag, without a prior refusal, and sends force with fixForward", async () => {
    const slot = await openWork(workView({ stage: 6, attempt: attempt({ status: "failed", step: "checked" }), sendBack: { needsForce: true, fixForwardOffered: true } }), { sendBack: () => null });
    fireEvent.click(slot.getByText("Send back…"));
    expect(slot.queryByText("Send back")).toBeNull();
    const go = slot.getByText("Hand over anyway") as HTMLButtonElement;
    const fix = slot.getByLabelText(/Fix forward/) as HTMLInputElement;
    expect(fix.checked).toBe(false);
    fireEvent.change(slot.getByLabelText("Reason for sending back"), { target: { value: "fix the migration" } });
    expect(go.disabled).toBe(true);
    fireEvent.click(fix);
    expect(go.disabled).toBe(false);
    // the box is unticked — nothing to send
    fireEvent.click(fix);
    expect(go.disabled).toBe(true);
    fireEvent.click(fix);
    fireEvent.click(go);
    await waitFor(() => expect(calls(slot, "sendBack").length).toBe(1));
    expect(calls(slot, "sendBack")[0]!.input).toEqual({ workId: "w1", expectedStage: 6, toStage: 4, reason: "fix the migration", fixForward: true, force: true });
    slot.lifecycle.unmount();
  });

  it("stage 5 after a failed enter offers the same variant by the flag, before any refusal", async () => {
    const slot = await openWork(workView({ stage: 5, attempt: attempt({ status: "unknown", step: "installed" }), sendBack: { needsForce: true, fixForwardOffered: true } }), { sendBack: () => null });
    fireEvent.click(slot.getByText("Send back…"));
    fireEvent.change(slot.getByLabelText("Send back to stage"), { target: { value: "4" } });
    fireEvent.change(slot.getByLabelText("Reason for sending back"), { target: { value: "fixing forward" } });
    fireEvent.click(slot.getByLabelText(/Fix forward/));
    fireEvent.click(slot.getByText("Hand over anyway"));
    await waitFor(() => expect(calls(slot, "sendBack").length).toBe(1));
    expect(calls(slot, "sendBack")[0]!.input).toEqual({ workId: "w1", expectedStage: 5, toStage: 4, reason: "fixing forward", fixForward: true, force: true });
    slot.lifecycle.unmount();
  });

  it("does not guess from the error text: without the flag a refusal is just an error", async () => {
    const slot = await openWork(workView({ stage: 6, attempt: attempt({ kind: "rollback", status: "done" }) }), {
      sendBack: () => {
        throw new Error("the rollout failed — «Roll back», «Disable» or «Fix forward» via «Hand over anyway»");
      },
    });
    fireEvent.click(slot.getByText("Send back…"));
    fireEvent.change(slot.getByLabelText("Reason for sending back"), { target: { value: "x" } });
    fireEvent.click(slot.getByText("Send back"));
    expect(await slot.findByText(/the rollout failed — «Roll back»/)).toBeTruthy();
    expect(slot.queryByText("Hand over anyway")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("does not offer «Fix forward» after a finished rollback", async () => {
    const slot = await openWork(workView({ stage: 6, attempt: attempt({ kind: "rollback", status: "done" }) }), { sendBack: () => null });
    fireEvent.click(slot.getByText("Send back…"));
    expect(slot.queryByLabelText(/Fix forward/)).toBeNull();
    fireEvent.change(slot.getByLabelText("Reason for sending back"), { target: { value: "after the rollback" } });
    fireEvent.click(slot.getByText("Send back"));
    await waitFor(() => expect(calls(slot, "sendBack").length).toBe(1));
    expect(calls(slot, "sendBack")[0]!.input).toEqual({ workId: "w1", expectedStage: 6, toStage: 4, reason: "after the rollback" });
    slot.lifecycle.unmount();
  });

  it("unticks «Fix forward» when the attempt changes, so a new failure is never forced by an old tick", async () => {
    let n = 0;
    const slot = await openWork(workView({ stage: 6, attempt: attempt({ id: "att_1", status: "failed" }), sendBack: { needsForce: true, fixForwardOffered: true } }), {
      work: () => workView({ stage: 6, attempt: attempt({ id: n++ === 0 ? "att_1" : "att_2", status: "failed" }), sendBack: { needsForce: true, fixForwardOffered: true } }),
    });
    fireEvent.click(slot.getByText("Send back…"));
    const fix = () => slot.getByLabelText(/Fix forward/) as HTMLInputElement;
    fireEvent.click(fix());
    expect(fix().checked).toBe(true);
    await slot.behavior.emitRealtime("plugin-workshop", { workId: "w1", pluginId: "demo" });
    await waitFor(() => expect(calls(slot, "work").length).toBeGreaterThan(1));
    await waitFor(() => expect(fix().checked).toBe(false));
    slot.lifecycle.unmount();
  });

  it("cancel: the reason is limited to 2000 characters and a longer one is not sent", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("я".repeat(2001));
    const slot = await openWork(workView({ stage: 4 }), { cancel: () => null });
    fireEvent.click(slot.getByText("Cancel work"));
    expect(await slot.findByText(/The reason must be up to 2000 characters, now 2001/)).toBeTruthy();
    expect(calls(slot, "cancel").length).toBe(0);
    prompt.mockReturnValue("я".repeat(2000));
    fireEvent.click(slot.getByText("Cancel work"));
    await waitFor(() => expect(calls(slot, "cancel").length).toBe(1));
    prompt.mockRestore();
    slot.lifecycle.unmount();
  });

  it("restarts a stage only when the server says it needs it", async () => {
    const errored = await openWork(workView({ state: "error" }));
    expect(errored.queryByText("Restart stage")).toBeNull();
    errored.lifecycle.unmount();
    const fallen = await openWork(workView({ canRestart: true }), { restartStage: () => null });
    fireEvent.click(fallen.getByText("Restart stage"));
    await waitFor(() => expect(calls(fallen, "restartStage").length).toBe(1));
    expect(calls(fallen, "restartStage")[0]!.input).toEqual({ workId: "w1", expectedStage: 2 });
    fallen.lifecycle.unmount();
  });

  it("asks for reviews by hand when none ran; while reviewers work it offers only to stop them", async () => {
    const first = await openWork(workView({ stage: 3 }), { review: () => null });
    fireEvent.click(first.getByText("Send to review"));
    await waitFor(() => expect(calls(first, "review").length).toBe(1));
    expect(calls(first, "review")[0]!.input).toEqual({ workId: "w1", expectedStage: 3 });
    first.lifecycle.unmount();
    const view = workView({ stage: 3 });
    view.stages[2]!.threads.push({ threadId: "r1", role: "review", who: "Fable 5.1", round: 1, status: "active", done: false, invalid: null });
    const slot = await openWork(view, { review: () => null, stopReviews: () => null });
    expect((slot.getByText("Another review round") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(slot.getByText("Stop reviewers"));
    await waitFor(() => expect(calls(slot, "stopReviews").length).toBe(1));
    expect(calls(slot, "stopReviews")[0]!.input).toEqual({ workId: "w1", expectedStage: 3 });
    slot.lifecycle.unmount();
  });

  it("sends back to Implementation by the report in one click, fixing forward at «Rollout»", async () => {
    const reason = "Verification, round 1: FAIL. Fix everything the report `.superpowers/workshop/TEST-1/verify-r1.md` calls a failure or a confirmed review finding.";
    const slot = await openWork(workView({ stage: 5, blockers: ["verification is red — send it back to Implementation"], returnByReport: { toStage: 4, reason, fixForward: false } }), { sendBack: () => null });
    fireEvent.click(slot.getByText("Send back to Implementation per report"));
    await waitFor(() => expect(calls(slot, "sendBack").length).toBe(1));
    expect(calls(slot, "sendBack")[0]!.input).toEqual({ workId: "w1", expectedStage: 5, toStage: 4, reason });
    slot.lifecycle.unmount();
    const live = await openWork(workView({ stage: 6, attempt: attempt(), returnByReport: { toStage: 4, reason: "live FAIL", fixForward: true } }), { sendBack: () => null });
    fireEvent.click(live.getByText("Fix forward per report"));
    await waitFor(() => expect(calls(live, "sendBack").length).toBe(1));
    expect(calls(live, "sendBack")[0]!.input).toEqual({ workId: "w1", expectedStage: 6, toStage: 4, reason: "live FAIL", fixForward: true });
    live.lifecycle.unmount();
    const green = await openWork(workView({ stage: 5 }));
    expect(green.queryByText("Send back to Implementation per report")).toBeNull();
    green.lifecycle.unmount();
  });

  it("reconfirms a stale document with the screen's version and shows what the owner still has to do", async () => {
    const slot = await openWork(workView({ stage: 3, reconfirm: [1], ownerNeeds: ["Weather API key via the secrets skill"] }), { reconfirm: () => null });
    expect(slot.getByText("Needed from you before implementation:")).toBeTruthy();
    expect(slot.getByText(/Weather API key via the secrets skill/)).toBeTruthy();
    fireEvent.click(slot.getByText("Reconfirm «Context»"));
    await waitFor(() => expect(calls(slot, "reconfirm").length).toBe(1));
    expect(calls(slot, "reconfirm")[0]!.input).toEqual({ workId: "w1", expectedStage: 3, stage: 1, expectedVersion: version });
    slot.lifecycle.unmount();
  });

  it("cancels the work with a reason on stages 1–5", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("changed my mind");
    const slot = await openWork(workView({ stage: 4 }), { cancel: () => null });
    fireEvent.click(slot.getByText("Cancel work"));
    await waitFor(() => expect(calls(slot, "cancel").length).toBe(1));
    expect(calls(slot, "cancel")[0]!.input).toEqual({ workId: "w1", reason: "changed my mind" });
    prompt.mockRestore();
    slot.lifecycle.unmount();
  });

  it("re-fetches an opened file when the version changes, so the owner never approves unseen text", async () => {
    let views = 0;
    let files = 0;
    const slot = await openWork(workView({}), {
      work: () => workView({ version: { ...version, tzSha: views++ === 0 ? "p1" : "p2" } }),
      file: () => ({ mime: "text/markdown", text: files++ === 0 ? "old spec" : "new spec", data: null, size: 5 }),
    });
    fireEvent.click(slot.getByText("Spec"));
    expect(await slot.findByText("old spec")).toBeTruthy();
    await slot.behavior.emitRealtime("plugin-workshop", { workId: "w1", pluginId: "demo" });
    expect(await slot.findByText("new spec")).toBeTruthy();
    expect(slot.queryByText("old spec")).toBeNull();
    expect(calls(slot, "file").length).toBe(2);
    slot.lifecycle.unmount();
  });

  it("reloads on a signal about its plugin, on a global one, and not on a foreign one", async () => {
    const slot = await openWork(workView({}));
    const loads = () => calls(slot, "work").length;
    const before = loads();
    await slot.behavior.emitRealtime("plugin-workshop", { workId: "w9", pluginId: "other" });
    expect(loads()).toBe(before);
    await slot.behavior.emitRealtime("plugin-workshop", { workId: null, pluginId: "demo" });
    await waitFor(() => expect(loads()).toBe(before + 1));
    await slot.behavior.emitRealtime("plugin-workshop", { workId: null, pluginId: null });
    await waitFor(() => expect(loads()).toBe(before + 2));
    slot.lifecycle.unmount();
  });

  it("reloads the page after a failed action, keeps the error visible even if the stage moved, and has a refresh button", async () => {
    let views = 0;
    const slot = await openWork(workView({}), {
      work: () => workView({ stage: views++ === 0 ? 2 : 3 }),
      handOver: () => {
        throw new Error("the version changed");
      },
    });
    const works = () => calls(slot, "work").length;
    const before = works();
    fireEvent.click(slot.getByText("Next"));
    await waitFor(() => expect(works()).toBe(before + 1));
    expect(await slot.findByText(/the version changed/)).toBeTruthy();
    fireEvent.click(slot.getByText("Refresh"));
    await waitFor(() => expect(works()).toBe(before + 2));
    slot.lifecycle.unmount();
  });

  it("shows labels for verdicts and hand-over actions", async () => {
    const view = workView({ stage: 3, files: [{ path: "docs/plan.md", label: "Plan", verdict: "blocking" }, { path: "docs/r.md", label: "Review", verdict: "clear" }] });
    view.stages[2]!.handover = { at: 1, action: "back", note: "", forced: false };
    const slot = await openWork(view);
    expect(slot.getByText("blocking findings")).toBeTruthy();
    expect(slot.getByText("no blocking findings")).toBeTruthy();
    expect(slot.getByText(/sent back/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("says in the header when the main branch moved ahead", async () => {
    const slot = await openWork(workView({ stage: 4, baseAhead: true }));
    expect(slot.getByText("the main branch moved ahead")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
