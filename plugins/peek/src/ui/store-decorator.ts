// The content script that puts a Preview button on the plugin store's cards.
//
// VesnALIA exposes no slot inside the store, so this decorates the store's own DOM.
// It anchors on the card's accessibility contract — the "Open <name> details"
// button every card renders — rather than on class names, and it appends its
// node as the card's last child so React's own insertions are never disturbed.
//
// Everything it creates is tracked and removed by the returned disposer: the
// style element, the buttons, the attributes it set, the observer, and the
// listeners.

/** Dispatched on window; the overlay listens for it. */
export const PEEK_OPEN_EVENT = "alia-peek:open";

/**
 * What the card could tell us. The content script cannot call plugin RPC, so
 * it reports what it read and the overlay resolves it to a catalog entry.
 */
export interface PeekOpenDetail {
  displayName: string;
  author: string | null;
  description: string | null;
}

const CARD_ATTRIBUTE = "data-alia-peek-card";
const SLOT_ATTRIBUTE = "data-alia-peek-slot";
const STYLE_ATTRIBUTE = "data-alia-peek-style";
const OPEN_PREFIX = "Open ";
const OPEN_SUFFIX = " details";

const STYLE_TEXT = `
[${SLOT_ATTRIBUTE}] {
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  z-index: 3;
  display: flex;
  opacity: 0;
  transition: opacity 120ms ease;
}
[${CARD_ATTRIBUTE}]:hover [${SLOT_ATTRIBUTE}],
[${SLOT_ATTRIBUTE}]:focus-within {
  opacity: 1;
}
@media (hover: none) {
  [${SLOT_ATTRIBUTE}] { opacity: 1; }
}
[${SLOT_ATTRIBUTE}] > button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 4px);
  background: var(--background);
  color: var(--muted-foreground);
  font: inherit;
  font-size: 0.6875rem;
  line-height: 1.25rem;
  cursor: pointer;
}
[${SLOT_ATTRIBUTE}] > button:hover {
  color: var(--foreground);
  border-color: color-mix(in oklab, var(--foreground) 30%, transparent);
}
`;

const EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true">' +
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

function displayNameFrom(anchor: Element): string | null {
  const label = anchor.getAttribute("aria-label");
  if (label === null || !label.startsWith(OPEN_PREFIX) || !label.endsWith(OPEN_SUFFIX)) return null;
  const name = label.slice(OPEN_PREFIX.length, label.length - OPEN_SUFFIX.length).trim();
  return name === "" ? null : name;
}

/**
 * The card is the parent of its own full-bleed open button. Verified against
 * VesnALIA's card shell, which renders that button as the card's first child.
 */
function cardFor(anchor: Element): HTMLElement | null {
  const parent = anchor.parentElement;
  if (parent === null) return null;
  // The shell marks the card `relative`; if that ever stops being true the
  // absolute slot would escape, so fall back to setting it ourselves.
  return parent;
}

function readText(card: HTMLElement, selector: string): string | null {
  const node = card.querySelector(selector);
  const text = node?.textContent?.trim();
  return text === undefined || text === "" ? null : text;
}

export interface StoreDecoratorOptions {
  signal: AbortSignal;
  onOpen: (detail: PeekOpenDetail) => void;
}

export function mountStoreDecorator(options: StoreDecoratorOptions): () => void {
  const { signal, onOpen } = options;
  const decorated = new Set<HTMLElement>();
  const slots = new Set<HTMLElement>();
  const positioned = new Set<HTMLElement>();

  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = STYLE_TEXT;
  document.head.append(style);

  function decorate(anchor: Element): void {
    const displayName = displayNameFrom(anchor);
    if (displayName === null) return;
    const card = cardFor(anchor);
    if (card === null || decorated.has(card)) return;
    // A settings row also uses aria-labels, but only store cards are grids of
    // this shape; requiring the full-bleed open button keeps us on the store.
    if (!(anchor instanceof HTMLElement) || anchor.tagName !== "BUTTON") return;

    const slot = document.createElement("span");
    slot.setAttribute(SLOT_ATTRIBUTE, "");
    const button = document.createElement("button");
    button.type = "button";
    button.title = `Preview what ${displayName} would change`;
    button.setAttribute("aria-label", `Preview what ${displayName} would change`);
    button.innerHTML = `${EYE_SVG}<span>Preview</span>`;
    button.addEventListener("click", (event) => {
      // The card's own full-bleed button sits underneath; do not open it.
      event.preventDefault();
      event.stopPropagation();
      onOpen({
        displayName,
        author: readText(card, "span.row-start-3 span, span[class*='row-start-3'] span"),
        description: readText(card, "span[class*='line-clamp']"),
      });
    });
    slot.append(button);

    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
      positioned.add(card);
    }
    card.setAttribute(CARD_ATTRIBUTE, "");
    // Appended last: React inserts before its own tracked nodes, so a trailing
    // extra child never interferes with its reconciliation.
    card.append(slot);
    decorated.add(card);
    slots.add(slot);
  }

  function scan(): void {
    if (signal.aborted) return;
    for (const card of decorated) {
      if (!card.isConnected) decorated.delete(card);
    }
    for (const slot of slots) {
      if (!slot.isConnected) slots.delete(slot);
    }
    const anchors = document.querySelectorAll(
      `button[aria-label^="${OPEN_PREFIX}"][aria-label$="${OPEN_SUFFIX}"]`,
    );
    anchors.forEach(decorate);
  }

  let frame = 0;
  function schedule(): void {
    if (frame !== 0 || signal.aborted) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      scan();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();

  return () => {
    observer.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
    for (const slot of slots) slot.remove();
    for (const card of decorated) card.removeAttribute(CARD_ATTRIBUTE);
    for (const card of positioned) card.style.removeProperty("position");
    slots.clear();
    decorated.clear();
    positioned.clear();
    style.remove();
  };
}
