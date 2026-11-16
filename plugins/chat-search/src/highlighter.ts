// Content script: paints every match of the current query inside the
// rendered chat timeline using the CSS Custom Highlight API, and scrolls a
// requested hit into view, seeking through the windowed timeline when the
// hit's row is not rendered. It never rewrites the timeline DOM, so React
// re-renders and streaming messages are unaffected.

import { buildMatcher, findMatches, type Matcher } from "../lib/search-core";
import { searchStore, type SearchHit } from "../lib/search-store";

export const MATCH_HIGHLIGHT = "alia-chat-search-match";
export const CURRENT_HIGHLIGHT = "alia-chat-search-current";

const ROW_SELECTOR = "[data-timeline-row-id]";
const LIST_SELECTOR = '[data-timeline-row-list="top-level"]';
const SKIP_SELECTOR = [
  "script",
  "style",
  "textarea",
  "input",
  "select",
  "[contenteditable]",
  "[data-inline-message-editor-frame]",
  "[data-queued-message-inline-editor]",
].join(",");

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

/** Concatenate a row's visible text and remember where each text node sits. */
export function collectRowText(row: Element): {
  text: string;
  segments: TextSegment[];
} {
  const doc = row.ownerDocument;
  const walker = doc.createTreeWalker(
    row,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          // Nested rows are walked on their own; editors are never searched.
          if (element !== row && element.matches(ROW_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (element.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const segments: TextSegment[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data;
    if (value.length === 0) continue;
    segments.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, segments };
}

function locate(segments: TextSegment[], offset: number, preferEnd: boolean): [Text, number] | null {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = segments[mid]!;
    const inside = preferEnd
      ? offset > segment.start && offset <= segment.end
      : offset >= segment.start && offset < segment.end;
    if (inside) return [segment.node, offset - segment.start];
    if (offset < segment.start || (preferEnd && offset === segment.start)) high = mid - 1;
    else low = mid + 1;
  }
  return null;
}

/** DOM ranges for every match of `matcher` inside one row, in document order. */
export function rangesInRow(row: Element, matcher: Matcher): Range[] {
  const { text, segments } = collectRowText(row);
  if (text.length === 0) return [];
  const ranges: Range[] = [];
  for (const match of findMatches(text, matcher)) {
    const start = locate(segments, match.start, false);
    const end = locate(segments, match.end, true);
    if (start === null || end === null) continue;
    const range = row.ownerDocument.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    ranges.push(range);
  }
  return ranges;
}

function supportsHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
}

const TOP_ROW_SELECTOR = [
  `${LIST_SELECTOR} > ${ROW_SELECTOR}`,
  `${LIST_SELECTOR} > [data-timeline-virtual-spacer] > ${ROW_SELECTOR}`,
].join(",");

function timelineRows(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(`${LIST_SELECTOR} ${ROW_SELECTOR}`));
}

function rowById(doc: Document, id: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`${LIST_SELECTOR} [data-timeline-row-id="${CSS.escape(id)}"]`);
}

/**
 * Timeline positions of the first and last known top-level rows that overlap
 * the viewport. Rows the list keeps mounted off-screen are ignored.
 */
export function visibleSpan(
  doc: Document,
  viewport: DOMRect,
  position: (id: string) => number | undefined,
): { first: number; last: number } | null {
  let first = Infinity;
  let last = -Infinity;
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>(TOP_ROW_SELECTOR))) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
    const index = position(element.dataset.timelineRowId ?? "");
    if (index === undefined) continue;
    first = Math.min(first, index);
    last = Math.max(last, index);
  }
  return first <= last ? { first, last } : null;
}

function scrollParent(element: Element): HTMLElement | null {
  let parent = element.parentElement;
  while (parent !== null) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * The chat keeps following its bottom unless a scroll comes right after user
 * input, and it snaps back as rows resize. A wheel event marks the next
 * programmatic scroll as the user's, so the chat stays where the hit is.
 */
function claimScroll(scroller: HTMLElement): void {
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Bring a top-level row that the windowed timeline has not rendered into the
 * DOM. Long chats only render rows near the viewport, so this binary-searches
 * the scroll offset, using the row order from the last search to tell whether
 * the target sits above or below what is on screen. Reaching the top of the
 * list loads older history, which is retried a few times.
 */
async function seekRow(
  doc: Document,
  id: string,
  signal: AbortSignal,
  stale: () => boolean,
): Promise<HTMLElement | null> {
  const target = searchStore.rowPosition(id);
  if (target === undefined) return null;
  let low = 0;
  let high = Infinity;
  let historyLoads = 0;
  let seekingHistory = true;
  for (let step = 0; step < 60; step += 1) {
    const row = rowById(doc, id);
    if (row !== null) return row;
    const list = doc.querySelector(LIST_SELECTOR);
    const scroller = list ? scrollParent(list) : null;
    if (scroller === null) return null;
    const span = visibleSpan(doc, scroller.getBoundingClientRect(), searchStore.rowPosition);
    if (span === null) return null;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const offset = scroller.scrollTop;
    // First expose the beginning of the loaded window. When the hit precedes
    // it, scrolling to the top requests another history page. Binary searching
    // each newly prepended page wastes the step budget and reuses bounds that
    // the host's reading-position restoration just moved.
    if (seekingHistory && target < span.first) {
      if (historyLoads >= 12) return null;
      historyLoads += 1;
      claimScroll(scroller);
      scroller.scrollTop = 0;
      low = 0;
      high = Infinity;
      await sleep(350, signal);
      if (stale()) return null;
      continue;
    }
    seekingHistory = false;
    high = Math.min(high, max);
    if (target < span.first) {
      if (offset <= 0) {
        if (historyLoads >= 12) return null;
        historyLoads += 1;
        low = 0;
        high = Infinity;
        await sleep(350, signal);
        if (stale()) return null;
        continue;
      }
      high = offset;
    } else if (target > span.last) {
      if (offset >= max) return null;
      low = offset;
    } else {
      return null;
    }
    let next = Math.floor((low + high) / 2);
    if (high - low < 2) {
      // Row heights are estimates until measured, so the target can drift out
      // of the bounds. Step to the nearer bound and reopen the far side.
      next = target < span.first ? low : high;
      low = target < span.first ? 0 : low;
      high = target < span.first ? high : max;
    }
    claimScroll(scroller);
    scroller.scrollTop = next;
    await sleep(80, signal);
    if (stale()) return null;
  }
  return null;
}

export function mountHighlighter({ signal }: { signal: AbortSignal }): () => void {
  const doc = document;
  const style = doc.createElement("style");
  style.dataset.aliaChatSearch = "";
  style.textContent = `
::highlight(${MATCH_HIGHLIGHT}) { background-color: oklch(0.86 0.17 92 / 0.55); color: inherit; }
::highlight(${CURRENT_HIGHLIGHT}) { background-color: oklch(0.72 0.19 55 / 0.9); color: oklch(0.15 0 0); }
`;
  doc.head.append(style);

  const enabled = supportsHighlights();
  const matchHighlight = enabled ? new Highlight() : null;
  const currentHighlight = enabled ? new Highlight() : null;
  if (matchHighlight && currentHighlight) {
    CSS.highlights.set(MATCH_HIGHLIGHT, matchHighlight);
    CSS.highlights.set(CURRENT_HIGHLIGHT, currentHighlight);
  }

  /** Ranges of the last paint, keyed by row id; used to place the current hit. */
  let painted = new Map<string, Range[]>();

  function paint(): void {
    if (!matchHighlight || !currentHighlight) return;
    const state = searchStore.get();
    const matcher = buildMatcher(state.query, state);
    matchHighlight.clear();
    currentHighlight.clear();
    painted = new Map();
    if (matcher === null) return;
    for (const row of timelineRows(doc)) {
      const ranges = rangesInRow(row, matcher);
      if (ranges.length === 0) continue;
      const rowId = (row as HTMLElement).dataset.timelineRowId ?? "";
      painted.set(rowId, ranges);
      for (const range of ranges) matchHighlight.add(range);
    }
    const current = state.current;
    if (current !== null) {
      const range = painted.get(current.rowId)?.[current.index] ?? painted.get(current.rowId)?.[0];
      if (range) currentHighlight.add(range);
    }
  }

  let frame = 0;
  let timer = 0;
  function schedulePaint(): void {
    if (signal.aborted) return;
    if (frame !== 0 || timer !== 0) return;
    // Coalesce bursts of mutations (streaming text) into one paint per ~120ms.
    timer = window.setTimeout(() => {
      timer = 0;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    }, 120);
  }

  const observer = new MutationObserver(() => {
    if (searchStore.get().query.length > 0) schedulePaint();
  });
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true });

  const unsubscribe = searchStore.subscribe(() => schedulePaint());

  let jumpToken = 0;
  const cancelJump = (event: Event) => {
    // Our synthetic wheel events claim programmatic scrolling. Real input
    // always takes over, including while virtual rows are still settling.
    if (event.isTrusted) jumpToken += 1;
  };
  for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    doc.addEventListener(name, cancelJump, { capture: true, passive: true });
  }
  async function jump(hit: SearchHit): Promise<void> {
    const token = ++jumpToken;
    const stale = () => token !== jumpToken || signal.aborted;
    const top = rowById(doc, hit.topRowId) ?? (await seekRow(doc, hit.topRowId, signal, stale));
    if (top === null || stale()) return;
    const scroller = scrollParent(top);
    if (scroller) claimScroll(scroller);
    top.scrollIntoView({ block: "center" });
    // A windowed row renders its content once scrolling settles near it.
    for (let attempt = 0; attempt < 15 && top.dataset.timelineWindowedRealized === "false"; attempt += 1) {
      await sleep(80, signal);
      if (stale()) return;
    }
    // Messages inside a collapsed turn are not rendered; the turn stays centred.
    const row = hit.rowId === hit.topRowId ? top : rowById(doc, hit.rowId);
    if (row === null) return;
    paint();
    const range = painted.get(hit.rowId)?.[hit.index] ?? painted.get(hit.rowId)?.[0];
    const anchor = range?.startContainer.parentElement ?? row;
    if (scroller) claimScroll(scroller);
    anchor.scrollIntoView({ block: "center" });
    // Seeking can mount estimated-height rows above the hit. Their measured
    // heights arrive after scrollIntoView and can move the match off-screen.
    // Reacquire the range while that explicit jump settles; painting updates
    // after this bounded interval must never scroll the timeline.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(80, signal);
      if (stale()) return;
      paint();
      const currentRow = rowById(doc, hit.rowId);
      const currentRange = painted.get(hit.rowId)?.[hit.index] ?? painted.get(hit.rowId)?.[0];
      if (!currentRow || !scroller) return;
      const rect = currentRange?.getBoundingClientRect() ?? currentRow.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      const delta = (rect.top + rect.bottom - viewport.top - viewport.bottom) / 2;
      if (Math.abs(delta) > 2) {
        claimScroll(scroller);
        scroller.scrollTop += delta;
      }
    }
  }
  const unsubscribeJump = searchStore.onJump((hit) => {
    jump(hit).catch(() => undefined);
  });

  paint();

  return () => {
    jumpToken += 1;
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      doc.removeEventListener(name, cancelJump, { capture: true });
    }
    observer.disconnect();
    unsubscribe();
    unsubscribeJump();
    if (frame !== 0) cancelAnimationFrame(frame);
    if (timer !== 0) window.clearTimeout(timer);
    if (enabled) {
      CSS.highlights.delete(MATCH_HIGHLIGHT);
      CSS.highlights.delete(CURRENT_HIGHLIGHT);
    }
    style.remove();
  };
}
