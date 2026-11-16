/**
 * An unknown icon name does not fail anywhere — VesnALIA draws its generic bolt
 * instead — so this is where it fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SKILLS_ICON } from "./icons";
import { ALIA_ICON_NAMES } from "./testing/alia-icon-names";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
  alia: { branding: { icon: string } };
};

describe("icon names", () => {
  it("draws a VesnALIA built-in", () => {
    expect(ALIA_ICON_NAMES).toContain(SKILLS_ICON);
  });

  it("brands the plugin with the same icon", () => {
    expect(manifest.alia.branding.icon).toBe(SKILLS_ICON);
  });
});
