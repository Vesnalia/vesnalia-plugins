import { describe, expect, it } from "vitest";
import { markdownToWiki, wikiToMarkdown } from "../wiki";

describe("markdownToWiki", () => {
  it("converts headings, lists, and emphasis", () => {
    expect(
      markdownToWiki(`# Title

- one
- two

**bold** and *italic* and \`code\``),
    ).toBe(`h1. Title

* one
* two

*bold* and _italic_ and {{code}}`);
  });

  it("wraps fenced code", () => {
    expect(markdownToWiki("```js\nconst x = 1;\n```")).toBe("{code:js}\nconst x = 1;\n{code}");
  });
});

describe("wikiToMarkdown", () => {
  it("round-trips a simple document", () => {
    const wiki = "h2. Hello\n\n* item\n\n*bold*";
    expect(wikiToMarkdown(wiki)).toBe("## Hello\n\n- item\n\n**bold**");
  });

  it("returns empty for non-strings", () => {
    expect(wikiToMarkdown(null)).toBe("");
    expect(wikiToMarkdown({ nope: true })).toBe("");
  });
});
