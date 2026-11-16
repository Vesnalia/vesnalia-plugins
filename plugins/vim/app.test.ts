// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { installInputVim } from "./vendor/input-vim";

test("enables Vim for text editors but leaves terminals alone", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const attachShadow = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    init,
  ) {
    return attachShadow.call(this, { ...init, mode: "open" });
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      right: 8,
      top: 0,
      bottom: 16,
      width: 8,
      height: 16,
    }),
  });

  document.body.innerHTML = `
    <div class="xterm"><textarea id="terminal"></textarea></div>
    <input id="navigator" />
    <div data-alia-vim-ignore><textarea id="ignored"></textarea></div>
    <div data-alia-vim-editor><input id="opted-in" /></div>
    <textarea id="editor">hello</textarea>
    <div id="promptbox" data-promptbox-shell>
      <div id="composer" role="textbox" tabindex="0">hello</div>
      <button id="voice" aria-label="Start voice input"></button>
    </div>
  `;

  const controller = new AbortController();
  const vim = installInputVim(controller.signal);
  const terminal = document.querySelector<HTMLTextAreaElement>("#terminal")!;
  const navigator = document.querySelector<HTMLInputElement>("#navigator")!;
  const ignored = document.querySelector<HTMLTextAreaElement>("#ignored")!;
  const optedIn = document.querySelector<HTMLInputElement>("#opted-in")!;
  const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
  const composer = document.querySelector<HTMLElement>("#composer")!;
  const voice = document.querySelector<HTMLButtonElement>("#voice")!;
  Object.defineProperty(composer, "isContentEditable", { value: true });
  vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 500,
    top: 100,
    bottom: 300,
    width: 400,
    height: 200,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  vi.spyOn(voice, "getBoundingClientRect").mockReturnValue({
    left: 450,
    right: 490,
    top: 220,
    bottom: 260,
    width: 40,
    height: 40,
    x: 450,
    y: 220,
    toJSON: () => ({}),
  });

  for (const nativeField of [terminal, navigator, ignored]) {
    nativeField.focus();
    const key = new KeyboardEvent("keydown", {
      key: "i",
      bubbles: true,
      cancelable: true,
    });
    nativeField.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(nativeField.hasAttribute("data-input-vim")).toBe(false);
  }

  optedIn.focus();
  expect(optedIn.getAttribute("data-input-vim")).toBe("INSERT");

  editor.focus();
  expect(editor.getAttribute("data-input-vim")).toBe("INSERT");
  const badge = document
    .querySelector<HTMLElement>("#input-vim-overlay-host")!
    .shadowRoot!.querySelector<HTMLElement>(".iv-badge")!;
  expect(badge.textContent).toBe("I");
  expect(badge.style.display).toBe("block");

  const ignoredEscape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  ignored.dispatchEvent(ignoredEscape);
  expect(ignoredEscape.defaultPrevented).toBe(false);
  expect(editor.getAttribute("data-input-vim")).toBe("INSERT");

  document.documentElement.setAttribute("data-alia-vim-consumed-escape", "");
  const consumedEscape = new KeyboardEvent("keyup", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  editor.dispatchEvent(consumedEscape);
  expect(consumedEscape.defaultPrevented).toBe(true);
  expect(editor.getAttribute("data-input-vim")).toBe("INSERT");
  document.documentElement.removeAttribute("data-alia-vim-consumed-escape");

  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(editor.getAttribute("data-input-vim")).toBe("NORMAL");
  expect(badge.textContent).toBe("N");
  expect(badge.style.display).toBe("block");
  expect(badge.style.top).toBe("106px");

  const range = document.createRange();
  range.setStart(composer.firstChild!, 0);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  composer.focus();
  expect(composer.getAttribute("data-input-vim")).toBe("INSERT");
  expect(badge.textContent).toBe("I");
  expect(badge.style.display).toBe("block");

  const newline = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  composer.dispatchEvent(newline);
  expect(newline.defaultPrevented).toBe(false);
  expect(composer.getAttribute("data-input-vim")).toBe("INSERT");

  composer.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(badge.textContent).toBe("N");
  expect(badge.style.left).toBe("444px");
  expect(badge.style.top).toBe("240px");
  vim.setIndicatorEnabled(false);
  expect(badge.style.display).toBe("none");
  vim.setIndicatorEnabled(true);
  expect(badge.style.display).toBe("block");
  composer.dispatchEvent(
    new KeyboardEvent("keydown", { key: "i", bubbles: true }),
  );

  // macOS does not consistently deliver Cmd+Tab key events before VesnALIA blurs.
  window.dispatchEvent(new Event("blur"));
  composer.blur();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(composer);
  expect(composer.getAttribute("data-input-vim")).toBe("INSERT");

  const paste = new KeyboardEvent("keydown", {
    key: "v",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  composer.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(false);
  composer.blur();
  expect(composer.getAttribute("data-input-vim")).toBe("INSERT");

  controller.abort();
  vim.dispose();
  expect(editor.hasAttribute("data-input-vim")).toBe(false);
  expect(document.querySelector("#input-vim-overlay-host")).toBeNull();
});
