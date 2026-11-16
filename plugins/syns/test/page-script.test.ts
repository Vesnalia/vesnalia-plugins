import { Script, createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { VERSION, buildDeclaration } from "../src/declaration.js";
import { METHODS } from "../src/methods/index.js";
import { PAGEHOST } from "../src/pagehost.js";
import { fakeBb } from "./fake-bb.js";
import { rec } from "./fake-runner.js";

/** One page-script ask as Thread Pages sends it (unife-pages 07 R5.88). */
const ask = (have: string | null, workspace: unknown = { id: "proj_1", path: "/work/plans", machine: "host_9" }, sessionId: string | null = "thr_1") => ({ caller: { sessionId, workspace }, documentPath: "index.html", have });

describe("the page script's text (S2.28)", () => {
  it("parses as a script, and holds neither </script nor <!--, inside the host's 256 KiB (07 R5.90)", () => {
    expect(() => new Script(PAGEHOST)).not.toThrow();
    expect(PAGEHOST).not.toMatch(/<\/script|<!--/i);
    expect(Buffer.byteLength(PAGEHOST)).toBeLessThanOrEqual(256 * 1024);
  });

  it("is the page host and its bootstrap: it leaves the kernel and every contributor's page script to run, and shows a page through the host's own frame", () => {
    expect(PAGEHOST).toContain('if (window.SynsPages && window.SynsPages.frame) return;');
    expect(PAGEHOST).toContain('s.hasAttribute("data-thread-page-kernel") || s.hasAttribute("data-thread-page-contributor")');
    expect(PAGEHOST).toContain("this.stop = window.threadPage.embed(this.frame, {");
    expect(PAGEHOST).toContain('const entry = ".page/index.html"');
    expect(PAGEHOST).not.toContain("data-app");
  });

  it("does nothing in a frame inside a page and boots in a page shown whole, read from the kernel's frame field, else from embedded (B-0119, D99)", () => {
    const boot = PAGEHOST.slice(PAGEHOST.lastIndexOf("(function () {"));
    /** Whether the bootstrap goes on past its frame check (it starts holding the page's scripts) for a kernel config. */
    const boots = (config: unknown) => {
      const kernel = config === undefined ? null : { getAttribute: () => JSON.stringify(config) };
      const observe = vi.fn(() => { throw new Error("booted"); });
      const win: Record<string, unknown> = { SynsPages: {}, Map, JSON, Array, MutationObserver: class { observe = observe; } };
      win.window = win;
      win.document = { currentScript: {}, readyState: "loading", querySelector: (q: string) => (q.startsWith("script[data-thread-page-kernel]") ? kernel : null) };
      try { runInContext(boot, createContext(win)); } catch (e) { if ((e as Error).message !== "booted") throw e; }
      return observe.mock.calls.length === 1;
    };
    // The host's home view of a session (an embed, shown whole) and a page at its own address boot the workspace.
    expect(boots({ embedded: true, frame: false })).toBe(true);
    expect(boots({ embedded: false, frame: false })).toBe(true);
    // A frame inside a page (an app, the agent's page in the workspace, a page another page embeds) runs as written.
    expect(boots({ embedded: true, frame: true })).toBe(false);
    // A host that does not say frame (Unife Pages before 0.6.0): every embed is a frame, as in 0.12.1.
    expect(boots({ embedded: true })).toBe(false);
    expect(boots({ embedded: false })).toBe(true);
    expect(boots({})).toBe(true);
    // No kernel config, or one that is no object: a page.
    expect(boots(undefined)).toBe(true);
    expect(boots(null)).toBe(true);
  });

  it("with no workspace to read, leaves the page as written and runs its scripts once: any failure of the first read, or no .page/index.html (S2.29)", () => {
    expect(PAGEHOST).toContain("catch (e) { if (app.version) throw e; return showWritten(); }");
    expect(PAGEHOST).toContain('if (app.version) throw new Error(entry + " is no longer in the repository"); return showWritten();');
    expect(PAGEHOST).toContain("if (shown) return;");
    expect(PAGEHOST).not.toContain("so there is no app to load");
  });

  it("clears the document only once the workspace is there, so the host's restore of drafts and scroll finds the page (S2.29)", () => {
    const capture = PAGEHOST.slice(PAGEHOST.indexOf("function capture()"), PAGEHOST.indexOf("function clear()"));
    expect(capture).not.toContain("remove()" + ";\n    Array.from(document.body.attributes)");
    expect(capture).not.toContain('say("Loading…")');
    const load = PAGEHOST.slice(PAGEHOST.indexOf("async function load()"));
    expect(load.indexOf("if (!app.version) { clear(); listen(); }")).toBeGreaterThan(load.indexOf("if (!index || index.text === undefined)"));
  });

  it("clearing the document for the workspace keeps the kernel and every plugin's page script, which the host carries into each frame it shows, so an app's links open (B-0103 verify F2)", () => {
    const boot = PAGEHOST.slice(PAGEHOST.lastIndexOf("(function () {"));
    const code = /const served = .*?;\n/.exec(boot)![0] + boot.slice(boot.indexOf("function clear()"), boot.indexOf("function say("));
    const el = (tagName: string, attrs: string[] = []) => ({ tagName, hasAttribute: (a: string) => attrs.includes(a), remove() { head.splice(head.indexOf(this), 1); } });
    const kernel = el("SCRIPT", ["data-thread-page-kernel"]), syns = el("SCRIPT", ["data-thread-page-contributor"]), other = el("SCRIPT", ["data-thread-page-contributor"]);
    const head: any[] = [el("META"), kernel, syns, other, el("SCRIPT"), el("STYLE"), el("LINK"), el("TITLE")];
    const doc = { head: { get children() { return head.slice(); }, appendChild: (n: unknown) => head.push(n) }, body: { attributes: [] }, createElement: (tag: string) => el(tag.toUpperCase()) };
    runInContext(code + "clear();", createContext({ document: doc, me: syns, say() {}, Array }));
    expect(head.map((n) => n.tagName)).toEqual(["META", "SCRIPT", "SCRIPT", "SCRIPT", "STYLE"]);
    expect(head.slice(1, 4)).toEqual([kernel, syns, other]);
  });

  it("once the workspace is shown, takes a saved page through threadPage.onPageUpdate where the host offers it: SynsPages.page and only its frames change, no new boot (S2.30)", () => {
    const load = PAGEHOST.slice(PAGEHOST.indexOf("async function load()"));
    expect(load).toContain("if (!app.version) { clear(); listen(); }");
    expect(load.indexOf("listen();")).toBeGreaterThan(load.indexOf("return showWritten();"));
    const listen = PAGEHOST.slice(PAGEHOST.indexOf("function listen()"), PAGEHOST.indexOf("function clear()"));
    expect(listen).toContain('if (typeof window.threadPage.onPageUpdate !== "function") return;');
    expect(listen).toContain("P.showPage(describe(doc.documentElement, u.documentPath, doc.title));");
    expect(PAGEHOST).toContain('if (f.src.kind === "page" && f.src.html !== undefined && f.src.path === page.path) { f.src.html = page.html || "<html></html>"; f.load(); }');
    expect(PAGEHOST).toContain("live.add(this);");
    expect(PAGEHOST).toContain("live.delete(this);");
  });
});

/**
 * The page host run in a stand-in window whose host offers threadPage.embed: a frame of `src`, what it read through
 * `call`, and what it handed the host's embed. The document parser is a stand-in that keeps the text as given.
 */
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((settled) => setTimeout(settled, 0)); };
const hosted = async (src: Record<string, unknown>, files: Record<string, string> = {}, embed: unknown = true, holds: boolean | "silent" = true, read: { errors?: Record<string, string>; defer?: string[] } = {}) => {
  const calls: [string, Record<string, unknown>][] = [];
  const embeds: { target: unknown; options: Record<string, any>; stopped: boolean }[] = [];
  const probes: { scope: unknown; html: string; stopped: boolean }[] = [];
  const listeners: ((e: unknown) => void)[] = [];
  const queried: string[] = [];
  const el = (tag: string) => ({ tag, style: {}, attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, remove() {}, contentWindow: { tag: "frame-window", n: Math.random() } });
  const parsed = (text: string) => {
    const head: unknown[] = [];
    return { querySelectorAll: (q: string) => { queried.push(q); return []; }, querySelector: (q: string) => { queried.push(q); return null; }, createElement: el, head: { prepend: (n: unknown) => head.unshift(n) },
      documentElement: { get outerHTML() { return head.map((n: any) => (n.tag === "script" ? `<script>${n.textContent}</script>` : `<meta name="${n.attrs.name}">`)).join("") + text; } } };
  };
  const win: Record<string, unknown> = { setTimeout, clearTimeout, setInterval, clearInterval, console, removeEventListener() {},
    addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === "message") listeners.push(fn); } };
  win.window = win;
  win.parent = win;
  win.document = { createElement: el, querySelector: () => null, visibilityState: "visible" };
  win.DOMParser = class { parseFromString(text: string) { return parsed(text); } };
  // The host's embed; the page host's hidden check of the frame's bound (title "Syns check") answers `holds` from its frame.
  const hostEmbed = (target: { contentWindow: unknown }, options: Record<string, any>) => {
    if (options.title === "Syns check") {
      const probe = { scope: options.scope, html: options.html as string, stopped: false };
      probes.push(probe);
      if (holds !== "silent") setTimeout(() => listeners.forEach((fn) => fn({ source: target.contentWindow, data: { __tool: "bound", bound: holds } })), 0);
      return () => { probe.stopped = true; };
    }
    const one = { target, options, stopped: false };
    embeds.push(one);
    return () => { one.stopped = true; };
  };
  win.threadPage = { invoke: () => Promise.reject(new Error("not this one")), ...(typeof embed === "function" ? { embed } : embed ? { embed: hostEmbed } : {}) };
  runInContext(PAGEHOST, createContext(win));
  const call = (method: string, params: Record<string, unknown>) => {
    calls.push([method, params]);
    // As syns.readMany answers (01 S1.16): a text, or an error (not_found for a missing path); a path it defers is not in files.
    if (method === "syns.readMany") {
      const paths = params.paths as string[], deferred = paths.length > 1 ? paths.filter((p) => (read.defer || []).includes(p)) : [];
      const one = (path: string) => (read.errors && read.errors[path] ? { path, error: read.errors[path] } : files[path] === undefined ? { path, error: "not_found" } : { path, text: files[path] });
      return Promise.resolve({ version: "v1", files: paths.filter((p) => !deferred.includes(p)).map(one), deferred });
    }
    return Promise.resolve({});
  };
  const states: Record<string, unknown>[] = [];
  const f = (win.SynsPages as { frame: (c: unknown, s: unknown, o: unknown) => any }).frame({ appendChild() {} }, src, { call, sessionId: "thr_1", onState: (s: Record<string, unknown>) => states.push(s) });
  await settle();
  const fromFrame = (data: unknown) => listeners.forEach((fn) => fn({ source: f.frame.contentWindow, data }));
  return { f, calls, embeds, probes, states, fromFrame, queried };
};

describe("an app is a frame of the page, the host's own (B-0103, B-0102, B-0104; Unife Pages IN-0020)", () => {
  it("hands the host the app's document with its folder as scope and its name as title, reading only the document", async () => {
    const { f, calls, embeds, states } = await hosted({ kind: "repo", folder: "apps/board/" }, { "apps/board/index.html": "<p>board</p>" });
    expect(calls).toEqual([["syns.readMany", { paths: ["apps/board/.page/index.html", "apps/board/index.html"] }], ["syns.readMany", { paths: ["apps/board/index.html"] }]]);
    expect(embeds).toHaveLength(1);
    expect(embeds[0].target).toBe(f.frame);
    expect(embeds[0].options).toMatchObject({ scope: "apps/board", title: "board" });
    expect(embeds[0].options.html).toBe('<!doctype html>\n<meta name="syns-pages-frame"><p>board</p>');
    embeds[0].options.onState({ status: "shown" });
    expect(states.at(-1)).toEqual({ status: "shown", message: "", failures: [] });
    embeds[0].options.onState({ status: "too_large" });
    expect(states.at(-1)).toMatchObject({ status: "failed", message: "apps/board/index.html: too large to show in a frame" });
  });

  it("shows the agent's own page with no scope, as the page shown as written (S2.32)", async () => {
    const { embeds } = await hosted({ kind: "page", path: "notes/plan.html", html: "<h1>Plan</h1>" });
    expect(embeds[0].options).toMatchObject({ scope: null, title: "plan" });
    expect(embeds[0].options.html).toContain("<h1>Plan</h1>");
  });

  it("relays nothing of the frame's but its links: no call, no form answer, no drafts, no storage of its own", async () => {
    const { calls, fromFrame } = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<form></form>" });
    const before = calls.length;
    fromFrame({ __tool: "invoke", id: 1, method: "session.reply", params: { text: "hi" } });
    fromFrame({ __tool: "form", title: "T", answers: [{ label: "a", value: "b" }] });
    fromFrame({ __tool: "draft", values: { a: 1 } });
    await new Promise((settled) => setTimeout(settled, 0));
    expect(calls.slice(before)).toEqual([]);
    for (const gone of ["const SHIM", "formdone", "session.reply", "storage.get", "storage.set", "nsKey", "stateKey", "CACHED", "data-thread-page-kernel], script[data-thread-page-contributor], base"]) expect(PAGEHOST, gone).not.toContain(gone);
  });

  it("leaves an app's forms to the host, as a Thread Page's: a method=\"dialog\" form and one marked data-thread-page-manual reach the host as written, and nothing of the page host's hears a submit (B-0104, Q-0038)", async () => {
    const forms = '<form method="dialog"><button>OK</button></form><form data-thread-page-manual><input name="q"></form><form><input name="a"></form>';
    const { embeds, queried } = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": forms });
    expect(embeds[0].options.html).toBe('<!doctype html>\n<meta name="syns-pages-frame">' + forms);
    // It looks for no form in the app's document, so none is taken out or changed before the host gets it.
    expect(queried.filter((q) => /form|dialog|thread-page-manual/i.test(q))).toEqual([]);
    expect(PAGEHOST).not.toMatch(/["'`](submit|dialog|form)["'`]|data-thread-page-manual|submitter|__tool:\s*["'`]form/);
  });

  it("a reload hands the host the document again on the same frame, not stopping it, so the reader's drafts and scroll stay (Unife Pages 0.5.3, IN-0027)", async () => {
    const { f, embeds } = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<p>1</p>" });
    f.changed(["apps/board/style.css"]);
    await settle();
    expect(embeds.map((e) => [e.target === f.frame, e.options.scope, e.stopped])).toEqual([[true, "apps/board", false], [true, "apps/board", false]]);
    f.changed(["apps/other/x.css"]);
    await settle();
    expect(embeds).toHaveLength(2);
  });

  it("another document of the app, by a link, is a fresh frame: the one shown is stopped first", async () => {
    const { f, embeds, fromFrame } = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<a href=\"other.html\">o</a>", "apps/board/other.html": "<p>other</p>" });
    fromFrame({ __tool: "link", href: "other.html", newTab: false });
    await settle();
    expect(embeds.map((e) => e.stopped)).toEqual([true, false]);
    expect(embeds[1].options.html).toContain("<p>other</p>");
    f.reload();
    await settle();
    expect(embeds.map((e) => e.stopped)).toEqual([true, true, false]);
  });

  it("f.reload() starts the app again in a fresh frame; a new version of the agent's page (showPage) is the same frame's (S2.30)", async () => {
    const app = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<p>1</p>" });
    app.f.reload();
    await settle();
    expect(app.embeds.map((e) => e.stopped)).toEqual([true, false]);
    const page = await hosted({ kind: "page", path: "index.html", html: "<h1>1</h1>" });
    (page.f as { src: { html: string } }).src.html = "<h1>1</h1>";
    expect(PAGEHOST).toContain("P.showPage = function (page) {");
    page.f.load();
    await settle();
    expect(page.embeds.map((e) => [e.stopped, e.options.scope])).toEqual([[false, null], [false, null]]);
  });

  it("checks once, in a hidden frame of the app's folder, that the host holds a frame in its folder; on a host that does not (before Thread Pages 1.13.4, Unife Pages 0.5.4) it shows no app (review F1)", async () => {
    const held = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<p>1</p>" });
    expect(held.probes).toEqual([{ scope: "apps/board", html: expect.stringContaining("threadPage.setScope(null)"), stopped: true }]);
    held.f.reload();
    await settle();
    expect(held.probes).toHaveLength(1);
    expect(held.embeds).toHaveLength(2);

    const older = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<p>1</p>" }, true, false);
    expect(older.embeds).toEqual([]);
    expect(older.states.at(-1)).toMatchObject({ status: "failed", message: "showing a page in a frame needs Thread Pages 1.13.4 or Unife Pages 0.5.4" });
    // The agent's own page is shown with no folder, so it needs no check.
    const page = await hosted({ kind: "page", path: "plan.html", html: "<h1>Plan</h1>" }, {}, true, false);
    expect([page.probes, page.embeds.length]).toEqual([[], 1]);
  });

  it("the check's frame says what its setScope(null) did: a TypeError is a held frame, a null answer an older host", () => {
    const probe = /const PROBE = (".*?" \+ ".*?");/.exec(PAGEHOST)![1];
    const html = runInContext(probe, createContext({})) as string;
    const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</" + "script>"));
    for (const [thrown, holds] of [["TypeError", true], [null, false], ["Error", false]] as const) {
      const posted: unknown[] = [];
      const frame = createContext({ parent: { postMessage: (data: unknown) => posted.push(data) } });
      // The frame's kernel throws its own realm's TypeError.
      frame.threadPage = { setScope: () => { if (thrown) throw new (runInContext(thrown, frame))("outside"); return null; } };
      runInContext(script, frame);
      expect(posted).toEqual([{ __tool: "bound", bound: holds }]);
    }
  });

  it("on a host without the frame call, says which it needs and shows nothing", async () => {
    const { embeds, states } = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<p>1</p>" }, false);
    expect(embeds).toEqual([]);
    expect(states.at(-1)).toMatchObject({ status: "failed", message: "showing a page in a frame needs Thread Pages 1.13.4 or Unife Pages 0.5.4" });
    // Thread Pages 1.12 and Unife Pages 0.4 have the call, for another session's page alone
    const older = await hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<p>1</p>" }, (() => { throw new TypeError("threadPage.embed needs { sessionId }"); }) as unknown);
    expect(older.states.at(-1)).toMatchObject({ status: "failed", message: "showing a page in a frame needs Thread Pages 1.13.4 or Unife Pages 0.5.4 (threadPage.embed needs { sessionId })" });
  });

  it("a host that refuses the check's frame for one folder says so for that app and asks again for the next (review 2 F2)", async () => {
    let refuse = true;
    const embed = (_target: unknown, options: Record<string, any>) => {
      if (refuse && options.scope === "bad folder") throw new Error("scope is not a folder of this page");
      return () => undefined;
    };
    const one = await hosted({ kind: "repo", folder: "bad folder" }, { "bad folder/index.html": "<p>1</p>" }, embed);
    expect(one.states.at(-1)).toMatchObject({ status: "failed", message: "scope is not a folder of this page" });
    refuse = false;
    // Not kept: the next load asks again (here it gets no answer from the stand-in, so it waits on the check).
    one.f.reload();
    await settle();
    expect(one.states.at(-1)).toMatchObject({ status: "loading" });
  });

  it("with no answer from the check's frame within 10 s, the load fails saying so and the next one asks again", async () => {
    vi.useFakeTimers();
    try {
      const silent = hosted({ kind: "repo", folder: "apps/board" }, { "apps/board/index.html": "<p>1</p>" }, true, "silent");
      await vi.advanceTimersByTimeAsync(9_000);
      const { f, probes, embeds, states } = await (async () => { await vi.advanceTimersByTimeAsync(1_500); return silent; })();
      expect(states.at(-1)).toMatchObject({ status: "failed", message: "the host did not say whether it holds an app in its folder; reload to try again" });
      expect([probes.map((p) => p.stopped), embeds]).toEqual([[true], []]);
      f.reload();
      await vi.advanceTimersByTimeAsync(10);
      expect(probes).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows an app's ../ links as far as the session's folder; one climbing above it loads nothing (S1.25, Q-0025, B-0083)", () => {
    const helper = /const join = function \(dir, ref\) \{[\s\S]*?\n  \};/.exec(PAGEHOST)![0];
    const join = new Function(helper + " return join;")() as (dir: string, ref: string) => string;
    expect(join("tools/app", "style.css")).toBe("tools/app/style.css");
    expect(join("tools/app", "../shared/theme.css")).toBe("tools/shared/theme.css");
    expect(join("tools/app", "../../notes/plan.css?v=2")).toBe("notes/plan.css");
    expect(join("tools/app", "../../../x.css")).toBe("");
    expect(join("tools/app", "../../../../private/secret.txt")).toBe("");
    expect(PAGEHOST).toContain("await this.readAll(want.filter(Boolean), version)");
  });

  it("inside a frame it made, hands a link to the page host that made it; the kernel keeps #, mailto: and download links, and any link of a frame it did not make", () => {
    const posted: unknown[] = [];
    let click: ((e: unknown) => void) | null = null;
    const marked = { value: true };
    const kernel = { getAttribute: () => JSON.stringify({ embedded: true }) };
    let capture: unknown = null;
    const win: Record<string, unknown> = { console, addEventListener: (type: string, fn: (e: unknown) => void, phase: unknown) => { if (type === "click") { click = fn; capture = phase; } } };
    win.window = win;
    win.parent = { postMessage: (m: unknown) => posted.push(m) };
    win.document = { querySelector: (q: string) => (q.startsWith("script[data-thread-page-kernel]") ? kernel : q.includes("syns-pages-frame") && marked.value ? {} : null), readyState: "complete" };
    runInContext(PAGEHOST, createContext(win));
    // On window, in the capture phase: before the kernel's own listener on document (D96 point 2, review F6).
    expect(capture).toBe(true);
    const press = (href: string, more: Record<string, unknown> = {}) => {
      let prevented = false;
      const a = { getAttribute: () => href, hasAttribute: (n: string) => n === "download" && !!more.download, target: more.target ?? "" };
      click!({ target: { closest: () => a }, button: 0, defaultPrevented: false, metaKey: !!more.meta, ctrlKey: false, preventDefault: () => { prevented = true; } });
      return prevented;
    };
    expect(press("page2.html")).toBe(true);
    expect(press("https://example.com", { meta: true })).toBe(true);
    expect(posted).toEqual([{ __tool: "link", href: "page2.html", newTab: false }, { __tool: "link", href: "https://example.com", newTab: true }]);
    for (const href of ["#top", "mailto:a@b.c", "javascript:void 0"]) expect(press(href), href).toBe(false);
    expect(press("a.pdf", { download: true })).toBe(false);
    marked.value = false;
    expect(press("page2.html")).toBe(false);
    expect(posted).toHaveLength(2);
  });
});

/** SynsPages.tools as the page host has it, run in a stand-in window with nothing else. */
const toolsOf = (paths: string[]) => {
  const win: Record<string, unknown> = { addEventListener() {}, document: { querySelector: () => null } };
  win.window = win;
  win.parent = win;
  runInContext(PAGEHOST, createContext(win));
  return (win.SynsPages as { tools: (p: string[]) => { placed: string[]; html: string[]; all: string[] } }).tools(paths);
};

describe("a folder's .page/index.html is its app, and wins over an index.html beside it (S2.35, S2.28)", () => {
  // The scratch workspace of the spec's Expected rows, its root's .page/index.html the workspace.
  const ws = [
    ".page/index.html", ".syns.yaml",
    "specs/.page/index.html", "specs/.page/style.css", "specs/.page/app.js", "specs/.page/other.html", "specs/.page/icon.svg", "specs/product.md",
    "specs/design/.page/index.html", "specs/design/tokens.md",
    "work/.page/index.html", "work/003-pricing/.page/index.html", "work/003-pricing/work.md",
    "notes/a.md", "both/index.html", "both/.page/index.html", "plain/index.html",
    "tools/t/.syns.yaml", "tools/t/.page/index.html", "tools/t/sub/.page/index.html", "tools/t/sub/data.md",
    ".hidden/x/.page/index.html", "deep/.page/.page/index.html",
  ];

  it("SynsPages.tools counts a folder holding .page/index.html, inside a placed folder too, each folder once, never the root or a folder under a dot path (W11, A107)", () => {
    const t = toolsOf(ws.concat(["a/.page/index.htm", "a/.page/Index.html", "a/.page/x.html", "tools/t/site/index.html", ".page/x/index.html"]));
    const apps = ["specs/", "specs/design/", "work/", "work/003-pricing/", "both/", "plain/", "tools/t/sub/"];
    expect(t.placed).toEqual(["tools/t/"]);
    expect([...t.html].sort()).toEqual([...apps].sort());
    expect(t.all.slice(0, 1)).toEqual(["tools/t/"]);
    expect([...t.all].sort()).toEqual(["tools/t/", ...apps].sort());
    expect(new Set(t.all).size).toBe(t.all.length);
    for (const no of ["", "/", "notes/", ".hidden/x/", "deep/", "deep/.page/", "a/", "tools/t/site/", ".page/x/", ".page/"]) expect(t.all, no).not.toContain(no);
  });

  it("an app's entry is its .page/index.html unless the first read answers it not_found, else its index.html; a .page/index.html the read cannot serve fails the frame and opens nothing else (W12, A108)", async () => {
    const first = (folder: string) => ["syns.readMany", { paths: [folder + "/.page/index.html", folder + "/index.html"] }];
    // Only .page/index.html: shown, scope the folder, titled by the folder's name; its CSS and JS read from .page/.
    const only = await hosted({ kind: "repo", folder: "specs" }, { "specs/.page/index.html": "<p>specs</p>" });
    expect(only.calls).toEqual([first("specs"), ["syns.readMany", { paths: ["specs/.page/index.html"] }]]);
    expect(only.embeds).toHaveLength(1);
    expect(only.embeds[0].options).toMatchObject({ scope: "specs", title: "specs", html: '<!doctype html>\n<meta name="syns-pages-frame"><p>specs</p>' });
    expect(only.f.entry()).toBe("specs/.page/index.html");
    // Only index.html: as before.
    const plain = await hosted({ kind: "repo", folder: "plain" }, { "plain/index.html": "<p>plain</p>" });
    expect(plain.calls).toEqual([first("plain"), ["syns.readMany", { paths: ["plain/index.html"] }]]);
    expect(plain.embeds[0].options).toMatchObject({ scope: "plain", html: expect.stringContaining("<p>plain</p>") });
    // Both: .page/index.html.
    const both = await hosted({ kind: "repo", folder: "both" }, { "both/index.html": "<title>Old</title>", "both/.page/index.html": "<title>New</title>" });
    expect(both.calls).toEqual([first("both"), ["syns.readMany", { paths: ["both/.page/index.html"] }]]);
    expect(both.embeds.map((e) => e.options.html)).toEqual(['<!doctype html>\n<meta name="syns-pages-frame"><title>New</title>']);
    // A .page/index.html the read cannot serve, beside a readable index.html: the frame fails naming it, nothing is embedded.
    for (const error of ["too_large", "not_text"]) {
      const broken = await hosted({ kind: "repo", folder: "both" }, { "both/index.html": "<title>Old</title>", "both/.page/index.html": "<title>New</title>" }, true, true, { errors: { "both/.page/index.html": error } });
      expect(broken.calls[0]).toEqual(first("both"));
      expect(broken.calls.slice(1).flatMap(([, p]) => p.paths as string[])).not.toContain("both/index.html");
      expect(broken.embeds).toEqual([]);
      expect(broken.states.at(-1)).toEqual({ status: "failed", message: "both/.page/index.html: " + (error === "too_large" ? "too large to show in a frame" : "not_text"), failures: [] });
    }
    // Both, the first answer serving index.html and deferring .page/index.html: the latter, read by its own call.
    const later = await hosted({ kind: "repo", folder: "both" }, { "both/index.html": "<title>Old</title>", "both/.page/index.html": "<title>New</title>" }, true, true, { defer: ["both/.page/index.html"] });
    expect(later.calls).toEqual([first("both"), ["syns.readMany", { paths: ["both/.page/index.html"] }]]);
    expect(later.embeds.map((e) => e.options.html)).toEqual(['<!doctype html>\n<meta name="syns-pages-frame"><title>New</title>']);
    // Neither: not found, naming both.
    const none = await hosted({ kind: "repo", folder: "notes" }, {});
    expect(none.calls).toEqual([first("notes")]);
    expect(none.embeds).toEqual([]);
    expect(none.states.at(-1)).toMatchObject({ status: "failed", message: "notes/.page/index.html or notes/index.html: not found" });
    // No .page/index.html and an index.html the read cannot serve: that one is the entry, and its read says why.
    const big = await hosted({ kind: "repo", folder: "plain" }, { "plain/index.html": "<p>big</p>" }, true, true, { errors: { "plain/index.html": "too_large" } });
    expect(big.calls).toEqual([first("plain"), ["syns.readMany", { paths: ["plain/index.html"] }]]);
    expect(big.states.at(-1)).toMatchObject({ status: "failed", message: "plain/index.html: too large to show in a frame" });
    // A given doc: only that document.
    const doc = await hosted({ kind: "repo", folder: "both", doc: "x.html" }, { "both/x.html": "<p>x</p>", "both/.page/index.html": "<p>new</p>" });
    expect(doc.calls).toEqual([["syns.readMany", { paths: ["both/x.html"] }]]);
    expect(doc.embeds.map((e) => e.options.html)).toEqual(['<!doctype html>\n<meta name="syns-pages-frame"><p>x</p>']);
  });

  it("the entry is chosen at the frame's first load and kept: a new version reads the same document (S2.28)", async () => {
    const files: Record<string, string> = { "both/.page/index.html": "<p>1</p>", "both/index.html": "<p>old</p>" };
    const one = await hosted({ kind: "repo", folder: "both" }, files);
    files["both/.page/index.html"] = "<p>2</p>";
    one.f.changed(["both/.page/index.html"]);
    await settle();
    expect(one.calls.slice(2)).toEqual([["syns.readMany", { paths: ["both/.page/index.html"] }]]);
    expect(one.embeds.map((e) => e.options.html)).toEqual(['<!doctype html>\n<meta name="syns-pages-frame"><p>1</p>', '<!doctype html>\n<meta name="syns-pages-frame"><p>2</p>']);
  });
});

/** The one script a frame given a hash carries first in its <head>, after the page host's mark (S2.36). */
const hashScript = (html: string) => {
  const m = /^<!doctype html>\n<meta name="syns-pages-frame"><script>([\s\S]*?)<\/script>/.exec(html);
  return m ? m[1] : null;
};

describe("a frame given a hash shows its document with that location.hash from its first script (S2.36, A110)", () => {
  it("puts one replaceState script right after its mark on every load (a new version, reload(), another document by a link with its own hash), none without a hash, and none in a page frame (W18)", async () => {
    const files: Record<string, string> = { "work/.page/index.html": "<head><script>app()</script></head><p>1</p>", "work/.page/other.html": "<p>other</p>" };
    const { f, embeds, fromFrame } = await hosted({ kind: "repo", folder: "work", hash: "#new=fix" }, files);
    const carried = (h: string) => '<!doctype html>\n<meta name="syns-pages-frame"><script>history.replaceState(history.state, "", location.href.replace(/#.*$/, "") + ' + JSON.stringify(h) + ")</script>";
    expect(embeds[0].options.html).toBe(carried("#new=fix") + files["work/.page/index.html"]);
    files["work/.page/index.html"] = "<head><script>app()</script></head><p>2</p>";
    f.changed(["work/.page/index.html"]);
    await settle();
    expect(embeds[1].options.html).toBe(carried("#new=fix") + "<head><script>app()</script></head><p>2</p>");
    f.reload();
    await settle();
    expect(embeds[2].options.html).toBe(carried("#new=fix") + "<head><script>app()</script></head><p>2</p>");
    fromFrame({ __tool: "link", href: "other.html#b", newTab: false });
    await settle();
    expect(embeds[3].options.html).toBe(carried("#b") + "<p>other</p>");
    fromFrame({ __tool: "link", href: "other.html", newTab: false });
    await settle();
    expect(embeds[4].options.html).toBe('<!doctype html>\n<meta name="syns-pages-frame"><p>other</p>');
    expect(embeds).toHaveLength(5);

    // With no hash, the document is as 0.12.3 handed it, byte for byte.
    const bare = await hosted({ kind: "repo", folder: "work" }, { "work/.page/index.html": "<head><script>app()</script></head><p>1</p>" });
    expect(bare.embeds[0].options.html).toBe('<!doctype html>\n<meta name="syns-pages-frame"><head><script>app()</script></head><p>1</p>');
  });

  it("the agent's page in the workspace, given the hash its address carries, reads it as its location.hash, again on each new version (showPage); with none it is as before (W22, S2.36)", async () => {
    const carried = (h: string) => '<!doctype html>\n<meta name="syns-pages-frame"><script>history.replaceState(history.state, "", location.href.replace(/#.*$/, "") + ' + JSON.stringify(h) + ")</script>";
    const page = await hosted({ kind: "page", path: "second.html", html: "<h1>1</h1>", hash: "#s" });
    expect(page.embeds[0].options.html).toBe(carried("#s") + "<h1>1</h1>");
    expect(page.embeds[0].options.scope).toBe(null);
    (page.f as { src: { html: string } }).src.html = "<h1>2</h1>";
    page.f.load();
    await settle();
    expect(page.embeds.map((e) => [e.stopped, e.options.html])).toEqual([[false, carried("#s") + "<h1>1</h1>"], [false, carried("#s") + "<h1>2</h1>"]]);
    for (const hash of [undefined, ""]) {
      const bare = await hosted({ kind: "page", path: "index.html", html: "<h1>1</h1>", hash });
      expect(bare.embeds[0].options.html).toBe('<!doctype html>\n<meta name="syns-pages-frame"><h1>1</h1>');
    }
  });

  it("carries any hash escaped: the html holds neither </script nor <!-- from it, and the script run hands replaceState the hash unchanged on the frame's own address (W18)", async () => {
    for (const hash of ["#</script><!--x", "#new=fix&from=specs", '#a"b\\c d', "#a?b"]) {
      const { embeds } = await hosted({ kind: "repo", folder: "work", hash }, { "work/.page/index.html": "<p>1</p>" });
      const html = embeds[0].options.html as string;
      expect(html.slice(0, html.indexOf("<p>1</p>") - "</script>".length)).not.toMatch(/<\/script|<!--/i);
      const script = hashScript(html)!;
      for (const href of ["about:srcdoc", "about:srcdoc#old"]) {
        const replaced: unknown[] = [];
        runInContext(script, createContext({ history: { state: { k: 1 }, replaceState: (...a: unknown[]) => replaced.push(a) }, location: { href } }));
        expect(replaced).toEqual([[{ k: 1 }, "", "about:srcdoc" + hash]]);
      }
    }
  });
});

describe("the page script on bb (S2.27)", () => {
  it("is declared, whatever agentInstructions says", () => {
    for (const agentInstructions of [true, false]) expect(buildDeclaration(METHODS, { agentInstructions }).pageScript).toBe(true);
  });

  it("answers the script at the plugin's version when the session's folder is a Syns repository, checked with one syns repo --json there", async () => {
    const asked: unknown[] = [];
    const { handlers } = fakeBb({}, async (method, input, options) => (asked.push({ method, input, options }), rec("repo.ok")));
    expect(await handlers.threadPagesPageScript!(ask(null))).toEqual({ version: VERSION, script: PAGEHOST });
    expect(asked).toEqual([{ method: "run", input: { cwd: "/work/plans", args: ["repo", "--json"], timeoutMs: expect.any(Number) }, options: { hostId: "host_9", timeoutMs: expect.any(Number), signal: expect.any(AbortSignal) } }]);
    expect((asked[0] as { input: { timeoutMs: number } }).input.timeoutMs).toBeLessThanOrEqual(2_000);
  });

  it("answers the script for a placed folder too", async () => {
    const { handlers } = fakeBb({}, async () => rec("repo.folder"));
    expect(await handlers.threadPagesPageScript!(ask(null))).toEqual({ version: VERSION, script: PAGEHOST });
  });

  it("answers only the version when the host already holds it, and the whole script for any other version", async () => {
    const { handlers } = fakeBb({}, async () => rec("repo.ok"));
    expect(await handlers.threadPagesPageScript!(ask(VERSION))).toEqual({ version: VERSION });
    expect(await handlers.threadPagesPageScript!(ask("0.0.1"))).toEqual({ version: VERSION, script: PAGEHOST });
  });

  it("answers none outside a Syns repository, signed out, or when the CLI cannot run", async () => {
    for (const reply of [rec("no-identity"), rec("signed-out.repo"), rec("not-json")]) {
      const { handlers } = fakeBb({}, async () => reply);
      expect(await handlers.threadPagesPageScript!(ask(null))).toBeNull();
    }
    const { handlers } = fakeBb({}, async () => {
      throw new Error("host host_9 is offline");
    });
    expect(await handlers.threadPagesPageScript!(ask(null))).toBeNull();
  });

  it("answers none, and runs nothing, with no session, no folder or a folder that is not an absolute path", async () => {
    const asked: unknown[] = [];
    const { handlers } = fakeBb({}, async (method) => (asked.push(method), rec("repo.ok")));
    for (const one of [ask(null, null, null), ask(null, null), ask(null, { id: "p", path: "work/plans", machine: null }), ask(null, { id: "p", machine: null }), {}, null]) {
      expect(await handlers.threadPagesPageScript!(one)).toBeNull();
    }
    expect(asked).toEqual([]);
  });

  it("answers none inside the host's 2 s when the check does not finish", async () => {
    const { handlers } = fakeBb({}, () => new Promise(() => undefined));
    const started = Date.now();
    expect(await handlers.threadPagesPageScript!(ask(null))).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("a frame gets what a Thread Page frame gets (B-0105, D91, D92)", () => {
  it("carries allow=\"fullscreen *; clipboard-write *\": the Thread Page's own fullscreen (unife-pages R3.3b, WebKit refuses a plain fullscreen) and the clipboard write it may pass on", () => {
    const ctor = PAGEHOST.slice(PAGEHOST.indexOf("class PageFrame"), PAGEHOST.indexOf("container.appendChild(this.frame)"));
    expect(ctor).toContain('this.frame.setAttribute("allow", "fullscreen *; clipboard-write *");');
  });

  /** The page host's link() run on its own, from an app (repo) or the agent's page, read at `origin`, on a host whose navigation.openExternal refuses `own` origins as R5.32a says. */
  const linkOf = (src: { kind: "repo"; folder: string; doc?: string; hash?: string } | { kind: "page"; path: string }, origin = "https://bart.getbb.app", own = [origin]) => {
    const body = PAGEHOST.slice(PAGEHOST.indexOf("    link(href, newTab) {"), PAGEHOST.indexOf("  P.frame = function"));
    const helpers = PAGEHOST.slice(PAGEHOST.indexOf("  const dirOf = function"), PAGEHOST.indexOf("  const baseOf = function")) + PAGEHOST.slice(PAGEHOST.indexOf("  const local = function"), PAGEHOST.indexOf("  const live = new Set()"));
    const Frame = new Function("location", helpers + "return class { " + body.trim().replace(/\}\s*$/, "") + " };")({ href: origin + "/x", origin });
    const went: unknown[] = [], asked: unknown[] = [], loaded: unknown[] = [];
    const f = Object.assign(new Frame(), {
      src, folder: src.kind === "repo" ? src.folder : "", opts: { onLink: (t: unknown) => went.push(t) },
      invoke: async (m: string, p: { url?: string }) => {
        asked.push([m, p]);
        if (m === "navigation.openExternal" && /declined/.test(p.url!)) throw Object.assign(new Error("The reader declined"), { code: "denied" });
        if (m === "navigation.openExternal" && /limited/.test(p.url!)) throw Object.assign(new Error("Too many calls"), { code: "rate_limited" });
        if (m === "navigation.openExternal" && own.includes(new URL(p.url!).origin)) throw Object.assign(new Error("This is the host's own address; use pages.open or sessions.openHost"), { code: "invalid_params" });
        return {};
      },
      session: async () => "thr_own", entry: () => (src.kind === "repo" ? src.folder + "/" + (src.doc || "index.html") : src.path),
      load: () => { if (src.kind === "repo") loaded.push("hash" in src ? { doc: src.doc, hash: src.hash } : { doc: src.doc }); },
    });
    return { link: async (href: string, newTab = false) => { await f.link(href, newTab); return { went: went.splice(0), asked: asked.splice(0) }; }, loaded };
  };
  const refused = (url: string) => ["navigation.openExternal", { url }];

  it("hands a local link's hash on in its target, path as before; a link to another document of the app carries its hash into the frame (W17, S2.36, A110)", async () => {
    const app = linkOf({ kind: "repo", folder: "specs", doc: ".page/index.html" });
    const repo = (path: string, hash?: string) => ({ went: [hash === undefined ? { kind: "repo", path, newTab: false } : { kind: "repo", path, hash, newTab: false }], asked: [] });
    expect(await app.link("../../work/#new=fix&from=specs")).toEqual(repo("work", "#new=fix&from=specs"));
    expect(await app.link("../#file=product.md&line=12")).toEqual(repo("specs", "#file=product.md&line=12"));
    expect(await app.link("../../work/?x=1#new=fix")).toEqual(repo("work", "#new=fix"));
    expect(await app.link("../../work/#a?b")).toEqual(repo("work", "#a?b"));
    expect(await app.link("../../work/")).toEqual(repo("work"));
    expect(await app.link("../../work/#")).toEqual(repo("work"));
    expect(await app.link("../product.md#top")).toEqual(repo("specs/product.md", "#top"));
    expect(await app.link("other.html#sec")).toEqual({ went: [], asked: [] });
    expect(await app.link("other.html")).toEqual({ went: [], asked: [] });
    expect(app.loaded).toEqual([{ doc: ".page/other.html", hash: "#sec" }, { doc: ".page/other.html" }]);
    const page = linkOf({ kind: "page", path: "index.html" });
    expect(await page.link("work/#new=fix")).toEqual({ went: [{ kind: "page", path: "work", hash: "#new=fix", newTab: false }], asked: [] });
    expect(await page.link("work/")).toEqual({ went: [{ kind: "page", path: "work", newTab: false }], asked: [] });
    expect(await page.link("second.html#s", true)).toEqual({ went: [{ kind: "page", path: "second.html", hash: "#s", newTab: true }], asked: [] });
  });

  it("opens another session's page on this host with pages.open once the host refuses it as its own, on bb's address and on Unife Pages' (Claude Code)", async () => {
    const bb = linkOf({ kind: "repo", folder: "tools/app" });
    const a = "https://bart.getbb.app/api/v1/plugins/thread-pages/http/page?session=thr_other&path=notes.html#top";
    expect(await bb.link(a)).toEqual({ went: [], asked: [refused(a), ["pages.open", { sessionId: "thr_other" }]] });
    const cc = linkOf({ kind: "page", path: "index.html" }, "http://127.0.0.1:4848", ["http://127.0.0.1:4848", "http://localhost:4848"]);
    for (const b of ["http://127.0.0.1:4848/page?session=thr_other", "http://localhost:4848/page?session=thr_other"]) expect(await cc.link(b), b).toEqual({ went: [], asked: [refused(b), ["pages.open", { sessionId: "thr_other" }]] });
  });

  it("opens the address an agent is given (bb Connect) while the reader is on the local origin, as the host counts both as its own (B-0105 F1)", async () => {
    const local = linkOf({ kind: "repo", folder: "tools/app" }, "http://127.0.0.1:38886", ["http://127.0.0.1:38886", "https://bart.getbb.app"]);
    const a = "https://bart.getbb.app/api/v1/plugins/thread-pages/http/page?session=thr_other";
    expect(await local.link(a)).toEqual({ went: [], asked: [refused(a), ["pages.open", { sessionId: "thr_other" }]] });
    const b = "https://bart.getbb.app/api/v1/plugins/thread-pages/http/page?session=thr_own&path=docs%2Fplan.html";
    expect(await local.link(b)).toEqual({ went: [{ kind: "page", path: "docs/plan.html", newTab: false }], asked: [refused(b)] });
  });

  it("leaves another host's page address to navigation.openExternal, which opens it", async () => {
    const one = linkOf({ kind: "repo", folder: "tools/app" });
    const a = "https://alice.getbb.app/api/v1/plugins/thread-pages/http/page?session=thr_other";
    expect(await one.link(a)).toEqual({ went: [], asked: [["navigation.openExternal", { url: a }]] });
  });

  it("opens nothing on any other refusal of a page address (declined, rate_limited)", async () => {
    const one = linkOf({ kind: "repo", folder: "tools/app" });
    for (const a of ["https://alice.getbb.app/declined/page?session=thr_other", "https://bart.getbb.app/limited/page?session=thr_other"]) expect(await one.link(a), a).toEqual({ went: [], asked: [["navigation.openExternal", { url: a }]] });
  });

  it("opens this session's own page's documents in the workspace, as a relative link does", async () => {
    const one = linkOf({ kind: "repo", folder: "tools/app" });
    const a = "https://bart.getbb.app/api/v1/plugins/thread-pages/http/page?session=thr_own&path=docs%2Fplan.html";
    expect(await one.link(a, true)).toEqual({ went: [{ kind: "page", path: "docs/plan.html", newTab: true }], asked: [refused(a)] });
    const b = "https://bart.getbb.app/api/v1/plugins/thread-pages/http/page?session=thr_own";
    expect(await one.link(b)).toEqual({ went: [{ kind: "page", path: "index.html", newTab: false }], asked: [refused(b)] });
    const c = "https://bart.getbb.app/api/v1/plugins/thread-pages/http/page?session=thr_own&path=tool.html%3Fscope%3Da#top";
    expect(await one.link(c)).toEqual({ went: [{ kind: "page", path: "tool.html?scope=a#top", newTab: false }], asked: [refused(c)] });
  });

  it("leaves every other address to the workspace's own external handler: another path on this host, a page address with no session", async () => {
    const one = linkOf({ kind: "repo", folder: "tools/app" });
    for (const url of ["https://bart.getbb.app/threads/thr_other", "https://bart.getbb.app/api/v1/plugins/thread-pages/http/page", "https://bart.getbb.app/pages?session=thr_other", "https://"]) {
      expect(await one.link(url), url).toEqual({ went: [{ kind: "external", url, newTab: true }], asked: [] });
    }
  });
});
