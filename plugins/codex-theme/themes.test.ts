import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPTION_KEYS, OPTIONS } from "./options";
// @ts-expect-error — plain ESM build script without types.
import { buildAliaTheme, regions } from "./scripts/themes.mjs";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const theme = read("./theme.css");
const themeAlia = read("./theme-alia.css");
const palette = read("./palettes/alia.css");
const manifest = JSON.parse(read("./package.json"));

describe("theme files", () => {
  it("theme-alia.css is generated from theme.css and palettes/alia.css", () => {
    expect(themeAlia).toBe(buildAliaTheme(theme, palette));
  });

  it("swaps every palette region", () => {
    expect([...regions(theme).keys()].sort()).toEqual([...regions(palette).keys()].sort());
    expect(themeAlia).not.toContain("#8839ef"); // Catppuccin Latte mauve
    expect(themeAlia).not.toContain("#cba6f7"); // Catppuccin Mocha mauve
  });

  it("rejects a palette that misses a region", () => {
    expect(() => buildAliaTheme(theme, "")).toThrow(/missing regions/);
  });

  it.each(["./theme.css", "./theme-alia.css"])("%s stays under VesnALIA's 256 KB theme limit", (file) => {
    expect(read(file).length).toBeLessThan(256_000);
  });

  it("declares both themes with existing CSS files", () => {
    expect(manifest.alia.themes.map((t: { id: string }) => t.id)).toEqual(["codex", "codex-alia"]);
    for (const { css } of manifest.alia.themes) expect(() => read(css)).not.toThrow();
  });
});

describe("optional blocks", () => {
  const optionalSection = theme.slice(theme.lastIndexOf("/*", theme.indexOf("   Optional: ")));
  const selectors = optionalSection
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "")
    .match(/[^{};]+(?=\{)/g)!
    .map((s) => s.trim())
    .filter((s) => !s.startsWith("@"));

  it("every option has CSS in theme.css", () => {
    for (const key of OPTION_KEYS) expect(theme).toContain(`[${OPTIONS[key].attribute}]`);
  });

  it("gates every selector in the optional section behind a data-codex-* attribute", () => {
    expect(selectors.length).toBeGreaterThan(20);
    for (const list of selectors) {
      for (const selector of list.split(/,(?![^(]*\))/)) {
        expect(selector.trim(), selector).toMatch(/^:root(\.dark)?\[data-codex-[a-z-]+\]/);
      }
    }
  });

  it("uses the plugin's own homepage section id", () => {
    expect(theme).not.toMatch(/:alia-codex:|alia-codex-/);
    expect(read("./app.css")).toContain("plugin-homepage:codex-theme:welcome");
  });
});
