import { describe, expect, it } from "vitest";
import { baseName, isIndented } from "./names";

const NBSP = "\u00a0";

describe("baseName", () => {
  it("strips only the pad", () => {
    // A name that never carried padding must come back untouched, and a plain
    // leading space is the user's, not ours.
    expect(baseName(`${NBSP}${NBSP}alia`)).toBe("alia");
    expect(baseName("alia")).toBe("alia");
    expect(baseName(` ${NBSP}alia`)).toBe(` ${NBSP}alia`);
  });
});

describe("isIndented", () => {
  it("reports whether a name carries a pad", () => {
    expect(isIndented(`${NBSP}alia`)).toBe(true);
    expect(isIndented("alia")).toBe(false);
    expect(isIndented(" alia")).toBe(false);
  });
});
