import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, mountPluginContentScripts, renderSlot } from "@vesnalia/plugin-sdk/testing/app";
import type { useSdk } from "@vesnalia/plugin-sdk/app";
import { SourcePreview } from "../src/app/components/source-preview";
import { VirtualizerContext, WorkerPoolContext } from "@pierre/diffs/react";
import type { Virtualizer } from "@pierre/diffs";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import type { ChangedFile } from "../src/core/tree";
import { environmentFixture } from "./fixtures/environment";
import { clearFileRequests, requestFile } from "../src/app/file-navigation";
import { clearThreadViewCache } from "../src/app/hooks/use-thread-view-state";
import { changesRow } from "./fixtures/chat-changes";

// jsdom lacks these browser APIs. Keep Pierre's real rendering and pointer handlers.
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("CSSStyleSheet", class extends CSSStyleSheet { replaceSync() {} });
});
afterAll(() => vi.unstubAllGlobals());

const file = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile => ({ path, previousPath: null, additions: 7, deletions: 2, changeKind: "modified", binary: false, loadMode: "on_demand", origin: "tracked", ...extra });
const patch = (path: string) => ({ path, truncated: false, patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n` });
const filesResult = (files: ChangedFile[]) => ({ outcome: "available" as const, files, initialPatches: [], mergeBaseRef: "abc", shortstat: "", truncated: false });

function makeThreadResponse({ environmentId }: { environmentId: string }): Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["get"]>> {
  return { activeBackgroundAgentCount: 0, archivedAt: null, canRestoreEnvironment: false, canSpawnChild: true,
    createdAt: 0, deletedAt: null, environmentId, id: "thread-1", lastReadAt: null, latestAttentionAt: 0,
    lifecycleOwnerThreadId: null, originKind: null, originPluginId: null, parentThreadId: null, pinnedAt: null,
    projectId: "project-1", providerId: "codex", queuedMessageCount: 0, runtime: { displayStatus: "idle" },
    sectionId: null, sourceThreadId: null, status: "idle", title: "Test", titleFallback: null, updatedAt: 0, visibility: "visible" };
}
const statusResult: Awaited<ReturnType<ReturnType<typeof useSdk>["environments"]["status"]>> = {
  outcome: "available", workspace: {
    branch: { currentBranch: "feature", defaultBranch: "main" },
    checkout: { kind: "branch", branchName: "feature", headSha: "abc" },
    mergeBase: { mergeBaseBranch: "develop", aheadCount: 1, behindCount: 0, baseRef: "abc", commits: [], deletions: 0, fileCount: 0, files: [], hasCommittedUnmergedChanges: true, insertions: 0, lineStatsComplete: true },
    workingTree: { state: "clean", deletions: 0, fileCount: 0, files: [], hasUncommittedChanges: false, insertions: 0, lineStatsComplete: true },
  },
};
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); clearFileRequests(); clearThreadViewCache(); localStorage.clear(); vi.restoreAllMocks(); });
async function open(files: ChangedFile[], overrides: Record<string, unknown> = {}, rpc: Record<string, (input: any) => any> = {}, settings?: Record<string, string | number | boolean>, fileApi: Record<string, unknown> = {}, threadId = "thread-1") {
  const app = await loadPluginApp(() => import("../src/app/index"));
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId, params: null }, {
    rpc: { history: () => ({ commits: [], hasMore: false }), ...rpc },
    settings,
    composer: { text: "Existing draft", scope: { kind: "thread", threadId } },
    sdk: {
      files: { read: async ({ path }: { path: string }) => ({ path, content: `Source of ${path}`, contentEncoding: "utf8" as const, sizeBytes: 32, sha256: "abc" }), ...fileApi },
      threads: { get: async () => makeThreadResponse({ environmentId: "env-1" }) },
      environments: {
        get: async () => environmentFixture(),
        status: async () => statusResult,
        diffFiles: async () => filesResult(files),
        diffPatch: async ({ paths }: { paths: string[] }) => ({ outcome: "available", patches: paths.map(patch) }),
        diffFile: async ({ path, side }: { path: string; side: string }) => ({ path, content: side === "old" ? "old\n" : "new\n", contentEncoding: "utf8", sizeBytes: 4 }),
        ...overrides,
      },
    },
  });
  cleanups.push(() => slot.lifecycle.unmount());
  await slot.findByRole("navigation", { name: /^(Changes|Worktree) tree$/ });
  return slot;
}

function sourceElement(slot: Awaited<ReturnType<typeof open>>) {
  return slot.container.querySelector(".dt-source-code diffs-container")?.shadowRoot?.querySelector<HTMLElement>("[data-content]") ?? null;
}
async function renderedSource(slot: Awaited<ReturnType<typeof open>>) {
  await waitFor(() => expect(sourceElement(slot)).toBeTruthy());
  return sourceElement(slot)!;
}

describe("Diff Tree panel", () => {
  it("keeps source rendering independent of ambient viewport and worker state", async () => {
    const accessed = vi.fn(() => { throw new Error("Ambient renderer state must not be used"); });
    const virtualizer = new Proxy({} as Virtualizer, { get: accessed });
    const pool = new Proxy({} as WorkerPoolManager, { get: accessed });
    const component = () => <VirtualizerContext.Provider value={virtualizer}><WorkerPoolContext.Provider value={pool}><SourcePreview path="source.md" content={"# first\nlast\n"} /></WorkerPoolContext.Provider></VirtualizerContext.Provider>;
    const slot = renderSlot({ component }, {}); cleanups.push(() => slot.lifecycle.unmount());
    await waitFor(() => expect(sourceElement(slot)?.textContent).toContain("last"));
    expect(accessed).not.toHaveBeenCalled();
  });
  it("keeps the full contents of very long files with a bounded plain-text DOM", async () => {
    const content = "line\n".repeat(10_000) + "last line";
    const slot = renderSlot({ component: SourcePreview }, { content, path: "long.txt" }); cleanups.push(() => slot.lifecycle.unmount());
    expect(slot.getByText("Plain text preview for files over 10,000 lines.")).toBeTruthy();
    const code = slot.container.querySelector("code")!;
    expect(code.textContent).toBe(content); expect(code.childNodes).toHaveLength(1);
    expect(slot.container.querySelector(".dt-source-numbers")?.textContent).toMatch(/10001$/);
  });

  it("keeps the complete numbered File preview stable during scrolling, resize and same-file refresh", async () => {
    let changed = false;
    const content = () => Array.from({ length: changed ? 12 : 230 }, (_, i) => `# source line ${i + 1}\n`).join("");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const slot = await open([file("long.md")], {}, {}, undefined, { read: async ({ path }: { path: string }) => ({ path, content: content(), contentEncoding: "utf8", sizeBytes: content().length, sha256: changed ? "new" : "old" }) });
    fireEvent.click(slot.getByRole("button", { name: "File" }));
    const shadow = () => slot.container.querySelector("diffs-container")?.shadowRoot;
    await waitFor(() => expect(shadow()?.querySelector('[data-column-number="230"]')).toBeTruthy());
    const container = slot.container.querySelector("diffs-container");
    const viewport = slot.container.querySelector<HTMLElement>(".dt-diff-body")!;
    viewport.scrollTop = 600;
    for (let i = 0; i < 4; i++) { fireEvent.scroll(viewport); fireEvent(window, new Event("resize")); }
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "files.read")).toHaveLength(2));
    expect(slot.container.querySelector("diffs-container")).toBe(container);
    expect(viewport.scrollTop).toBe(600);
    changed = true; fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(shadow()?.querySelector('[data-column-number="230"]')).toBeNull());
    await waitFor(() => expect(shadow()?.querySelector('[data-column-number="12"]')).toBeTruthy());
    expect(shadow()?.querySelector('[data-error-wrapper]')).toBeNull();
    expect(errors.mock.calls.flat().some(value => /Line doesnt exist|Line does not exist/i.test(String(value)))).toBe(false);
  });

  const picture = (content = "cG5n") => ({ kind: "image" as const, mimeType: "image/png" as const, content, sizeBytes: 3 });
  it("previews binary images on both sides, with dimensions and zoom, without loading text patches", async () => {
    const slot = await open([file("image.png", { binary: true })], {}, { imageDiff: () => ({ old: picture(), next: picture("bmV3") }) });
    const before = await slot.findByRole("img", { name: "Before: image.png" });
    expect(before.getAttribute("src")).toBe("data:image/png;base64,cG5n");
    expect(slot.getByRole("img", { name: "After: image.png" }).getAttribute("src")).toBe("data:image/png;base64,bmV3");
    Object.defineProperties(before, { naturalWidth: { value: 120 }, naturalHeight: { value: 80 } });
    fireEvent.load(before); expect(slot.getByText("120 × 80 · 3 B")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "100%" }));
    expect(slot.getByRole("button", { name: "100%" }).getAttribute("aria-pressed")).toBe("true");
    expect(slot.container.querySelector(".dt-image-fit")).toBeNull();
    expect(slot.inspection.sdkCalls.some(call => call.method === "environments.diffPatch" || call.method === "environments.diffFile")).toBe(false);
    expect(slot.queryByRole("group", { name: "Diff view" })).toBeNull();
  });
  it("keeps the available side for added/deleted images and handles decode failures", async () => {
    const slot = await open([file("added.png", { binary: true, changeKind: "added" }), file("deleted.png", { binary: true, changeKind: "deleted" })], {}, { imageDiff: ({ path }) => path === "added.png" ? { old: { kind: "missing" }, next: picture() } : { old: picture(), next: { kind: "missing" } } });
    fireEvent.error(await slot.findByRole("img", { name: "After: added.png" }));
    expect(slot.getByText(/could not be decoded/)).toBeTruthy();
    expect(slot.getByText("Not present in this revision.")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: /deleted.png/ }));
    await slot.findByRole("img", { name: "Before: deleted.png" });
    expect(slot.queryByRole("img", { name: "After: deleted.png" })).toBeNull();
  });
  it("loads immutable image versions for historical comparisons", async () => {
    const a = "a".repeat(40), b = "b".repeat(40);
    const slot = await open([file("a.ts")], {}, {
      history: () => ({ commits: [{ sha: b, shortSha: "bbbbbbbb", subject: "Image update", author: "Test", timestamp: 1 }], hasMore: false }),
      committedChanges: () => ({ from: a, to: b, label: "Selected range", files: [file("new.png", { previousPath: "old.png", binary: true })], truncated: false }),
      imageDiff: () => ({ old: picture(), next: picture() }),
    });
    fireEvent.change(slot.getByRole("combobox", { name: "Changes scope" }), { target: { value: "recent" } });
    await slot.findByRole("img", { name: "After: new.png" });
    expect(slot.inspection.rpcCalls.find(call => call.method === "imageDiff")?.input).toEqual({ environmentId: "env-1", target: { type: "range", from: a, to: b }, path: "new.png", previousPath: "old.png" });
  });
  it("previews worktree images without routing them through the text file reader", async () => {
    const slot = await open([file("image.png", { binary: true })], {}, { imageFile: () => picture(), imageDiff: () => ({ old: picture(), next: picture() }) });
    await slot.findByRole("img", { name: "After: image.png" });
    fireEvent.click(slot.getByRole("button", { name: "File" }));
    await slot.findByRole("img", { name: "Working copy: image.png" });
    expect(slot.inspection.rpcCalls).toContainEqual({ method: "imageFile", input: { environmentId: "env-1", path: "image.png" } });
    expect(slot.inspection.sdkCalls.some(call => call.method === "files.read")).toBe(false);
  });
  it("keeps SVG text diffs accessible and renders SVG previews as images", async () => {
    const old = '<svg xmlns="http://www.w3.org/2000/svg"/>', next = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const svg = (content: string) => ({ kind: "image", mimeType: "image/svg+xml", content: btoa(content), sizeBytes: content.length });
    const slot = await open([file("icon.svg")], {
      diffPatch: async () => ({ outcome: "available", patches: [{ path: "icon.svg", patch: `diff --git a/icon.svg b/icon.svg\n--- a/icon.svg\n+++ b/icon.svg\n@@ -1 +1 @@\n-${old}\n+${next}\n`, truncated: false }] }),
      diffFile: async ({ side }: { side: string }) => ({ path: "icon.svg", content: side === "old" ? old + "\n" : next + "\n", contentEncoding: "utf8", sizeBytes: 100 }),
    }, { imageDiff: () => ({ old: svg(old), next: svg(next) }) });
    expect((await slot.findByRole("img", { name: "After: icon.svg" })).getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(slot.container.querySelector(".dt-image-preview svg")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Text diff" }));
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("rect"));
    fireEvent.click(slot.getByRole("button", { name: "Image" }));
    await slot.findByRole("img", { name: "After: icon.svg" });
  });
  it("ignores stale image responses when switching to another image", async () => {
    let finish!: (value: unknown) => void;
    const slot = await open([file("a.png", { binary: true }), file("b.png", { binary: true })], {}, { imageDiff: ({ path }) => path === "a.png" ? new Promise(resolve => { finish = resolve; }) : { old: picture(), next: picture("YmJi") } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === "imageDiff")).toBe(true));
    fireEvent.click(slot.getByRole("button", { name: /b.png/ }));
    await slot.findByRole("img", { name: "After: b.png" });
    await act(async () => finish({ old: picture(), next: picture("YWFh") }));
    expect(slot.getByRole("img", { name: "After: b.png" }).getAttribute("src")).toBe("data:image/png;base64,YmJi");
    expect(slot.queryByRole("img", { name: "After: a.png" })).toBeNull();
  });

  it("restores the recent starting commit on returning to a chat without sharing it with other chats", async () => {
    const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
    const rpc = {
      history: () => ({ commits: [c, b, a].map((sha, i) => ({ sha, shortSha: sha.slice(0, 8), subject: `Change ${3 - i}`, author: "Test", timestamp: 3 - i })), hasMore: false }),
      committedChanges: () => ({ from: "d".repeat(40), to: c, label: "From selected commit", files: [file("history.ts")], truncated: false }),
      committedPatch: ({ path }: { path: string }) => patch(path),
      committedContents: () => ({ old: "old\n", next: "new\n" }),
    };
    const first = await open([file("a.ts")], {}, rpc);
    fireEvent.change(first.getByRole("combobox", { name: "Changes scope" }), { target: { value: "recent" } });
    await first.findByRole("option", { name: /Change 1/ });
    fireEvent.change(first.getByRole("combobox", { name: "Starting commit" }), { target: { value: a } });
    await first.findByText("From selected commit");
    first.lifecycle.unmount();
    const other = await open([file("b.ts")], {}, rpc, undefined, {}, "thread-2");
    expect((other.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("all");
    fireEvent.change(other.getByRole("combobox", { name: "Changes scope" }), { target: { value: "uncommitted" } });
    other.lifecycle.unmount();
    const returned = await open([file("a.ts")], {}, rpc);
    expect((returned.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("recent");
    expect((returned.getByRole("combobox", { name: "Starting commit" }) as HTMLSelectElement).value).toBe(a);
    expect(returned.inspection.rpcCalls.filter(call => call.method === "committedChanges").map(call => call.input)).toEqual([expect.objectContaining({ selection: { kind: "since", sha: a } })]);
    expect(returned.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles")).toHaveLength(0);
  });

  it("migrates a saved Last N choice once and keeps its SHA when HEAD advances", async () => {
    const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
    let commits = [b, a];
    const rpc = {
      history: () => ({ commits: commits.map((sha, i) => ({ sha, shortSha: sha.slice(0, 8), subject: `Change ${sha[0]}`, author: "Test", timestamp: i })), hasMore: false }),
      committedChanges: () => ({ from: "d".repeat(40), to: commits[0], label: "Selected range", files: [file("history.ts")], truncated: false }),
      committedPatch: ({ path }: { path: string }) => patch(path),
      committedContents: () => ({ old: "old\n", next: "new\n" }),
    };
    const initial = await open([file("a.ts")]);
    fireEvent.click(initial.getByRole("button", { name: "Split" }));
    initial.lifecycle.unmount();
    const key = Object.keys(localStorage).find(key => key.includes('"thread-view-v1"'))!;
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), scope: "recent", count: 2 }));
    clearThreadViewCache();
    const migrated = await open([file("a.ts")], {}, rpc);
    expect((migrated.getByRole("combobox", { name: "Starting commit" }) as HTMLSelectElement).value).toBe(a);
    expect(migrated.inspection.rpcCalls.filter(call => call.method === "committedChanges").map(call => call.input)).toEqual([expect.objectContaining({ selection: { kind: "since", sha: a } })]);
    commits = [c, b, a];
    fireEvent.click(migrated.getByRole("button", { name: "Refresh" }));
    await migrated.findByRole("option", { name: /Change c/ });
    expect((migrated.getByRole("combobox", { name: "Starting commit" }) as HTMLSelectElement).value).toBe(a);
    expect(migrated.inspection.rpcCalls.filter(call => call.method === "committedChanges").at(-1)?.input).toMatchObject({ selection: { kind: "since", sha: a } });
  });

  it("lets the user recover when the starting commit is no longer on the branch", async () => {
    const a = "a".repeat(40), b = "b".repeat(40);
    let current = a;
    const rpc = {
      history: () => ({ commits: [{ sha: current, shortSha: current.slice(0, 8), subject: "Current branch", author: "Test", timestamp: 1 }], hasMore: false }),
      committedChanges: ({ selection }: { selection: { sha: string } }) => {
        if (selection.sha !== current) throw new Error("The starting commit is not in the current branch. Choose another starting commit.");
        return { from: "c".repeat(40), to: current, label: "Selected range", files: [file("history.ts")], truncated: false };
      },
      committedPatch: ({ path }: { path: string }) => patch(path),
      committedContents: () => ({ old: "old\n", next: "new\n" }),
    };
    const slot = await open([file("a.ts")], {}, rpc);
    fireEvent.change(slot.getByRole("combobox", { name: "Changes scope" }), { target: { value: "recent" } });
    await slot.findByRole("button", { name: /history.ts/ });
    current = b;
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await slot.findByRole("option", { name: /Not in current history/ });
    expect((await slot.findByRole("alert")).textContent).toContain("Choose another starting commit");
    fireEvent.change(slot.getByRole("combobox", { name: "Starting commit" }), { target: { value: b } });
    await slot.findByRole("button", { name: /history.ts/ });
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it.each([false, true])("handles an unavailable recent history (error: %s) without requesting a range", async fail => {
    const slot = await open([file("a.ts")], {}, { history: () => { if (fail) throw new Error("History unavailable"); return { commits: [], hasMore: false }; } });
    fireEvent.change(slot.getByRole("combobox", { name: "Changes scope" }), { target: { value: "recent" } });
    if (fail) await slot.findByRole("alert");
    else await slot.findByText("No commits yet. Use Uncommitted to view working-copy changes.");
    expect(slot.getByRole("combobox", { name: "Starting commit" }).hasAttribute("disabled")).toBe(true);
    expect(slot.inspection.rpcCalls.filter(call => call.method === "committedChanges")).toHaveLength(0);
  });

  const listing = (paths: string[], directories: string[] = [], truncated = false) => ({ paths: [
    ...directories.map(path => ({ path, name: path.split("/").pop()!, kind: "directory", positions: [], score: 0 })),
    ...paths.map(path => ({ path, name: path.split("/").pop()!, kind: "file", positions: [], score: 0 })),
  ], truncated });

  it("restores the full-tree file and folder expansion after switching chats and reloading", async () => {
    const overrides = { paths: async () => listing(["docs/readme.md", "src/nested/b.py", "src/a.py"], ["docs", "src", "src/nested"]) };
    const first = await open([file("changed.ts")], overrides);
    fireEvent.click(first.getByRole("button", { name: "Browse worktree" }));
    fireEvent.click(await first.findByRole("button", { name: /^src/ }));
    fireEvent.click(first.getByRole("button", { name: /^nested/ }));
    fireEvent.click(first.getByRole("button", { name: /b.py/ }));
    await waitFor(() => expect(sourceElement(first)?.textContent).toBe("Source of /workspace/src/nested/b.py"));
    first.lifecycle.unmount();
    const other = await open([file("other.ts")], overrides, {}, undefined, {}, "thread-2");
    other.lifecycle.unmount();
    clearThreadViewCache();
    const returned = await open([file("changed.ts")], overrides);
    const selected = await returned.findByRole("button", { name: /b.py/ });
    expect(selected.getAttribute("aria-current")).toBe("true");
    expect(returned.getByRole("button", { name: /^src/ }).getAttribute("aria-expanded")).toBe("true");
    expect(returned.getByRole("button", { name: /^nested/ }).getAttribute("aria-expanded")).toBe("true");
    expect(returned.getByRole("button", { name: /^docs/ }).getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(sourceElement(returned)?.textContent).toBe("Source of /workspace/src/nested/b.py"));
  });

  it("keeps changes and full-tree selections, searches and folders independent", async () => {
    const files = [file("src/a.ts"), file("src/b.ts"), file("docs/note.md")];
    const overrides = { paths: async () => listing(["src/a.ts", "src/b.ts", "docs/readme.md"], ["src", "docs"]) };
    const first = await open(files, overrides);
    fireEvent.click(first.getByRole("button", { name: /b.ts/ }));
    fireEvent.click(first.getByRole("button", { name: /^docs/ }));
    fireEvent.click(first.getByRole("button", { name: "Browse worktree" }));
    fireEvent.click(await first.findByRole("button", { name: /^docs/ }));
    fireEvent.click(first.getByRole("button", { name: /readme.md/ }));
    await waitFor(() => expect(sourceElement(first)?.textContent).toContain("docs/readme.md"));
    fireEvent.click(first.getByRole("button", { name: "Browse worktree" }));
    expect(first.getByRole("button", { name: /b.ts/ }).getAttribute("aria-current")).toBe("true");
    expect(first.getByRole("button", { name: /^docs/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(first.getByRole("textbox", { name: "Search files" }), { target: { value: "b.ts" } });
    first.lifecycle.unmount();
    clearThreadViewCache();
    const returned = await open(files, overrides);
    expect((returned.getByRole("textbox", { name: "Search files" }) as HTMLInputElement).value).toBe("b.ts");
    expect(returned.getByRole("button", { name: /b.ts/ }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(returned.getByRole("button", { name: "Browse worktree" }));
    expect((returned.getByRole("textbox", { name: "Search files" }) as HTMLInputElement).value).toBe("");
    expect((await returned.findByRole("button", { name: /readme.md/ })).getAttribute("aria-current")).toBe("true");
    expect(returned.getByRole("button", { name: /^src/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("does not let a previous chat link overwrite a later full-tree selection on remount", async () => {
    const overrides = { paths: async () => listing(["src/a.ts", "docs/b.py"], ["src", "docs"]) };
    act(() => requestFile("thread-1", "src/a.ts"));
    const first = await open([file("src/a.ts")], overrides);
    fireEvent.click(first.getByRole("button", { name: "Browse worktree" }));
    fireEvent.click(await first.findByRole("button", { name: /^docs/ }));
    fireEvent.click(first.getByRole("button", { name: /b.py/ }));
    await waitFor(() => expect(sourceElement(first)?.textContent).toContain("docs/b.py"));
    first.lifecycle.unmount();
    const returned = await open([file("src/a.ts")], overrides);
    expect((await returned.findByRole("button", { name: /b.py/ })).getAttribute("aria-current")).toBe("true");
    act(() => requestFile("thread-1", "src/a.ts"));
    await waitFor(() => expect(returned.getByRole("button", { name: /a.ts/ }).getAttribute("aria-current")).toBe("true"));
    expect(returned.getByRole("region", { name: "Selected file diff" }).textContent).toContain("src/a.ts");
  });

  it("restores branch, tree, preview and layout choices after a frontend reload", async () => {
    const overrides = { paths: async () => listing(["a.ts"]) };
    const first = await open([file("a.ts")], overrides);
    fireEvent.change(first.getByRole("textbox", { name: "Base" }), { target: { value: "release/test" } });
    await first.findByRole("navigation", { name: "Changes tree" });
    fireEvent.click(first.getByRole("button", { name: "Split" }));
    fireEvent.click(first.getByRole("button", { name: "File" }));
    fireEvent.click(first.getByRole("button", { name: "Browse worktree" }));
    await renderedSource(first);
    first.lifecycle.unmount();
    clearThreadViewCache();
    const returned = await open([file("a.ts")], overrides);
    expect((returned.getByRole("textbox", { name: "Base" }) as HTMLInputElement).value).toBe("release/test");
    expect(returned.getByRole("button", { name: "Browse worktree" }).getAttribute("aria-pressed")).toBe("true");
    await renderedSource(returned);
    expect(returned.getByRole("button", { name: "File" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(returned.getByRole("button", { name: "Diff" }));
    expect(returned.getByRole("button", { name: "Split" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps a chosen historical commit when reopening the viewer", async () => {
    const a = "a".repeat(40), b = "b".repeat(40);
    const rpc = {
      history: () => ({ commits: [{ sha: b, shortSha: "bbbbbbbb", subject: "Latest", author: "Test", timestamp: 1 }, { sha: a, shortSha: "aaaaaaaa", subject: "Previous", author: "Test", timestamp: 0 }], hasMore: false }),
      committedChanges: ({ selection }: { selection: { sha: string } }) => ({ from: "c".repeat(40), to: selection.sha, label: "Selected commit", files: [file("history.ts")], truncated: false }),
      committedPatch: ({ path }: { path: string }) => patch(path),
      committedContents: () => ({ old: "old\n", next: "new\n" }),
    };
    const first = await open([file("a.ts")], {}, rpc);
    fireEvent.change(first.getByRole("combobox", { name: "Changes scope" }), { target: { value: "commit" } });
    await first.findByRole("option", { name: /Previous/ });
    fireEvent.change(first.getByRole("combobox", { name: "Commit" }), { target: { value: a } });
    await first.findByRole("navigation", { name: "Changes tree" });
    first.lifecycle.unmount();
    clearThreadViewCache();
    const returned = await open([file("a.ts")], {}, rpc);
    await returned.findByRole("option", { name: /Previous/ });
    expect((returned.getByRole("combobox", { name: "Commit" }) as HTMLSelectElement).value).toBe(a);
    expect(returned.inspection.rpcCalls.filter(call => call.method === "committedChanges").map(call => call.input)).toEqual([expect.objectContaining({ selection: { kind: "commit", sha: a } })]);
  });

  it("does not replay an old chat request on remount but still handles a fresh request", async () => {
    act(() => requestFile("thread-1", "a.ts"));
    const first = await open([file("a.ts")]);
    fireEvent.change(first.getByRole("combobox", { name: "Changes scope" }), { target: { value: "uncommitted" } });
    await first.findByRole("navigation", { name: "Changes tree" });
    first.lifecycle.unmount();
    const returned = await open([file("a.ts")]);
    expect((returned.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("uncommitted");
    act(() => requestFile("thread-1", "a.ts"));
    await waitFor(() => expect((returned.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("all"));
  });

  it("keeps choices in memory when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    const first = await open([file("a.ts")]);
    fireEvent.change(first.getByRole("combobox", { name: "Changes scope" }), { target: { value: "uncommitted" } });
    await first.findByRole("navigation", { name: "Changes tree" });
    first.lifecycle.unmount();
    const returned = await open([file("a.ts")]);
    expect((returned.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("uncommitted");
  });

  it("restores the right thread when the host reuses the mounted panel component", async () => {
    const { DiffTreePanel } = await import("../src/app/index");
    const slot = await open([file("a.ts")]);
    fireEvent.change(slot.getByRole("combobox", { name: "Changes scope" }), { target: { value: "uncommitted" } });
    slot.lifecycle.rerender(<DiffTreePanel threadId="thread-2" />);
    expect((slot.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("all");
    fireEvent.click(slot.getByRole("button", { name: "Browse worktree" }));
    slot.lifecycle.rerender(<DiffTreePanel threadId="thread-1" />);
    expect((slot.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("uncommitted");
    expect(slot.getByRole("button", { name: "Browse worktree" }).getAttribute("aria-pressed")).toBe("false");
    await slot.findByRole("navigation", { name: "Changes tree" });
  });

  it.each(["{invalid", JSON.stringify({ scope: "unknown", base: {}, count: 500, commit: "HEAD; echo bad", worktreeMode: "true", view: "invalid", preview: "invalid" })])("recovers from invalid stored choices: %s", async saved => {
    const first = await open([file("a.ts")]);
    fireEvent.click(first.getByRole("button", { name: "Split" }));
    first.lifecycle.unmount();
    const key = Object.keys(localStorage).find(key => key.includes('"thread-view-v1"'))!;
    localStorage.setItem(key, saved);
    clearThreadViewCache();
    const returned = await open([file("a.ts")]);
    expect((returned.getByRole("combobox", { name: "Changes scope" }) as HTMLSelectElement).value).toBe("all");
    expect((returned.getByRole("textbox", { name: "Base" }) as HTMLInputElement).value).toBe("develop");
    expect(returned.getByRole("button", { name: "Unified" }).getAttribute("aria-pressed")).toBe("true");
    expect(returned.getByRole("button", { name: "Diff" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(returned.getByRole("combobox", { name: "Changes scope" }), { target: { value: "recent" } });
    expect((returned.getByRole("combobox", { name: "Starting commit" }) as HTMLSelectElement).value).toBe("");
  });

  it("browses the worktree on demand, previews unchanged files and preserves change metadata and mentions", async () => {
    const slot = await open([file("src/changed.ts"), file("gone.ts", { changeKind: "deleted" })], {
      paths: async () => listing(["src/changed.ts", "docs/readme.md"], ["src", "docs", "empty"]),
    });
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.paths")).toHaveLength(0);
    fireEvent.click(slot.getByRole("button", { name: "Browse worktree" }));
    await slot.findByRole("button", { name: /docs/ });
    expect(slot.getByRole("button", { name: /docs/ }).getAttribute("aria-expanded")).toBe("false");
    expect(slot.getByRole("button", { name: /empty/ })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Expand all" }));
    expect(slot.queryByRole("button", { name: /gone.ts/ })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: /readme.md/ }));
    expect((await renderedSource(slot)).textContent).toBe("Source of /workspace/docs/readme.md");
    expect(slot.getByRole("button", { name: "Diff" }).hasAttribute("disabled")).toBe(true);
    expect(slot.getByRole("button", { name: /readme.md/ }).querySelector(".dt-status")).toBeNull();
    expect(slot.inspection.sdkCalls.filter(call => call.method === "files.read").at(-1)?.args[0]).toMatchObject({ hostId: "host-1", rootPath: "/workspace", path: "/workspace/docs/readme.md" });
    fireEvent.click(slot.getByRole("button", { name: /readme.md/ }), { metaKey: true });
    expect(slot.inspection.composer.draft.mentions).toEqual(expect.arrayContaining([expect.objectContaining({ path: "docs/readme.md" })]));
    expect(slot.inspection.composer.submits).toHaveLength(0);
    fireEvent.click(slot.getByRole("button", { name: /changed.ts/ }));
    expect(slot.getByRole("region", { name: "Selected file diff" })).toBeTruthy();
    expect(slot.getByRole("button", { name: /changed.ts/ }).querySelector(".dt-status")?.textContent).toBe("M");
    fireEvent.click(slot.getByRole("button", { name: "File" }));
    expect((await renderedSource(slot)).textContent).toBe("Source of /workspace/src/changed.ts");
    fireEvent.click(slot.getByRole("button", { name: "Diff" }));
    fireEvent.click(slot.getByRole("button", { name: "Browse worktree" }));
    await slot.findByRole("navigation", { name: "Changes tree" });
    expect(slot.queryByRole("button", { name: /readme.md/ })).toBeNull();
    expect(slot.getByRole("button", { name: /gone.ts/ })).toBeTruthy();
  });

  it("opens an unchanged file from chat inside the worktree when there are no changes", async () => {
    const slot = await open([], { paths: async () => listing(["src/unchanged.py"], ["src"]) });
    act(() => requestFile("thread-1", "src/unchanged.py"));
    fireEvent.click(await slot.findByRole("button", { name: "View in worktree" }));
    expect((await renderedSource(slot)).textContent).toBe("Source of /workspace/src/unchanged.py");
    expect(slot.getByRole("button", { name: /unchanged.py/ }).getAttribute("aria-current")).toBe("true");
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch")).toHaveLength(0);
  });

  it("searches the server beyond truncated worktree results and ignores stale search responses", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const slot = await open([], { paths: async ({ query }: { query?: string }) => query === "old" ? pending : query === "dtrg" ? listing(["deep/target.py"]) : listing(["README.md"], [], true) });
    fireEvent.click(slot.getByRole("button", { name: "Browse worktree" }));
    await slot.findByText(/The worktree list is partial/);
    fireEvent.change(slot.getByRole("textbox", { name: "Search files" }), { target: { value: "old" } });
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.paths")).toHaveLength(2));
    fireEvent.change(slot.getByRole("textbox", { name: "Search files" }), { target: { value: "dtrg" } });
    fireEvent.click(await slot.findByRole("button", { name: /target.py/ }));
    expect((await renderedSource(slot)).textContent).toBe("Source of /workspace/deep/target.py");
    await act(async () => { finish(listing(["old.ts"])); });
    expect(slot.queryByRole("button", { name: /old.ts/ })).toBeNull();
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.paths").at(-1)?.args[0]).toMatchObject({ environmentId: "env-1", query: "dtrg", limit: "10000" });
  });

  it.each([
    ["binary", { content: "AAAB", contentEncoding: "base64", sizeBytes: 3 }, "Binary file — no source preview available."],
    ["large", { content: "large", contentEncoding: "utf8", sizeBytes: 524289 }, "This file exceeds the 512 KiB source preview limit. Open it in VesnALIA to view it."],
    ["empty", { content: "", contentEncoding: "utf8", sizeBytes: 0 }, "Empty file."],
  ])("handles %s worktree files without rendering invalid source", async (_kind, contents, notice) => {
    const slot = await open([], { paths: async () => listing(["a.dat"]) }, {}, undefined, { read: async () => ({ ...(contents as object), path: "/workspace/a.dat", sha256: "abc" }) });
    fireEvent.click(slot.getByRole("button", { name: "Browse worktree" }));
    await slot.findByText(notice as string);
    expect(sourceElement(slot)).toBeNull();
    expect(slot.getByRole("link", { name: "Open file" })).toBeTruthy();
  });

  it("keeps the worktree accessible when branch comparison fails and reports read errors", async () => {
    const slot = await open([], {
      paths: async () => listing(["denied.ts"]),
      diffFiles: async ({ mergeBaseBranch }: { mergeBaseBranch: string }) => { if (mergeBaseBranch === "missing") throw new Error("Branch missing"); return filesResult([]); },
    }, {}, undefined, { read: async () => { throw new Error("File access denied"); } });
    fireEvent.click(slot.getByRole("button", { name: "Browse worktree" }));
    await slot.findByRole("button", { name: /denied.ts/ });
    fireEvent.change(slot.getByRole("textbox", { name: "Base" }), { target: { value: "missing" } });
    await slot.findByText(/Comparison unavailable: Branch missing/);
    expect(slot.getByRole("navigation", { name: "Worktree tree" })).toBeTruthy();
    expect((await slot.findByRole("alert")).textContent).toBe("File access denied");
  });

  it("does not show a late source response under another worktree filename", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const slot = await open([], { paths: async () => listing(["a.ts", "b.ts"]) }, {}, undefined, {
      read: async ({ path }: { path: string }) => path.endsWith("a.ts") ? pending : { path, content: "contents of b", contentEncoding: "utf8", sizeBytes: 13, sha256: "b" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Browse worktree" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "files.read")).toHaveLength(1));
    fireEvent.click(slot.getByRole("button", { name: /b.ts/ }));
    expect((await renderedSource(slot)).textContent).toBe("contents of b");
    await act(async () => { finish({ path: "/workspace/a.ts", content: "late contents of a", contentEncoding: "utf8", sizeBytes: 18, sha256: "a" }); });
    expect(sourceElement(slot)?.textContent).toBe("contents of b");
    expect(slot.getByRole("region", { name: "Source code: b.ts" })).toBeTruthy();
  });

  it.each([true, false])("uses optional smooth loading without delaying the diff (enabled=%s)", async smoothTransitions => {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const slot = await open([file("a.ts")], { diffPatch: async () => pending }, {}, { smoothTransitions });
    expect(slot.container.querySelector(".dt-diff-body")?.getAttribute("aria-busy")).toBe("true");
    if (smoothTransitions) {
      expect(slot.getByRole("status", { name: "Loading diff" }).className).toBe("dt-diff-skeleton");
      expect(slot.getByText("Loading diff…").className).toBe("dt-sr-only");
    } else {
      expect(slot.container.querySelector(".dt-diff-skeleton")).toBeNull();
      expect(slot.getByText("Loading diff…").className).toBe("dt-notice");
    }
    await act(async () => { finish({ outcome: "available", patches: [patch("a.ts")] }); });
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("new"));
    expect(slot.container.querySelector(".dt-diff-body")?.getAttribute("aria-busy")).toBe("false");
    expect(slot.queryByText("Loading diff…")).toBeNull();
    expect(!!slot.container.querySelector(".dt-diff-reveal-smooth")).toBe(smoothTransitions);
  });

  it("shows loading failures directly when smooth transitions are enabled", async () => {
    const slot = await open([file("a.ts")], { diffPatch: async () => { throw new Error("Diff unavailable"); } }, {}, { smoothTransitions: true });
    expect((await slot.findByRole("alert")).textContent).toBe("Diff unavailable");
    expect(slot.container.querySelector(".dt-diff-skeleton")).toBeNull();
    expect(slot.container.querySelector(".dt-diff-body")?.getAttribute("aria-busy")).toBe("false");
  });

  it.each([ ["icon", "link"], ["diff-tree", "link"], ["icon", "card"], ["diff-tree", "card"] ])("opens chat files through the registered header and reuses one tab in %s mode (%s)", async (mode, surface) => {
    const app = await loadPluginApp(() => import("../src/app/index"));
    const scripts = await mountPluginContentScripts(app, { pluginId: "diff-tree" });
    const header = renderSlot(app.threadHeaderActions[0]!, { threadId: "thread-1", projectId: "project-1", isCompactViewport: false }, {
      settings: { chatFileLinks: mode },
      openThreadPanel: () => true,
      sdk: { threads: { get: async () => makeThreadResponse({ environmentId: "env-1" }) }, environments: { get: async () => environmentFixture() } },
    });
    const pane = document.createElement("div"); pane.dataset.splitPaneId = "one"; document.body.append(pane); pane.append(header.container);
    const message = document.createElement("div"); message.dataset.messageColumn = ""; pane.append(message);
    const link = document.createElement("a"); link.href = "file:///workspace/src/a.ts"; link.target = "_blank"; link.textContent = "a.ts";
    const card = surface === "card" ? changesRow(message, "src/a.ts") : null;
    if (!card) message.append(link);
    const control = card?.button ?? link;
    try {
      await waitFor(() => expect(header.inspection.sdkCalls.some(call => call.method === "environments.get")).toBe(true));
      await act(async () => {});
      if (mode === "icon") {
        await waitFor(() => expect(message.querySelector(".dt-chat-open")).toBeTruthy());
        fireEvent.click(message.querySelector(".dt-chat-open")!);
      } else expect(fireEvent.click(control)).toBe(false);
      expect(header.inspection.navigateCalls.at(-1)).toMatchObject({ method: "openThreadPanel", options: { actionId: "changes", title: "Diff Tree" } });
      if (card) { card.button.title = "Open src/b.ts"; card.button.setAttribute("aria-label", card.button.title); card.filename.title = "src/b.ts"; }
      else link.href = "file:///workspace/src/b.ts";
      fireEvent.click(mode === "icon" ? message.querySelector(".dt-chat-open")! : control);
      expect(header.inspection.navigateCalls.filter(call => call.method === "openThreadPanel")).toHaveLength(2);
      expect(header.inspection.navigateCalls.at(-1)).toEqual(header.inspection.navigateCalls[0]);
    } finally { header.lifecycle.unmount(); await scripts.lifecycle.dispose(); pane.remove(); }
  });

  it("applies display preferences while keeping manual layout switching available", async () => {
    const slot = await open([file("a.ts")], {}, {}, { fileIcons: false, defaultView: "split", fontSize: 16, refreshOnReturn: false });
    await waitFor(() => expect(slot.getByRole("button", { name: "Split", pressed: true })).toBeTruthy());
    expect(slot.container.querySelector(".dt-file-icon")).toBeNull();
    await waitFor(() => expect((slot.container.querySelector(".dt-interactive-diff") as HTMLElement)?.style.getPropertyValue("--diffs-font-size")).toBe("16px"));
    fireEvent.click(slot.getByRole("button", { name: "Unified" }));
    expect(slot.getByRole("button", { name: "Unified", pressed: true })).toBeTruthy();
    fireEvent(document, new Event("visibilitychange"));
    expect(slot.inspection.sdkCalls.filter(call => call.method === "threads.get")).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles")).toHaveLength(2));
  });

  it("selects chat targets, opens their folders and makes unchanged targets explicit", async () => {
    const slot = await open([file("a.ts"), file("src/b.py")]);
    fireEvent.click(slot.getByRole("button", { name: "Collapse all" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Search files" }), { target: { value: "a.ts" } });
    act(() => requestFile("thread-1", "src/b.py"));
    await waitFor(() => expect(slot.getByRole("button", { name: /b.py/ }).getAttribute("aria-current")).toBe("true"));
    expect((slot.getByRole("textbox", { name: "Search files" }) as HTMLInputElement).value).toBe("");
    act(() => requestFile("thread-1", "unchanged.py"));
    await slot.findByText("No changes for this file in the selected comparison.");
    expect(slot.getByRole("link", { name: "Open file in VesnALIA" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: /a.ts/ }));
    expect(slot.queryByText("No changes for this file in the selected comparison.")).toBeNull();
  });

  it.each(["header", "cmd", "ctrl"])("adds a workspace mention through %s without submitting or changing selection", async gesture => {
    const slot = await open([file("a.ts"), file("src/b.py")]);
    if (gesture === "header") fireEvent.click(slot.getByRole("button", { name: "Add file mention to chat" }));
    else fireEvent.click(slot.getByRole("button", { name: /b.py/ }), { metaKey: gesture === "cmd", ctrlKey: gesture === "ctrl" });
    const path = gesture === "header" ? "a.ts" : "src/b.py";
    expect(slot.inspection.composer.text).toContain("Existing draft");
    expect(slot.inspection.composer.draft.mentions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "path", source: "workspace", entryKind: "file", path })]));
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(slot.getByRole("button", { name: /a.ts/ }).getAttribute("aria-current")).toBe("true");
    expect(slot.getByRole("button", { name: /b.py/ }).querySelector(".dt-file-icon svg path")).toBeTruthy();
  });

  it.each(["Unified", "Split"])("expands context in both directions and at both file edges in %s view", async view => {
    const old = Array.from({ length: 180 }, (_, i) => `line ${i + 1}\n`).join("");
    const next = old.replace("line 40\n", "changed 40\n").replace("line 140\n", "changed 140\n");
    const content = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -39,3 +39,3 @@\n line 39\n-line 40\n+changed 40\n line 41\n@@ -139,3 +139,3 @@\n line 139\n-line 140\n+changed 140\n line 141\n";
    const slot = await open([file("a.ts")], {
      diffPatch: async () => ({ outcome: "available", patches: [{ path: "a.ts", patch: content, truncated: false }] }),
      diffFile: async ({ side }: { side: string }) => ({ path: "a.ts", content: side === "old" ? old : next, contentEncoding: "utf8", sizeBytes: 1600 }),
    });
    fireEvent.click(slot.getByRole("button", { name: view }));
    let shadow: ShadowRoot;
    await waitFor(() => { shadow = slot.container.querySelector("diffs-container")!.shadowRoot!; expect(shadow?.querySelector('[data-expand-up]')).toBeTruthy(); });
    const gap = () => shadow.querySelector('[data-separator]:not([data-separator-first]):not([data-separator-last])')!;
    expect(shadow!.querySelector('[data-column-number="42"]')).toBeNull();
    fireEvent.click(gap().querySelector('[data-expand-up]')!);
    await waitFor(() => expect(shadow.querySelector('[data-column-number="42"]')).toBeTruthy());
    fireEvent.click(gap().querySelector('[data-expand-down]')!);
    await waitFor(() => expect(shadow.querySelector('[data-column-number="138"]')).toBeTruthy());
    fireEvent.click(shadow!.querySelector('[data-separator-first] [data-expand-down]')!);
    await waitFor(() => expect(shadow.querySelector('[data-column-number="38"]')).toBeTruthy());
    fireEvent.click(shadow!.querySelector('[data-separator-last] [data-expand-up]')!);
    await waitFor(() => expect(shadow.querySelector('[data-column-number="142"]')).toBeTruthy());
    const line = shadow!.querySelector('[data-column-number="42"]')!;
    Object.defineProperty(shadow!, "elementFromPoint", { value: () => line, configurable: true });
    for (const type of ["pointerdown", "pointerup"]) {
      const event = new MouseEvent(type, { bubbles: true, composed: true, button: 0, clientX: 40, clientY: 40 });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
      fireEvent(type === "pointerdown" ? line : document, event);
    }
    fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
    expect(slot.inspection.composer.text).toContain(" line 42");
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFile").map(call => call.args[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "all", mergeBaseRef: "abc", side: "old" }), expect.objectContaining({ target: "all", mergeBaseRef: "abc", side: "new" }),
    ]));
  });

  it("keeps the patch readable when full context cannot be loaded", async () => {
    const slot = await open([file("a.ts")], { diffFile: async () => { throw new Error("File unavailable"); } });
    await slot.findByText("Unchanged lines unavailable: File unavailable");
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.querySelector('[data-column-number="1"]')).toBeTruthy());
    expect(slot.queryByRole("alert")).toBeNull();
  });
  it("groups files, searches paths, expands search results and loads only the chosen patch", async () => {
    const slot = await open([file("src/domain/account.ts"), file("src/api/routes.ts"), file("README.md")]);
    expect(slot.getByRole("button", { name: /src/ }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(slot.getByRole("button", { name: "Collapse all" }));
    expect(slot.queryByRole("button", { name: /account.ts/ })).toBeNull();
    fireEvent.change(slot.getByRole("textbox", { name: "Search files" }), { target: { value: "domain/acc" } });
    await slot.findByRole("button", { name: /account.ts/ });
    expect(slot.queryByRole("button", { name: /routes.ts/ })).toBeNull();
    await waitFor(() => expect(slot.inspection.sdkCalls.some(call => call.method === "environments.diffPatch" && JSON.stringify(call.args).includes("src/domain/account.ts"))).toBe(true));
  });

  it("resolves the configured base branch and switches to working-copy changes", async () => {
    const slot = await open([file("a.ts")]);
    const initial = slot.inspection.sdkCalls.find(call => call.method === "environments.diffFiles");
    expect(initial?.args[0]).toMatchObject({ environmentId: "env-1", target: "all", mergeBaseBranch: "develop" });
    fireEvent.change(slot.getByRole("combobox", { name: "Changes scope" }), { target: { value: "uncommitted" } });
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles").at(-1)?.args[0]).toMatchObject({ target: "uncommitted" }));
  });

  it("shows all files and loads their patches before the first commit, including with an explicit base", async () => {
    const unbornStatus = { ...statusResult, workspace: { ...statusResult.workspace,
      checkout: { kind: "unborn", branchName: "main" }, mergeBase: null,
    } };
    const slot = await open([file("first.ts")], {
      status: async () => unbornStatus,
      diffFiles: async ({ target }: { target: string }) => filesResult(target === "uncommitted" ? [file("first.ts")] : []),
      diffPatch: async ({ target, paths }: { target: { type: string }; paths: string[] }) => ({ outcome: "available", patches: target.type === "uncommitted" ? paths.map(patch) : [] }),
    });
    await slot.findByRole("button", { name: /first.ts/ });
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch").at(-1)?.args[0]).toMatchObject({ target: { type: "uncommitted" }, paths: ["first.ts"] }));
    fireEvent.change(slot.getByRole("textbox", { name: "Base" }), { target: { value: "release" } });
    await slot.findByRole("button", { name: /first.ts/ });
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles")).toHaveLength(2));
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles").at(-1)?.args[0]).toMatchObject({ target: "uncommitted" });
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("resumes branch comparison after the first commit", async () => {
    let committed = false;
    const slot = await open([file("first.ts")], {
      status: async () => committed ? statusResult : { ...statusResult, workspace: { ...statusResult.workspace, checkout: { kind: "unborn", branchName: "main" }, mergeBase: null } },
    });
    expect(slot.inspection.sdkCalls.find(call => call.method === "environments.diffFiles")?.args[0]).toMatchObject({ target: "uncommitted" });
    committed = true;
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles").at(-1)?.args[0]).toMatchObject({ target: "all", mergeBaseBranch: "develop" }));
  });

  it("compares with the creation branch and supports manual selection and automatic reset", async () => {
    const slot = await open([file("a.ts")], {
      get: async () => environmentFixture({ baseBranch: "feature/parent", mergeBaseBranch: "develop" }),
    });
    const picker = slot.getByTestId("alia-branch-picker");
    expect(picker.getAttribute("data-host-id")).toBe("host-1");
    expect(picker.getAttribute("data-project-id")).toBe("project-1");
    expect((slot.getByRole("textbox", { name: "Base" }) as HTMLInputElement).value).toBe("feature/parent");
    expect(slot.getByLabelText("Created from feature/parent")).toBeTruthy();
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch").at(-1)?.args[0]).toMatchObject({ target: { type: "all", mergeBaseBranch: "feature/parent" } }));
    fireEvent.change(slot.getByRole("textbox", { name: "Base" }), { target: { value: "origin/release" } });
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles").at(-1)?.args[0]).toMatchObject({ mergeBaseBranch: "origin/release" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch").at(-1)?.args[0]).toMatchObject({ target: { type: "all", mergeBaseBranch: "origin/release" } }));
    fireEvent.click(slot.getByRole("button", { name: "Use automatic comparison branch" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles").at(-1)?.args[0]).toMatchObject({ mergeBaseBranch: "feature/parent" }));
    expect(slot.getByRole("option", { name: "All changes" })).toBeTruthy();
    expect(slot.getByRole("option", { name: "Uncommitted" })).toBeTruthy();
  });

  it("keeps the branch picker available when comparison fails", async () => {
    const slot = await open([file("a.ts")], {
      diffFiles: async ({ mergeBaseBranch }: { mergeBaseBranch: string }) => {
        if (mergeBaseBranch === "missing") throw new Error("Branch not found");
        return filesResult([file("a.ts")]);
      },
    });
    fireEvent.change(slot.getByRole("textbox", { name: "Base" }), { target: { value: "missing" } });
    expect(await slot.findByRole("alert")).toBeTruthy();
    fireEvent.change(slot.getByRole("textbox", { name: "Base" }), { target: { value: "main" } });
    await slot.findByRole("navigation", { name: "Changes tree" });
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("loads recent-commit ranges and an individual history commit through the same immutable target", async () => {
    const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
    const slot = await open([file("a.ts")], {}, {
      history: () => ({ commits: [{ sha: b, shortSha: "bbbbbbbb", subject: "Latest", author: "Test", timestamp: 1 }, { sha: a, shortSha: "aaaaaaaa", subject: "Previous", author: "Test", timestamp: 0 }], hasMore: false }),
      committedChanges: ({ selection }: { selection: { kind: string; sha: string } }) => ({ from: c, to: selection.kind === "since" ? b : selection.sha, label: selection.kind === "since" ? "Selected range" : "Selected commit", files: [file("history.ts")], truncated: false }),
      committedPatch: ({ path }: { path: string }) => patch(path),
      committedContents: () => ({ old: "old\n", next: "new\n" }),
    });
    fireEvent.change(slot.getByRole("combobox", { name: "Changes scope" }), { target: { value: "recent" } });
    await slot.findByRole("button", { name: /history.ts/ });
    fireEvent.change(slot.getByRole("combobox", { name: "Starting commit" }), { target: { value: a } });
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "committedChanges").at(-1)?.input).toMatchObject({ selection: { kind: "since", sha: a } }));
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "committedPatch").at(-1)?.input).toMatchObject({ from: c, to: b, path: "history.ts" }));
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "committedContents").at(-1)?.input).toMatchObject({ from: c, to: b, path: "history.ts" }));
    fireEvent.change(slot.getByRole("combobox", { name: "Changes scope" }), { target: { value: "commit" } });
    await slot.findByRole("option", { name: /Previous/ });
    fireEvent.change(slot.getByRole("combobox", { name: "Commit" }), { target: { value: a } });
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "committedChanges").at(-1)?.input).toMatchObject({ selection: { kind: "commit", sha: a } }));
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "committedPatch").at(-1)?.input).toMatchObject({ from: c, to: a }));
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "committedContents").at(-1)?.input).toMatchObject({ from: c, to: a }));
  });

  it("adds exact lines and their revision to the existing draft without submitting", async () => {
    const slot = await open([file("a.ts")]);
    let line: Element | undefined;
    await waitFor(() => {
      const shadow = slot.container.querySelector("diffs-container")?.shadowRoot;
      line = Array.from(shadow?.querySelectorAll('[data-column-number="1"]') ?? []).at(-1);
      expect(line).toBeTruthy();
    });
    const pointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, composed: true, button: 0, clientX: 40, clientY: 40 });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
      fireEvent(type === "pointerup" ? document : line!, event);
    };
    const shadow = slot.container.querySelector("diffs-container")!.shadowRoot!;
    Object.defineProperty(shadow, "elementFromPoint", { value: () => line, configurable: true });
    pointer("pointerdown"); pointer("pointerup");
    fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
    expect(slot.inspection.composer.text).toContain("Existing draft");
    expect(slot.inspection.composer.text).toContain("a.ts");
    expect(slot.inspection.composer.text).toContain("new line 1");
    expect(slot.inspection.composer.text).toContain("From develop");
    expect(slot.inspection.composer.text).toContain("new");
    expect(slot.inspection.composer.submits).toHaveLength(0);
  });

  it.each(["shift", "drag"])("selects multiple rendered lines with %s and adds exactly that diff to the draft", async gesture => {
    const content = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n d\n";
    const slot = await open([file("a.ts")], { diffPatch: async () => ({ outcome: "available", patches: [{ path: "a.ts", patch: content, truncated: false }] }) });
    let shadow: ShadowRoot;
    await waitFor(() => { shadow = slot.container.querySelector("diffs-container")!.shadowRoot!; expect(shadow?.querySelector('[data-column-number="4"]')).toBeTruthy(); });
    const line = (n: number) => Array.from(shadow.querySelectorAll(`[data-column-number="${n}"]`)).at(-1)!;
    let hovered = line(1);
    Object.defineProperty(shadow!, "elementFromPoint", { value: () => hovered, configurable: true });
    const pointer = (type: string, target: Element | Document, shiftKey = false) => {
      const event = new MouseEvent(type, { bubbles: true, composed: true, shiftKey, button: 0, clientX: 40, clientY: 40 });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
      fireEvent(target, event);
    };
    pointer("pointerdown", hovered);
    if (gesture === "shift") {
      pointer("pointerup", document);
      hovered = line(3); pointer("pointerdown", hovered, true);
    } else {
      hovered = line(3); pointer("pointermove", hovered);
    }
    pointer("pointerup", document);
    fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
    expect(slot.inspection.composer.text).toContain(" a\n-b\n+B\n c");
    expect(slot.inspection.composer.text).not.toContain("\n d");
    expect(slot.inspection.composer.text).toContain("new line 1 → new line 3");
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(slot.queryByRole("spinbutton", { name: "First line" })).toBeNull();
  });

  it("does not download patches for binary files", async () => {
    const slot = await open([file("archive.bin", { binary: true })]);
    await slot.findByText(/Binary file/);
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch")).toHaveLength(0);
  });

  it("keeps selection and collapsed folders across refresh", async () => {
    const slot = await open([file("a.ts"), file("src/b.ts")]);
    fireEvent.click(slot.getByRole("button", { name: /b.ts/ }));
    fireEvent.click(slot.getByRole("button", { name: /src/ }));
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles")).toHaveLength(2));
    expect(slot.getByRole("button", { name: /src/ }).getAttribute("aria-expanded")).toBe("false");
    expect(slot.getByText("src/b.ts")).toBeTruthy();
  });

  it("keeps the rendered diff while a chat navigation refresh is pending, then updates it without a loading flash", async () => {
    let refreshing = false;
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const slot = await open([file("a.ts")], {
      diffPatch: async () => refreshing ? pending : { outcome: "available", patches: [patch("a.ts")] },
      diffFile: async ({ side }: { side: string }) => ({ path: "a.ts", content: side === "old" ? "old\n" : refreshing ? "updated\n" : "new\n", contentEncoding: "utf8", sizeBytes: 8 }),
    });
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("new"));
    const viewer = slot.container.querySelector(".dt-interactive-diff");
    refreshing = true;
    act(() => requestFile("thread-1", "a.ts"));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch")).toHaveLength(2));
    expect(slot.queryByText("Loading diff…")).toBeNull();
    expect(slot.container.querySelector(".dt-interactive-diff")).toBe(viewer);
    expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("new");
    expect(slot.queryByText(/File contents changed/)).toBeNull();
    await act(async () => { finish({ outcome: "available", patches: [{ ...patch("a.ts"), patch: patch("a.ts").patch.replace("+new", "+updated") }] }); });
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("updated"));
    expect(slot.container.querySelector(".dt-interactive-diff")).toBe(viewer);
    expect(slot.queryByText("Loading diff…")).toBeNull();
    expect(slot.queryByText(/File contents changed/)).toBeNull();
  });

  it("opens a new viewer directly on the chat target without loading a default file or refreshing twice", async () => {
    act(() => requestFile("thread-1", "src/b.py"));
    const slot = await open([file("a.ts"), file("src/b.py")]);
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("new"));
    expect(slot.getByRole("button", { name: /b.py/ }).getAttribute("aria-current")).toBe("true");
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffFiles")).toHaveLength(1);
    expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch").map(call => call.args[0])).toEqual([expect.objectContaining({ paths: ["src/b.py"] })]);
  });

  it("discards a pending background refresh after switching the comparison branch", async () => {
    let refreshing = false;
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const slot = await open([file("a.ts")], {
      diffFiles: async ({ mergeBaseBranch }: { mergeBaseBranch: string }) => ({ ...filesResult([file("a.ts")]), mergeBaseRef: mergeBaseBranch === "release" ? "release-ref" : "abc" }),
      diffPatch: async ({ target }: { target: { mergeBaseBranch: string } }) => target.mergeBaseBranch === "release"
        ? { outcome: "available", patches: [{ ...patch("a.ts"), patch: patch("a.ts").patch.replace("+new", "+release") }] }
        : refreshing ? pending : { outcome: "available", patches: [patch("a.ts")] },
      diffFile: async ({ side, mergeBaseRef }: { side: string; mergeBaseRef: string }) => ({ path: "a.ts", content: side === "old" ? "old\n" : mergeBaseRef === "release-ref" ? "release\n" : "new\n", contentEncoding: "utf8", sizeBytes: 8 }),
    });
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("new"));
    refreshing = true;
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(slot.inspection.sdkCalls.filter(call => call.method === "environments.diffPatch")).toHaveLength(2));
    fireEvent.change(slot.getByRole("textbox", { name: "Base" }), { target: { value: "release" } });
    expect(slot.container.querySelector(".dt-interactive-diff")).toBeNull();
    await waitFor(() => expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("release"));
    await act(async () => { finish({ outcome: "available", patches: [{ ...patch("a.ts"), patch: patch("a.ts").patch.replace("+new", "+stale") }] }); });
    expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("release");
    expect(slot.container.querySelector("diffs-container")?.shadowRoot?.textContent).not.toContain("stale");
  });

  it("shows non-Git environments as an actionable error", async () => {
    const app = await loadPluginApp(() => import("../src/app/index"));
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "t", params: null }, { sdk: {
      threads: { get: async () => makeThreadResponse({ environmentId: "e" }) },
      environments: { get: async () => environmentFixture(), status: async () => ({ outcome: "not_applicable", message: "Not a Git repository", reason: "non_git_environment" }) },
    } });
    cleanups.push(() => slot.lifecycle.unmount());
    expect(await slot.findByRole("alert")).toBeTruthy();
  });
});
