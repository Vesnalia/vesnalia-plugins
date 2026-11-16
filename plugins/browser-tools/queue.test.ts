import { describe, expect, it } from "vitest";
import { BrowserToolError } from "./contracts.js";
import { SerialQueue } from "./queue.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserToolError);
    expect((error as BrowserToolError).code).toBe(code);
  }
};

describe("SerialQueue", () => {
  it("runs tasks one at a time in submission order", async () => {
    const lifecycle = new AbortController();
    const queue = new SerialQueue(8, lifecycle.signal);
    const events: string[] = [];
    let active = 0;
    const run = (name: string, hold: Promise<void>) =>
      queue.run(async () => {
        active += 1;
        expect(active).toBe(1);
        events.push(`${name}:start`);
        await hold;
        events.push(`${name}:end`);
        active -= 1;
      }, new AbortController().signal);

    const first = deferred();
    const second = deferred();
    const one = run("one", first.promise);
    const two = run("two", second.promise);
    await Promise.resolve();
    expect(events).toEqual(["one:start"]);
    first.resolve();
    await one;
    await Promise.resolve();
    expect(events).toEqual(["one:start", "one:end", "two:start"]);
    second.resolve();
    await two;
    expect(events).toEqual(["one:start", "one:end", "two:start", "two:end"]);
  });

  it("rejects admission beyond the depth bound", async () => {
    const lifecycle = new AbortController();
    const queue = new SerialQueue(2, lifecycle.signal);
    const hold = deferred();
    const signal = new AbortController().signal;
    const first = queue.run(() => hold.promise, signal);
    const second = queue.run(() => hold.promise, signal);
    await expectCode(queue.run(async () => {}, signal), "QUEUE_FULL");
    hold.resolve();
    await Promise.all([first, second]);
    const third = queue.run(async () => "ok", signal);
    await expect(third).resolves.toBe("ok");
  });

  it("cancels a queued task without ever starting it", async () => {
    const lifecycle = new AbortController();
    const queue = new SerialQueue(4, lifecycle.signal);
    const hold = deferred();
    const controller = new AbortController();
    let queuedRan = false;
    const running = queue.run(() => hold.promise, new AbortController().signal);
    const queued = queue.run(async () => {
      queuedRan = true;
    }, controller.signal);
    controller.abort();
    await expectCode(queued, "SESSION_STOPPED");
    hold.resolve();
    await running;
    expect(queuedRan).toBe(false);
  });

  it("close rejects pending work and waits for the active task", async () => {
    const lifecycle = new AbortController();
    const queue = new SerialQueue(4, lifecycle.signal);
    const hold = deferred();
    const running = queue.run(() => hold.promise, new AbortController().signal);
    const pending = queue.run(async () => "never", new AbortController().signal);
    queue.close();
    await expectCode(pending, "SESSION_STOPPED");
    hold.resolve();
    await running;
    await queue.waitForIdle();
    await expectCode(queue.run(async () => "late", new AbortController().signal), "SESSION_STOPPED");
  });

  it("a failed task does not stall later tasks", async () => {
    const lifecycle = new AbortController();
    const queue = new SerialQueue(4, lifecycle.signal);
    const signal = new AbortController().signal;
    await expectCode(
      queue.run(async () => {
        throw new BrowserToolError("TARGET_UNAVAILABLE", "boom");
      }, signal),
      "TARGET_UNAVAILABLE",
    );
    await expect(queue.run(async () => "next", signal)).resolves.toBe("next");
  });

  it("lifecycle abort preempts the queue", async () => {
    const lifecycle = new AbortController();
    const queue = new SerialQueue(4, lifecycle.signal);
    const hold = deferred();
    const running = queue.run(() => hold.promise, new AbortController().signal);
    const pending = queue.run(async () => "never", new AbortController().signal);
    lifecycle.abort();
    await expectCode(pending, "SESSION_STOPPED");
    hold.resolve();
    await running;
    await expectCode(queue.run(async () => "late", new AbortController().signal), "SESSION_STOPPED");
  });
});
