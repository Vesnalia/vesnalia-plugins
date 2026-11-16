import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer-core";
import { BrowserToolError, type SnapshotPayload } from "./contracts.js";
import { BrowserSession } from "./executor.js";
import { chromeExecutablePath, startFixture, type Fixture } from "./test/browser-fixture.js";

let browser: Browser;
let fixture: Fixture;

const newSignal = () => new AbortController().signal;
const soon = (ms = 20_000) => Date.now() + ms;

function refFor(snapshot: SnapshotPayload, name: string, role?: string): string {
  const match = snapshot.refs.find(
    (candidate) =>
      (candidate.name ?? "").includes(name) && (role === undefined || candidate.role === role),
  );
  if (!match) {
    throw new Error(`no ref for ${JSON.stringify(name)} in ${JSON.stringify(snapshot.refs)}`);
  }
  return match.ref;
}

async function connect(): Promise<BrowserSession> {
  return BrowserSession.connect({
    wsEndpoint: browser.wsEndpoint(),
    signal: newSignal(),
    discoveryTimeoutMs: 5_000,
  });
}

async function withSession(run: (session: BrowserSession) => Promise<void>): Promise<void> {
  const session = await connect();
  try {
    await run(session);
  } finally {
    session.dispose();
  }
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    throw new Error(`expected rejection with ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserToolError);
    expect((error as BrowserToolError).code).toBe(code);
  }
};

beforeAll(async () => {
  browser = await puppeteer.launch({
    executablePath: chromeExecutablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  fixture = await startFixture();
}, 60_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  await fixture?.close().catch(() => {});
}, 60_000);

describe("BrowserSession", () => {
  it("snapshots bounded text with versioned refs and honest metadata", async () => {
    await withSession(async (session) => {
      const navigation = await session.navigate(fixture.url, newSignal(), soon());
      expect(navigation.action.ok).toBe(true);
      const snapshot = navigation.snapshot;
      expect(snapshot).not.toBeNull();
      if (!snapshot) return;
      expect(snapshot.snapshotId).toMatch(/^[0-9a-f]{8}\.[0-9]+$/);
      expect(snapshot.text).toContain('button "Increment"');
      expect(snapshot.text.length).toBeLessThanOrEqual(60_000);
      expect(snapshot.url).toBe(fixture.url);
      expect(refFor(snapshot, "Increment", "button")).toMatch(/:e[0-9]+$/);
    });
  });

  it("clicks a ref and reports the post-action snapshot", async () => {
    await withSession(async (session) => {
      const initial = await session.navigate(fixture.url, newSignal(), soon());
      const ref = refFor(initial.snapshot!, "Increment", "button");
      const result = await session.click(ref, newSignal(), soon());
      expect(result.action.ok).toBe(true);
      expect(result.snapshotError).toBeNull();
      const count = await session.evaluate(
        'document.getElementById("count").textContent',
        newSignal(),
        soon(),
      );
      expect(count.value).toBe("1");
    });
  });

  it("replaces and appends text through focused selection", async () => {
    await withSession(async (session) => {
      const initial = await session.navigate(fixture.url, newSignal(), soon());
      const ref = refFor(initial.snapshot!, "Name", "textbox");
      const replaced = await session.type(ref, "Alice", true, newSignal(), soon());
      expect(replaced.action.ok).toBe(true);
      const value = await session.evaluate(
        '({ value: document.getElementById("name").value, mirror: document.getElementById("mirror").textContent })',
        newSignal(),
        soon(),
      );
      expect(value.value).toEqual({ value: "Alice", mirror: "Alice" });
      const freshRef = refFor(replaced.snapshot!, "Name", "textbox");
      const appended = await session.type(freshRef, "X", false, newSignal(), soon());
      expect(appended.action.ok).toBe(true);
      const appendedValue = await session.evaluate(
        'document.getElementById("name").value',
        newSignal(),
        soon(),
      );
      expect(appendedValue.value).toBe("AliceX");
    });
  });

  it("dispatches validated key combinations", async () => {
    await withSession(async (session) => {
      const initial = await session.navigate(fixture.url, newSignal(), soon());
      const ref = refFor(initial.snapshot!, "Key input", "textbox");
      const focused = await session.type(ref, "", true, newSignal(), soon());
      expect(focused.action.ok).toBe(true);
      const pressed = await session.press("Control+Enter", newSignal(), soon());
      expect(pressed.action.ok).toBe(true);
      const lastKey = await session.evaluate(
        'document.getElementById("last-key").textContent',
        newSignal(),
        soon(),
      );
      expect(lastKey.value).toBe("Enter+ctrl");
    });
  });

  it("binds refs to nodes, not positions, and fails closed when the node is replaced", async () => {
    await withSession(async (session) => {
      const initial = await session.navigate(fixture.url, newSignal(), soon());
      const ref = refFor(initial.snapshot!, "Increment", "button");
      await session.evaluate('document.getElementById("reorder").click()', newSignal(), soon());
      const clicked = await session.click(ref, newSignal(), soon());
      expect(clicked.action.ok).toBe(true);
      const count = await session.evaluate(
        'document.getElementById("count").textContent',
        newSignal(),
        soon(),
      );
      expect(count.value).toBe("1");

      await session.evaluate('document.getElementById("inc").remove()', newSignal(), soon());
      const stale = await session.click(ref, newSignal(), soon());
      expect(stale.action.ok).toBe(false);
      if (!stale.action.ok) expect(stale.action.error.code).toBe("STALE_REF");
    });
  });

  it("reports a successful action separately from a failed follow-up snapshot", async () => {
    await withSession(async (session) => {
      const initial = await session.navigate(fixture.url, newSignal(), soon());
      const ref = refFor(initial.snapshot!, "Increment", "button");
      session.snapshot = async () => {
        throw new BrowserToolError("TARGET_UNAVAILABLE", "page lost");
      };
      const result = await session.click(ref, newSignal(), soon());
      expect(result.action.ok).toBe(true);
      expect(result.snapshot).toBeNull();
      expect(result.snapshotError?.code).toBe("TARGET_UNAVAILABLE");
    });
  });

  it("bounds evaluate output, handles cycles, and surfaces thrown errors", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      const bounded = await session.evaluate("'x'.repeat(200000)", newSignal(), soon());
      expect(bounded.truncated).toBe(true);
      expect(bounded.notice).not.toBeNull();

      const cycle = await session.evaluate(
        "(() => { const a = { self: null }; a.self = a; return a; })()",
        newSignal(),
        soon(),
      );
      expect(cycle.truncated).toBe(true);
      expect(cycle.notice).not.toBeNull();

      await expectCode(
        session.evaluate("(() => { throw new Error('bad') })()", newSignal(), soon()),
        "INVALID_INPUT",
      );
    });
  });

  it("closes the session when an evaluation exceeds its deadline", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      await expectCode(
        session.evaluate(
          "new Promise((resolve) => setTimeout(() => resolve('late'), 30000))",
          newSignal(),
          Date.now() + 500,
        ),
        "ACTION_OUTCOME_UNKNOWN",
      );
      expect(session.alive).toBe(false);
    });
  });

  it("aborts an in-flight evaluation and stops the session", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      const controller = new AbortController();
      const evaluation = session.evaluate(
        "new Promise((resolve) => setTimeout(() => resolve('late'), 30000))",
        controller.signal,
        soon(30_000),
      );
      setTimeout(() => controller.abort(), 100);
      await expectCode(evaluation, "ACTION_OUTCOME_UNKNOWN");
      expect(session.alive).toBe(false);
    });
  });

  it("reports actual encoded screenshot dimensions", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      const metrics = await session.evaluate(
        "({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 })",
        newSignal(),
        soon(),
      );
      const raw = metrics.value;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("metrics were not an object");
      }
      const expectedWidth = Math.round(Number(raw["width"]) * Number(raw["dpr"]));
      const expectedHeight = Math.round(Number(raw["height"]) * Number(raw["dpr"]));
      const viewport = await session.screenshot(false, newSignal(), soon());
      expect(viewport.mode).toBe("viewport");
      expect(viewport.width).toBe(expectedWidth);
      expect(viewport.height).toBe(expectedHeight);
      expect(viewport.bytes).toBeGreaterThan(0);
      expect(Buffer.from(viewport.data, "base64").length).toBe(viewport.bytes);

      await session.evaluate('document.getElementById("tall").click()', newSignal(), soon());
      const full = await session.screenshot(true, newSignal(), soon());
      expect(full.mode).toBe("full-page");
      expect(full.height).toBeGreaterThan(viewport.height);
    });
  });

  it("keeps console, page-error, and HTTP diagnostics with a cursor and scrubbed secrets", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      for (const id of ["console-error", "console-secret", "pageerror", "fetch404"]) {
        await session.evaluate(`document.getElementById("${id}").click()`, newSignal(), soon());
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      const first = session.readConsole(null);
      const texts = first.entries.map((entry) => `${entry.kind}:${entry.level}:${entry.text}`);
      expect(texts.some((text) => text.includes("fixture console error"))).toBe(true);
      expect(texts.some((text) => text.includes("fixture page error"))).toBe(true);
      expect(texts.some((text) => text.includes("status-404"))).toBe(true);
      const secret = first.entries.find((entry) => entry.text.includes("authorization"));
      expect(secret?.text).toContain("[redacted]");
      expect(secret?.text ?? "").not.toContain("abcd1234secretvalue");

      const next = session.readConsole(first.nextCursor);
      expect(next.entries).toEqual([]);

      await session.evaluate('document.getElementById("console-error").click()', newSignal(), soon());
      await new Promise((resolve) => setTimeout(resolve, 100));
      const incremental = session.readConsole(first.nextCursor);
      expect(incremental.entries.length).toBeGreaterThan(0);
      expect(incremental.entries[0]!.seq).toBeGreaterThanOrEqual(first.nextCursor);
    });
  });

  it("bounds snapshots of deep and oversized pages", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      await session.evaluate('document.getElementById("deep").click()', newSignal(), soon());
      const snapshot = await session.snapshot(newSignal(), soon(30_000));
      expect(snapshot.text.length).toBeLessThanOrEqual(60_000);
      expect(snapshot.refs.length).toBeLessThanOrEqual(2_000);
    });
  });

  it("refuses to connect with an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expectCode(
      BrowserSession.connect({
        wsEndpoint: browser.wsEndpoint(),
        signal: controller.signal,
        discoveryTimeoutMs: 1_000,
      }),
      "SESSION_STOPPED",
    );
  });

  it("bounds key-heavy evaluation results", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      const result = await session.evaluate(
        "Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['k'.repeat(2000) + i, 'v']))",
        newSignal(),
        soon(30_000),
      );
      expect(result.truncated).toBe(true);
      expect(JSON.stringify(result.value).length).toBeLessThanOrEqual(60_000);
    });
  });

  it("scrubs query strings from navigation failure messages", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      const result = await session.navigate(
        "http://127.0.0.1:1/cb?code=TOPSECRET&state=xyz",
        newSignal(),
        soon(10_000),
      );
      expect(result.action.ok).toBe(false);
      if (!result.action.ok) {
        expect(result.action.error.message).not.toContain("TOPSECRET");
        expect(result.action.error.message).not.toContain("?code=");
      }
    });
  });

  it("clamps over-long diagnostic URLs to the contract bound", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      await session.evaluate(
        `fetch("/${"a".repeat(5_000)}").catch(() => undefined)`,
        newSignal(),
        soon(),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const payload = session.readConsole(null);
      const entry = payload.entries.find((candidate) => candidate.level === "status-404");
      expect(entry).toBeDefined();
      expect(entry!.url!.length).toBeLessThanOrEqual(4_096);
      expect(entry!.url!).not.toContain("?");
    });
  });

  it("bounds and reduces an oversize full-page screenshot", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      await session.evaluate('document.getElementById("tall").click()', newSignal(), soon());
      await session.evaluate('document.getElementById("tall").click()', newSignal(), soon());
      const shot = await session.screenshot(true, newSignal(), soon(30_000));
      expect(shot.width * shot.height).toBeLessThanOrEqual(4_000_000);
      expect(shot.reduced).toBe(true);
      expect(Buffer.from(shot.data, "base64").length).toBe(shot.bytes);
    });
  });

  it("reports dropped diagnostics relative to the requested cursor", async () => {
    await withSession(async (session) => {
      await session.navigate(fixture.url, newSignal(), soon());
      await session.evaluate(
        '(() => { for (let index = 0; index < 250; index += 1) console.log("entry " + index); return true; })()',
        newSignal(),
        soon(),
      );
      const all = session.readConsole(0);
      expect(all.entries).toHaveLength(200);
      expect(all.dropped).toBe(50);
      const fromLive = session.readConsole(50);
      expect(fromLive.dropped).toBe(0);
      expect(fromLive.entries[0]!.seq).toBe(50);
    });
  });

  it("stops the session on transport loss", async () => {
    const transportBrowser = await puppeteer.launch({
      executablePath: chromeExecutablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
    const session = await BrowserSession.connect({
      wsEndpoint: transportBrowser.wsEndpoint(),
      signal: newSignal(),
      discoveryTimeoutMs: 5_000,
    });
    await transportBrowser.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(session.alive).toBe(false);
    await expectCode(session.snapshot(newSignal(), soon()), "SESSION_STOPPED");
    session.dispose();
  }, 60_000);
  it("R7 redacts cutoff quotes and clamps redaction expansion in captured diagnostics", async () => {
    await withSession(async session => {
      await session.navigate(fixture.url, newSignal(), soon());
      await session.evaluate(`(() => {
        console.log('password: "' + 'SYNTHETIC_SECRET_'.repeat(300) + '"');
        console.log('x'.repeat(1985) + ' password=abcd');
        return true;
      })()`, newSignal(), soon());
      const entries = session.readConsole(null).entries;
      expect(entries.some(entry => entry.text.includes("[redacted]"))).toBe(true);
      expect(entries.every(entry => !entry.text.includes("SYNTHETIC_SECRET"))).toBe(true);
      expect(entries.every(entry => entry.text.length <= 2000)).toBe(true);
    });
  });

});
