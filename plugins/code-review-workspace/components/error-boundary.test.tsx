// @vitest-environment jsdom
import type { ComponentType } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { loadPluginApp } from "@vesnalia/plugin-sdk/testing/app";

// Needs review's rows, failing to draw.
vi.mock("./NeedsReviewSidebar", () => ({ NeedsReviewSidebar: () => { throw new Error("Couldn't draw the rows"); } }));

afterEach(cleanup);

test("Needs review's rows failing to draw leave VesnALIA's thread list as it is, rather than take it down", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = await loadPluginApp(() => import("../app"));
  const Overlay = app.appOverlays.find((registration) => registration.id === "needs-review")!.component as ComponentType;
  const { container } = render(<div><Overlay /><p>VesnALIA's thread list</p></div>);
  expect(container.textContent).toBe("VesnALIA's thread list");
  report.mockRestore();
});
