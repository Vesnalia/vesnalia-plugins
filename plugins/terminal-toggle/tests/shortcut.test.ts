// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { captureShortcut, createShortcutHandler } from "../src/toggle";
import { COMMAND, type HostSnapshot } from "../src/host";

function host(
  shortcut: { key: string; control?: boolean } | null = {
    key: "`",
    control: true,
  },
): HostSnapshot {
  return {
    tree: [],
    surface: {} as HostSnapshot["surface"],
    commands: {
      dispatch: vi.fn(() => true),
      getShortcut: () => shortcut,
      getShortcutCommand: () => null,
    },
  };
}
function event(extra: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", {
    key: "`",
    code: "Backquote",
    ctrlKey: true,
    cancelable: true,
    ...extra,
  });
}
afterEach(() => {
  document.body.replaceChildren();
});
it("uses physical Backquote for the default even with a Russian key value", () => {
  const h = host(),
    e = event({ key: "ё" });
  expect(captureShortcut(e, h)).toBe(true);
  expect(h.commands!.dispatch).toHaveBeenCalledExactlyOnceWith(COMMAND, null);
  expect(e.defaultPrevented).toBe(true);
});
it.each([
  { shiftKey: true },
  { metaKey: true },
  { altKey: true },
  { repeat: true },
  { isComposing: true },
])("ignores extra modifiers/repeat/composition %o", (extra) => {
  const h = host();
  expect(captureShortcut(event(extra), h)).toBe(false);
  expect(h.commands!.dispatch).not.toHaveBeenCalled();
});
it("respects disabled/conflicting defaults", () => {
  const h = host(null);
  expect(captureShortcut(event(), h)).toBe(false);
  expect(h.commands!.dispatch).not.toHaveBeenCalled();
});
it("uses the host matcher for user overrides instead of keeping the physical default", () => {
  const h = host({ key: "Y", control: true });
  expect(captureShortcut(event(), h)).toBe(false);
  h.commands!.getShortcutCommand = () => COMMAND;
  expect(captureShortcut(event({ key: "y", code: "KeyY" }), h)).toBe(true);
});
it("does not consume a declined command", () => {
  const h = host();
  h.commands!.dispatch = () => false;
  const e = event();
  expect(captureShortcut(e, h)).toBe(false);
  expect(e.defaultPrevented).toBe(false);
});
it("suppresses the command during an open modal or embedded-browser focus", () => {
  const h = host();
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  expect(captureShortcut(event(), h)).toBe(false);
  dialog.remove();
  const browser = document.createElement("div");
  browser.setAttribute("data-app-browser", "");
  browser.tabIndex = 0;
  document.body.append(browser);
  browser.focus();
  expect(captureShortcut(event(), h)).toBe(false);
  expect(h.commands!.dispatch).not.toHaveBeenCalled();
});

it.each([false, true])(
  "captures an effective %s-shift F6 binding through the actual window listener",
  (shift) => {
    const h = host({ key: "F6" });
    h.commands!.getShortcutCommand = (e) =>
      e.key === "F6" && e.shiftKey === shift ? COMMAND : null;
    const listener = createShortcutHandler(
      () => h,
      () => h.commands,
    );
    window.addEventListener("keydown", listener, true);
    try {
      const e = event({
        key: "F6",
        code: "F6",
        ctrlKey: false,
        shiftKey: shift,
      });
      window.dispatchEvent(e);
      expect(h.commands!.dispatch).toHaveBeenCalledExactlyOnceWith(
        COMMAND,
        expect.anything(),
      );
      expect(e.defaultPrevented).toBe(true);
      window.dispatchEvent(event());
      expect(h.commands!.dispatch).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", listener, true);
    }
  },
);

it("does not resolve the full host for an unrelated key", () => {
  const h = host(),
    read = vi.fn(() => h);
  const listener = createShortcutHandler(read, () => h.commands);
  listener(event({ key: "a", code: "KeyA", ctrlKey: false }));
  expect(read).not.toHaveBeenCalled();
});

it("reports dispatcher discovery failure without consuming the key or throwing into bb", () => {
  const report = vi.fn(),
    read = vi.fn(() => host());
  const listener = createShortcutHandler(read, () => null, report);
  const e = event();
  expect(() => listener(e)).not.toThrow();
  expect(e.defaultPrevented).toBe(false);
  expect(read).not.toHaveBeenCalled();
  expect(report.mock.calls[0][0].message).toContain("TT_COMMANDS");
});
it("reports a changed shortcut contract without running a host command", () => {
  const h = host(),
    report = vi.fn();
  h.commands!.getShortcut = () =>
    ({ key: undefined }) as unknown as ReturnType<
      NonNullable<HostSnapshot["commands"]>["getShortcut"]
    >;
  createShortcutHandler(
    () => h,
    () => h.commands,
    report,
  )(event());
  expect(h.commands!.dispatch).not.toHaveBeenCalled();
  expect(report.mock.calls[0][0].message).toContain("TT_SHORTCUT");
});
