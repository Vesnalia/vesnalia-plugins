import { expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@vesnalia/plugin-sdk/testing";
import plugin from "./server";
const captureId = "82cf39c2-3c52-4fbb-8a28-c3e87d9026cc";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const captured = {
  status: "captured",
  path: "/tmp/screenshot.png",
  sizeBytes: png.length,
};

it("transfers a native screenshot to the requested project and cleans up the Mac file", async () => {
  const upload = vi.fn().mockResolvedValue({
    path: "attachments/screenshot.png",
    name: "screenshot.png",
    type: "localImage",
    sizeBytes: png.length,
  });
  const { alia, harness } = createFakePluginHost({
    pluginId: "screenshot",
    experimental_callHostRpc: async ({ method }) =>
      method === "capture" ? captured : null,
    sdk: {
      files: {
        read: async () => ({
          content: png.toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/png",
          sizeBytes: png.length,
        }),
      },
      projects: { attachments: { upload } },
    },
  });
  try {
    plugin(alia);
    const result = await harness.behavior.callRpc("capture", {
      captureId,
      hostId: "mac1",
      projectId: "p1",
    });
    expect(result).toMatchObject({
      status: "captured",
      path: "attachments/screenshot.png",
      sizeBytes: png.length,
    });
    expect(upload.mock.calls[0]![0]).toMatchObject({
      projectId: "p1",
      mimeType: "image/png",
      clientFile: png,
    });
    expect(
      harness.experimental_hostRpcCalls.map((call) => call.method),
    ).toEqual(["capture", "release"]);
  } finally {
    await harness.lifecycle.dispose();
  }
});

it("cleans up the Mac's temporary image even if upload fails", async () => {
  const { alia, harness } = createFakePluginHost({
    pluginId: "screenshot",
    experimental_callHostRpc: async ({ method }) =>
      method === "capture" ? captured : null,
    sdk: {
      files: {
        read: async () => ({
          content: png.toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/png",
          sizeBytes: png.length,
        }),
      },
      projects: {
        attachments: {
          upload: async () => {
            throw new Error("Upload failed");
          },
        },
      },
    },
  });
  try {
    plugin(alia);
    await expect(
      harness.behavior.callRpc("capture", {
        captureId,
        hostId: "mac1",
        projectId: "p1",
      }),
    ).rejects.toThrow("Upload failed");
    expect(
      harness.experimental_hostRpcCalls.map((call) => call.method),
    ).toEqual(["capture", "release"]);
  } finally {
    await harness.lifecycle.dispose();
  }
});

it("returns local identity bridges only for supported connected hosts", async () => {
  const { alia, harness } = createFakePluginHost({
    pluginId: "screenshot",
    experimental_callHostRpc: async ({ hostId }) => {
      if (hostId === "unavailable") throw new Error("Offline");
      return hostId === "mac1"
        ? { port: 1234, token: "token", identity: "identity" }
        : null;
    },
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "mac1", name: "My Mac", status: "connected" }),
          makeHostResponse({
            id: "linux1",
            name: "Server",
            status: "connected",
          }),
          makeHostResponse({ id: "unavailable", status: "connected" }),
          makeHostResponse({ id: "offline", status: "disconnected" }),
        ],
      },
    },
  });
  try {
    plugin(alia);
    expect(await harness.behavior.callRpc("localBridges", null)).toEqual([
      { hostId: "mac1", port: 1234, token: "token", identity: "identity" },
    ]);
  } finally {
    await harness.lifecycle.dispose();
  }
});

it("honors cancellation that arrives before the capture request", async () => {
  const callHost = vi.fn().mockResolvedValue({ status: "cancelled" });
  const { alia, harness } = createFakePluginHost({
    pluginId: "screenshot",
    experimental_callHostRpc: callHost,
  });
  try {
    plugin(alia);
    await harness.behavior.callRpc("cancel", { captureId });
    expect(
      await harness.behavior.callRpc("capture", {
        captureId,
        hostId: "mac1",
        projectId: "p1",
      }),
    ).toEqual({ status: "cancelled" });
    expect(callHost).not.toHaveBeenCalled();
  } finally {
    await harness.lifecycle.dispose();
  }
});

it("refuses a corrupt image and still removes the temporary file", async () => {
  const upload = vi.fn();
  const { alia, harness } = createFakePluginHost({
    pluginId: "screenshot",
    experimental_callHostRpc: async ({ method }) =>
      method === "capture" ? captured : null,
    sdk: {
      files: {
        read: async () => ({
          content: Buffer.alloc(png.length).toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/png",
          sizeBytes: png.length,
        }),
      },
      projects: { attachments: { upload } },
    },
  });
  try {
    plugin(alia);
    await expect(
      harness.behavior.callRpc("capture", {
        captureId,
        hostId: "mac1",
        projectId: "p1",
      }),
    ).rejects.toThrow("invalid PNG");
    expect(upload).not.toHaveBeenCalled();
    expect(
      harness.experimental_hostRpcCalls.map((call) => call.method),
    ).toEqual(["capture", "release"]);
  } finally {
    await harness.lifecycle.dispose();
  }
});
