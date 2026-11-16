// Glyphs for this plugin; VesnALIA ships a short icon list and draws a bolt for unknown names.
import type { ReactNode, SVGProps } from "react";

function glyph(children: ReactNode) {
  return function Glyph(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
        {children}
      </svg>
    );
  };
}

export const ICONS = {
  "try-it/phone": glyph(<><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></>),
  "try-it/open": glyph(<><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></>),
  "try-it/check": glyph(<><path d="M5 12.5l4.5 4.5L19 7.5"/></>),
  "try-it/x": glyph(<><path d="M6 6l12 12M18 6L6 18"/></>),
};
