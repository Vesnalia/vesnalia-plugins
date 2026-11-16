import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits.js";
import { renderSnapshot, type SnapshotNode } from "./snapshot.js";

const leaf = (id: number, role: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({
  id,
  role,
  ...extra,
});

const withChildren = (
  id: number,
  role: string,
  children: SnapshotNode[],
  extra: Partial<SnapshotNode> = {},
): SnapshotNode => ({ id, role, children, ...extra });

describe("renderSnapshot", () => {
  it("renders nodes in document order with versioned refs", () => {
    const root = withChildren(
      0,
      "generic",
      [
        leaf(1, "heading", { name: "Title" }),
        leaf(2, "button", { name: "Click", refable: true }),
      ],
      { name: "Root", refable: true },
    );
    const rendered = renderSnapshot(root, "abcd1234.1");
    expect(rendered.text).toBe(
      [
        '- generic "Root" [ref=abcd1234.1:e1]',
        '  - heading "Title"',
        '  - button "Click" [ref=abcd1234.1:e2]',
      ].join("\n"),
    );
    expect(rendered.refs).toEqual([
      { ref: "abcd1234.1:e1", id: 0 },
      { ref: "abcd1234.1:e2", id: 2 },
    ]);
    expect(rendered.truncated).toEqual({
      text: false,
      nodes: false,
      depth: false,
      refs: false,
      droppedNodes: 0,
    });
  });

  it("keeps every field on one line by escaping names, values, and descriptions", () => {
    const node = leaf(0, "textbox", {
      name: 'He said "hi"\nnext\tline\u0001',
      value: "a\nb",
      description: 'desc "quoted"',
      refable: true,
    });
    const rendered = renderSnapshot(node, "abcd1234.2");
    expect(rendered.text.split("\n")).toHaveLength(1);
    expect(rendered.text).toContain('He said \\"hi\\"\\nnext\\tline\\u0001');
    expect(rendered.text).toContain('value="a\\nb"');
    expect(rendered.text).toContain('description="desc \\"quoted\\""');
  });

  it("renders interaction states and skips empty quotes for unnamed nodes", () => {
    const rendered = renderSnapshot(
      withChildren(0, "generic", [
        leaf(1, "button", { name: "Save", states: ["disabled"], refable: true }),
        leaf(2, "checkbox", { name: "Agree", states: ["checked"], refable: true }),
        leaf(3, "heading", { name: "H", states: ["level=2"] }),
        leaf(4, "separator"),
      ]),
      "abcd1234.3",
    );
    expect(rendered.text).toContain('- button "Save" [disabled] [ref=abcd1234.3:e1]');
    expect(rendered.text).toContain('- checkbox "Agree" [checked] [ref=abcd1234.3:e2]');
    expect(rendered.text).toContain('- heading "H" [level=2]');
    expect(rendered.text).toContain("- separator");
    expect(rendered.text).not.toContain('""');
  });

  it("bounds rendered text and reports truncation inside the budget", () => {
    const children = Array.from({ length: 200 }, (_, index) =>
      leaf(index + 1, "paragraph", { name: "x".repeat(400), refable: true }),
    );
    const rendered = renderSnapshot(withChildren(0, "generic", children), "abcd1234.4");
    expect(rendered.text.length).toBeLessThanOrEqual(LIMITS.snapshot.textChars);
    expect(rendered.truncated.text).toBe(true);
    expect(rendered.truncated.droppedNodes).toBeGreaterThan(0);
    expect(rendered.text).toContain("snapshot truncated");
    const refLabels = rendered.text.match(/\[ref=[^\]]+\]/g) ?? [];
    expect(rendered.refs.length).toBe(refLabels.length);
  });

  it("bounds visited nodes and depth", () => {
    const wide = withChildren(
      0,
      "a",
      Array.from({ length: LIMITS.snapshot.nodes + 1_500 }, (_, index) => leaf(index + 1, "a")),
    );
    const wideRendered = renderSnapshot(wide, "abcd1234.5");
    expect(wideRendered.truncated.nodes).toBe(true);
    expect(wideRendered.text.split("\n").length).toBeLessThanOrEqual(LIMITS.snapshot.nodes + 1);

    let deep: SnapshotNode = leaf(0, "generic");
    for (let depth = 1; depth < 200; depth += 1) {
      deep = withChildren(depth, "generic", [deep]);
    }
    const deepRendered = renderSnapshot(deep, "abcd1234.6");
    expect(deepRendered.truncated.depth).toBe(true);
    expect(deepRendered.text).toContain("snapshot truncated");
  });

  it("bounds refs and never exposes a ref whose line was dropped", () => {
    const children = Array.from({ length: LIMITS.snapshot.refs + 100 }, (_, index) =>
      leaf(index + 1, "button", { refable: true }),
    );
    const rendered = renderSnapshot(withChildren(0, "generic", children), "aaaa.7");
    expect(rendered.refs.length).toBe(LIMITS.snapshot.refs);
    expect(rendered.truncated.refs).toBe(true);
    for (const { ref } of rendered.refs) {
      expect(rendered.text).toContain(`[ref=${ref}]`);
    }
  });

  it("handles a null tree and wide/deep construction iteratively", () => {
    const empty = renderSnapshot(null, "abcd1234.8");
    expect(empty.refs).toEqual([]);
    expect(empty.text.length).toBeGreaterThan(0);

    const wide = withChildren(
      0,
      "generic",
      Array.from({ length: 20_000 }, (_, index) => leaf(index + 1, "paragraph", { name: `n${index}` })),
      { refable: true },
    );
    const wideRendered = renderSnapshot(wide, "abcd1234.9");
    expect(wideRendered.truncated.nodes || wideRendered.truncated.text).toBe(true);
    expect(wideRendered.text.length).toBeLessThanOrEqual(LIMITS.snapshot.textChars);

    let deep: SnapshotNode = leaf(0, "generic");
    for (let depth = 1; depth < 5_000; depth += 1) {
      deep = withChildren(depth, "generic", [deep]);
    }
    const deepRendered = renderSnapshot(deep, "abcd1234.10");
    expect(deepRendered.truncated.depth).toBe(true);
    expect(deepRendered.text.length).toBeLessThanOrEqual(LIMITS.snapshot.textChars);
  });
});
