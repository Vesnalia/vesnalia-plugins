import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import type { Protocol } from "puppeteer-core";
import { BOUND_VALUE_SOURCE, buildSnapshotTree } from "./executor.js";
import { renderSnapshot } from "./snapshot.js";
import { LIMITS } from "./limits.js";

describe("R6 in-page serialization producer", () => {
  it.each(["1", "true", "'\\\"\\\\\\n'"])("globally bounds nested %s arrays before transfer", primitive => {
    const result = runInNewContext(`(() => {
      const bound = ${BOUND_VALUE_SOURCE};
      const state = { spent: 0, truncated: false };
      const value = Array.from({length:100}, () => Array.from({length:100}, () => Array(100).fill(${primitive})));
      const output = bound(value, ${JSON.stringify({ depth: 6, items: 100, stringChars: 10000, totalChars: 60000 })}, state);
      return { bytes: JSON.stringify(output).length, truncated: state.truncated };
    })()`);
    expect(result.bytes).toBeLessThanOrEqual(LIMITS.evaluate.outputChars);
    expect(result.truncated).toBe(true);
  });
});

describe("R11 AX materialization and rendering", () => {
  it.each([false, true])("counts acquired depth omissions exactly (shared/cyclic=%s)", shared => {
    const nodes: Protocol.Accessibility.AXNode[] = Array.from({length: 68}, (_, i) => ({
      nodeId: String(i), ignored: false,
      role: { type: "role", value: i ? "generic" : "RootWebArea" },
      childIds: i < 67 ? [String(i + 1)] : [],
    }));
    if (shared) {
      nodes[65]!.childIds = ["66", "67"];
      nodes[67]!.childIds = ["65", "66"];
    }
    const tree = buildSnapshotTree(nodes);
    const rendered = renderSnapshot(tree.root, "abcd1234.1", tree.truncated);
    expect(rendered.truncated.depth).toBe(true);
    expect(rendered.truncated.droppedNodes).toBe(3);
    expect(rendered.text).toContain("snapshot truncated");
    expect(rendered.text.length).toBeLessThanOrEqual(LIMITS.snapshot.textChars);
  });
});
