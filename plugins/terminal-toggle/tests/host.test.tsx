// @vitest-environment jsdom
import { act, createContext, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classify, snapshot, type Surface } from "../src/host";
import { Toggle, type Runtime } from "../src/toggle";
import { rootFor, walk } from "../src/fiber";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const Keyboard = createContext<unknown>(null);
const NavigationContext = createContext<unknown>(null);
const dispatcher = {
  dispatch: () => true,
  getShortcut: () => null,
  getShortcutCommand: () => null,
  registerHandler: () => () => {},
};
const Pane = createContext<unknown>(null),
  Composer = createContext<unknown>(null);
function Terminal({
  terminalId,
  target,
}: {
  terminalId: string;
  target: unknown;
}) {
  void terminalId;
  void target;
  return (
    <section data-app-terminal="">
      <div className="xterm">
        <textarea className="xterm-helper-textarea" />
      </div>
      <input aria-label="Find in terminal" />
    </section>
  );
}
function Navigation({
  capabilities,
  children,
}: {
  capabilities: unknown;
  children: ReactNode;
}) {
  return (
    <NavigationContext
      value={{
        openFileExternally: () => false,
        openFilePreview: () => false,
        openUrl: () => false,
        ...(capabilities as object),
      }}
    >
      {children}
    </NavigationContext>
  );
}
function Unrelated({
  capabilities,
  children,
}: {
  capabilities: unknown;
  children: ReactNode;
}) {
  void capabilities;
  return <>{children}</>;
}
function Thread({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  void threadId;
  return <>{children}</>;
}
const composer = { scope: { kind: "thread", threadId: "t" }, focus: vi.fn() };
const capabilities = {
  panel: {
    getTabs: (): ReturnType<Surface["panel"]["getTabs"]> => ({
      open: true,
      selectedKey: null,
      tabs: [],
    }),
    selectTab: () => true,
    close: () => true,
  },
  openTerminal: () => true,
};
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(
  id = "a",
  options: {
    navigation?: unknown;
    keyboard?: unknown;
    composer?: unknown;
    nestedCapability?: boolean;
  } = {},
) {
  await act(async () =>
    root.render(
      <Keyboard value={options.keyboard ?? dispatcher}>
        <Pane
          value={{ paneId: "p", isFocused: true, navigateInPane: () => {} }}
        >
          <Thread threadId="t">
            <Navigation capabilities={options.navigation ?? capabilities}>
              <Unrelated
                capabilities={
                  options.nestedCapability ? { panel: {} } : undefined
                }
              >
                <Composer value={options.composer ?? composer}>
                  <div data-app-composer="" data-app-composer-role="primary">
                    <div tabIndex={0} />
                  </div>
                  <Terminal
                    terminalId={id}
                    target={{ kind: "thread", threadId: "t" }}
                  />
                </Composer>
              </Unrelated>
            </Navigation>
          </Thread>
        </Pane>
      </Keyboard>,
    ),
  );
}
it("resolves real React committed terminal owners and pane without component names", async () => {
  await render();
  document.querySelector<HTMLTextAreaElement>("textarea")!.focus();
  const h = snapshot();
  expect(h.surface?.paneId).toBe("p");
  expect(classify(document, h)).toEqual({
    kind: "terminal",
    terminalId: "a",
    threadId: "t",
    paneId: "p",
  });
});
it("uses the current committed props after DOM reuse and branch flips", async () => {
  await render();
  const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
  input.focus();
  await render("b");
  expect(document.querySelector("textarea")).toBe(input);
  expect(classify(document, snapshot())).toMatchObject({
    kind: "terminal",
    terminalId: "b",
  });
  await render("c");
  expect(classify(document, snapshot())).toMatchObject({
    kind: "terminal",
    terminalId: "c",
  });
});
it("distinguishes terminal input from search and composer while the tab remains selected", async () => {
  await render();
  document.querySelector<HTMLInputElement>("input")!.focus();
  expect(classify(document, snapshot())).toEqual({ kind: "other" });
  document.querySelector<HTMLElement>("[tabindex]")!.focus();
  expect(classify(document, snapshot())).toEqual({ kind: "other" });
});
it("refuses stale focus from an inactive document", async () => {
  await render();
  document.querySelector<HTMLTextAreaElement>("textarea")!.focus();
  vi.mocked(document.hasFocus).mockReturnValue(false);
  expect(classify(document, snapshot())).toMatchObject({
    kind: "unknown",
    invalidateHistory: false,
  });
});
it("bounds malformed React tree traversal", async () => {
  await render();
  const live = rootFor(container)!;
  expect(walk(live).length).toBeGreaterThan(1);
  const cycle = {
    return: null,
    child: null,
    sibling: null,
    stateNode: null,
    memoizedProps: null,
    tag: 3,
  } as Parameters<typeof walk>[0];
  cycle.child = cycle;
  expect(() => walk(cycle)).toThrow("TT_REACT");
});

it("identifies a missing keyboard contract instead of silently disappearing", async () => {
  await render("a", { keyboard: {} });
  expect(() => snapshot()).toThrow("TT_COMMANDS");
});
it("identifies the missing native panel method before performing host actions", async () => {
  await render("a", {
    navigation: {
      ...capabilities,
      panel: { ...capabilities.panel, close: undefined },
    },
  });
  expect(() => snapshot()).toThrow("TT_PANEL");
  expect(() => snapshot()).toThrow("'close'");
});
it("declines a changed composer contract before performing host actions", async () => {
  await render("a", { composer: { ...composer, focus: undefined } });
  expect(snapshot().surface).toBeNull();
});
it("does not treat a changed terminal input wrapper as ordinary editor focus", async () => {
  await render();
  const h = snapshot();
  const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
  input.closest("[data-app-terminal]")!.removeAttribute("data-app-terminal");
  input.focus();
  expect(classify(document, h).kind).toBe("unknown");
});

it("ignores unrelated nested capabilities rather than vetoing the navigation owner", async () => {
  await render("a", { nestedCapability: true });
  expect(snapshot().surface?.panel).toBe(capabilities.panel);
});
it("preserves terminal history and restores it from an ordinary textarea", async () => {
  await render();
  const read = () => snapshot();
  const runtime: Runtime = {
    read,
    focus: (host) => classify(document, host),
    blocked: () => false,
    create: vi.fn(),
    wait: async () => {
      throw new Error("Unexpected focus wait");
    },
    now: () => performance.now(),
  };
  const toggle = new Toggle(runtime);
  const terminal = document.querySelector<HTMLTextAreaElement>("textarea")!;
  terminal.focus();
  toggle.observe();
  const ordinary = document.createElement("textarea");
  document.body.append(ordinary);
  try {
    ordinary.focus();
    expect(classify(document, read())).toEqual({ kind: "other" });
    toggle.observe();
    expect(toggle.last.get("t")).toBe("a");
    vi.spyOn(capabilities.panel, "selectTab").mockImplementation(() => {
      terminal.focus();
      return true;
    });
    const tab = (id: string) => ({
      key: id,
      title: id,
      status: null,
      closable: true,
      detail: { kind: "terminal" as const, terminalId: id },
    });
    vi.spyOn(capabilities.panel, "getTabs").mockReturnValue({
      open: true,
      selectedKey: null,
      tabs: [tab("b"), tab("a")],
    } as ReturnType<Surface["panel"]["getTabs"]>);
    await toggle.run({
      threadId: "t",
      projectId: null,
      experimental_panel: {} as never,
    });
    expect(capabilities.panel.selectTab).toHaveBeenCalledWith("a");
    expect(runtime.create).not.toHaveBeenCalled();
  } finally {
    ordinary.remove();
    toggle.dispose();
  }
});
