import { afterEach, expect, it, vi } from "vitest";
import { findLocalMac } from "./find-local-mac";
afterEach(() => vi.unstubAllGlobals());
it("verifies the local worker token and never contacts a remote machine", async () => {
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => ({
    ok:
      options.headers &&
      (options.headers as Record<string, string>).Authorization ===
        "Bearer local-token",
    json: async () => ({ identity: "local-identity" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await findLocalMac(
      [
        {
          hostId: "remote",
          port: 1234,
          token: "remote-token",
          identity: "remote-identity",
        },
        {
          hostId: "local",
          port: 2345,
          token: "local-token",
          identity: "local-identity",
        },
      ],
      new AbortController().signal,
    ),
  ).toBe("local");
  expect(
    fetchMock.mock.calls.every(
      ([url]) => new URL(url).hostname === "127.0.0.1",
    ),
  ).toBe(true);
});
it("refuses capture when no local identity proof succeeds", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Connection refused")),
  );
  await expect(
    findLocalMac(
      [
        {
          hostId: "remote",
          port: 1234,
          token: "wrong",
          identity: "remote-identity",
        },
      ],
      new AbortController().signal,
    ),
  ).rejects.toThrow("this Mac");
  await expect(findLocalMac([], new AbortController().signal)).rejects.toThrow(
    "this Mac",
  );
});

it("does not mistake an unrelated localhost service for a remote Mac", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ local: true }) }),
  );
  await expect(
    findLocalMac(
      [
        {
          hostId: "remote",
          port: 1234,
          token: "remote-token",
          identity: "remote-identity",
        },
      ],
      new AbortController().signal,
    ),
  ).rejects.toThrow("this Mac");
});

it("does not start probes after cancellation", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  controller.abort();
  await expect(
    findLocalMac(
      [{ hostId: "mac1", port: 1234, token: "token", identity: "identity" }],
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("aborts remaining probes after finding the current Mac", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      if (
        options.headers &&
        (options.headers as Record<string, string>).Authorization ===
          "Bearer local-token"
      )
        return { ok: true, json: async () => ({ identity: "local-identity" }) };
      return new Promise((_resolve, reject) =>
        options.signal!.addEventListener(
          "abort",
          () => reject(options.signal!.reason),
          { once: true },
        ),
      );
    }),
  );
  expect(
    await findLocalMac(
      [
        {
          hostId: "remote",
          port: 1234,
          token: "remote-token",
          identity: "remote-identity",
        },
        {
          hostId: "local",
          port: 2345,
          token: "local-token",
          identity: "local-identity",
        },
      ],
      new AbortController().signal,
    ),
  ).toBe("local");
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
