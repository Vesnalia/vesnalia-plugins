import { describe, expect, it } from "vitest";
import { GLYPH_NAMES, renderGlyphSvg } from "./glyphs";

describe("alia glyphs", () => {
  it("renders a known VesnALIA icon name as a standalone svg", () => {
    const svg = renderGlyphSvg("GridView");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24" fill="none">/);
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).not.toContain("key=");
    expect(svg).not.toContain("strokeWidth");
  });

  it("returns null for names outside VesnALIA's icon set", () => {
    expect(renderGlyphSvg("NotABbIcon")).toBeNull();
    expect(renderGlyphSvg("")).toBeNull();
  });

  it("covers the common branding defaults", () => {
    expect(GLYPH_NAMES).toEqual(expect.arrayContaining(["Zap", "Folder", "GridView", "Puzzle", "PanelLeft"]));
  });
});
