// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMatcher } from "../lib/search-core";
import { collectRowText, rangesInRow, visibleSpan, mountHighlighter, MATCH_HIGHLIGHT, CURRENT_HIGHLIGHT } from "./highlighter";
import { searchStore } from "../lib/search-store";

function row(html: string): HTMLElement {
  document.body.innerHTML = `<div data-timeline-row-list="top-level"><div data-timeline-row-id="r1">${html}</div></div>`;
  return document.querySelector('[data-timeline-row-id="r1"]')!;
}

describe("collectRowText", () => {
  it("skips nested rows and editors", () => {
    const element = row(
      'a <b>custom</b> <div data-timeline-row-id="child">custom</div><textarea>custom</textarea> tail',
    );
    expect(collectRowText(element).text).toBe("a custom  tail");
  });
});

describe("rangesInRow", () => {
  it("finds matches that span inline element boundaries", () => {
    const element = row("cus<strong>tom</strong> and custom");
    const matcher = buildMatcher("custom", { caseSensitive: false, regex: false })!;
    const ranges = rangesInRow(element, matcher);
    expect(ranges.map((range) => range.toString())).toEqual(["custom", "custom"]);
  });
  it("returns nothing for an empty row", () => {
    const element = row("");
    const matcher = buildMatcher("x", { caseSensitive: false, regex: false })!;
    expect(rangesInRow(element, matcher)).toEqual([]);
  });
});

describe("visibleSpan", () => {
  it("reports known top-level rows on screen and ignores off-screen ones", () => {
    document.body.innerHTML = `<div data-timeline-row-list="top-level"><div data-timeline-virtual-spacer>
      <div data-timeline-row-id="a"></div><div data-timeline-row-id="b"><div data-timeline-row-id="nested"></div></div>
      <div data-timeline-row-id="c"></div><div data-timeline-row-id="unknown"></div><div data-timeline-row-id="last"></div>
    </div></div>`;
    const tops: Record<string, number> = { a: -300, b: 50, nested: 60, c: 400, unknown: 450, last: 5000 };
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-timeline-row-id]"))) {
      const top = tops[element.dataset.timelineRowId!]!;
      element.getBoundingClientRect = () => ({ top, bottom: top + 100 }) as DOMRect;
    }
    const order = new Map([["a", 0], ["b", 1], ["nested", 2], ["c", 3], ["last", 9]]);
    const viewport = { top: 0, bottom: 500 } as DOMRect;
    expect(visibleSpan(document, viewport, (id) => order.get(id))).toEqual({ first: 1, last: 3 });
  });
});

describe("highlighter lifecycle and explicit jumps", () => {
  let controller: AbortController;
  let dispose: () => void;
  let scroller: HTMLElement;
  let rangeTop: number;
  let rangeRectDescriptor: PropertyDescriptor | undefined;
  let scrollDescriptor: PropertyDescriptor | undefined;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  const highlights = new Map<string, Set<Range>>();

  beforeEach(() => {
    vi.useFakeTimers();
    highlights.clear();
    vi.stubGlobal("CSS", { highlights, escape: (value: string) => value });
    vi.stubGlobal("Highlight", class extends Set<Range> {});
    document.body.innerHTML = `<div id="scroll" style="overflow-y:auto"><div data-timeline-row-list="top-level"><div data-timeline-row-id="old">needle</div></div></div>`;
    scroller = document.getElementById("scroll")!;
    Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500 }) as DOMRect;
    rangeTop = 500;
    rangeRectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
    scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  });

  afterEach(() => {
    controller?.abort();
    dispose?.();
    searchStore.clear();
    if (rangeRectDescriptor) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeRectDescriptor);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mount() {
    // jsdom has no layout or CSS highlights. Model measured row movement
    // independently of the jump's scroll calls.
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true, value() {
        return { top: rangeTop - scroller.scrollTop, bottom: rangeTop - scroller.scrollTop + 20 } as DOMRect;
      },
    });
    scrollIntoView = vi.fn(() => { scroller.scrollTop = rangeTop - 240; });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    controller = new AbortController();
    searchStore.set({ query: "needle" });
    dispose = mountHighlighter({ signal: controller.signal });
  }

  it("repaints streamed text without scrolling and removes all resources on close", async () => {
    mount();
    expect(highlights.get(MATCH_HIGHLIGHT)?.size).toBe(1);
    document.querySelector("[data-timeline-row-id]")!.append(" needle");
    await vi.advanceTimersByTimeAsync(200);
    expect(highlights.get(MATCH_HIGHLIGHT)?.size).toBe(2);
    expect(scrollIntoView).not.toHaveBeenCalled();
    controller.abort();
    dispose();
    expect(highlights.size).toBe(0);
    expect(document.querySelector("style[data-alia-chat-search]")).toBeNull();
    searchStore.requestJump({ rowId: "old", topRowId: "old", index: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps a selected match visible as virtual row heights settle, then leaves pushed updates alone", async () => {
    mount();
    searchStore.requestJump({ rowId: "old", topRowId: "old", index: 0 });
    await vi.advanceTimersByTimeAsync(160);
    rangeTop += 300;
    await vi.advanceTimersByTimeAsync(1000);
    expect(scroller.scrollTop).toBe(560);
    expect(highlights.get(CURRENT_HIGHLIGHT)?.size).toBe(1);
    const offset = scroller.scrollTop;
    document.querySelector("[data-timeline-row-id]")!.append(" needle pushed");
    await vi.advanceTimersByTimeAsync(500);
    expect(scroller.scrollTop).toBe(offset);
    expect(highlights.get(MATCH_HIGHLIGHT)?.size).toBe(2);
  });

  it("loads successive older windows despite the host restoring its reading position after each prepend", async () => {
    mount();
    const list = document.querySelector("[data-timeline-row-list]")!;
    let remaining = 8;
    let offset = 1000;
    function renderWindow() {
      list.innerHTML = `<div data-timeline-row-id="${remaining === 0 ? "old" : `r${remaining}`}">needle</div>`;
      list.firstElementChild!.getBoundingClientRect = () => ({ top: 50, bottom: 150 }) as DOMRect;
    }
    renderWindow();
    searchStore.setRowOrder(["old", ...Array.from({ length: 8 }, (_, i) => `r${i + 1}`)]);
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true, get: () => offset, set(value: number) {
        offset = value;
        if (value === 0 && remaining > 0) {
          window.setTimeout(() => {
            remaining -= 1;
            renderWindow();
            offset = 1000; // The host preserves the previous visible row.
          }, 50);
        }
      },
    });
    searchStore.requestJump({ rowId: "old", topRowId: "old", index: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(remaining).toBe(0);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(highlights.get(CURRENT_HIGHLIGHT)?.size).toBe(1);
  });
});
