import { describe, expect, it } from "vitest";
import { engineProblems } from "../src/engines";

describe("engineProblems", () => {
  const host = { alia: "0.46.1" };

  it("passes a release without engines, or one this VesnALIA satisfies", () => {
    expect(engineProblems({}, host)).toEqual([]);
    expect(engineProblems({ alia: ">=0.46" }, host)).toEqual([]);
  });

  it("names the VesnALIA range this VesnALIA misses, as VesnALIA does", () => {
    expect(engineProblems({ alia: ">=0.47" }, host)).toEqual([
      "requires VesnALIA >=0.47, running VesnALIA is 0.46.1",
    ]);
    expect(engineProblems({ alia: "not a range" }, host)).toEqual([
      'declares invalid engines.alia range "not a range"',
    ]);
  });

  it("skips what it can't know, and engines.alia on VesnALIA's dev builds", () => {
    expect(engineProblems({ alia: ">=9" }, {})).toEqual([]);
    expect(engineProblems({ alia: ">=9" }, { alia: "0.0.0" })).toEqual([]);
  });
});
