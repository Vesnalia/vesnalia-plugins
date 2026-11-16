import { WebSocketServer } from "ws";
import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import puppeteer, { type Browser } from "puppeteer-core";
import { experimental_createHostEntryHarness } from "@vesnalia/plugin-sdk/testing/host";
import { createHostEntry } from "./host.js";
import { chromeExecutablePath, startFixture, type Fixture } from "./test/browser-fixture.js";

let browser: Browser;
let fixture: Fixture;
const harness = experimental_createHostEntryHarness(createHostEntry({ discoveryTimeoutMs: 5_000 }));

let sessionCounter = 0;
const nextSessionId = () => `s_${++sessionCounter}`;

const openSession = (sessionId: string, expiresAt = Date.now() + 60_000) =>
  harness.experimental_call("open", {
    sessionId,
    wsEndpoint: browser.wsEndpoint(),
    expiresAt,
    deadlineAt: Date.now() + 30_000,
  });

const closeSession = async (sessionId: string) => {
  await harness.experimental_call("close", { sessionId }).catch(() => null);
};

let pageUrl = "";

beforeAll(async () => {
  browser = await puppeteer.launch({
    executablePath: chromeExecutablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  fixture = await startFixture();
  pageUrl = fixture.url;
}, 60_000);

afterAll(async () => {
  await harness.experimental_dispose();
  await browser?.close().catch(() => {});
  await fixture?.close().catch(() => {});
}, 60_000);

describe("browser tools host entry", () => {
  it("opens, navigates, snapshots, and closes a session", async () => {
    const sessionId = nextSessionId();
    try {
      const opened = await openSession(sessionId);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.data.snapshot.text).toContain("RootWebArea");
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBeGreaterThan(0);

      const navigation = await harness.experimental_call("navigate", {
        sessionId,
        url: pageUrl,
        deadlineAt: Date.now() + 30_000,
      });
      expect(navigation.ok).toBe(true);
      if (!navigation.ok || navigation.data.action.ok !== true) throw new Error("navigate failed");
      expect(navigation.data.snapshot?.title).toBe("BT Fixture");
      expect(navigation.data.snapshot?.text).toContain('button "Increment"');

      const snapshot = await harness.experimental_call("snapshot", {
        sessionId,
        deadlineAt: Date.now() + 30_000,
      });
      expect(snapshot.ok).toBe(true);
    } finally {
      const closed = await harness.experimental_call("close", { sessionId });
      expect(closed).toBeNull();
    }
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);

    const afterClose = await harness.experimental_call("snapshot", {
      sessionId,
      deadlineAt: Date.now() + 30_000,
    });
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) expect(afterClose.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("bounds the queue and recovers after the burst", async () => {
    const sessionId = nextSessionId();
    try {
      const opened = await openSession(sessionId);
      expect(opened.ok).toBe(true);

      const burst = await Promise.all(
        Array.from({ length: 12 }, () =>
          harness.experimental_call("snapshot", { sessionId, deadlineAt: Date.now() + 30_000 }),
        ),
      );
      const rejected = burst.filter((result) => !result.ok);
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected.every((result) => !result.ok && result.error.code === "QUEUE_FULL")).toBe(true);

      const recovered = await harness.experimental_call("snapshot", {
        sessionId,
        deadlineAt: Date.now() + 30_000,
      });
      expect(recovered.ok).toBe(true);
    } finally {
      await closeSession(sessionId);
    }
  });

  it("preempts in-flight work on close and releases the worker lease", async () => {
    const sessionId = nextSessionId();
    try {
      const opened = await openSession(sessionId);
      expect(opened.ok).toBe(true);
      await harness.experimental_call("navigate", {
        sessionId,
        url: pageUrl,
        deadlineAt: Date.now() + 30_000,
      });

      const inFlight = harness.experimental_call("evaluate", {
        sessionId,
        expression: "new Promise((resolve) => setTimeout(() => resolve('late'), 30000))",
        deadlineAt: Date.now() + 30_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const closed = await harness.experimental_call("close", { sessionId });
      expect(closed).toBeNull();
      const result = await inFlight;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["ACTION_OUTCOME_UNKNOWN", "SESSION_STOPPED"]).toContain(result.error.code);
      }
    } finally {
      await closeSession(sessionId);
    }
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  });

  it("hard-expires a session at the recorded lease expiry", async () => {
    const sessionId = nextSessionId();
    const opened = await openSession(sessionId, Date.now() + 1_500);
    expect(opened.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const snapshot = await harness.experimental_call("snapshot", {
      sessionId,
      deadlineAt: Date.now() + 30_000,
    });
    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) expect(snapshot.error.code).toBe("SESSION_NOT_FOUND");
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  });

  it("fails an unreachable endpoint cleanly and releases the worker lease", async () => {
    const sessionId = nextSessionId();
    const opened = await harness.experimental_call("open", {
      sessionId,
      wsEndpoint: "ws://127.0.0.1:1/cdp/deadbeef",
      expiresAt: Date.now() + 60_000,
      deadlineAt: Date.now() + 10_000,
    });
    expect(opened.ok).toBe(false);
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  });
  it.each(["deadline", "close", "protocol"])("R8 aborts stalled transport handshake on %s and releases retain", async kind => {
    const sockets = new Set<Socket>();
    const server = createServer();
    server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    if (kind === "protocol") new WebSocketServer({ server }); // Upgrade, then never answer Puppeteer initialization.
    else server.on("upgrade", (_request, socket) => { socket.resume(); socket.on("end", () => socket.end()); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address missing");
    const sessionId = nextSessionId();
    const opening = harness.experimental_call("open", {
      sessionId, wsEndpoint: `ws://127.0.0.1:${address.port}/stalled`,
      expiresAt: Date.now() + 60000, deadlineAt: Date.now() + (kind === "close" ? 10000 : 100),
    });
    try {
      await vi.waitFor(() => expect(sockets.size).toBe(1));
      if (kind === "close") await harness.experimental_call("close", { sessionId });
      const result = await Promise.race([opening, new Promise<"stalled">(resolve => setTimeout(() => resolve("stalled"), 500))]);
      expect(result).not.toBe("stalled");
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
      await vi.waitFor(() => expect(sockets.size).toBe(0));
    } finally {
      for (const socket of sockets) socket.destroy();
      await opening;
      await new Promise<void>(resolve => server.close(() => resolve()));
      await closeSession(sessionId);
    }
  });

  it("R8 abort during dispatched navigation prevents queued browser work", async () => {
    let response: ServerResponse | undefined;
    let dispatched!: () => void;
    const requestSeen = new Promise<void>(resolve => { dispatched = resolve; });
    const sockets = new Set<Socket>();
    const server = createServer((_request, incoming) => { response = incoming; dispatched(); });
    server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address missing");
    const sessionId = nextSessionId();
    try {
      expect((await openSession(sessionId)).ok).toBe(true);
      const controller = new AbortController();
      const navigation = harness.experimental_call("navigate", {
        sessionId, url: `http://127.0.0.1:${address.port}/delayed`, deadlineAt: Date.now() + 10000,
      }, { signal: controller.signal });
      await requestSeen;
      const queued = harness.experimental_call("evaluate", {
        sessionId, expression: "document.title = 'MUST_NOT_DISPATCH'", deadlineAt: Date.now() + 10000,
      });
      controller.abort();
      await navigation;
      response?.end("<title>late navigation</title>");
      expect((await queued).ok).toBe(false);
      await vi.waitFor(() => expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0));
    } finally {
      await closeSession(sessionId);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each(["close", "dispose"])("R8 %s drains an opening handshake before returning", async kind => {
    const entry = createHostEntry();
    let finishRelease!: () => void;
    const releaseGate = new Promise<void>(resolve => { finishRelease = resolve; });
    let releasing = false;
    // Only delay the SDK retain-release acknowledgement, not host lifecycle code.
    const local = experimental_createHostEntryHarness({
      ...entry,
      handlers: {
        ...entry.handlers,
        open: (input, context) => entry.handlers.open(input, {
          ...context,
          experimental_retainWorker: () => {
            const lease = context.experimental_retainWorker();
            return { dispose: async () => {
              releasing = true;
              await releaseGate;
              await lease.dispose();
            } };
          },
        }),
      },
    });
    const sockets = new Set<Socket>();
    const server = createServer();
    server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    server.on("upgrade", (_request, socket) => { socket.resume(); socket.on("end", () => socket.end()); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address missing");
    const sessionId = nextSessionId();
    const opening = local.experimental_call("open", {
      sessionId, wsEndpoint: `ws://127.0.0.1:${address.port}/stalled`,
      expiresAt: Date.now() + 60000, deadlineAt: Date.now() + 10000,
    });
    try {
      await vi.waitFor(() => expect(sockets.size).toBe(1));
      expect(local.experimental_getRetainedWorkerLeaseCount()).toBe(1);
      let stopped = false;
      const stopping = (kind === "close"
        ? local.experimental_call("close", { sessionId })
        : local.experimental_dispose()).then(() => { stopped = true; });
      await vi.waitFor(() => expect(releasing).toBe(true));
      expect(stopped).toBe(false);
      expect(local.experimental_getRetainedWorkerLeaseCount()).toBe(1);
      finishRelease();
      await stopping;
      // Do not await open or poll before checking teardown's completion contract.
      expect(local.experimental_getRetainedWorkerLeaseCount()).toBe(0);
      expect((await opening).ok).toBe(false);
    } finally {
      finishRelease();
      for (const socket of sockets) socket.destroy();
      await opening;
      await local.experimental_dispose();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

});
