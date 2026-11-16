// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const styles = await readFile(`${process.cwd()}/tabs.css`, "utf8");
const element = document.createElement("style");
element.textContent = styles;
document.head.append(element);
if (!element.sheet) throw new Error("Chat Tabs stylesheet did not parse");

const blocks: Array<{ rule: CSSStyleRule; scope: string }> = [];
function collect(rules: CSSRuleList, scope = "") {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) blocks.push({ rule, scope });
    else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule)
      collect(rule.cssRules, rule.conditionText);
  }
}
collect(element.sheet.cssRules);
const compact = "(max-width: 767px), (pointer: coarse)";
function selectors(text: string) {
  text = text.replace(/\s+/gu, " ").replace(/\(\s+/gu, "(").replace(/\s+\)/gu, ")");
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      result.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(text.slice(start).trim());
  return result;
}
function value(selector: string, property: string, scope = "") {
  const matches = blocks.filter(
    (block) => block.scope === scope && selectors(block.rule.selectorText).includes(selector),
  );
  expect(matches.length, `Missing ${scope}: ${selector}`).toBeGreaterThan(0);
  return (
    matches
      .map(({ rule }) => rule.style.getPropertyValue(property))
      .filter(Boolean)
      .at(-1) ?? ""
  );
}
function expectStyle(selector: string, properties: Record<string, string>, scope = "") {
  for (const [property, expected] of Object.entries(properties))
    expect(value(selector, property, scope), `${scope}: ${selector} ${property}`).toBe(expected);
}

describe("Chat Tabs CSS contracts", () => {
  it("has no document-wide relational predicates while retaining local settings fallback", () => {
    expect(styles).not.toMatch(/\b(?:body|html)\s*:has\(/u);
    expectStyle('body:is(body, #alia-chat-tabs-overlay)[data-alia-chat-tabs-layout~="row-one"]', {
      "--alia-chat-tabs-strip-height": "48px",
    });
    expectStyle('body:is(body, #alia-chat-tabs-overlay)[data-alia-chat-tabs-layout~="no-overflow"]', {
      "--alia-chat-tabs-strip-height": "38px",
    });
    expectStyle('body[data-alia-chat-tabs-layout~="split"] #alia-chat-tabs-overlay', {
      display: "none",
    });
    expectStyle(
      'body:where([data-alia-chat-tabs-layout~="inert"]):is(body, [inert] [data-thread-window]:not(aside [data-thread-window])) #alia-chat-tabs-overlay',
      { display: "none" },
    );
  });
  it("shows a bounded full desktop workspace name with keyboard focus and keeps chat-list inset", () => {
    expectStyle(".alia-chat-tabs-workspace-trigger", {
      "box-sizing": "border-box",
      width: "auto",
      height: "1.75rem",
      "max-width": "min(16rem, 40vw)",
    });
    expectStyle(".alia-chat-tabs-content-row", { "padding-inline-start": "0.5rem" });
    expectStyle(".alia-chat-tabs-workspace-initial", { display: "none" });
    expectStyle(".alia-chat-tabs-workspace-label", {
      "white-space": "nowrap",
      "text-overflow": "ellipsis",
    });
    expect(value(".alia-chat-tabs-workspace-trigger:focus-visible", "outline")).toContain(
      "var(--ring",
    );
    expect(value(".alia-chat-tabs-workspace-menu-list", "max-height")).toContain(
      "--radix-dropdown-menu-content-available-height",
    );
  });
  it("shows only the short name and keeps all workspace controls at least 44px on compact/coarse surfaces", () => {
    expectStyle(".alia-chat-tabs-workspace-initial", { display: "inline" }, compact);
    expectStyle(".alia-chat-tabs-workspace-label", { display: "none" }, compact);
    expectStyle(
      '.alia-chat-tabs-workspace-switcher[data-compact="true"] .alia-chat-tabs-workspace-initial',
      { display: "inline" },
    );
    expectStyle(
      '.alia-chat-tabs-workspace-switcher[data-compact="true"] .alia-chat-tabs-workspace-label',
      { display: "none" },
    );
    expectStyle(
      ".alia-chat-tabs-workspace-trigger",
      { height: "44px", width: "44px", "min-height": "44px" },
      compact,
    );
    for (const selector of [
      ".alia-chat-tabs-workspace-action",
      ".alia-chat-tabs-workspace-menu-item",
      ".alia-chat-tabs-workspace-dialog .alia-chat-tab-dialog-button",
    ])
      expectStyle(selector, { "min-height": "44px" }, compact);
  });

  it("keeps settings language and position selects at least 44px on compact/coarse surfaces", () => {
    expectStyle(".alia-chat-tabs-settings select", { "min-height": "44px" }, compact);
  });

  it.each([
    {
      name: "hides only the host form while replacement settings exist",
      html: '<div data-testid="plugin-detail-tabs"><div class="overflow-hidden" id="host"></div><div class="alia-chat-tabs-settings"></div></div>',
      expected: ["host"],
    },
    {
      name: "keeps the native fallback without replacement settings",
      html: '<div data-testid="plugin-detail-tabs"><div class="overflow-hidden" id="host"></div></div>',
      expected: [],
    },
    {
      name: "does not hide a panel containing replacement settings",
      html: '<div data-testid="plugin-detail-tabs"><div class="overflow-hidden" id="host"><div class="alia-chat-tabs-settings"></div></div></div>',
      expected: [],
    },
    {
      name: "does not affect other plugins",
      html: '<div data-testid="plugin-detail-other"><div class="overflow-hidden" id="host"></div><div class="alia-chat-tabs-settings"></div></div>',
      expected: [],
    },
    {
      name: "does not hide generic first children or later panels",
      html: '<div data-testid="plugin-detail-tabs"><div id="generic"></div><div class="overflow-hidden" id="later"></div><div class="alia-chat-tabs-settings"></div></div>',
      expected: [],
    },
  ])("$name", ({ html, expected }) => {
    const selectors = blocks.filter(
      ({ scope, rule }) =>
        !scope &&
        rule.style.display === "none" &&
        rule.selectorText.includes('[data-testid="plugin-detail-tabs"]'),
    );
    expect(selectors).toHaveLength(1);
    const selector = selectors[0]!.rule.selectorText;
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(Array.from(root.querySelectorAll(selector), (node) => node.id)).toEqual(expected);
    if (expected.length) {
      const replacement = root.querySelector(".alia-chat-tabs-settings")!;
      const wrapper = document.createElement("div");
      replacement.replaceWith(wrapper);
      wrapper.append(replacement);
      expect(Array.from(root.querySelectorAll(selector), (node) => node.id)).toEqual(expected);
      replacement.remove();
      expect(root.querySelectorAll(selector)).toHaveLength(0);
    }
  });

  it("highlights pointer hover independently of keyboard selection", () => {
    for (const selector of [
      ".alia-chat-tabs-list-menu-item:not([data-disabled]):hover",
      ".alia-chat-tabs-list-menu-more:hover",
      '.alia-chat-tabs-list-menu-item[data-selected="true"]',
    ])
      expectStyle(selector, { background: "var(--muted)" });
  });
  it("keeps a flat scrollable strip and an RTL-safe close-button inset", () => {
    expectStyle(".alia-chat-tabs-strip", {
      display: "flex",
      gap: "0.375rem",
      "overflow-x": "auto",
      "overflow-y": "hidden",
      padding: "0.25rem 0.5rem",
    });
    expectStyle(".alia-chat-tab", {
      width: "13.5rem",
      "min-width": "9rem",
      "max-width": "13.5rem",
      flex: "1 1 13.5rem",
      height: "var(--alia-chat-tabs-tab-height)",
    });
    expectStyle(".alia-chat-tab-action", { "margin-inline-end": "0.25rem" });
    expect(value(".alia-chat-tabs-shell", "border-bottom")).toBe("");
  });
  it("shows drag feedback without allocating space for inactive drop targets", () => {
    expectStyle('.alia-chat-tab[data-dragging="true"]', { opacity: "0.52" });
    expectStyle(".alia-chat-tab-drop-slot", { width: "0px", display: "none" });
    expectStyle('.alia-chat-tabs-strip[data-dragging="true"] .alia-chat-tab-drop-slot', {
      width: "0px",
      display: "block",
      "margin-inline": "-0.1875rem",
    });
    // JSDOM drops the valid unitless-zero flex shorthand and WebKit-only properties.
    expect(styles).toMatch(/\.alia-chat-tab-drop-slot\s*\{[^}]*\bflex:\s*0 0 0(?:px)?;/u);
    expectStyle('.alia-chat-tab-drop-slot[data-active="true"] .alia-chat-tab-drop-slot-hit::before', {
      background: "var(--ring, var(--primary))",
    });
  });
  it("uses host theme tokens for work, unread and scrollbar colors", () => {
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expectStyle(":root", {
      "--alia-chat-tabs-status-working": "var(--foreground)",
      "--alia-chat-tabs-status-unread": "var(--foreground)",
    });
    expect(value(":root", "--alia-chat-tabs-status-working-dot")).toContain("var(--primary) 45%");
    expect(value(":root", "--alia-chat-tabs-status-working-halo")).toContain("var(--primary) 20%");
    for (const token of ["--alia-chat-tabs-scrollbar-track", "--alia-chat-tabs-scrollbar-thumb"])
      expect(value(":root", token)).toContain("color-mix(");
  });
  it("keeps selected tabs readable in light and dark themes", () => {
    expect(value(":root", "--alia-chat-tabs-active-background")).toContain("var(--foreground) 20%");
    expect(value(".dark", "--alia-chat-tabs-active-background")).toContain("var(--foreground) 12%");
    expect(value(":root", "--alia-chat-tabs-active-border")).toContain("color-mix(");
  });
  it("uses a thin desktop proxy scrollbar instead of a second native strip scrollbar", () => {
    expectStyle(".alia-chat-tabs-top-scrollbar", {
      "overflow-x": "scroll",
      "scrollbar-width": "thin",
    });
    expectStyle(".alia-chat-tabs-top-scrollbar::-webkit-scrollbar", { height: "0.5rem" });
    expectStyle(".alia-chat-tabs-top-scrollbar::-webkit-scrollbar-track", {
      background: "var(--alia-chat-tabs-scrollbar-track)",
    });
    expectStyle(".alia-chat-tabs-top-scrollbar::-webkit-scrollbar-thumb", {
      background: "var(--alia-chat-tabs-scrollbar-thumb)",
    });
    expectStyle(".alia-chat-tabs-strip::-webkit-scrollbar", { display: "none" });
    expectStyle('.alia-chat-tabs-shell[data-scrollable="false"] .alia-chat-tabs-top-scrollbar', {
      display: "none",
    });
    expectStyle(":root", { "--alia-chat-tabs-strip-height": "48px" });
  });
  it("bounds homepage cards and keeps their actions compact with larger touch targets", () => {
    expectStyle(".alia-chat-tabs-homepage-pinned-items", {
      "grid-template-columns": "repeat(auto-fit, minmax(11rem, 1fr))",
      "max-height": "18rem",
    });
    expectStyle(".alia-chat-tabs-homepage-pinned-project", {
      "min-width": "0px",
      flex: "1 1 auto",
    });
    expectStyle(".alia-chat-tabs-homepage-pinned-status", { "max-width": "68%" });
    expectStyle(".alia-chat-tabs-homepage-remove svg", { width: "0.875rem", height: "0.875rem" });
    expectStyle(".alia-chat-tabs-homepage-remove", { width: "1.5rem", height: "1.5rem" });
    expectStyle(
      ".alia-chat-tabs-homepage-remove",
      { width: "2.75rem", height: "2.75rem" },
      "(pointer: coarse)",
    );
    expectStyle(".alia-chat-tabs-homepage-pinned-button", { padding: "0.375rem 0.5rem" });
    for (const status of ["working", "unread"])
      expect(
        value(`.alia-chat-tabs-homepage-pinned-status[data-status="${status}"]`, "color"),
      ).not.toBe("");
  });
  it("keeps context menus compact and editable titles discoverable", () => {
    expectStyle(".alia-chat-tab-context-menu", {
      "min-width": "7rem",
      "border-radius": "0.375rem",
      background: "var(--popover, var(--background))",
    });
    expectStyle(".alia-chat-tab-context-menu-item", {
      padding: "0.3125rem 0.5rem",
      "font-size": "0.75rem",
    });
    expectStyle(".alia-chat-tab-context-menu-item > svg", { width: "1rem" });
    expectStyle(".alia-chat-tab-context-menu-separator", { margin: "0.25rem -0.25rem" });
    expectStyle(".alia-chat-tab-title", { cursor: "pointer" });
    expectStyle(".alia-chat-tab-inline-rename", { cursor: "text" });
    expect(value(".alia-chat-tab-rename-dialog", "background")).toContain("var(--popover");
    expect(value(".alia-chat-tab-rename-overlay", "background")).not.toBe("");
  });
  it("animates both modal layers in both directions, preserves centering and supports reduced motion", () => {
    for (const target of ["dialog", "overlay"])
      for (const [state, suffix, duration] of [
        ["open", "in", "160ms"],
        ["closed", "out", "120ms"],
      ]) {
        const animation = value(
          `.alia-chat-tabs-workspace-${target}[data-state="${state}"]`,
          "animation",
        );
        expect(animation).toContain(`alia-chat-tabs-${target}-${suffix}`);
        expect(animation).toContain(duration);
      }
    expectStyle(".alia-chat-tab-rename-dialog.alia-chat-tabs-workspace-dialog", {
      "transform-origin": "0 0",
    });
    for (const target of ["dialog", "overlay"])
      for (const suffix of ["in", "out"]) {
        const frames = Array.from(element.sheet!.cssRules).find(
          (rule): rule is CSSKeyframesRule =>
            rule instanceof CSSKeyframesRule && rule.name === `alia-chat-tabs-${target}-${suffix}`,
        );
        expect(frames).toBeDefined();
        const steps = Array.from(frames!.cssRules).filter(
          (frame): frame is CSSKeyframeRule => frame instanceof CSSKeyframeRule,
        );
        const from = steps.find((frame) => /^(from|0%)$/u.test(frame.keyText));
        const to = steps.find((frame) => /^(to|100%)$/u.test(frame.keyText));
        expect(from?.style.getPropertyValue("opacity")).toBe(suffix === "in" ? "0" : "1");
        expect(to?.style.getPropertyValue("opacity")).toBe(suffix === "in" ? "1" : "0");
        if (target === "dialog") {
          expect(from?.style.getPropertyValue("scale")).toBe(suffix === "in" ? "0.97" : "1");
          expect(to?.style.getPropertyValue("scale")).toBe(suffix === "in" ? "1" : "0.97");
          expect(steps.map((frame) => frame.style.getPropertyValue("transform"))).toEqual(["", ""]);
        }
      }
    for (const target of ["dialog", "overlay"])
      expectStyle(
        `.alia-chat-tabs-workspace-${target}[data-state]`,
        { animation: "none" },
        "(prefers-reduced-motion: reduce)",
      );
  });
  it("keeps nested-only work grey even on the selected parent tab", () => {
    const selector = '.alia-chat-tab .alia-chat-tab-working[data-nested-only="true"]';
    expectStyle(selector, {
      background: "color-mix(in oklch, var(--muted-foreground) 80%, var(--background))",
      "box-shadow": "none",
    });
    expect(styles.indexOf(selector)).toBeGreaterThan(
      styles.indexOf('.alia-chat-tab[data-active="true"] .alia-chat-tab-working'),
    );
  });
  it("keeps unread dots visible on selected tabs", () => {
    expectStyle(".alia-chat-tab-unread", { background: "var(--alia-chat-tabs-status-unread)" });
    expectStyle('.alia-chat-tab[data-active="true"] .alia-chat-tab-unread', {
      background: "var(--alia-chat-tabs-active-foreground)",
    });
  });
  it("anchors only to main chat panes and reserves space only outside split layouts", () => {
    expectStyle(
      "[data-thread-window]:not(aside [data-thread-window])",
      { "anchor-name": "--alia-chat-tabs-thread-window" },
      "(left: anchor(left))",
    );
    expectStyle(
      'body:where([data-alia-chat-tabs-layout~="main"]):is(body, [data-thread-window]:not(aside [data-thread-window])) #alia-chat-tabs-overlay',
      { "position-anchor": "--alia-chat-tabs-thread-window" },
      "(left: anchor(left))",
    );
    const reserve =
      'body:is(body, #alia-chat-tabs-overlay)[data-alia-chat-tabs-layout~="docked"]:not([data-alia-chat-tabs-layout~="split"]) [data-testid="app-layout-content-shell"] [data-thread-window]:not(aside [data-thread-window])';
    for (const scope of ["(min-width: 768px) and (pointer: fine)", compact]) {
      const block = blocks.find(
        ({ rule, scope: actual }) =>
          actual === scope && selectors(rule.selectorText).includes(reserve),
      );
      expect(block?.rule.style.getPropertyValue("padding-block-start")).toBe(
        "var(--alia-chat-tabs-strip-height)",
      );
    }
  });
  it("lets tabs grow to 1.5x and shrink before the strip scrolls", () => {
    expectStyle(".alia-chat-tab", {
      "min-width": "9rem",
      "max-width": "13.5rem",
      flex: "1 1 13.5rem",
    });
    expectStyle(
      ".alia-chat-tab",
      { "min-width": "6.75rem", "max-width": "13.5rem", flex: "1 1 13.5rem" },
      compact,
    );
  });
  it("keeps menu controls, bounded content and unavailable statuses consistent", () => {
    expectStyle('.alia-chat-tabs-list-switcher[data-position="right"]', {
      padding: "0.25rem 0.5rem 0.25rem 0px",
    });
    expectStyle(".alia-chat-tabs-list-trigger", {
      width: "var(--alia-chat-tabs-tab-height)",
      height: "var(--alia-chat-tabs-tab-height)",
    });
    expectStyle(".alia-chat-tabs-new-trigger", { background: "transparent", border: "0px" });
    expectStyle(".alia-chat-tabs-strip", {
      flex: "0 1 auto",
      "min-width": "0px",
      "overflow-x": "auto",
    });
    expectStyle(".alia-chat-tabs-new-switcher", { "align-items": "center", flex: "0 0 auto" });
    expectStyle(".alia-chat-tabs-new-switcher", { "margin-inline-end": "0px" }, compact);
    for (const target of ["list", "new"])
      expect(value(`.alia-chat-tabs-${target}-menu[data-state="closed"]`, "animation")).toContain(
        "alia-chat-tabs-menu-out",
      );
    expectStyle(".alia-chat-tabs-list-menu-project", { "min-width": "0px", flex: "1 1 auto" });
    expectStyle(".alia-chat-tabs-list-menu-item[data-disabled]", {
      cursor: "not-allowed",
      background: "transparent",
    });
    expectStyle(".alia-chat-tabs-list-menu-title[data-unavailable]", {
      "text-decoration-line": "line-through",
    });
    expect(value(".alia-chat-tabs-list-menu", "max-height")).toContain("44rem");
    expect(value(".alia-chat-tabs-list-menu", "max-height")).toContain(
      "--radix-dropdown-menu-content-available-height",
    );
    expectStyle(".alia-chat-tabs-list-menu-more", {
      "font-size": "0.75rem",
      "font-weight": "500",
      "line-height": "1rem",
    });
    expect(value(".alia-chat-tabs-list-menu-history-page-separator", "background")).toContain(
      "var(--foreground) 20%",
    );
    expect(value('.alia-chat-tabs-new-menu-more[data-pending="true"]::after', "animation")).toContain(
      "alia-chat-tabs-history-more-progress 300ms",
    );
    for (const target of ["list", "new", "workspace"])
      expectStyle(
        `.alia-chat-tabs-${target}-menu[data-state]`,
        { animation: "none" },
        "(prefers-reduced-motion: reduce)",
      );
  });
  it("keeps mobile strips swipeable and hides them behind mobile shelves", () => {
    expectStyle(
      '#alia-chat-tabs-overlay[data-docked="true"]',
      {
        "z-index": "31",
        display: "block",
        "--alia-chat-tabs-strip-height": "3.5rem",
        "--alia-chat-tabs-tab-height": "2.75rem",
      },
      compact,
    );
    expectStyle(".alia-chat-tabs-strip", { "scroll-snap-type": "x proximity" }, compact);
    expect(styles).toMatch(/\.alia-chat-tabs-strip\s*\{[^}]*-webkit-overflow-scrolling:\s*touch;/u);
    for (const selector of [".alia-chat-tab-drop-slot", ".alia-chat-tabs-top-scrollbar"]) {
      expectStyle(selector, { display: "none" }, compact);
      expect(
        blocks
          .find((block) => block.scope === compact && block.rule.selectorText === selector)
          ?.rule.style.getPropertyPriority("display"),
      ).toBe("important");
    }
    for (const target of ["list", "new"])
      expectStyle(
        `.alia-chat-tabs-${target}-trigger`,
        { width: "2.75rem", height: "2.75rem" },
        compact,
      );
    for (const token of ["sidebar-open", "panel-shelf", "panel-full"]) {
      for (const target of ["#alia-chat-tabs-overlay", ".alia-chat-tabs-list-menu"])
        expectStyle(
          `body[data-alia-chat-tabs-layout~="${token}"] ${target}`,
          { display: "none" },
          compact,
        );
    }
  });
});
