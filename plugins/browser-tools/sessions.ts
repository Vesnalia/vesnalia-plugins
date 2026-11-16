import type { BbPluginApi, ExperimentalDesktopBrowserScope, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import {
  BrowserToolError,
  browserToolErrorCodeSchema,
  cleanupComplete,
  hostContract,
  interpretActionResult,
  newCleanupSteps,
  sessionRecordSchema,
  type ActionWithSnapshot,
  type BrowserClickInput,
  type BrowserCloseInput,
  type BrowserConsoleInput,
  type BrowserEvaluateInput,
  type BrowserNavigateInput,
  type BrowserOpenInput,
  type BrowserPressInput,
  type BrowserScreenshotInput,
  type BrowserSnapshotInput,
  type BrowserTypeInput,
  type ClosePayload,
  type ConsolePayload,
  type EvaluatePayload,
  type ScreenshotPayload,
  type SessionRecord,
  type SnapshotPayload,
} from "./contracts.js";
import { LIMITS } from "./limits.js";

export type SessionSummary = {
  sessionId: string;
  threadId: string;
  hostId: string;
  tabId: string;
  borrowed: boolean;
  expiresAt: number;
};

export type SessionManagerOptions = {
  operationBudgetMs?: number;
  navigateBudgetMs?: number;
  readyTimeoutMs?: number;
  idleMs?: number;
  cleanupRetryDelaysMs?: readonly number[];
};

type ReadyResult = {
  session: SessionSummary;
  snapshot: SnapshotPayload;
};

type WatcherEntry = {
  count: number;
  scope: ExperimentalDesktopBrowserScope;
  dispose: () => void;
};

const KEY_PREFIX = "sessions/";
const PRUNE_INTERVAL_MS = 15 * 60_000;

function scopeKey(scope: {
  hostId: string;
  instanceId: string;
  generation: string;
  threadId: string;
}): string {
  return [scope.hostId, scope.instanceId, scope.generation, scope.threadId].join("|");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new BrowserToolError("SESSION_STOPPED", "The browser session was cancelled");
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BrowserToolError("SESSION_STOPPED", "The browser session was cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new BrowserToolError("SESSION_STOPPED", "The browser session was cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The one owner of thread authorization, session lifecycle, tab provenance,
 * admission, scope observation, persistence, and recovery. Tools and the
 * host executor never duplicate these rules.
 */
export class SessionManager {
  readonly #bb: BbPluginApi;
  readonly #host: ExperimentalHostClient<typeof hostContract>;
  readonly #options: Required<Pick<SessionManagerOptions, "operationBudgetMs" | "navigateBudgetMs" | "readyTimeoutMs" | "idleMs">> & {
    cleanupRetryDelaysMs: readonly number[];
  };
  readonly #opening = new Map<string, { done: Promise<void>; finish: () => void; acquiring: boolean; cleanupError: unknown }>();
  readonly #reserved = new Set<string>();
  readonly #records = new Map<string, SessionRecord>();
  readonly #readyByThread = new Map<string, Set<string>>();
  readonly #sessionSignals = new Map<string, AbortController>();
  readonly #threadSignals = new Map<string, AbortController>();
  readonly #busy = new Map<string, number>();
  readonly #watchers = new Map<string, WatcherEntry>();
  readonly #watched = new Set<string>();
  readonly #unverifiedScopes = new Set<string>();
  readonly #threadCounts = new Map<string, number>();
  readonly #hostCounts = new Map<string, number>();
  #total = 0;
  readonly #stopping = new Map<string, Promise<void>>();
  readonly #retryAttempts = new Map<string, number>();
  readonly #retryTimers = new Map<string, NodeJS.Timeout>();
  readonly #lifecycle = new AbortController();
  #ready = false;
  #disposed = false;
  #lastPruneAt = 0;
  #sweeper: NodeJS.Timeout | null = null;

  constructor(bb: BbPluginApi, options: SessionManagerOptions = {}) {
    this.#bb = bb;
    this.#host = bb.hosts.experimental_client({ contract: hostContract });
    this.#options = {
      operationBudgetMs: options.operationBudgetMs ?? 30_000,
      navigateBudgetMs: options.navigateBudgetMs ?? LIMITS.navigation.defaultTimeoutMs,
      readyTimeoutMs: options.readyTimeoutMs ?? 30_000,
      idleMs: options.idleMs ?? LIMITS.session.idleMs,
      cleanupRetryDelaysMs: options.cleanupRetryDelaysMs ?? [5_000, 30_000, 120_000, 600_000],
    };
  }

  get #desktop() {
    return this.#bb.sdk.experimental_desktopBrowsers;
  }

  get #clock(): number {
    return Date.now();
  }

  markReady(): void {
    this.#ready = true;
  }

  startSweeper(): void {
    if (this.#sweeper) return;
    this.#sweeper = setInterval(() => {
      void this.#sweep();
    }, 1_000);
    this.#sweeper.unref();
  }

  async sweepNow(): Promise<void> {
    await this.#sweep();
  }

  bindHostSignals(): void {
    this.#host.experimental_onWorkerExit(({ hostId }) => this.#onHostWorkerExit(hostId));
  }

  async #onHostWorkerExit(hostId: string): Promise<void> {
    for (const record of [...this.#records.values()]) {
      if (record.hostId !== hostId || record.phase !== "ready") continue;
      record.cleanup.hostConnectionClosed = true;
      await this.#stop(record, { closeTab: false });
    }
  }

  async #sweep(): Promise<void> {
    for (const record of [...this.#records.values()]) {
      if (record.phase !== "ready") continue;
      const busy = (this.#busy.get(record.id) ?? 0) > 0;
      if (this.#clock >= record.expiresAt) {
        await this.#stop(record, { closeTab: false });
      } else if (!busy && this.#clock - record.lastUsedAt >= this.#options.idleMs) {
        await this.#stop(record, { closeTab: false });
      }
    }
    if (this.#clock - this.#lastPruneAt >= PRUNE_INTERVAL_MS) {
      this.#lastPruneAt = this.#clock;
      await this.#pruneCompleted();
    }
  }

  async reconcile(): Promise<void> {
    const keys = await this.#bb.storage.kv.list(KEY_PREFIX);
    const records: SessionRecord[] = [];
    for (const key of keys) {
      const parsed = sessionRecordSchema.safeParse(await this.#bb.storage.kv.get(key));
      if (parsed.success) records.push(parsed.data);
    }
    const batchSize = LIMITS.cleanup.concurrency;
    for (let index = 0; index < records.length; index += batchSize) {
      const batch = records.slice(index, index + batchSize);
      await Promise.all(batch.map((record) => this.#reconcileRecord(record)));
    }
    this.#lastPruneAt = this.#clock;
    await this.#pruneCompleted();
  }

  async #reconcileRecord(record: SessionRecord): Promise<void> {
    if (record.phase === "stopped" && cleanupComplete(record)) return;
    if (record.desktop) record.desktop.pendingClose = false;
    this.#records.set(record.id, record);
    this.#sessionSignals.set(record.id, new AbortController());
    await this.#stop(record, { closeTab: false });
  }

  async #pruneCompleted(): Promise<void> {
    const cutoff = this.#clock - LIMITS.session.completedRecordRetentionMs;
    for (const key of await this.#bb.storage.kv.list(KEY_PREFIX)) {
      const parsed = sessionRecordSchema.safeParse(await this.#bb.storage.kv.get(key));
      if (!parsed.success) continue;
      const record = parsed.data;
      if (
        record.phase === "stopped" &&
        cleanupComplete(record) &&
        record.stoppedAt !== null &&
        record.stoppedAt < cutoff
      ) {
        await this.#bb.storage.kv.delete(key).catch(() => {});
      }
    }
  }

  async onThreadStopped(threadId: string): Promise<void> {
    const controller = this.#threadSignals.get(threadId);
    controller?.abort();
    const records = [...this.#records.values()].filter(record => record.threadId === threadId);
    await this.#drainCleanup(records);
    // Only a completed drain permits a fresh open; never clear a newer signal.
    if (this.#threadSignals.get(threadId) === controller) this.#threadSignals.delete(threadId);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lifecycle.abort();
    if (this.#sweeper) clearInterval(this.#sweeper);
    for (const timer of this.#retryTimers.values()) clearTimeout(timer);
    this.#retryTimers.clear();
    for (const watcher of this.#watchers.values()) watcher.dispose();
    this.#watchers.clear();
    await this.#drainCleanup([...this.#records.values()]);
    this.#sessionSignals.clear();
  }

  async #drainCleanup(records: readonly SessionRecord[]): Promise<void> {
    // Capture opening completions before stop: stop only signals an acquiring
    // transaction; that transaction must capture late identities and compensate.
    const openings = records.flatMap(record => {
      const opening = this.#opening.get(record.id);
      return opening ? [opening] : [];
    });
    const cleanup = Promise.all(records.map(record => this.#stop(record, { closeTab: false })));
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([cleanup, ...openings.map(async opening => {
          await opening.done;
          if (opening.cleanupError) throw opening.cleanupError;
        })]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new BrowserToolError(
            "TARGET_UNAVAILABLE",
            "Browser cleanup could not drain in-flight desktop requests; cleanup remains pending and unidentified leases must expire",
          )), LIMITS.cleanup.disposeDrainMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // -- Admission ------------------------------------------------------------

  #reserveAdmission(threadId: string, hostId: string): void {
    const threadCount = this.#threadCounts.get(threadId) ?? 0;
    if (threadCount >= LIMITS.session.perThread) {
      throw new BrowserToolError(
        "SESSION_LIMIT",
        `This thread already has ${LIMITS.session.perThread} browser sessions open`,
      );
    }
    const hostCount = this.#hostCounts.get(hostId) ?? 0;
    if (hostCount >= LIMITS.session.perHost) {
      throw new BrowserToolError(
        "SESSION_LIMIT",
        `The selected host already runs ${LIMITS.session.perHost} browser sessions`,
      );
    }
    const unresolvedCount = [...this.#records.values()].filter(record => !this.#reserved.has(record.id)).length;
    if (this.#total + unresolvedCount >= LIMITS.session.global) {
      const unresolved = [...this.#records.values()].filter(
        (record) => record.phase !== "ready" || record.cleanup.leaseReleased === false,
      ).length;
      throw new BrowserToolError(
        "SESSION_LIMIT",
        unresolved > 0
          ? `Browser session capacity is full with ${unresolved} unfinished cleanup record(s); close a session or retry shortly`
          : `Browser session capacity is full (${LIMITS.session.global})`,
      );
    }
    this.#threadCounts.set(threadId, threadCount + 1);
    this.#hostCounts.set(hostId, hostCount + 1);
    this.#total += 1;
  }

  #releaseAdmission(record: SessionRecord): void {
    const threadCount = this.#threadCounts.get(record.threadId) ?? 0;
    if (threadCount <= 1) this.#threadCounts.delete(record.threadId);
    else this.#threadCounts.set(record.threadId, threadCount - 1);
    const hostCount = this.#hostCounts.get(record.hostId) ?? 0;
    if (hostCount <= 1) this.#hostCounts.delete(record.hostId);
    else this.#hostCounts.set(record.hostId, hostCount - 1);
    this.#total = Math.max(0, this.#total - 1);
  }

  // -- Identity, persistence ------------------------------------------------

  #key(record: Pick<SessionRecord, "threadId" | "id">): string {
    return `${KEY_PREFIX}${encodeURIComponent(record.threadId)}/${record.id}`;
  }

  async #persist(record: SessionRecord): Promise<void> {
    await this.#bb.storage.kv.set(this.#key(record), sessionRecordSchema.parse(record));
  }

  // -- Scope watchers -------------------------------------------------------

  #recordScope(record: SessionRecord): ExperimentalDesktopBrowserScope | null {
    if (!record.desktop) return null;
    return {
      hostId: record.hostId,
      instanceId: record.desktop.instanceId,
      generation: record.desktop.generation,
      threadId: record.threadId,
    };
  }

  #watch(record: SessionRecord): void {
    const scope = this.#recordScope(record);
    if (!scope) return;
    const key = scopeKey(scope);
    let entry = this.#watchers.get(key);
    if (!entry) {
      const subscription = this.#desktop.subscribe({
        ...scope,
        onChange: (result) => {
          this.#onScopeChange(key, result.tabs);
        },
        onError: () => {
          void this.#onScopeError(key);
        },
      });
      entry = { count: 0, scope, dispose: () => subscription.dispose() };
      this.#watchers.set(key, entry);
    }
    entry.count += 1;
    this.#watched.add(record.id);
  }

  #unwatch(record: SessionRecord): void {
    if (!this.#watched.delete(record.id)) return;
    const scope = this.#recordScope(record);
    if (!scope) return;
    const key = scopeKey(scope);
    const entry = this.#watchers.get(key);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) {
      entry.dispose();
      this.#watchers.delete(key);
    }
  }

  #recordsInScope(key: string): SessionRecord[] {
    return [...this.#records.values()].filter((record) => {
      const scope = this.#recordScope(record);
      return scope !== null && scopeKey(scope) === key && record.phase === "ready";
    });
  }

  #onScopeChange(key: string, tabs: readonly { tabId: string; control: { leaseId: string } | null }[]): void {
    this.#unverifiedScopes.delete(key);
    for (const record of this.#recordsInScope(key)) {
      const desktop = record.desktop;
      if (!desktop) continue;
      const tab = tabs.find((candidate) => candidate.tabId === desktop.tabId);
      if (!tab || tab.control?.leaseId !== desktop.leaseId) {
        void this.#stop(record, { closeTab: false });
      }
    }
  }

  async #onScopeError(key: string): Promise<void> {
    this.#unverifiedScopes.add(key);
    const records = this.#recordsInScope(key);
    for (const record of records) {
      const verified = await this.#verifyOwnership(record, 3, 500);
      if (!verified) await this.#stop(record, { closeTab: false });
    }
    // Every remaining ready record was just verified; allow admission again.
    this.#unverifiedScopes.delete(key);
  }

  async #verifyOwnership(record: SessionRecord, attempts: number, delayMs: number): Promise<boolean> {
    const scope = this.#recordScope(record);
    const desktop = record.desktop;
    if (!scope || !desktop) return true;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await this.#desktop.listTabs(scope);
        const tab = result.tabs.find((candidate) => candidate.tabId === desktop.tabId);
        if (tab && tab.control?.leaseId === desktop.leaseId) return true;
        if (!tab) return false;
      } catch {
        // Ownership is unverifiable right now; retry within the bounded window.
      }
      if (attempt < attempts - 1) await sleep(delayMs);
    }
    return false;
  }

  // -- Open -----------------------------------------------------------------

  async #waitReady(): Promise<void> {
    const deadline = this.#clock + this.#options.readyTimeoutMs;
    while (!this.#ready) {
      if (this.#disposed || this.#lifecycle.signal.aborted) {
        throw new BrowserToolError("SESSION_STOPPED", "Browser tools are shutting down");
      }
      if (this.#clock > deadline) {
        throw new BrowserToolError(
          "TARGET_UNAVAILABLE",
          "Browser tools are still recovering from a restart; try again shortly",
        );
      }
      await sleep(25);
    }
  }

  async #resolveInstance(
    input: BrowserOpenInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<{ hostId: string; instanceId: string; generation: string }> {
    let hostId = input.hostId;
    if (hostId === undefined) {
      const hosts = (await this.#bb.sdk.hosts.list()).filter(
        (host) => host.status === "connected" && host.lifecycle.phase === "active",
      );
      if (hosts.length === 0) {
        throw new BrowserToolError(
          "TARGET_UNAVAILABLE",
          "No connected desktop host is available; pass hostId explicitly",
        );
      }
      if (hosts.length > 1) {
        throw new BrowserToolError(
          "TARGET_AMBIGUOUS",
          `Multiple hosts are connected (${hosts.map((host) => host.id).join(", ")}); pass hostId explicitly`,
        );
      }
      hostId = hosts[0]!.id;
    }
    throwIfAborted(signal);
    const { instances } = await this.#desktop.listInstances({ hostId });
    if (instances.length === 0) {
      throw new BrowserToolError(
        "TARGET_UNAVAILABLE",
        `No desktop window is connected on host ${hostId}; open a BB window there first`,
      );
    }
    const instance =
      input.instanceId === undefined
        ? instances.length === 1
          ? instances[0]!
          : null
        : instances.find((candidate) => candidate.instanceId === input.instanceId) ?? null;
    if (!instance) {
      throw new BrowserToolError(
        "TARGET_AMBIGUOUS",
        `Multiple desktop windows are connected on host ${hostId} (${instances
          .map((candidate) => candidate.instanceId)
          .join(", ")}); pass instanceId explicitly`,
      );
    }
    throwIfAborted(signal);
    return { hostId, instanceId: instance.instanceId, generation: instance.generation };
  }

  async open(input: BrowserOpenInput, threadId: string, signal: AbortSignal): Promise<ReadyResult> {
    await this.#waitReady();
    throwIfAborted(signal);
    const threadSignal = this.#threadSignal(threadId);
    throwIfAborted(threadSignal.signal);
    await this.#bb.sdk.threads.get({ threadId, signal: threadSignal.signal });
    const combined = AbortSignal.any([signal, this.#lifecycle.signal, threadSignal.signal]);
    throwIfAborted(combined);

    const target = await this.#resolveInstance(input, threadId, combined);
    const scope = { ...target, threadId };
    if (this.#unverifiedScopes.has(scopeKey(scope))) {
      throw new BrowserToolError(
        "TARGET_UNAVAILABLE",
        "Browser ownership on that desktop is being re-verified; try again shortly",
      );
    }
    this.#reserveAdmission(threadId, target.hostId);

    const sessionId = `s_${crypto.randomUUID()}`;
    const now = this.#clock;
    const record: SessionRecord = {
      version: 1,
      id: sessionId,
      threadId,
      hostId: target.hostId,
      phase: "opening",
      createdAt: now,
      expiresAt: now + LIMITS.session.leaseTtlMs,
      lastUsedAt: now,
      stoppedAt: null,
      desktop: null,
      cleanup: newCleanupSteps(),
    };
    this.#records.set(record.id, record);
    let finishOpening!: () => void;
    const done = new Promise<void>(resolve => { finishOpening = resolve; });
    const opening = { done, finish: finishOpening, acquiring: true, cleanupError: null as unknown };
    this.#opening.set(record.id, opening);
    this.#reserved.add(record.id);
    record.cleanup.hostConnectionClosed = true;
    record.cleanup.leaseReleased = true;
    const sessionSignal = new AbortController();
    this.#sessionSignals.set(sessionId, sessionSignal);
    const bound = AbortSignal.any([combined, sessionSignal.signal]);
    try {
      let tabId = input.tabId;
      let profileId: string | null = null;
      let borrowed = input.tabId !== undefined;
      if (tabId === undefined) {
        const created = await this.#desktop.createTab({
          ...scope,
          url: "about:blank",
          presentation: "hidden",
        });
        tabId = created.tab.tabId;
        profileId = created.tab.profile.kind === "automation" ? created.tab.profile.id : null;
        borrowed = false;
      } else {
        const tabs = await this.#desktop.listTabs(scope);
        throwIfAborted(bound);
        const tab = tabs.tabs.find((candidate) => candidate.tabId === tabId);
        if (!tab) {
          throw new BrowserToolError(
            "TARGET_UNAVAILABLE",
            "The requested tab is not part of this thread's desktop tabs",
          );
        }
        profileId = tab.profile.kind === "automation" ? tab.profile.id : null;
        if (tab.profile.kind === "personal" && !input.allowPersonal) {
          throw new BrowserToolError(
            "TARGET_UNAVAILABLE",
            "Controlling a personal tab requires allowPersonal and explicit user authorization",
          );
        }
      }
      record.desktop = {
        instanceId: scope.instanceId,
        generation: scope.generation,
        leaseId: "",
        tabId,
        borrowed,
        profileId,
        pendingClose: false,
      };
      throwIfAborted(bound);
      await this.#persist(record);
      throwIfAborted(bound);

      const lease = await this.#desktop.acquireControl({
        ...scope,
        tabIds: [tabId],
        controllerLabel: "Browser Tools",
        ttlMs: LIMITS.session.leaseTtlMs,
        allowPersonal: input.allowPersonal && borrowed,
      });
      const leaseId = lease.leaseId;
      record.desktop = { ...record.desktop, leaseId };
      record.cleanup.leaseReleased = false;
      record.expiresAt = Math.min(record.expiresAt, lease.expiresAt);
      throwIfAborted(bound);
      // Persist a conservative host-close obligation before connection setup.
      // Close is idempotent even if setup never reaches the host.
      record.cleanup.hostConnectionClosed = false;
      await this.#persist(record);
      throwIfAborted(bound);

      const connection = await this.#desktop.openConnection({ ...scope, leaseId });
      throwIfAborted(bound);
      if (connection.hostId !== scope.hostId) {
        throw new BrowserToolError(
          "TARGET_UNAVAILABLE",
          "The desktop connection returned a different execution host",
        );
      }
      record.expiresAt = Math.min(record.expiresAt, connection.expiresAt);

      // Mark the host stage attempted before the call: close is idempotent,
      // so rollback always tries to release whatever the call may have left.
      record.cleanup.hostConnectionClosed = false;
      const opened = await this.#host.call(
        "open",
        {
          sessionId,
          wsEndpoint: connection.wsEndpoint,
          expiresAt: record.expiresAt,
          deadlineAt: this.#clock + this.#options.operationBudgetMs,
        },
        {
          hostId: scope.hostId,
          signal: bound,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      );
      if (!opened.ok) throw new BrowserToolError(opened.error.code, opened.error.message);
      throwIfAborted(bound);

      let snapshot = opened.data.snapshot;
      if (input.url !== undefined) {
        const navigation = await this.#invoke(
          record,
          bound,
          this.#options.navigateBudgetMs,
          (callSignal, deadlineAt) =>
            this.#host.call(
              "navigate",
              { sessionId, url: input.url!, deadlineAt },
              {
                hostId: record.hostId,
                signal: callSignal,
                timeoutMs: this.#options.navigateBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
              },
            ),
        );
        if (!navigation.action.ok) {
          throw new BrowserToolError(navigation.action.error.code, navigation.action.error.message);
        }
        if (navigation.snapshot === null) {
          throw new BrowserToolError(
            navigation.snapshotError?.code ?? "ACTION_OUTCOME_UNKNOWN",
            navigation.snapshotError?.message ??
              "The initial navigation completed but its snapshot failed; reopen the session",
          );
        }
        snapshot = navigation.snapshot;
      }

      if (!(await this.#verifyOwnership(record, 1, 0))) {
        throw new BrowserToolError("SESSION_STOPPED", "Browser control was lost while opening");
      }
      throwIfAborted(bound);
      record.phase = "ready";
      await this.#persist(record);
      throwIfAborted(bound);
      opening.acquiring = false;
      const readySet = this.#readyByThread.get(threadId) ?? new Set<string>();
      readySet.add(sessionId);
      this.#readyByThread.set(threadId, readySet);
      this.#watch(record);
      return { session: this.#summary(record), snapshot };
    } catch (error) {
      opening.acquiring = false;
      try {
        await this.#stop(record, { closeTab: false });
      } catch (cleanupError) {
        opening.cleanupError = cleanupError;
        throw cleanupError;
      }
      throw error;
    } finally {
      opening.finish();
      this.#opening.delete(record.id);
    }
  }

  #threadSignal(threadId: string): AbortController {
    let controller = this.#threadSignals.get(threadId);
    if (!controller) {
      controller = new AbortController();
      this.#threadSignals.set(threadId, controller);
    }
    return controller;
  }

  // -- Stop and cleanup -----------------------------------------------------

  #summary(record: SessionRecord): SessionSummary {
    return {
      sessionId: record.id,
      threadId: record.threadId,
      hostId: record.hostId,
      tabId: record.desktop?.tabId ?? "",
      borrowed: record.desktop?.borrowed ?? false,
      expiresAt: record.expiresAt,
    };
  }

  #abortSession(sessionId: string): void {
    this.#sessionSignals.get(sessionId)?.abort();
  }

  async #disposeHost(record: SessionRecord): Promise<void> {
    if (record.cleanup.hostConnectionClosed) return;
    try {
      await this.#host.call(
        "close",
        { sessionId: record.id },
        { hostId: record.hostId, timeoutMs: LIMITS.cleanup.hostCallTimeoutMs },
      );
      record.cleanup.hostConnectionClosed = true;
    } catch {
      // The worker may already be gone; the next cleanup pass retries.
    }
  }

  async #releaseLease(record: SessionRecord): Promise<void> {
    const scope = this.#recordScope(record);
    const desktop = record.desktop;
    if (!scope || !desktop || record.cleanup.leaseReleased) return;
    if (desktop.leaseId === "" || this.#clock >= record.expiresAt) {
      record.cleanup.leaseReleased = true;
      return;
    }
    try {
      await this.#desktop.releaseControl({ ...scope, leaseId: desktop.leaseId });
    } catch {
      // A missing server registry entry is not proof of desktop release.
    }
    try {
      const { tabs } = await this.#desktop.listTabs(scope);
      const tab = tabs.find(candidate => candidate.tabId === desktop.tabId);
      record.cleanup.leaseReleased = tab?.control?.leaseId !== desktop.leaseId;
    } catch {
      if (this.#clock >= record.expiresAt) record.cleanup.leaseReleased = true;
    }
  }

  async #closeOwnedTab(record: SessionRecord): Promise<void> {
    const scope = this.#recordScope(record);
    const desktop = record.desktop;
    if (!scope || !desktop || desktop.borrowed || record.cleanup.tabClosed) return;
    try {
      const tabs = await this.#desktop.listTabs(scope);
      const tab = tabs.tabs.find((candidate) => candidate.tabId === desktop.tabId);
      if (!tab) {
        record.cleanup.tabClosed = true;
        desktop.pendingClose = false;
        return;
      }
      if (tab.control?.leaseId !== desktop.leaseId || desktop.leaseId === "") {
        // Takeover (including unowned control) permanently withdraws deletion.
        desktop.pendingClose = false;
        return;
      }
      await this.#desktop.closeTab({ ...scope, tabId: desktop.tabId });
      record.cleanup.tabClosed = true;
      desktop.pendingClose = false;
    } catch {
      desktop.pendingClose = true;
    }
  }

  async #stop(record: SessionRecord, options: { closeTab: boolean }): Promise<void> {
    this.#abortSession(record.id);
    // The open transaction captures late SDK identities before sharing cleanup.
    if (this.#opening.get(record.id)?.acquiring) return;
    const existing = this.#stopping.get(record.id);
    if (existing) return existing;
    const work = (async () => {
      this.#abortSession(record.id);
      if (record.phase !== "stopped") {
        // Unwatch exactly once, while this record still owns its watcher ref.
        this.#unwatch(record);
        record.phase = "stopping";
      }
      await this.#disposeHost(record);
      if (options.closeTab && record.desktop?.pendingClose === true) {
        await this.#closeOwnedTab(record);
      }
      await this.#releaseLease(record);
      record.phase = "stopped";
      record.stoppedAt = this.#clock;
      this.#records.set(record.id, record);
      this.#readyByThread.get(record.threadId)?.delete(record.id);
      if (this.#readyByThread.get(record.threadId)?.size === 0) {
        this.#readyByThread.delete(record.threadId);
      }
      this.#releaseAdmissionOnce(record);
      let persisted = false;
      try {
        await this.#persist(record);
        persisted = true;
      } catch {
        // No raw storage error text: it may contain private paths or payloads.
        this.#bb.log.warn("Browser cleanup state could not be persisted; resource accounting remains reserved for retry");
        if (this.#disposed) {
          throw new BrowserToolError("TARGET_UNAVAILABLE", "Browser shutdown could not persist pending cleanup");
        }
      }
      if (cleanupComplete(record) && persisted) {
        const retryTimer = this.#retryTimers.get(record.id);
        if (retryTimer) {
          clearTimeout(retryTimer);
          this.#retryTimers.delete(record.id);
        }
        this.#records.delete(record.id);
        this.#sessionSignals.delete(record.id);
        this.#retryAttempts.delete(record.id);
      } else {
        this.#scheduleCleanupRetry(record);
      }
    })();
    this.#stopping.set(record.id, work);
    try {
      await work;
    } finally {
      this.#stopping.delete(record.id);
    }
  }

  #releaseAdmissionOnce(record: SessionRecord): void {
    if (!this.#reserved.delete(record.id)) return;
    this.#releaseAdmission(record);
  }

  #scheduleCleanupRetry(record: SessionRecord): void {
    if (this.#disposed || this.#retryTimers.has(record.id)) return;
    const attempt = this.#retryAttempts.get(record.id) ?? 0;
    this.#retryAttempts.set(record.id, attempt + 1);
    const delays = this.#options.cleanupRetryDelaysMs;
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? 600_000;
    const timer = setTimeout(() => {
      this.#retryTimers.delete(record.id);
      void this.#stop(record, {
        closeTab: record.desktop?.pendingClose === true && record.desktop.borrowed === false,
      });
    }, delay);
    timer.unref();
    this.#retryTimers.set(record.id, timer);
  }

  // -- Resolution and host invocation --------------------------------------

  #resolve(threadId: string, sessionId: string | undefined): SessionRecord {
    if (sessionId !== undefined) {
      const record = this.#records.get(sessionId);
      if (!record || record.threadId !== threadId) {
        throw new BrowserToolError(
          "SESSION_NOT_FOUND",
          "No open browser session matches that id for this thread",
        );
      }
      if (record.phase !== "ready") {
        throw new BrowserToolError("SESSION_STOPPED", "That browser session is stopped");
      }
      if (this.#clock >= record.expiresAt) {
        throw new BrowserToolError(
          "SESSION_STOPPED",
          "That browser session control lease expired; open a new session",
        );
      }
      return record;
    }
    const ready = [...(this.#readyByThread.get(threadId) ?? [])]
      .map((id) => this.#records.get(id))
      .filter((record): record is SessionRecord => record !== undefined && record.phase === "ready");
    if (ready.length === 0) {
      throw new BrowserToolError(
        "SESSION_NOT_FOUND",
        "No browser session is open for this thread; call browser_open first",
      );
    }
    if (ready.length > 1) {
      throw new BrowserToolError(
        "INVALID_INPUT",
        "Multiple browser sessions are open for this thread; pass sessionId",
      );
    }
    return ready[0]!;
  }

  async #invoke<T>(
    record: SessionRecord,
    signal: AbortSignal,
    budgetMs: number,
    run: (
      signal: AbortSignal,
      deadlineAt: number,
    ) => Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>,
  ): Promise<T> {
    const sessionSignal = this.#sessionSignals.get(record.id);
    const combined = AbortSignal.any([
      signal,
      this.#lifecycle.signal,
      sessionSignal ? sessionSignal.signal : new AbortController().signal,
    ]);
    throwIfAborted(combined);
    const deadlineAt = this.#clock + budgetMs;
    this.#busy.set(record.id, (this.#busy.get(record.id) ?? 0) + 1);
    try {
      const result = await run(combined, deadlineAt);
      if (!result.ok) {
        const parsed = browserToolErrorCodeSchema.safeParse(result.error.code);
        throw new BrowserToolError(
          parsed.success ? parsed.data : "INTERNAL",
          result.error.message,
        );
      }
      if (interpretActionResult(result.data).stopSession) {
        await this.#stop(record, { closeTab: false });
      }
      return result.data;
    } catch (error) {
      if (error instanceof BrowserToolError && (error.code === "ACTION_OUTCOME_UNKNOWN" || error.code === "SESSION_STOPPED")) {
        void this.#stop(record, { closeTab: false });
        throw error;
      }
      const sessionAborted = this.#sessionSignals.get(record.id)?.signal.aborted === true;
      if (!this.#sessionSignals.has(record.id) || this.#lifecycle.signal.aborted || sessionAborted) {
        throw new BrowserToolError("SESSION_STOPPED", "The browser session was closed");
      }
      throw error;
    } finally {
      const remaining = (this.#busy.get(record.id) ?? 1) - 1;
      if (remaining > 0) this.#busy.set(record.id, remaining);
      else this.#busy.delete(record.id);
      record.lastUsedAt = this.#clock;
    }
  }

  #resolveForCall(
    threadId: string,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): {
    record: SessionRecord;
    call: <T>(
      run: (
        signal: AbortSignal,
        deadlineAt: number,
      ) => Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>,
      budgetMs?: number,
    ) => Promise<T>;
  } {
    const record = this.#resolve(threadId, sessionId);
    const scope = this.#recordScope(record);
    if (scope && this.#unverifiedScopes.has(scopeKey(scope))) {
      throw new BrowserToolError("TARGET_UNAVAILABLE", "Browser ownership is being re-verified; try again shortly");
    }
    return {
      record,
      call: <T>(
        run: (
          signal: AbortSignal,
          deadlineAt: number,
        ) => Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>,
        budgetMs = this.#options.operationBudgetMs,
      ) => this.#invoke(record, signal, budgetMs, run),
    };
  }

  async list(threadId: string): Promise<SessionSummary[]> {
    return [...(this.#readyByThread.get(threadId) ?? [])]
      .map((id) => this.#records.get(id))
      .filter((record): record is SessionRecord => record !== undefined && record.phase === "ready")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((record) => this.#summary(record));
  }

  async navigate(
    input: BrowserNavigateInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<ActionWithSnapshot> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    return selected.call(
      (callSignal, deadlineAt) =>
        this.#host.call(
          "navigate",
          { sessionId: selected.record.id, url: input.url, deadlineAt },
          {
            hostId: selected.record.hostId,
            signal: callSignal,
            timeoutMs: this.#options.navigateBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
          },
        ),
      this.#options.navigateBudgetMs,
    );
  }

  async snapshot(
    input: BrowserSnapshotInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<SnapshotPayload> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    const result = await selected.call((callSignal, deadlineAt) =>
      this.#host.call(
        "snapshot",
        { sessionId: selected.record.id, deadlineAt },
        {
          hostId: selected.record.hostId,
          signal: callSignal,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      ),
    );
    return result.snapshot;
  }

  async click(
    input: BrowserClickInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<ActionWithSnapshot> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    return selected.call((callSignal, deadlineAt) =>
      this.#host.call(
        "click",
        { sessionId: selected.record.id, ref: input.ref, deadlineAt },
        {
          hostId: selected.record.hostId,
          signal: callSignal,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      ),
    );
  }

  async type(
    input: BrowserTypeInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<ActionWithSnapshot> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    return selected.call((callSignal, deadlineAt) =>
      this.#host.call(
        "type",
        {
          sessionId: selected.record.id,
          ref: input.ref,
          text: input.text,
          replace: input.replace,
          deadlineAt,
        },
        {
          hostId: selected.record.hostId,
          signal: callSignal,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      ),
    );
  }

  async press(
    input: BrowserPressInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<ActionWithSnapshot> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    return selected.call((callSignal, deadlineAt) =>
      this.#host.call(
        "press",
        { sessionId: selected.record.id, key: input.key, deadlineAt },
        {
          hostId: selected.record.hostId,
          signal: callSignal,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      ),
    );
  }

  async screenshot(
    input: BrowserScreenshotInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<ScreenshotPayload> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    return selected.call((callSignal, deadlineAt) =>
      this.#host.call(
        "screenshot",
        { sessionId: selected.record.id, fullPage: input.fullPage, deadlineAt },
        {
          hostId: selected.record.hostId,
          signal: callSignal,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      ),
    );
  }

  async evaluate(
    input: BrowserEvaluateInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<EvaluatePayload> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    return selected.call((callSignal, deadlineAt) =>
      this.#host.call(
        "evaluate",
        { sessionId: selected.record.id, expression: input.expression, deadlineAt },
        {
          hostId: selected.record.hostId,
          signal: callSignal,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      ),
    );
  }

  async console(
    input: BrowserConsoleInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<ConsolePayload> {
    const selected = this.#resolveForCall(threadId, input.sessionId, signal);
    return selected.call((callSignal, deadlineAt) =>
      this.#host.call(
        "console",
        {
          sessionId: selected.record.id,
          cursor: input.cursor ?? null,
          deadlineAt,
        },
        {
          hostId: selected.record.hostId,
          signal: callSignal,
          timeoutMs: this.#options.operationBudgetMs + LIMITS.cleanup.hostCallTimeoutMs,
        },
      ),
    );
  }

  async close(
    input: BrowserCloseInput,
    threadId: string,
    signal: AbortSignal,
  ): Promise<ClosePayload> {
    void signal;
    const record = this.#resolve(threadId, input.sessionId);
    const canCloseTab = input.closeTab && record.desktop !== null && !record.desktop.borrowed;
    if (input.closeTab && record.desktop?.borrowed === true) {
      throw new BrowserToolError(
        "UNSUPPORTED_CAPABILITY",
        "Borrowed and personal tabs are never closed by the plugin; close it in BB instead",
      );
    }
    if (canCloseTab && record.desktop) {
      record.desktop.pendingClose = true;
    }
    await this.#stop(record, { closeTab: canCloseTab });
    return { closed: true, tabClosed: record.cleanup.tabClosed };
  }
}
