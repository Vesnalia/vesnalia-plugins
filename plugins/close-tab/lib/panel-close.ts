// A × at the right end of the secondary panel's top chrome that hides the
// whole panel, like the × on the neighbouring side panels.
//
// In layouts with an inline "Hide right panel" button the plugin shows a
// cross on that native button. Otherwise it adds a cross that presses VesnALIA's
// outside toggle. Both paths preserve VesnALIA's own panel action.

const CHROME = '[data-testid="thread-secondary-panel-top-chrome"]';
const HIDE_PANEL = 'button[aria-label^="Hide right panel"]';
const MARK = "data-close-tab-panel-x";
const NATIVE_MARK = "data-close-tab-native-panel-x";
const CROSS_MARK = "data-close-tab-cross";
const SVG_NS = "http://www.w3.org/2000/svg";

function hideToggle(doc: Document): HTMLButtonElement | null {
  return doc.querySelector<HTMLButtonElement>(HIDE_PANEL);
}

/** The control group at the right end of the chrome: it holds the full-screen button. */
function controlsOf(chrome: Element): HTMLElement | null {
  const last = chrome.lastElementChild;
  return last instanceof HTMLElement && last.querySelector("button") !== null ? last : null;
}

/** VesnALIA's own × on the "Close pane" buttons of side panes and thread headers. */
const ALIA_CLOSE_ICON = 'button[aria-label="Close pane"] svg';

function crossIcon(doc: Document): SVGElement {
  const aliaIcon = doc.querySelector<SVGElement>(ALIA_CLOSE_ICON);
  if (aliaIcon !== null) return aliaIcon.cloneNode(true) as SVGElement;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M18 6L6 18M6 6l12 12");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function makeButton(doc: Document, template: HTMLButtonElement): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute(MARK, "");
  button.className = template.className;
  button.setAttribute("aria-label", "Hide panel");
  button.title = "Hide panel";
  button.appendChild(crossIcon(doc));
  button.addEventListener("click", () => hideToggle(doc)?.click());
  return button;
}

function restoreNativeButton(button: Element): void {
  button.querySelector(`[${CROSS_MARK}]`)?.remove();
  button.removeAttribute(NATIVE_MARK);
}

function sync(doc: Document): void {
  // Keep VesnALIA's native click handler and geometry. Only its icon changes.
  for (const button of Array.from(doc.querySelectorAll(`[${NATIVE_MARK}]`))) {
    if (!button.matches(HIDE_PANEL) || button.closest(CHROME) === null) restoreNativeButton(button);
  }
  const canHide = hideToggle(doc) !== null;
  for (const chrome of Array.from(doc.querySelectorAll(CHROME))) {
    const controls = controlsOf(chrome);
    const existing = chrome.querySelector(`[${MARK}]`);
    const nativeHide = controls?.querySelector<HTMLButtonElement>(HIDE_PANEL);
    if (nativeHide) {
      existing?.remove();
      if (!nativeHide.hasAttribute(NATIVE_MARK)) nativeHide.setAttribute(NATIVE_MARK, "");
      if (nativeHide.querySelector(`[${CROSS_MARK}]`) === null) {
        const icon = crossIcon(doc);
        icon.setAttribute(CROSS_MARK, "");
        icon.setAttribute("aria-hidden", "true");
        nativeHide.appendChild(icon);
      }
      continue;
    }
    if (!canHide || controls === null) {
      existing?.remove();
      continue;
    }
    if (existing !== null && existing.parentElement === controls && controls.lastElementChild === existing) continue;
    existing?.remove();
    const template = controls.querySelector<HTMLButtonElement>(`button:not([${MARK}])`);
    if (template === null) continue;
    controls.appendChild(makeButton(doc, template));
  }
}

export function mountPanelClose({ signal }: { signal: AbortSignal }): () => void {
  const doc = document;
  if (signal.aborted) return () => {};
  let scheduled = false;
  let disposed = false;
  let frame = 0;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame = requestAnimationFrame(() => {
      scheduled = false;
      frame = 0;
      if (!disposed && !signal.aborted) sync(doc);
    });
  };
  const style = doc.createElement("style");
  style.textContent = `[${NATIVE_MARK}] > svg:not([${CROSS_MARK}]){display:none}`;
  doc.head.appendChild(style);
  sync(doc);
  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true });
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    doc.querySelectorAll(`[${MARK}]`).forEach((node) => node.remove());
    doc.querySelectorAll(`[${NATIVE_MARK}]`).forEach(restoreNativeButton);
    style.remove();
    signal.removeEventListener("abort", cleanup);
  };
  signal.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
