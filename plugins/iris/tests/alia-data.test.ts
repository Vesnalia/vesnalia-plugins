import { describe, expect, it } from "vitest";
import { ALIA_SOURCES, parseAliaSource } from "../core/alia-data";
import { check } from "../core/check";
import { aliaDataGuide, docsFor } from "../core/prompt";

describe("alia live data sources", () => {
  it("reads a source name and its options", () => {
    expect(parseAliaSource("alia:threads?scope=project&usage")).toEqual({ ok: true, name: "threads", query: { scope: "project", usage: "1" } });
    expect(parseAliaSource("alia:thread")).toEqual({ ok: true, name: "thread", query: {} });
  });

  it("refuses unknown sources and odd option names", () => {
    expect(parseAliaSource("alia:secrets").ok).toBe(false);
    expect(parseAliaSource("alia:threads?Scope=x").ok).toBe(false);
    expect(parseAliaSource("alia:../x").ok).toBe(false);
    expect(parseAliaSource("alia:threads?scope=%E0%A").ok).toBe(false);
  });

  it("documents every source, and the guide's example passes check", () => {
    const guide = aliaDataGuide();
    for (const s of ALIA_SOURCES) expect(guide).toContain(`alia:${s.name}`);
    expect(docsFor(["alia"])).toBe(guide);
    const example = /```iris\n([\s\S]*?)```/.exec(guide)?.[1] ?? "";
    const report = check(example, { load: () => new Promise(() => undefined) });
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

import { describeLine, formatAmount, formatOf, normalizeBudget } from "../core/budget";
describe("Budget in percent", () => {
  it("reads percent lines as percentages and never totals them", () => {
    expect(formatAmount(47, "percent")).toBe("47%");
    expect(formatOf(53, 100, "percent")).toBe("53% of 100%");
    const r = normalizeBudget({ lines: [{ label: "a", spent: 53, limit: 100, unit: "percent" }, { label: "b", spent: 26, limit: 100, unit: "percent" }] } as never, {}, Date.now());
    expect(r.model.totals).toEqual([]);
    expect(describeLine(r.model.lines[0])).toBe("53%");
  });
});
