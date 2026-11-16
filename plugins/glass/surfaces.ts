import type { GlassConfig } from "./config";

export function surfaceCss(next: GlassConfig, canvas: readonly [number, number, number]): string {
    // token translucency
    const a = next.opacity / 100;
    const rgba = (alpha: number) =>
      `rgba(${canvas[0]},${canvas[1]},${canvas[2]},${Math.min(1, alpha).toFixed(3)})`;
    const sbA = next.sidebarOpacity / 100;
    return `
html, body { background: transparent !important; }
:root:root, :root:root.dark, :root:root.light {
  --canvas: ${rgba(a)};
  --background: ${rgba(a)};
  --card: ${rgba(a + 0.05)};
  --sidebar: ${rgba(sbA)};
  --popover: ${rgba(next.modalFrost ? Math.max(0.85, a) : Math.max(0.96, a))};
}
${
  next.modalFrost
    ? `
/* Frost modals, popups, dropdown menus, tooltips, and drawers: their surfaces
   go slightly translucent (--popover above) and blur what's behind them. */
:root:root [role="dialog"],
:root:root [role="alertdialog"],
:root:root [data-radix-popper-content-wrapper] > *,
:root:root [role="menu"],
:root:root [role="listbox"],
:root:root [data-sonner-toast] {
  backdrop-filter: blur(${next.modalBlur}px) saturate(1.1);
  -webkit-backdrop-filter: blur(${next.modalBlur}px) saturate(1.1);
}`
    : ""
}
/* Frost the sidebar itself so its UI stays crisp over the backdrop. */
:root:root [data-sidebar="sidebar"] {
  backdrop-filter: blur(${next.sidebarBlur}px) saturate(1.15);
  -webkit-backdrop-filter: blur(${next.sidebarBlur}px) saturate(1.15);
}
/* Frost the chat input as ONE overall region, hosted on VesnALIA's own sticky
   bottom wrapper (the element actually docked to the window edge). One
   pseudo = one blur layer (no inner text-area layer), it reaches the very
   bottom when docked (no gap), and the tiny extension adds no meaningful
   scroll overflow — so the composer stays put instead of bobbing. */
${
  next.composerFrost
    ? `
/* Progressive gradient blur: a light layer starts high with a long fade, a
   strong layer ramps in below — barely-there at the top, full frost at the
   bottom. Top-only extensions add no scrollable overflow, so the docked
   composer never drifts; the wrapper itself already touches the window edge. */
:root:root .sticky.bottom-0:has([data-follow-up-composer])::before {
  content: "";
  position: absolute;
  inset: -44px 0 0 0;
  z-index: -1;
  pointer-events: none;
  backdrop-filter: blur(${Math.max(2, Math.round(next.composerBlur / 3))}px) saturate(1.05);
  -webkit-backdrop-filter: blur(${Math.max(2, Math.round(next.composerBlur / 3))}px) saturate(1.05);
  mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.45) 38%, #000 72%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.45) 38%, #000 72%);
}
:root:root .sticky.bottom-0:has([data-follow-up-composer])::after {
  content: "";
  position: absolute;
  inset: -14px 0 0 0;
  z-index: -1;
  pointer-events: none;
  backdrop-filter: blur(${next.composerBlur}px) saturate(1.1);
  -webkit-backdrop-filter: blur(${next.composerBlur}px) saturate(1.1);
  mask-image: linear-gradient(to bottom, transparent 8%, rgba(0,0,0,.55) 52%, #000 88%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 8%, rgba(0,0,0,.55) 52%, #000 88%);
}`
    : ""
}
/* VesnALIA keeps mobile shelves mounted behind the translating main surface.
   Opaque host tokens prevent two layers of text from blending together. */
@media (max-width: 767.98px) {
  :root:root, :root:root.dark, :root:root.light {
    --canvas: ${rgba(1)};
    --background: ${rgba(1)};
    --card: ${rgba(1)};
    --sidebar: ${rgba(1)};
    --popover: ${rgba(1)};
  }
  :root:root [role="dialog"], :root:root [role="alertdialog"],
  :root:root [data-radix-popper-content-wrapper] > *,
  :root:root [role="menu"], :root:root [role="listbox"],
  :root:root [data-sonner-toast] {
    background-color: ${rgba(1)};
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  [data-glass-backdrop] { visibility: hidden; }
}
@keyframes glass-grain {
  0% { transform: translate(0,0); } 25% { transform: translate(-6px,4px); }
  50% { transform: translate(4px,-6px); } 75% { transform: translate(-3px,-4px); }
  100% { transform: translate(0,0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-glass-backdrop] * { animation: none !important; }
}`;
}
