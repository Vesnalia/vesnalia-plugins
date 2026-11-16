// @vitest-environment node
import { expect, it } from "vitest";
import { connect } from "node:net";
import { once } from "node:events";
import { createLocalBridge } from "./local-bridge";
it("serves local identity only with its own token and allows browser preflight", async () => {
  const bridge = await createLocalBridge();
  const url = `http://127.0.0.1:${bridge.port}/alia-screenshot/identify`;
  try {
    expect((await fetch(url)).status).toBe(403);
    expect(
      (await fetch(url, { headers: { Authorization: "Bearer wrong" } })).status,
    ).toBe(403);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bridge.token}` },
    });
    expect(await response.json()).toEqual({ identity: bridge.identity });
    const preflight = await fetch(url, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
  } finally {
    await bridge.close();
  }
});

it("closes open connections and permits repeated cleanup", async () => {
  const bridge = await createLocalBridge();
  const socket = connect(bridge.port, "127.0.0.1");
  await once(socket, "connect");
  const closed = once(socket, "close");
  await bridge.close();
  await closed;
  await bridge.close();
  await expect(
    fetch(`http://127.0.0.1:${bridge.port}/alia-screenshot/identify`),
  ).rejects.toThrow();
});
