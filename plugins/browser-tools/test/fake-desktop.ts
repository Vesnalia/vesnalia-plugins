import type {
  ExperimentalDesktopBrowserAcquireInput,
  ExperimentalDesktopBrowserCreateInput,
  ExperimentalDesktopBrowserLease,
  ExperimentalDesktopBrowserScope,
  ExperimentalDesktopBrowsersArea,
} from "@vesnalia/plugin-sdk";

type DesktopArea = ExperimentalDesktopBrowsersArea;
type InstancesResult = Awaited<ReturnType<DesktopArea["listInstances"]>>;
type TabsResult = Awaited<ReturnType<DesktopArea["listTabs"]>>;
type CreatedResult = Awaited<ReturnType<DesktopArea["createTab"]>>;
type ConnectionResult = Awaited<ReturnType<DesktopArea["openConnection"]>>;
type TabRequest = Parameters<DesktopArea["closeTab"]>[0];
type InstanceRequest = Parameters<DesktopArea["listImportSources"]>[0];
type ImportInput = Parameters<DesktopArea["importCookies"]>[0];
type ImportSourcesResult = Awaited<ReturnType<DesktopArea["listImportSources"]>>;
type ImportOutcomeResult = Awaited<ReturnType<DesktopArea["importCookies"]>>;
type LeaseRequest = Parameters<DesktopArea["openConnection"]>[0];

export type FakeTab = {
  tabId: string;
  threadId: string;
  url: string;
  title: string;
  presentation: "hidden" | "reveal";
  control: { controllerLabel: string; expiresAt: number; leaseId: string } | null;
  profile: { kind: "automation"; id: string } | { kind: "personal" };
};

type Subscription = {
  scope: ExperimentalDesktopBrowserScope;
  onChange: (result: TabsResult) => void;
  onError: (error: Error) => void;
  disposed: boolean;
};

/**
 * Controllable stand-in for the public desktop-browsers SDK area. Every
 * boundary call can be deferred or failed so the real session manager can be
 * exercised against the same contract shapes the server sees.
 */
export class FakeDesktop implements ExperimentalDesktopBrowsersArea {
  instances: { instanceId: string; generation: string; label: string }[] = [
    { instanceId: "inst_1", generation: "gen_1", label: "VesnALIA window 1" },
  ];
  tabs = new Map<string, FakeTab>();
  leases = new Map<string, { tabIds: string[]; expiresAt: number; scope: ExperimentalDesktopBrowserScope }>();
  calls: string[] = [];
  closedTabs: string[] = [];
  subscriptions: Subscription[] = [];
  acquireDelay: Promise<void> | null = null;
  createTabDelay: Promise<void> | null = null;
  listTabsDelay: Promise<void> | null = null;
  listInstancesError: Error | null = null;
  createTabError: Error | null = null;
  acquireError: Error | null = null;
  connectionError: Error | null = null;
  releaseError: Error | null = null;
  desktopReleaseError: Error | null = null;
  closeTabError: Error | null = null;
  connectionExpiresAt: number | null = null;
  leaseExpiresAt: number | null = null;
  #nextId = 0;

  get activeSubscriptions(): number {
    return this.subscriptions.filter((subscription) => !subscription.disposed).length;
  }

  addTab(threadId: string, url = "about:blank", profile: FakeTab["profile"] = { kind: "automation", id: `prof_${++this.#nextId}` }): FakeTab {
    const tab: FakeTab = {
      tabId: `tab_${++this.#nextId}`,
      threadId,
      url,
      title: "",
      presentation: "hidden",
      control: null,
      profile,
    };
    this.tabs.set(tab.tabId, tab);
    return tab;
  }

  fireChange(scope: ExperimentalDesktopBrowserScope): void {
    for (const subscription of this.subscriptions) {
      if (subscription.disposed) continue;
      if (
        subscription.scope.hostId === scope.hostId &&
        subscription.scope.instanceId === scope.instanceId &&
        subscription.scope.generation === scope.generation &&
        subscription.scope.threadId === scope.threadId
      ) {
        subscription.onChange({ tabs: [...this.tabs.values()] });
      }
    }
  }

  fireError(scope: ExperimentalDesktopBrowserScope): void {
    for (const subscription of this.subscriptions) {
      if (subscription.disposed) continue;
      if (
        subscription.scope.hostId === scope.hostId &&
        subscription.scope.instanceId === scope.instanceId &&
        subscription.scope.generation === scope.generation &&
        subscription.scope.threadId === scope.threadId
      ) {
        subscription.onError(new Error("watcher failed"));
      }
    }
  }

  async listInstances(input: { hostId: string }): Promise<InstancesResult> {
    this.calls.push("listInstances");
    if (this.listInstancesError) throw this.listInstancesError;
    return { instances: this.instances.map((instance) => ({ ...instance, hostId: input.hostId })) };
  }

  async listTabs(scope: ExperimentalDesktopBrowserScope): Promise<TabsResult> {
    this.calls.push("listTabs");
    await this.listTabsDelay;
    return {
      tabs: [...this.tabs.values()]
        .filter((tab) => tab.threadId === scope.threadId)
        .map((tab) => ({ ...tab })),
    };
  }

  async createTab(input: ExperimentalDesktopBrowserCreateInput): Promise<CreatedResult> {
    this.calls.push("createTab");
    await this.createTabDelay;
    if (this.createTabError) throw this.createTabError;
    const tab: FakeTab = {
      tabId: `tab_${++this.#nextId}`,
      threadId: input.threadId,
      url: input.url ?? "about:blank",
      title: "",
      presentation: input.presentation ?? "hidden",
      control: null,
      profile: { kind: "automation", id: `prof_${++this.#nextId}` },
    };
    this.tabs.set(tab.tabId, tab);
    return { tab: { ...tab } };
  }

  async acquireControl(input: ExperimentalDesktopBrowserAcquireInput): Promise<ExperimentalDesktopBrowserLease> {
    this.calls.push("acquireControl");
    await this.acquireDelay;
    if (this.acquireError) throw this.acquireError;
    const leaseId = `lease_${++this.#nextId}`;
    const expiresAt = this.leaseExpiresAt ?? Date.now() + (input.ttlMs ?? 300_000);
    for (const tabId of input.tabIds) {
      const tab = this.tabs.get(tabId);
      if (!tab) throw new Error("tab not found");
      tab.control = { controllerLabel: input.controllerLabel, expiresAt, leaseId };
    }
    this.leases.set(leaseId, {
      tabIds: input.tabIds,
      expiresAt,
      scope: {
        hostId: input.hostId,
        instanceId: input.instanceId,
        generation: input.generation,
        threadId: input.threadId,
      },
    });
    return {
      hostId: input.hostId,
      instanceId: input.instanceId,
      generation: input.generation,
      threadId: input.threadId,
      leaseId,
      tabIds: input.tabIds,
      controllerLabel: input.controllerLabel,
      expiresAt,
    };
  }

  async openConnection(input: LeaseRequest): Promise<ConnectionResult> {
    this.calls.push("openConnection");
    if (this.connectionError) throw this.connectionError;
    return {
      hostId: input.hostId,
      wsEndpoint: "ws://127.0.0.1:1/cdp/fake",
      expiresAt: this.connectionExpiresAt ?? Date.now() + 600_000,
    };
  }

  async releaseControl(input: LeaseRequest): Promise<{ ok: true }> {
    this.calls.push("releaseControl");
    if (this.releaseError) throw this.releaseError;
    const lease = this.leases.get(input.leaseId);
    if (lease) {
      this.leases.delete(input.leaseId);
      if (this.desktopReleaseError) throw this.desktopReleaseError;
      for (const tabId of lease.tabIds) {
        const tab = this.tabs.get(tabId);
        if (tab && tab.control?.leaseId === input.leaseId) tab.control = null;
      }
      this.leases.delete(input.leaseId);
    }
    return { ok: true };
  }

  async revealTab(_input: TabRequest): Promise<{ ok: true }> {
    return { ok: true };
  }

  async closeTab(input: TabRequest): Promise<{ ok: true }> {
    this.calls.push("closeTab");
    if (this.closeTabError) throw this.closeTabError;
    this.closedTabs.push(input.tabId);
    this.tabs.delete(input.tabId);
    return { ok: true };
  }

  async captureTab(_input: TabRequest) {
    return { base64: "", height: 1, mimeType: "image/jpeg" as const, width: 1 };
  }

  async listImportSources(_input: InstanceRequest): Promise<ImportSourcesResult> {
    return { sources: [] };
  }

  async importCookies(_input: ImportInput): Promise<ImportOutcomeResult> {
    return { ok: true, imported: 0, skipped: 0, skippedDomains: [] };
  }

  subscribe(input: ExperimentalDesktopBrowserScope & {
    onChange: (result: TabsResult) => void;
    onError: (error: Error) => void;
  }): { dispose(): void } {
    const subscription: Subscription = {
      scope: {
        hostId: input.hostId,
        instanceId: input.instanceId,
        generation: input.generation,
        threadId: input.threadId,
      },
      onChange: input.onChange,
      onError: input.onError,
      disposed: false,
    };
    this.subscriptions.push(subscription);
    return {
      dispose: () => {
        subscription.disposed = true;
      },
    };
  }
}
