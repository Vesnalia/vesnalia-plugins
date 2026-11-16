// Glyphs for this plugin; BB ships a short icon list and draws a bolt for unknown names.
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
  "file-versions/stack": glyph(<><path d="M6 3h8l4 4v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M8.5 21H17a3 3 0 0 0 3-3V9"/></>),
  "file-versions/refresh": glyph(<><path d="M20 5v5h-5"/><path d="M4 19v-5h5"/><path d="M19.5 10A8 8 0 0 0 5.7 7M4.5 14a8 8 0 0 0 13.8 3"/></>),
  "file-versions/down": glyph(<><path d="M6 9.5l6 6 6-6"/></>),
  "file-versions/up": glyph(<><path d="M6 14.5l6-6 6 6"/></>),
};
