import { expect, it, vi } from "vitest";
import { CompatibilityError, compatibilityReport } from "../src/compatibility";
import { terminals } from "../src/host";

it("reports a specific missing contract once automatically and again on explicit retry", () => {
  const show = vi.fn(),
    report = compatibilityReport(show);
  const cause = new CompatibilityError(
    "TT_REACT",
    "Cannot access the committed React tree.",
  );
  report(cause);
  report(cause);
  expect(show).toHaveBeenCalledOnce();
  expect(show.mock.calls[0][0]).toContain("TT_REACT");
  expect(show.mock.calls[0][0]).toContain("Update Terminal Toggle");
  report(cause, true);
  expect(show).toHaveBeenCalledTimes(2);
});
it.each([
  undefined,
  { open: true, tabs: [] },
  {
    open: true,
    selectedKey: null,
    tabs: [{ key: "a", detail: { kind: "terminal" } }],
  },
])("rejects incompatible tab snapshots", (value) => {
  expect(() => terminals(value)).toThrow("TT_TABS");
});
it("does not include arbitrary thrown host data in automatic diagnostics", () => {
  const show = vi.fn();
  compatibilityReport(show)({ secret: "sensitive host object" });
  expect(show.mock.calls[0][0]).toContain("TT_OPERATION");
  expect(show.mock.calls[0][0]).not.toContain("sensitive host object");
});
