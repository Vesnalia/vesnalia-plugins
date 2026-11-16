import type { ComponentProps } from "react";
import { ThreadStatusGlyph } from "./alia-sdk";
import "./still-glyphs.css";

/** VesnALIA's status glyph for another plugin's row status, with its motion removed (see still-glyphs.css). */
export function StillThreadStatusGlyph(props: ComponentProps<typeof ThreadStatusGlyph>) {
  return (
    <span className="alia-sidebar-still contents">
      <ThreadStatusGlyph {...props} />
    </span>
  );
}
