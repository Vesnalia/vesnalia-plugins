import { describe, expect, it } from "vitest";
import { buildMatcher, findMatches, makeSnippet, MAX_TEXT_LENGTH } from "./search-core";

describe("buildMatcher", () => {
  it("escapes literal queries and ignores case by default", () => {
    const matcher = buildMatcher("a.b", { caseSensitive: false, regex: false });
    expect(matcher).not.toBeNull();
    expect(findMatches("A.B axb", matcher!)).toEqual([{ start: 0, end: 3 }]);
  });
  it("escapes every metacharacter in literal mode", () => {
    const query = "a.b*(c)[d]\\e^$|?+{2}";
    const matcher = buildMatcher(query, { caseSensitive: true, regex: false })!;
    expect(findMatches(`x ${query} y`, matcher)).toEqual([{ start: 2, end: 2 + query.length }]);
  });
  it("honours case sensitivity", () => {
    const matcher = buildMatcher("Custom", { caseSensitive: true, regex: false })!;
    expect(findMatches("custom Custom CUSTOM", matcher)).toEqual([{ start: 7, end: 13 }]);
  });
  it("supports regular expressions and rejects invalid ones", () => {
    const matcher = buildMatcher("cust\\w+", { caseSensitive: false, regex: true })!;
    expect(findMatches("custom customs", matcher)).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 14 },
    ]);
    expect(buildMatcher("(", { caseSensitive: false, regex: true })).toBeNull();
    expect(buildMatcher("", { caseSensitive: false, regex: false })).toBeNull();
  });
  it("rejects backreferences and lookaround (RE2 syntax)", () => {
    expect(buildMatcher("(a)\\1", { caseSensitive: false, regex: true })).toBeNull();
    expect(buildMatcher("a(?=b)", { caseSensitive: false, regex: true })).toBeNull();
  });
  it("terminates on zero-width matches", () => {
    const matcher = buildMatcher("x*", { caseSensitive: false, regex: true })!;
    expect(findMatches("axxb", matcher)).toEqual([{ start: 1, end: 3 }]);
  });
  it("reports UTF-16 offsets so ranges line up with string slices", () => {
    const text = "😀 emoji 😀 Emoji";
    const matcher = buildMatcher("emoji", { caseSensitive: false, regex: false })!;
    const ranges = findMatches(text, matcher);
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual(["emoji", "Emoji"]);
  });
  it("caps how much of one text is scanned", () => {
    const text = "a".repeat(MAX_TEXT_LENGTH) + "needle";
    const matcher = buildMatcher("needle", { caseSensitive: true, regex: false })!;
    expect(findMatches(text, matcher)).toEqual([]);
  });
});

describe("catastrophic patterns", () => {
  // Each of these makes a backtracking engine (native RegExp) take
  // exponential time. RE2 must finish in linear time.
  const patterns = ["(a+)+$", "(a|a)+$", "(a*)*b", "^(([a-z])+.)+[A-Z]([a-z])+$"];
  const text = "a".repeat(50_000) + "!";
  for (const pattern of patterns) {
    it(`finishes ${pattern} over 50k characters quickly`, () => {
      const matcher = buildMatcher(pattern, { caseSensitive: false, regex: true });
      expect(matcher).not.toBeNull();
      const started = performance.now();
      const ranges = findMatches(text, matcher!);
      const elapsed = performance.now() - started;
      expect(ranges).toEqual([]);
      expect(elapsed).toBeLessThan(1_000);
    });
  }
});

describe("makeSnippet", () => {
  it("keeps context on both sides and squashes whitespace", () => {
    const text = "the   quick\nbrown custom fox jumps";
    const snippet = makeSnippet(text, { start: 18, end: 24 }, 6);
    expect(snippet).toEqual({ before: "…brown ", match: "custom", after: " fox j…" });
  });
});
