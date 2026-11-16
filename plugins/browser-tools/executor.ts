import WebSocket from "ws";
import puppeteer, {
  TimeoutError,
  type Browser,
  type CDPSession,
  type ConsoleMessage,
  type ConnectionTransport,
  type HTTPRequest,
  type HTTPResponse,
  type KeyInput,
  type Page,
  type Protocol,
} from "puppeteer-core";
import {
  BrowserToolError,
  type ActionOutcome,
  type ActionWithSnapshot,
  type BrowserToolErrorCode,
  type ConsolePayload,
  type EvaluatePayload,
  type ScreenshotPayload,
  type SnapshotPayload,
  evaluatePayloadSchema,
  toErrorEnvelope,
} from "./contracts.js";
import { LIMITS } from "./limits.js";
import { clampText, scrubBoundedText, scrubText, scrubUrl } from "./scrub.js";
import { renderSnapshot, type SnapshotNode } from "./snapshot.js";

type AxNode = Protocol.Accessibility.AXNode;

type RefTarget = {
  backendNodeId: number;
  role: string;
  name: string | null;
};

type Diagnostic = {
  seq: number;
  kind: "console" | "pageerror" | "http";
  level: string | null;
  text: string;
  url: string | null;
};

type MutableSnapshotNode = SnapshotNode & { children: MutableSnapshotNode[] };

type PageMetrics = {
  url: string;
  title: string;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  scrollWidth: number;
  scrollHeight: number;
};

const ACTIONABLE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
]);

const NON_REFABLE_ROLES = new Set([
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "none",
  "presentation",
  "RootWebArea",
  "WebArea",
]);

const MAX_MATERIALIZED_NODES = LIMITS.snapshot.nodes + 500;

const KEY_INPUT_BY_NAME: Record<string, KeyInput> = {
  Alt: "Alt",
  Control: "Control",
  Meta: "Meta",
  Shift: "Shift",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Space: "Space",
};

/** Converts a validated key name into Puppeteer's key vocabulary. */
function toKeyInput(key: string): KeyInput {
  const named = KEY_INPUT_BY_NAME[key];
  if (named !== undefined) return named;
  // pressKeySchema already restricted the remaining form to one printable character.
  return key as KeyInput;
}

export const BOUND_VALUE_SOURCE = `function __btBound(value, budgets, state) {
  const seen = new WeakSet();
  let visited = 0;
  const remaining = () => budgets.totalChars - state.spent;
  const scalar = value => {
    let output = value;
    if (typeof output === "string") {
      if (output.length > budgets.stringChars) {
        output = output.slice(0, budgets.stringChars); state.truncated = true;
      }
      if (JSON.stringify(output).length > remaining()) {
        output = output.slice(0, Math.max(0, Math.floor((remaining() - 2) / 6)));
        state.truncated = true;
      }
    }
    const json = JSON.stringify(output);
    state.spent += json.length;
    return output;
  };
  const walk = (value, depth) => {
    visited++;
    if (value == null) return scalar(null);
    const type = typeof value;
    if (type === "boolean") return scalar(value);
    if (type === "number") {
      if (!Number.isFinite(value) || String(value).length > remaining()) { state.truncated = true; return scalar(null); }
      return scalar(value);
    }
    if (type === "string") return scalar(value);
    if (type === "bigint" || type === "symbol" || type === "function") { state.truncated = true; return scalar(null); }
    if (depth <= 0 || seen.has(value)) { state.truncated = true; return scalar(null); }
    seen.add(value);
    const array = Array.isArray(value);
    const out = array ? [] : Object.create(null);
    state.spent += 2; // container delimiters
    let count = 0;
    const append = (key, item) => {
      const boundedKey = String(key).slice(0, 200);
      const overhead = (count ? 1 : 0) + (array ? 0 : JSON.stringify(boundedKey).length + 1);
      // A child needs room for any primitive (true/null = 4, false = 5).
      if (visited >= budgets.items || remaining() < overhead + 5) { state.truncated = true; return false; }
      state.spent += overhead;
      if (!array && boundedKey !== key) state.truncated = true;
      let child;
      const beforeChild = state.spent;
      try { child = walk(item(), depth - 1); } catch {
        state.spent = beforeChild; state.truncated = true; child = scalar(null);
      }
      if (array) out.push(child); else out[boundedKey] = child;
      count++;
      return true;
    };
    if (array) {
      for (let i = 0; i < value.length; i++) { if (!append(i, () => value[i])) break; }
    } else {
      let keysVisited = 0;
      for (const key in value) {
        if (++keysVisited > budgets.items) { state.truncated = true; break; }
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (!append(key, () => value[key])) break;
      }
    }
    return out;
  };
  return walk(value, budgets.depth);
}`;

function jpegDimensions(buffer: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (buffer[offset + 5]! << 8) | buffer[offset + 6]!,
        width: (buffer[offset + 7]! << 8) | buffer[offset + 8]!,
      };
    }
    const length = (buffer[offset + 2]! << 8) | buffer[offset + 3]!;
    offset += 2 + length;
  }
  return null;
}

function axValue(value: Protocol.Accessibility.AXValue | undefined): string | null {
  if (!value || value.value === undefined || value.value === null) return null;
  const raw = value.value;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return null;
}

function axStates(node: AxNode): string[] {
  const states: string[] = [];
  for (const property of node.properties ?? []) {
    const name = property.name;
    const raw = property.value?.value;
    if (name === "disabled" && raw === true) states.push("disabled");
    else if (name === "checked" && raw === "mixed") states.push("mixed");
    else if (name === "checked" && raw === true) states.push("checked");
    else if (name === "expanded" && raw === true) states.push("expanded");
    else if (name === "expanded" && raw === false) states.push("collapsed");
    else if (name === "selected" && raw === true) states.push("selected");
    else if (name === "focused" && raw === true) states.push("focused");
    else if (name === "required" && raw === true) states.push("required");
    else if (name === "readonly" && raw === true) states.push("readonly");
    else if (name === "invalid" && raw !== "false" && raw !== undefined) states.push("invalid");
    else if (name === "modal" && raw === true) states.push("modal");
    else if (name === "level" && typeof raw === "number") states.push(`level=${raw}`);
    else if (name === "hasPopup" && typeof raw === "string") states.push(`hasPopup=${raw}`);
  }
  return states;
}

function isRefable(node: AxNode): boolean {
  if (node.ignored === true || node.backendDOMNodeId === undefined) return false;
  const role = String(node.role?.value ?? "");
  if (NON_REFABLE_ROLES.has(role)) return false;
  if (ACTIONABLE_ROLES.has(role)) return true;
  const name = axValue(node.name);
  return name !== null && name.trim() !== "";
}

/**
 * Builds the render input and the ref table in document order. Ignored AX
 * wrappers are flattened; recursion is bounded by the snapshot depth limit.
 */
export function buildSnapshotTree(nodes: readonly AxNode[]): {
  root: SnapshotNode | null;
  targets: Map<number, RefTarget>;
  truncated: { nodes: boolean; depth: boolean; droppedNodes: number };
} {
  const truncated = { nodes: false, depth: false, droppedNodes: 0 };
  const visited = new Set<string>();
  const byId = new Map<string, AxNode>();
  for (const node of nodes) {
    if (node.nodeId !== undefined) byId.set(node.nodeId, node);
  }
  const childrenOf = (node: AxNode): AxNode[] => {
    const children: AxNode[] = [];
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) children.push(child);
      else { truncated.nodes = true; truncated.droppedNodes++; }
    }
    return children;
  };
  const childIds = new Set<string>();
  for (const node of nodes) {
    for (const childId of node.childIds ?? []) childIds.add(childId);
  }
  const roots = nodes.filter(
    (node) => node.nodeId !== undefined && !childIds.has(node.nodeId) && node.ignored !== true,
  );
  const rootAx =
    roots.find((node) => String(node.role?.value ?? "") === "RootWebArea") ?? roots[0] ?? null;
  if (rootAx === null) return { root: null, targets: new Map(), truncated };

  const targets = new Map<number, RefTarget>();
  const materialized = new Set<string>();
  const depthOmissions = new Set<string>();
  let nextId = 0;

  const materialize = (axChildren: readonly AxNode[], depth: number): MutableSnapshotNode[] => {
    const result: MutableSnapshotNode[] = [];
    const stack: AxNode[] = [];
    for (let index = axChildren.length - 1; index >= 0; index -= 1) {
      stack.push(axChildren[index]!);
    }
    while (stack.length > 0) {
      const ax = stack.pop()!;
      if (visited.has(ax.nodeId) || visited.size >= MAX_MATERIALIZED_NODES) {
        truncated.nodes = true; truncated.droppedNodes += 1 + stack.length; break;
      }
      visited.add(ax.nodeId);
      if (ax.ignored === true) {
        const ignoredChildren = childrenOf(ax);
        for (let index = ignoredChildren.length - 1; index >= 0; index -= 1) {
          stack.push(ignoredChildren[index]!);
        }
        continue;
      }
      if (depth > LIMITS.snapshot.depth) {
        truncated.depth = true; depthOmissions.add(ax.nodeId); continue;
      }
      if (nextId >= MAX_MATERIALIZED_NODES) {
        truncated.nodes = true; truncated.droppedNodes += 1 + stack.length;
        stack.length = 0;
        break;
      }
      const id = nextId++;
      materialized.add(ax.nodeId);
      const role = String(ax.role?.value ?? "generic");
      const name = axValue(ax.name);
      const refable = isRefable(ax);
      if (refable && ax.backendDOMNodeId !== undefined) {
        targets.set(id, { backendNodeId: ax.backendDOMNodeId, role, name });
      }
      result.push({
        id,
        role,
        name,
        value: axValue(ax.value),
        description: axValue(ax.description),
        states: axStates(ax),
        refable,
        children: materialize(childrenOf(ax), depth + 1),
      });
    }
    return result;
  };

  const root = materialize([rootAx], 0)[0] ?? null;
  // Count acquired descendants omitted by depth in one shared iterative pass.
  // Each acquired node/edge is examined at most once, including overlapping
  // subtrees or cycles. No new AX requests or repeated subtree scans are made.
  const counted = new Set<string>();
  const omitted = [...depthOmissions];
  while (omitted.length > 0) {
    const nodeId = omitted.pop()!;
    if (counted.has(nodeId)) continue;
    counted.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) continue;
    if (!node.ignored && !materialized.has(nodeId)) truncated.droppedNodes++;
    for (const childId of node.childIds ?? []) {
      if (!counted.has(childId)) omitted.push(childId);
    }
  }
  return { root, targets, truncated };
}

export type ConnectOptions = {
  wsEndpoint: string;
  signal: AbortSignal;
  discoveryTimeoutMs?: number;
  deadlineAt?: number;
};

/**
 * One Puppeteer connection and Page per leased tab. Owns the current ref
 * store, diagnostics buffer, and page listeners. Commands execute when
 * called; per-session ordering lives in the host queue, not here.
 */
export class BrowserSession {
  readonly #browser: Browser;
  readonly #page: Page;
  readonly #client: CDPSession;
  readonly #nonce: string;
  readonly #connectionState: { alive: boolean };
  #epoch = 0;
  #refs = new Map<string, RefTarget>();
  #diagnostics: Diagnostic[] = [];
  #nextSeq = 0;
  #dropped = 0;
  #disposed = false;

  private constructor(
    browser: Browser,
    page: Page,
    client: CDPSession,
    nonce: string,
    connectionState: { alive: boolean },
  ) {
    this.#browser = browser;
    this.#page = page;
    this.#client = client;
    this.#nonce = nonce;
    this.#connectionState = connectionState;

    page.on("console", (message: ConsoleMessage) => {
      this.#record({
        kind: "console",
        level: message.type(),
        text: scrubBoundedText(message.text(), LIMITS.diagnostics.entryChars),
        url: null,
      });
    });
    page.on("pageerror", (error: unknown) => {
      this.#record({
        kind: "pageerror",
        level: "error",
        text: scrubBoundedText(String(error), LIMITS.diagnostics.entryChars),
        url: null,
      });
    });
    page.on("response", (response: HTTPResponse) => {
      const status = response.status();
      if (status < 400) return;
      this.#record({
        kind: "http",
        level: `status-${status}`,
        text: `${status} ${response.request().method()}`,
        url: clampText(scrubUrl(response.url()), LIMITS.snapshot.urlChars),
      });
    });
    page.on("requestfailed", (request: HTTPRequest) => {
      this.#record({
        kind: "http",
        level: "request-failed",
        text: `requestfailed ${request.method()} ${scrubBoundedText(
          request.failure()?.errorText ?? "unknown", 200,
        )}`,
        url: clampText(scrubUrl(request.url()), LIMITS.snapshot.urlChars),
      });
    });
  }

  static async connect(options: ConnectOptions): Promise<BrowserSession> {
    if (options.signal.aborted) {
      throw new BrowserToolError("SESSION_STOPPED", "The browser connection was cancelled");
    }
    const deadlineAt = options.deadlineAt ?? Date.now() + 30_000;
    if (deadlineAt <= Date.now()) {
      throw new BrowserToolError("DEADLINE_EXCEEDED", "The browser connection deadline expired");
    }
    // Public ConnectionTransport only: Puppeteer still owns every CDP command.
    // Owning the socket lets abort close even an unfinished WebSocket handshake.
    const socket = new WebSocket(options.wsEndpoint, {
      handshakeTimeout: Math.max(1, deadlineAt - Date.now()),
      perMessageDeflate: false,
      maxPayload: LIMITS.rpc.hostResultBytes,
      followRedirects: false,
    });
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), Math.max(1, deadlineAt - Date.now()));
    const signal = AbortSignal.any([options.signal, deadline.signal]);
    const connectionState = { alive: true };
    let browser: Browser | undefined;
    const transport: ConnectionTransport = {
      send: message => socket.send(message),
      close: () => socket.terminate(),
    };
    socket.addEventListener("message", event => transport.onmessage?.(String(event.data)));
    socket.addEventListener("close", () => { connectionState.alive = false; transport.onclose?.(); });
    const cancelled = () => new BrowserToolError(
      deadline.signal.aborted ? "DEADLINE_EXCEEDED" : "SESSION_STOPPED",
      "The browser connection was cancelled or exceeded its deadline",
    );
    const fence = () => { if (signal.aborted) throw cancelled(); };
    let onAbort = () => {};
    const cancellation = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        connectionState.alive = false;
        socket.terminate();
        void browser?.disconnect().catch(() => {});
        reject(cancelled());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const work = (async () => {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new BrowserToolError("TARGET_UNAVAILABLE", "Browser transport failed")));
      });
      fence();
      browser = await puppeteer.connect({
        transport, defaultViewport: null,
        protocolTimeout: LIMITS.navigation.maxTimeoutMs + 15_000,
      });
      try {
        fence();
        browser.on("disconnected", () => { connectionState.alive = false; });
        const page = await waitForSinglePage(browser, options.discoveryTimeoutMs ?? 5_000, signal);
        fence();
        const client = await page.createCDPSession();
        fence();
        const { randomBytes } = await import("node:crypto");
        fence();
        return new BrowserSession(browser, page, client, randomBytes(4).toString("hex"), connectionState);
      } catch (error) {
        await browser.disconnect().catch(() => {});
        throw error;
      }
    })();
    try {
      return await Promise.race([work, cancellation]);
    } catch (error) {
      socket.terminate();
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  get alive(): boolean {
    return this.#connectionState.alive && !this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#refs.clear();
    void this.#browser.disconnect().catch(() => {});
  }

  #fatal(): void {
    this.#connectionState.alive = false;
    this.dispose();
  }

  #assertUsable(): void {
    if (!this.alive) {
      throw new BrowserToolError("SESSION_STOPPED", "The browser session is no longer available");
    }
  }

  #record(entry: Omit<Diagnostic, "seq">): void {
    this.#diagnostics.push({ seq: this.#nextSeq++, ...entry });
    while (this.#diagnostics.length > LIMITS.diagnostics.entries) {
      this.#diagnostics.shift();
      this.#dropped += 1;
    }
  }

  #classify(error: unknown, failureCode: BrowserToolErrorCode): Error {
    if (error instanceof BrowserToolError) return error;
    if (!this.alive) {
      return new BrowserToolError("SESSION_STOPPED", "The browser session is no longer available");
    }
    return new BrowserToolError(
      failureCode,
      clampText(scrubText(error instanceof Error ? error.message : "Browser command failed"), 300),
    );
  }

  /**
   * Runs one browser command under the shared deadline and signal. A timeout
   * on a command that may have had an effect disconnects the session and
   * reports ACTION_OUTCOME_UNKNOWN; read-only timeouts can be retried.
   */
  async #guard<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
    deadlineAt: number,
    options: { failureCode: BrowserToolErrorCode; outcomeUnknown: boolean },
  ): Promise<T> {
    this.#assertUsable();
    if (signal.aborted) {
      throw new BrowserToolError("SESSION_STOPPED", "The browser command was cancelled");
    }
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new BrowserToolError(
        "DEADLINE_EXCEEDED",
        "The browser command expired before it started",
      );
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        settle();
      };
      const timer = setTimeout(() => {
        if (options.outcomeUnknown) {
          this.#fatal();
          finish(() =>
            reject(
              new BrowserToolError(
                "ACTION_OUTCOME_UNKNOWN",
                "The browser did not answer before the deadline; the session was closed",
              ),
            ),
          );
        } else {
          finish(() =>
            reject(
              new BrowserToolError(
                "DEADLINE_EXCEEDED",
                "The browser did not answer before the deadline",
              ),
            ),
          );
        }
      }, remaining);
      const onAbort = () => {
        if (options.outcomeUnknown) {
          this.#fatal();
          finish(() =>
            reject(
              new BrowserToolError(
                "ACTION_OUTCOME_UNKNOWN",
                "The browser command was cancelled after it started",
              ),
            ),
          );
        } else {
          finish(() =>
            reject(new BrowserToolError("SESSION_STOPPED", "The browser command was cancelled")),
          );
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      operation().then(
        (value) => finish(() => resolve(value)),
        (error) => {
          const classified = this.#classify(error, options.failureCode);
          if (classified instanceof BrowserToolError && classified.code === "ACTION_OUTCOME_UNKNOWN") this.#fatal();
          finish(() => reject(classified));
        },
      );
    });
  }

  async #metrics(signal: AbortSignal, deadlineAt: number): Promise<PageMetrics> {
    const result = await this.#guard(
      () =>
        this.#client.send("Runtime.evaluate", {
          expression:
            "({ url: location.href, title: document.title, innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0), scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) })",
          returnByValue: true,
        }),
      signal,
      deadlineAt,
      { failureCode: "TARGET_UNAVAILABLE", outcomeUnknown: false },
    );
    const value = (result.result?.value ?? {}) as Partial<PageMetrics>;
    return {
      url: typeof value.url === "string" ? value.url : "about:blank",
      title: typeof value.title === "string" ? value.title : "",
      innerWidth: Number(value.innerWidth) || 0,
      innerHeight: Number(value.innerHeight) || 0,
      devicePixelRatio: Number(value.devicePixelRatio) || 1,
      scrollWidth: Number(value.scrollWidth) || 0,
      scrollHeight: Number(value.scrollHeight) || 0,
    };
  }

  async snapshot(signal: AbortSignal, deadlineAt: number): Promise<SnapshotPayload> {
    this.#assertUsable();
    const metrics = await this.#metrics(signal, deadlineAt);
    const axTree = await this.#guard(
      () =>
        this.#client.send("Accessibility.getFullAXTree", {
          depth: LIMITS.snapshot.depth + 2,
        }),
      signal,
      deadlineAt,
      { failureCode: "TARGET_UNAVAILABLE", outcomeUnknown: false },
    );
    const { root, targets, truncated } = buildSnapshotTree(axTree.nodes);
    const snapshotId = `${this.#nonce}.${++this.#epoch}`;
    const rendered = renderSnapshot(root, snapshotId, truncated);
    const refs: SnapshotPayload["refs"] = [];
    const nextRefs = new Map<string, RefTarget>();
    for (const { ref, id } of rendered.refs) {
      const target = targets.get(id);
      if (!target) continue;
      nextRefs.set(ref, target);
      refs.push({
        ref,
        role: clampText(target.role, 120),
        name: target.name === null ? null : clampText(target.name, 1_000),
      });
    }
    this.#refs = nextRefs;
    return {
      snapshotId,
      text: rendered.text,
      refs,
      url: clampText(scrubUrl(metrics.url), LIMITS.snapshot.urlChars),
      title: clampText(scrubText(metrics.title), LIMITS.snapshot.titleChars),
      truncated: rendered.truncated,
    };
  }

  async #snapshotAfterAction(
    action: ActionOutcome,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ActionWithSnapshot> {
    try {
      const snapshot = await this.snapshot(signal, deadlineAt);
      return { action, snapshot, snapshotError: null };
    } catch (error) {
      if (!this.alive) {
        return {
          action,
          snapshot: null,
          snapshotError: {
            code: "ACTION_OUTCOME_UNKNOWN",
            message: "The action completed but the page session was lost before the snapshot",
          },
        };
      }
      return { action, snapshot: null, snapshotError: toErrorEnvelope(error) };
    }
  }

  async #runAction(
    action: () => Promise<void>,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ActionWithSnapshot> {
    try {
      await action();
    } catch (error) {
      return {
        action: { ok: false, error: toErrorEnvelope(error) },
        snapshot: null,
        snapshotError: null,
      };
    }
    return this.#snapshotAfterAction({ ok: true }, signal, deadlineAt);
  }

  async #resolveRef(
    ref: string,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<{ objectId: string; target: RefTarget }> {
    this.#assertUsable();
    const target = this.#refs.get(ref);
    if (!target) {
      throw new BrowserToolError(
        "STALE_REF",
        "That ref is not part of the current snapshot; take a fresh snapshot first",
      );
    }
    let partial: Protocol.Accessibility.GetPartialAXTreeResponse;
    try {
      partial = await this.#guard(
        () =>
          this.#client.send("Accessibility.getPartialAXTree", {
            backendNodeId: target.backendNodeId,
            fetchRelatives: false,
          }),
        signal,
        deadlineAt,
        { failureCode: "STALE_REF", outcomeUnknown: false },
      );
    } catch (error) {
      throw new BrowserToolError(
        "STALE_REF",
        `The referenced element is gone (${toErrorEnvelope(error).code}); take a fresh snapshot`,
      );
    }
    const node = partial.nodes?.[0];
    if (!node || node.ignored === true || node.backendDOMNodeId === undefined) {
      throw new BrowserToolError(
        "STALE_REF",
        "The referenced element is no longer rendered; take a fresh snapshot",
      );
    }
    const role = String(node.role?.value ?? "");
    const name = axValue(node.name);
    if (role !== target.role || (target.name !== null && name !== target.name)) {
      throw new BrowserToolError(
        "STALE_REF",
        "The referenced element changed since the snapshot; take a fresh snapshot",
      );
    }
    const resolved = await this.#guard(
      () => this.#client.send("DOM.resolveNode", { backendNodeId: target.backendNodeId }),
      signal,
      deadlineAt,
      { failureCode: "STALE_REF", outcomeUnknown: false },
    );
    const objectId = resolved.object.objectId;
    if (!objectId) {
      throw new BrowserToolError(
        "STALE_REF",
        "The referenced element is detached; take a fresh snapshot",
      );
    }
    return { objectId, target };
  }

  /** Resolves a ref and always releases the remote object afterwards. */
  async #withRef<T>(
    ref: string,
    signal: AbortSignal,
    deadlineAt: number,
    run: (objectId: string) => Promise<T>,
  ): Promise<T> {
    const { objectId } = await this.#resolveRef(ref, signal, deadlineAt);
    try {
      return await run(objectId);
    } finally {
      // Release is cleanup, not a command: never block the queue on it.
      void this.#client.send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }

  async #callFunction<T>(
    objectId: string,
    functionDeclaration: string,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<T> {
    const result = await this.#guard(
      () =>
        this.#client.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration,
          returnByValue: true,
          awaitPromise: true,
        }),
      signal,
      deadlineAt,
      { failureCode: "TARGET_UNAVAILABLE", outcomeUnknown: false },
    );
    if (result.exceptionDetails) {
      throw new BrowserToolError(
        "INVALID_INPUT",
        `The page rejected the operation: ${clampText(
          scrubText(
            result.exceptionDetails.exception?.description ??
              result.exceptionDetails.text ??
              "unknown",
          ),
          300,
        )}`,
      );
    }
    return result.result?.value as T;
  }

  async #boxCenter(
    objectId: string,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<{ x: number; y: number } | null> {
    const result = await this.#guard(
      () => this.#client.send("DOM.getBoxModel", { objectId }),
      signal,
      deadlineAt,
      { failureCode: "TARGET_UNAVAILABLE", outcomeUnknown: false },
    );
    const quad = result.model?.border;
    if (!quad || quad.length < 8) return null;
    const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
    const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (maxX - minX < 1 || maxY - minY < 1) return null;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  async click(ref: string, signal: AbortSignal, deadlineAt: number): Promise<ActionWithSnapshot> {
    return this.#runAction(async () => {
      await this.#withRef(ref, signal, deadlineAt, async (objectId) => {
        await this.#callFunction<void>(
          objectId,
          "function() { this.scrollIntoView({ block: 'center', inline: 'center' }); }",
          signal,
          deadlineAt,
        );
        const center = await this.#boxCenter(objectId, signal, deadlineAt);
        if (center === null) {
          throw new BrowserToolError("TARGET_UNAVAILABLE", "The referenced element is not visible");
        }
        const { x, y } = center;
        const hit = await this.#callFunction<string>(
          objectId,
          `function() {
            const el = document.elementFromPoint(${x}, ${y});
            if (el === null) return "none";
            return el === this || this.contains(el) || el.contains(this) ? "ok" : (el.tagName || "other");
          }`,
          signal,
          deadlineAt,
        );
        if (hit !== "ok") {
          throw new BrowserToolError(
            "TARGET_UNAVAILABLE",
            `The referenced element is covered by <${hit}>`,
          );
        }
        const dispatch = (type: "mouseMoved" | "mousePressed" | "mouseReleased") =>
          this.#guard(
            () =>
              this.#client.send("Input.dispatchMouseEvent", {
                type,
                x,
                y,
                button: type === "mouseMoved" ? "none" : "left",
                buttons: type === "mousePressed" ? 1 : 0,
                clickCount: type === "mouseMoved" ? 0 : 1,
              }),
            signal,
            deadlineAt,
            { failureCode: "ACTION_OUTCOME_UNKNOWN", outcomeUnknown: true },
          );
        await dispatch("mouseMoved");
        await dispatch("mousePressed");
        await dispatch("mouseReleased");
      });
    }, signal, deadlineAt);
  }

  async type(
    ref: string,
    text: string,
    replace: boolean,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ActionWithSnapshot> {
    return this.#runAction(async () => {
      await this.#withRef(ref, signal, deadlineAt, async (objectId) => {
        const field = await this.#callFunction<{
          editable: boolean;
          disabled: boolean;
          readOnly: boolean;
        }>(
          objectId,
          `function() {
            const tag = (this.tagName || "").toUpperCase();
            return {
              editable: this.isContentEditable === true || tag === "INPUT" || tag === "TEXTAREA",
              disabled: this.disabled === true,
              readOnly: this.readOnly === true,
            };
          }`,
          signal,
          deadlineAt,
        );
        if (!field.editable) {
          throw new BrowserToolError(
            "TARGET_UNAVAILABLE",
            "The referenced element is not an editable text field",
          );
        }
        if (field.disabled || field.readOnly) {
          throw new BrowserToolError(
            "TARGET_UNAVAILABLE",
            "The referenced field is disabled or read-only",
          );
        }
        const selection = replace
          ? `function() {
               this.focus();
               if (typeof this.select === "function") { try { this.select(); return; } catch {} }
               if (this.isContentEditable === true) {
                 const range = document.createRange();
                 range.selectNodeContents(this);
                 const selection = window.getSelection();
                 if (selection) { selection.removeAllRanges(); selection.addRange(range); }
                 return;
               }
               if (typeof this.setSelectionRange === "function") {
                 try { this.setSelectionRange(0, (this.value || "").length); } catch {}
               }
             }`
          : `function() {
               this.focus();
               if (this.isContentEditable === true) {
                 const range = document.createRange();
                 range.selectNodeContents(this);
                 range.collapse(false);
                 const selection = window.getSelection();
                 if (selection) { selection.removeAllRanges(); selection.addRange(range); }
                 return;
               }
               if (typeof this.setSelectionRange === "function") {
                 try { const length = (this.value || "").length; this.setSelectionRange(length, length); } catch {}
               }
             }`;
        await this.#callFunction<void>(objectId, selection, signal, deadlineAt);
        await this.#guard(
          () => this.#client.send("Input.insertText", { text }),
          signal,
          deadlineAt,
          { failureCode: "ACTION_OUTCOME_UNKNOWN", outcomeUnknown: true },
        );
      });
    }, signal, deadlineAt);
  }

  async press(key: string, signal: AbortSignal, deadlineAt: number): Promise<ActionWithSnapshot> {
    return this.#runAction(async () => {
      this.#assertUsable();
      const parts = key.split("+");
      const main = parts.pop();
      if (main === undefined) {
        throw new BrowserToolError("INVALID_INPUT", "The key is empty");
      }
      const modifiers = parts;
      await this.#guard(
        async () => {
          for (const modifier of modifiers) {
            await this.#page.keyboard.down(toKeyInput(modifier));
          }
          try {
            await this.#page.keyboard.press(toKeyInput(main));
          } finally {
            for (const modifier of [...modifiers].reverse()) {
              await this.#page.keyboard.up(toKeyInput(modifier)).catch(() => {});
            }
          }
        },
        signal,
        deadlineAt,
        { failureCode: "ACTION_OUTCOME_UNKNOWN", outcomeUnknown: true },
      );
    }, signal, deadlineAt);
  }

  async navigate(
    url: string,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ActionWithSnapshot> {
    try {
      this.#assertUsable();
      await this.#guard(
        () =>
          this.#page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: Math.max(1, deadlineAt - Date.now()),
          }),
        signal,
        deadlineAt,
        { failureCode: "ACTION_OUTCOME_UNKNOWN", outcomeUnknown: true },
      );
    } catch (error) {
      if (error instanceof TimeoutError || (error instanceof BrowserToolError && error.code === "ACTION_OUTCOME_UNKNOWN")) this.#fatal();
      const envelope = toErrorEnvelope(
        error instanceof TimeoutError || (error instanceof BrowserToolError && error.code === "DEADLINE_EXCEEDED")
          ? new BrowserToolError(
              "ACTION_OUTCOME_UNKNOWN",
              "Navigation did not finish before the deadline; the page may still have changed",
            )
          : error,
      );
      try {
        const snapshot = await this.snapshot(signal, deadlineAt);
        return { action: { ok: false, error: envelope }, snapshot, snapshotError: null };
      } catch (snapshotError) {
        return {
          action: { ok: false, error: envelope },
          snapshot: null,
          snapshotError: toErrorEnvelope(snapshotError),
        };
      }
    }
    return this.#snapshotAfterAction({ ok: true }, signal, deadlineAt);
  }

  async screenshot(
    fullPage: boolean,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ScreenshotPayload> {
    this.#assertUsable();
    const metrics = await this.#metrics(signal, deadlineAt);
    const cssWidth = fullPage
      ? Math.max(metrics.innerWidth, metrics.scrollWidth)
      : metrics.innerWidth;
    const cssHeight = fullPage
      ? Math.max(metrics.innerHeight, metrics.scrollHeight)
      : metrics.innerHeight;
    const rawPixels = cssWidth * cssHeight * metrics.devicePixelRatio ** 2;
    // Headroom for rounded encoded dimensions, so the encoded image stays
    // inside the pixel budget as well as the raw estimate.
    const scale = Math.min(1, Math.sqrt((LIMITS.screenshot.maxPixels * 0.97) / Math.max(1, rawPixels)));
    const clipped = scale < 1;
    const capture = (quality: number): Promise<Uint8Array> =>
      this.#guard(
        () =>
          this.#page.screenshot(
            clipped
              ? {
                  type: "jpeg",
                  quality,
                  captureBeyondViewport: fullPage,
                  clip: { x: 0, y: 0, width: cssWidth, height: cssHeight, scale },
                }
              : { type: "jpeg", quality, fullPage },
          ),
        signal,
        deadlineAt,
        { failureCode: "ACTION_OUTCOME_UNKNOWN", outcomeUnknown: true },
      );

    const firstQuality =
      rawPixels > LIMITS.screenshot.largePagePixels
        ? LIMITS.screenshot.fallbackQuality
        : LIMITS.screenshot.initialQuality;
    let reduced = clipped;
    let buffer = await capture(firstQuality);
    if (buffer.length > LIMITS.screenshot.maxJpegBytes) {
      reduced = true;
      buffer = await capture(LIMITS.screenshot.fallbackQuality);
    }
    if (buffer.length > LIMITS.screenshot.maxJpegBytes) {
      throw new BrowserToolError(
        "OUTPUT_LIMIT",
        `The screenshot exceeds the ${Math.round(
          LIMITS.screenshot.maxJpegBytes / 1024,
        )} KiB budget`,
      );
    }
    const size = jpegDimensions(buffer);
    if (size === null) {
      throw new BrowserToolError("OUTPUT_LIMIT", "The screenshot could not be decoded");
    }
    return {
      data: Buffer.from(buffer).toString("base64"),
      mimeType: "image/jpeg",
      width: size.width,
      height: size.height,
      mode: fullPage ? "full-page" : "viewport",
      reduced,
      truncated: false,
      bytes: buffer.length,
    };
  }

  async evaluate(
    expression: string,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<EvaluatePayload> {
    this.#assertUsable();
    const budgets = JSON.stringify({
      depth: LIMITS.evaluate.depth,
      items: LIMITS.evaluate.items,
      stringChars: LIMITS.evaluate.stringChars,
      totalChars: LIMITS.evaluate.outputChars,
    });
    const wrapped = `(async () => { const __btBound = ${BOUND_VALUE_SOURCE}; const __btState = { spent: 0, truncated: false }; const __btValue = __btBound(await (${expression}), ${budgets}, __btState); return { value: __btValue, inPageTruncated: __btState.truncated }; })()`;
    const result = await this.#guard(
      () =>
        this.#client.send("Runtime.evaluate", {
          expression: wrapped,
          awaitPromise: true,
          returnByValue: true,
        }),
      signal,
      deadlineAt,
      { failureCode: "ACTION_OUTCOME_UNKNOWN", outcomeUnknown: true },
    );
    if (result.exceptionDetails) {
      throw new BrowserToolError(
        "INVALID_INPUT",
        `Evaluation failed: ${clampText(
          scrubText(
            result.exceptionDetails.exception?.description ??
              result.exceptionDetails.text ??
              "unknown",
          ),
          300,
        )}`,
      );
    }
    const envelope = (result.result?.value ?? { value: null, inPageTruncated: false }) as {
      value: unknown;
      inPageTruncated: boolean;
    };
    const value = envelope.value ?? null;
    let json: string;
    try {
      json = JSON.stringify(value) ?? "null";
    } catch {
      json = "null";
    }
    if (envelope.inPageTruncated === true || json.length > LIMITS.evaluate.outputChars) {
      return evaluatePayloadSchema.parse({
        value: envelope.inPageTruncated === true ? value : null,
        truncated: true,
        notice:
          envelope.inPageTruncated === true
            ? "The result exceeded the in-page serialization budget"
            : `The result exceeded the ${LIMITS.evaluate.outputChars} character output budget`,
      });
    }
    return evaluatePayloadSchema.parse({ value, truncated: false, notice: null });
  }

  readConsole(cursor: number | null): ConsolePayload {
    const entries =
      cursor === null
        ? [...this.#diagnostics]
        : this.#diagnostics.filter((entry) => entry.seq >= cursor);
    const last = entries[entries.length - 1];
    const bufferedFrom = this.#diagnostics[0]?.seq ?? this.#nextSeq;
    return {
      entries: entries.map((entry) => ({
        seq: entry.seq,
        kind: entry.kind,
        level: entry.level,
        text: entry.text,
        url: entry.url,
      })),
      nextCursor: last ? last.seq + 1 : cursor ?? 0,
      dropped:
        cursor === null ? this.#dropped : Math.max(0, Math.min(this.#dropped, bufferedFrom - cursor)),
    };
  }
}

async function waitForSinglePage(
  browser: Browser,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal.aborted) {
      throw new BrowserToolError("SESSION_STOPPED", "The browser session was cancelled");
    }
    const pages = await browser.pages();
    if (pages.length > 1) {
      throw new BrowserToolError(
        "TARGET_AMBIGUOUS",
        "The lease exposes more than one page; close extra tabs before opening a session",
      );
    }
    const first = pages[0];
    if (first) return first;
    if (Date.now() >= deadline) {
      throw new BrowserToolError(
        "TARGET_UNAVAILABLE",
        "No page target became available in the leased tab",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
