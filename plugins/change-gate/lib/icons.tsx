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
  "change-gate/shield": glyph(<><path d="M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></>),
};
