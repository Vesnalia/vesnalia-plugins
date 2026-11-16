import {
  experimental_defineHostEntry,
  type ExperimentalHostRpcContext,
  type ExperimentalHostWorkerLease,
} from "@vesnalia/plugin-sdk";
import {
  BrowserToolError,
  hostContract,
  toErrorEnvelope,
  type ErrorEnvelope,
} from "./contracts.js";
import { BrowserSession } from "./executor.js";
import { LIMITS } from "./limits.js";
import { SerialQueue } from "./queue.js";

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: ErrorEnvelope };

type ManagedSession = {
  id: string;
  executor: BrowserSession;
  queue: SerialQueue;
  abort: AbortController;
  retainLease: ExperimentalHostWorkerLease;
  expiryTimer: NodeJS.Timeout;
};

export type HostEntryOptions = {
  discoveryTimeoutMs?: number;
};

function fail(error: unknown): Fail {
  return { ok: false, error: toErrorEnvelope(error) };
}

function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function createHostEntry(options: HostEntryOptions = {}) {
  const sessions = new Map<string, ManagedSession>();
  const opening = new Map<string, { abort: AbortController; done: Promise<void> }>();
  const disposing = new Map<string, Promise<void>>();

  const disposeSession = (session: ManagedSession): Promise<void> => {
    const existing = disposing.get(session.id);
    if (existing) return existing;
    const work = (async () => {
      sessions.delete(session.id);
      clearTimeout(session.expiryTimer);
      session.abort.abort();
      session.queue.close();
      session.executor.dispose();
      await session.retainLease.dispose().catch(() => {});
    })();
    disposing.set(session.id, work);
    void work.finally(() => {
      if (disposing.get(session.id) === work) disposing.delete(session.id);
    });
    return work;
  };

  const withSession = async <T>(
    sessionId: string,
    context: ExperimentalHostRpcContext,
    deadlineAt: number,
    run: (session: ManagedSession, signal: AbortSignal) => Promise<T> | T,
  ): Promise<Ok<T> | Fail> => {
    const session = sessions.get(sessionId);
    if (!session) {
      return fail(
        new BrowserToolError("SESSION_NOT_FOUND", "The browser session is not open on this host"),
      );
    }
    const signal = AbortSignal.any([
      context.signal,
      context.lifecycle.signal,
      session.abort.signal,
    ]);
    try {
      const data = await session.queue.run(async (taskSignal) => {
        if (!session.executor.alive) {
          throw new BrowserToolError("SESSION_STOPPED", "The browser session is no longer available");
        }
        if (Date.now() >= deadlineAt) {
          throw new BrowserToolError(
            "DEADLINE_EXCEEDED",
            "The browser command expired before it started",
          );
        }
        const result = await run(session, taskSignal);
        if (!session.executor.alive) await disposeSession(session);
        return result;
      }, signal);
      return ok(data);
    } catch (error) {
      if (!session.executor.alive) void disposeSession(session);
      return fail(error);
    }
  };

  return experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      async open(input, context) {
        if (sessions.has(input.sessionId) || opening.has(input.sessionId) || disposing.has(input.sessionId)) {
          return fail(
            new BrowserToolError("SESSION_STOPPED", "That browser session id is already in use"),
          );
        }
        if (sessions.size + opening.size >= LIMITS.session.perHost) {
          return fail(
            new BrowserToolError(
              "SESSION_LIMIT",
              `This host already runs ${LIMITS.session.perHost} browser sessions`,
            ),
          );
        }
        if (input.expiresAt - Date.now() < 1_000) {
          return fail(
            new BrowserToolError("DEADLINE_EXCEEDED", "The browser control lease expires too soon"),
          );
        }
        const abort = new AbortController();
        const signal = AbortSignal.any([
          context.signal,
          context.lifecycle.signal,
          abort.signal,
        ]);
        const retainLease = context.experimental_retainWorker();
        let finishOpening!: () => void;
        const done = new Promise<void>(resolve => { finishOpening = resolve; });
        opening.set(input.sessionId, { abort, done });
        let executor: BrowserSession | null = null;
        try {
          executor = await BrowserSession.connect({
            wsEndpoint: input.wsEndpoint,
            signal,
            discoveryTimeoutMs: options.discoveryTimeoutMs,
            deadlineAt: Math.min(input.deadlineAt, input.expiresAt),
          });
          const snapshot = await executor.snapshot(signal, input.deadlineAt);
          if (signal.aborted || Date.now() >= Math.min(input.deadlineAt, input.expiresAt)) {
            throw new BrowserToolError("SESSION_STOPPED", "The browser open was cancelled");
          }
          const expiryTimer = setTimeout(() => {
            const current = sessions.get(input.sessionId);
            if (current) void disposeSession(current);
          }, Math.max(0, input.expiresAt - Date.now()));
          expiryTimer.unref();
          const session: ManagedSession = {
            id: input.sessionId,
            executor,
            queue: new SerialQueue(LIMITS.session.queueDepth, abort.signal),
            abort,
            retainLease,
            expiryTimer,
          };
          sessions.set(input.sessionId, session);
          return ok({ snapshot });
        } catch (error) {
          abort.abort();
          executor?.dispose();
          await retainLease.dispose().catch(() => {});
          return fail(error);
        } finally {
          opening.delete(input.sessionId);
          finishOpening();
        }
      },

      async navigate(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, (session, signal) =>
          session.executor.navigate(input.url, signal, input.deadlineAt),
        );
      },

      async snapshot(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, async (session, signal) => ({
          snapshot: await session.executor.snapshot(signal, input.deadlineAt),
        }));
      },

      async click(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, (session, signal) =>
          session.executor.click(input.ref, signal, input.deadlineAt),
        );
      },

      async type(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, (session, signal) =>
          session.executor.type(input.ref, input.text, input.replace, signal, input.deadlineAt),
        );
      },

      async press(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, (session, signal) =>
          session.executor.press(input.key, signal, input.deadlineAt),
        );
      },

      async screenshot(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, (session, signal) =>
          session.executor.screenshot(input.fullPage, signal, input.deadlineAt),
        );
      },

      async evaluate(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, (session, signal) =>
          session.executor.evaluate(input.expression, signal, input.deadlineAt),
        );
      },

      async console(input, context) {
        return withSession(input.sessionId, context, input.deadlineAt, (session) =>
          session.executor.readConsole(input.cursor),
        );
      },

      async close({ sessionId }) {
        const connecting = opening.get(sessionId);
        if (connecting) {
          connecting.abort.abort();
          await connecting.done;
        }
        const pending = disposing.get(sessionId);
        if (pending) {
          await pending;
          return null;
        }
        const session = sessions.get(sessionId);
        if (session) await disposeSession(session);
        return null;
      },
    },
    async dispose() {
      const connecting = [...opening.values()];
      for (const session of connecting) session.abort.abort();
      await Promise.all([
        ...connecting.map(session => session.done),
        ...[...sessions.values()].map(disposeSession),
        ...disposing.values(),
      ]);
    },
  });
}

export default createHostEntry();
