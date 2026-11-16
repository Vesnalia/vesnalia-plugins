import { BrowserToolError } from "./contracts.js";

type PendingEntry = {
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

/**
 * One bounded serial queue per browser session: the single owner of command
 * ordering. Tasks run one at a time; queued tasks observe their own abort
 * signal and can never start after it fires. `close` preempts the queue and
 * settles every pending task.
 */
export class SerialQueue {
  readonly #maxDepth: number;
  readonly #lifecycle: AbortSignal;
  readonly #pending: PendingEntry[] = [];
  #active = 0;
  #closed = false;
  #idle: Promise<void> = Promise.resolve();
  #resolveIdle: (() => void) | null = null;

  constructor(maxDepth: number, lifecycle: AbortSignal) {
    this.#maxDepth = maxDepth;
    this.#lifecycle = lifecycle;
    lifecycle.addEventListener("abort", () => this.close(), { once: true });
  }

  get active(): number {
    return this.#active;
  }

  get queued(): number {
    return this.#pending.length;
  }

  run<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.#closed || this.#lifecycle.aborted) {
      return Promise.reject(
        new BrowserToolError("SESSION_STOPPED", "The browser session is no longer available"),
      );
    }
    if (this.#pending.length + this.#active >= this.#maxDepth) {
      return Promise.reject(
        new BrowserToolError(
          "QUEUE_FULL",
          `The browser session already has ${this.#maxDepth} commands pending`,
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const entry: PendingEntry = {
        run: run as (signal: AbortSignal) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
        onAbort: () => {
          const index = this.#pending.indexOf(entry);
          if (index >= 0) {
            this.#pending.splice(index, 1);
            reject(new BrowserToolError("SESSION_STOPPED", "The browser command was cancelled"));
          }
        },
      };
      if (signal.aborted) {
        reject(new BrowserToolError("SESSION_STOPPED", "The browser command was cancelled"));
        return;
      }
      signal.addEventListener("abort", entry.onAbort, { once: true });
      this.#pending.push(entry);
      this.#pump();
    });
  }

  /** Reject everything queued and wait for the in-flight task to settle. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#pending.splice(0)) {
      entry.signal.removeEventListener("abort", entry.onAbort);
      entry.reject(new BrowserToolError("SESSION_STOPPED", "The browser session was closed"));
    }
    if (this.#active > 0 && this.#resolveIdle === null) {
      this.#idle = new Promise<void>((resolve) => {
        this.#resolveIdle = resolve;
      });
    }
  }

  async waitForIdle(): Promise<void> {
    await this.#idle;
  }

  #pump(): void {
    if (this.#closed || this.#active > 0 || this.#pending.length === 0) return;
    const entry = this.#pending.shift()!;
    entry.signal.removeEventListener("abort", entry.onAbort);
    if (entry.signal.aborted || this.#lifecycle.aborted) {
      entry.reject(new BrowserToolError("SESSION_STOPPED", "The browser command was cancelled"));
      this.#pump();
      return;
    }
    this.#active += 1;
    void entry
      .run(entry.signal)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.#active -= 1;
        if (this.#active === 0 && this.#resolveIdle !== null) {
          this.#resolveIdle();
          this.#resolveIdle = null;
          this.#idle = Promise.resolve();
        }
        this.#pump();
      });
  }
}
