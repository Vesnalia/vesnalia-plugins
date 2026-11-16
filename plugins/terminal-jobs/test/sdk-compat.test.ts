import { describe, expect, it } from "vitest";
// @ts-expect-error The public compatibility check is an executable JavaScript module.
import { assertCompatibility } from "../scripts/check-sdk-compat.mjs";

const expected = {
  sdkVersion: "0.4.34",
  builtWith: { bbVersion: "0.41.0", pluginSdkVersion: "0.4.34" },
};

describe("published SDK compatibility gate", () => {
  it("accepts only exact 0.4.34 declarations and build metadata", () => {
    expect(() => assertCompatibility("0.4.34", expected)).not.toThrow();
    expect(() => assertCompatibility("0.4.35", expected)).toThrow("expected published SDK 0.4.34");
    expect(() =>
      assertCompatibility("0.4.34", {
        ...expected,
        sdkVersion: "0.4.35",
        builtWith: { ...expected.builtWith, pluginSdkVersion: "0.4.35" },
      }),
    ).toThrow("expected exact SDK 0.4.34 build metadata");
    expect(() =>
      assertCompatibility("0.4.34", {
        ...expected,
        builtWith: { bbVersion: "0.42.0", pluginSdkVersion: "0.4.34" },
      }),
    ).toThrow("expected BB 0.41.0");
  });
});
