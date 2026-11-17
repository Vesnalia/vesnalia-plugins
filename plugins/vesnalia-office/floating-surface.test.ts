import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const widget = readFileSync(
  new URL("./floating-office-widget.tsx", import.meta.url),
  "utf8",
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`Missing CSS rule ${selector}`);
  return match[1];
}

describe("VesnALIA Office floating surface", () => {
  test("registers an independent app overlay and portals the office", () => {
    expect(app).toContain("app.slots.experimental_appOverlay(");
    expect(app).not.toContain("experimental_threadList");
    expect(app).not.toContain("<Original />");
    expect(app).toContain("createPortal(");
    expect(app).toContain("document.body");
    expect(app).not.toContain('className="alia-office-sidebar"');
    expect(css).not.toContain(".alia-office-sidebar");
  });

  test("lets the page receive input outside the floating widget", () => {
    expect(ruleBody(".alia-office-floating-root")).toMatch(
      /pointer-events\s*:\s*none/,
    );
    expect(ruleBody(".alia-office-floating-root")).toMatch(/z-index\s*:\s*35/);
    expect(ruleBody(".alia-office-floating-widget")).toMatch(
      /pointer-events\s*:\s*auto/,
    );
    expect(ruleBody(".alia-office-floating-widget")).toMatch(
      /position\s*:\s*fixed/,
    );
  });

  test("uses anchor-preserving animation, resizing, and overlay-only controls", () => {
    expect(ruleBody(".alia-office-floating-widget")).toMatch(
      /transform 240ms/,
    );
    expect(widget).toContain('className="alia-office-floating-resize"');
    expect(widget).not.toContain('className="alia-office-floating-toolbar"');
    expect(css).not.toContain(".alia-office-floating-toolbar");
  });

  test("keeps the floating office off compact screens", () => {
    expect(app).toContain("if (isCompactViewport) return null");
    expect(css).toContain("@media (max-width: 46rem)");
  });

  test("uses route-aware collapsed content without a worker-count badge", () => {
    expect(app).toContain("resolveFloatingOfficeCollapsedKind");
    expect(widget).toContain('data-collapsed-kind={collapsedKind}');
    expect(widget).toContain('collapsedKind === "floorplan"');
    expect(widget).toContain('collapsedKind !== "hidden"');
    expect(widget).not.toContain("alia-office-floating-count");
    expect(css).not.toContain(".alia-office-floating-count");
  });
});
