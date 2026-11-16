// @vitest-environment jsdom
/**
 * `useTabVisible` finds VesnALIA 0.48's hook in the runtime VesnALIA hands the bundle, whatever list of the SDK's
 * exports the bundle was built against, and counts the tab as shown where there is none. `built-bundle.test`
 * runs the same against the bundle VesnALIA built.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = globalThis as { __aliaPluginRuntime?: unknown };

async function load(exported: (() => boolean) | undefined, runtime: (() => boolean) | undefined) {
  vi.resetModules();
  vi.doMock("@vesnalia/plugin-sdk/app", () => ({ experimental_useTabVisible: exported }));
  host.__aliaPluginRuntime = runtime === undefined ? { pluginSdkApp: {} } : { pluginSdkApp: { experimental_useTabVisible: runtime } };
  const { useTabVisible } = await import("./tab-visible");
  return renderHook(() => useTabVisible()).result.current;
}

afterEach(() => {
  vi.doUnmock("@vesnalia/plugin-sdk/app");
  delete host.__aliaPluginRuntime;
});

describe("useTabVisible", () => {
  it("asks VesnALIA's runtime where it has the hook", async () => {
    expect(await load(() => true, () => false)).toBe(false);
  });

  it("asks VesnALIA's runtime even when the bundle was built against VesnALIA 0.47's exports, which lack it", async () => {
    expect(await load(undefined, () => false)).toBe(false);
  });

  it("is true on VesnALIA 0.47, which has no such hook", async () => {
    expect(await load(undefined, undefined)).toBe(true);
  });
});
