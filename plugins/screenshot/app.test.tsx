import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@vesnalia/plugin-sdk/testing/app";
import { findLocalMac } from "./find-local-mac";
vi.mock("./find-local-mac", () => ({ findLocalMac: vi.fn() }));
beforeEach(() => {
  vi.mocked(findLocalMac).mockResolvedValue("local-mac");
});
const image = {
  status: "captured" as const,
  path: "attachments/new.png",
  name: "screenshot.png",
  sizeBytes: 123,
};

it("captures only on the verified local Mac and preserves the original draft", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const capture = vi.fn().mockResolvedValue(image);
  const action = renderSlot(
    app.composerCustomizations[0]!.actions![0]!,
    {},
    {
      composer: {
        scope: { kind: "new-thread", projectId: "p1" },
        text: "Please fix this",
        attachments: [{ type: "localFile", path: "old.txt", name: "old.txt" }],
      },
    },
  );
  const controller = renderSlot(
    app.appOverlays[0]!,
    {},
    { rpc: { localBridges: () => [], capture, cancel: () => null } },
  );
  try {
    await act(async () =>
      fireEvent.click(action.getByRole("button", { name: "Take screenshot" })),
    );
    await waitFor(() =>
      expect(action.inspection.composer.draft.attachments).toHaveLength(2),
    );
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0]![0]).toMatchObject({
      projectId: "p1",
      hostId: "local-mac",
    });
    expect(action.inspection.composer.text).toBe("Please fix this");
    expect(action.inspection.composer.draft.attachments[0]).toEqual({
      type: "localFile",
      path: "old.txt",
      name: "old.txt",
    });
    expect(action.inspection.composer.submits).toHaveLength(0);
    expect(app.composerCustomizations[0]!.plusMenu).toHaveLength(1);
  } finally {
    controller.lifecycle.unmount();
    action.lifecycle.unmount();
  }
});

it("does not start capture on another host when the local Mac cannot be verified", async () => {
  vi.mocked(findLocalMac).mockRejectedValue(new Error("No local Mac"));
  const app = await loadPluginApp(() => import("./app"));
  const capture = vi.fn();
  const action = renderSlot(
    app.composerCustomizations[0]!.actions![0]!,
    {},
    {
      composer: {
        scope: { kind: "new-thread", projectId: "p1" },
        text: "Keep this",
      },
    },
  );
  const controller = renderSlot(
    app.appOverlays[0]!,
    {},
    { rpc: { localBridges: () => [], capture } },
  );
  try {
    await act(async () =>
      fireEvent.click(action.getByRole("button", { name: "Take screenshot" })),
    );
    await waitFor(() =>
      expect(
        action.getByRole("button", { name: "Take screenshot" }),
      ).toBeTruthy(),
    );
    expect(capture).not.toHaveBeenCalled();
    expect(action.inspection.composer.draft.attachments).toHaveLength(0);
  } finally {
    controller.lifecycle.unmount();
    action.lifecycle.unmount();
  }
});

it("resolves the original thread's project and treats native Escape as cancellation", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const capture = vi.fn().mockResolvedValue({ status: "cancelled" });
  const getThread = vi.fn().mockResolvedValue({ projectId: "thread-project" });
  const action = renderSlot(
    app.composerCustomizations[0]!.actions![0]!,
    {},
    {
      composer: {
        scope: { kind: "thread", threadId: "t1" },
        text: "Keep this draft",
      },
    },
  );
  const controller = renderSlot(
    app.appOverlays[0]!,
    {},
    {
      rpc: { localBridges: () => [], capture },
      sdk: { threads: { get: getThread } },
    },
  );
  try {
    await act(async () =>
      fireEvent.click(action.getByRole("button", { name: "Take screenshot" })),
    );
    await waitFor(() => expect(capture).toHaveBeenCalledOnce());
    expect(capture.mock.calls[0]![0]).toMatchObject({
      projectId: "thread-project",
      hostId: "local-mac",
    });
    expect(action.inspection.composer.draft.attachments).toHaveLength(0);
  } finally {
    controller.lifecycle.unmount();
    action.lifecycle.unmount();
  }
});

it("cancels an in-flight capture and ignores a late screenshot result", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let resolveCapture!: (value: typeof image) => void;
  const capture = vi.fn(
    () =>
      new Promise<typeof image>((resolve) => {
        resolveCapture = resolve;
      }),
  );
  const cancel = vi.fn(() => null);
  const action = renderSlot(
    app.composerCustomizations[0]!.actions![0]!,
    {},
    {
      composer: {
        scope: { kind: "new-thread", projectId: "p1" },
        text: "Still here",
      },
    },
  );
  const controller = renderSlot(
    app.appOverlays[0]!,
    {},
    { rpc: { localBridges: () => [], capture, cancel } },
  );
  try {
    await act(async () =>
      fireEvent.click(action.getByRole("button", { name: "Take screenshot" })),
    );
    await waitFor(() => expect(capture).toHaveBeenCalledOnce());
    await act(async () =>
      fireEvent.click(
        action.getByRole("button", { name: "Cancel screenshot" }),
      ),
    );
    await act(async () => resolveCapture(image));
    expect(cancel).toHaveBeenCalledOnce();
    expect(action.inspection.composer.draft.attachments).toHaveLength(0);
  } finally {
    controller.lifecycle.unmount();
    action.lifecycle.unmount();
  }
});
