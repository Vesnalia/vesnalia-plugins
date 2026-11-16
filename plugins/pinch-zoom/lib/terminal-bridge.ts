/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Applies the terminal text size to VesnALIA's xterm terminals.
 *
 * VesnALIA hard-codes `fontSize: 12` in ThreadTerminalView and exposes no SDK API for terminal font size, and xterm keeps no DOM back-reference to its Terminal.
 * The component stores the instance in a `useRef` (`terminalRef`), so we walk the React fiber of the element the terminal was opened into and look for a ref whose `current` is the Terminal that owns this `.xterm` element.
 * This depends on VesnALIA internals: if the lookup fails, the terminal is left untouched (fail-safe) rather than guessed at.
 *
 * After changing `options.fontSize`, xterm re-measures cells but cols/rows only change when VesnALIA's fit runs.
 * VesnALIA fits (and sends the PTY resize) from a ResizeObserver on the container, so we nudge the container's content box by 1px for one frame to trigger that same path instead of resizing the PTY ourselves.
 */

interface XtermLike {
  element: HTMLElement | undefined;
  options: { fontSize?: number };
  resize: (cols: number, rows: number) => void;
}

const terminalCache = new WeakMap<HTMLElement, XtermLike>();
const originalFontSize = new WeakMap<XtermLike, number>();
const pendingNudges = new WeakSet<HTMLElement>();

function isTerminalFor(value: unknown, xtermElement: HTMLElement): value is XtermLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<XtermLike>;
  return (
    candidate.element === xtermElement &&
    typeof candidate.options === "object" &&
    candidate.options !== null &&
    typeof candidate.resize === "function"
  );
}

interface FiberLike {
  return: FiberLike | null;
  memoizedState: unknown;
}

interface HookLike {
  memoizedState: unknown;
  next: HookLike | null;
}

function fiberOf(element: HTMLElement): FiberLike | null {
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactFiber$")) {
      return (element as unknown as Record<string, FiberLike>)[key] ?? null;
    }
  }
  return null;
}

/** Finds the xterm Terminal that owns a `.xterm` element, or null. */
export function findTerminal(xtermElement: HTMLElement): XtermLike | null {
  const cached = terminalCache.get(xtermElement);
  if (cached !== undefined && cached.element === xtermElement) return cached;
  const host = xtermElement.parentElement;
  if (host === null) return null;
  let fiber = fiberOf(host);
  for (let depth = 0; fiber !== null && depth < 40; depth += 1) {
    let hook = fiber.memoizedState as HookLike | null;
    for (let index = 0; index < 200; index += 1) {
      if (typeof hook !== "object" || hook === null || !("next" in hook)) break;
      const value = hook.memoizedState;
      if (typeof value === "object" && value !== null && "current" in value) {
        const current = (value as { current: unknown }).current;
        if (isTerminalFor(current, xtermElement)) {
          terminalCache.set(xtermElement, current);
          return current;
        }
      }
      hook = hook.next;
    }
    fiber = fiber.return;
  }
  return null;
}

/** Triggers VesnALIA's own ResizeObserver → fitAddon.fit() → PTY resize path. */
function nudgeRefit(container: HTMLElement): void {
  if (pendingNudges.has(container)) return;
  pendingNudges.add(container);
  const previous = container.style.paddingBottom;
  const computed = Number.parseFloat(getComputedStyle(container).paddingBottom) || 0;
  container.style.paddingBottom = `${computed + 1}px`;
  // Two frames: layout must observe the nudge before it is reverted.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.style.paddingBottom = previous;
      pendingNudges.delete(container);
    });
  });
}

export function listTerminalElements(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".xterm"));
}

/**
 * Sets the font size on one terminal. Returns true when the size changed.
 * `refit` controls whether the PTY is resized now; gestures defer it until the pinch settles so TUIs are not redrawn every frame.
 */
export function applyTerminalFontSize(
  xtermElement: HTMLElement,
  fontSize: number,
  refit: boolean,
): boolean {
  const terminal = findTerminal(xtermElement);
  if (terminal === null) return false;
  if (!originalFontSize.has(terminal)) {
    originalFontSize.set(terminal, terminal.options.fontSize ?? 12);
  }
  const changed = terminal.options.fontSize !== fontSize;
  if (changed) terminal.options.fontSize = fontSize;
  if (refit && xtermElement.parentElement !== null) {
    nudgeRefit(xtermElement.parentElement);
  }
  return changed;
}

export function applyToAllTerminals(fontSize: number, refit: boolean): void {
  for (const element of listTerminalElements()) {
    applyTerminalFontSize(element, fontSize, refit);
  }
}

/** Puts every terminal back to the size it had before this plugin touched it. */
export function restoreAllTerminals(): void {
  for (const element of listTerminalElements()) {
    const terminal = findTerminal(element);
    if (terminal === null) continue;
    const original = originalFontSize.get(terminal);
    if (original === undefined || terminal.options.fontSize === original) continue;
    terminal.options.fontSize = original;
    if (element.parentElement !== null) nudgeRefit(element.parentElement);
  }
}
