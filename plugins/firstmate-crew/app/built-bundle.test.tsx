// @vitest-environment jsdom
/**
 * The app as VesnALIA built it (`dist/app.js`), run on a VesnALIA whose runtime has `experimental_useTabVisible`. A
 * git install is built once, by the VesnALIA it was installed on, and keeps that bundle after VesnALIA is upgraded; a
 * bundle built by VesnALIA 0.47, whose list of the SDK's exports has no such hook, must still pause a hidden
 * board on VesnALIA 0.48. CI builds `dist/` with its pinned VesnALIA before it runs the tests; without a build there
 * is nothing to load, and this is skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { cleanup, screen, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, loadPluginApp, renderSlot } from "@vesnalia/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Fleet } from "../shared/types";

const dist = join(import.meta.dirname, "..", "dist");
const bundle = join(dist, "app.js");
const built = existsSync(bundle);

const FLEET: Fleet = {
  home: "/h",
  homeReady: true,
  mate: null,
  mateMissing: false,
  cards: [],
  suggestions: [],
  charter: { edited: false, outdated: false },
  watches: [],
};

beforeAll(async () => {
  if (!built) return;
  installTestPluginRuntime();
  // What else VesnALIA's runtime hands a bundle, as the bundle reads it.
  const runtime = (globalThis as unknown as { __aliaPluginRuntime: Record<string, unknown> }).__aliaPluginRuntime;
  Object.assign(runtime, {
    reactDom: await import("react-dom"),
    jsxRuntime: await import("react/jsx-runtime"),
    sonner: await import("sonner"),
    clsx: await import("clsx"),
    tailwindMerge: await import("tailwind-merge"),
    radixAlertDialog: await import("@radix-ui/react-alert-dialog"),
    classVarianceAuthority: await import("class-variance-authority"),
  });
});

afterEach(() => cleanup());

describe.skipIf(!built)("the FirstMate tab in the bundle VesnALIA built", () => {
  async function renderTab(tabVisible: boolean) {
    const app = await loadPluginApp(() => import(pathToFileURL(bundle).href));
    const tab = app.tabs.find((registration) => registration.id === "firstmate");
    if (tab === undefined) throw new Error("the bundle registers no FirstMate tab");
    let reads = 0;
    renderSlot(tab as Parameters<typeof renderSlot>[0], { threadId: "thr_other", params: null }, {
      tabVisible,
      rpc: {
        "fleet.load": () => {
          reads += 1;
          return FLEET;
        },
      },
    });
    return () => reads;
  }

  it(`reads the fleet while shown (built by VesnALIA ${built ? JSON.parse(readFileSync(join(dist, "app.meta.json"), "utf8")).builtWith.aliaVersion : "-"})`, async () => {
    const reads = await renderTab(true);
    await waitFor(() => expect(screen.getByText("No first mate aboard")).toBeTruthy());
    expect(reads()).toBe(1);
  });

  it("reads nothing while hidden, on a runtime that says so", async () => {
    const reads = await renderTab(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads()).toBe(0);
  });
});
