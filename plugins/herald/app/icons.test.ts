/**
 * Every icon name Herald draws must be one VesnALIA knows: a built-in, or one of
 * this plugin's own declared SVGs (`"<pluginId>/<name>"` from
 * `alia.branding.experimental_icons`). An unknown name does not fail anywhere —
 * VesnALIA draws its generic bolt instead — so this is where it fails.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HERALD_ICONS } from "./icons";
import { ALIA_ICON_NAMES } from "./testing/alia-icon-names";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  alia: { branding: { icon: string; experimental_icons: Record<string, string> } };
};
const pluginId = manifest.name.split("/").pop()?.replace(/^alia-plugin-/, "") ?? "";
const declared = manifest.alia.branding.experimental_icons;

const sources = [
  "app.tsx",
  ...readdirSync(join(root, "app"))
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => join("app", name)),
];

/** Literal names in `name="…"` props and `icon: "…"` fields. */
function literalNames(source: string): string[] {
  return [...source.matchAll(/\b(?:name|icon)(?:=|:\s*)"([A-Za-z0-9/-]+)"/g)].map((match) => match[1] ?? "");
}

function isKnown(name: string): boolean {
  if (ALIA_ICON_NAMES.includes(name)) return true;
  const [owner, local, ...rest] = name.split("/");
  return rest.length === 0 && owner === pluginId && local !== undefined && declared[local] !== undefined;
}

describe("icon names", () => {
  const used = [...new Set([...Object.values(HERALD_ICONS), ...sources.flatMap((file) => literalNames(readFileSync(join(root, file), "utf8")))])];

  it("finds the names it checks", () => {
    expect(used).toEqual(expect.arrayContaining(["Play", "Settings", "MessageQuestion", HERALD_ICONS.volume]));
  });

  it.each(used)("%s is a VesnALIA built-in or one of Herald's declared icons", (name) => {
    expect(isKnown(name)).toBe(true);
  });

  it("names a real SVG file for the branding icon and every declared icon", () => {
    for (const path of [manifest.alia.branding.icon, ...Object.values(declared)]) {
      expect(path).toMatch(/^\.\/.*\.svg$/);
      expect(existsSync(join(root, path))).toBe(true);
    }
  });

  it("rejects a name VesnALIA does not know", () => {
    expect(isKnown("Volume2")).toBe(false);
    expect(isKnown("RefreshCw")).toBe(false);
    expect(isKnown("other-plugin/volume")).toBe(false);
  });
});
