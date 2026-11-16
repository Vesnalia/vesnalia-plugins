import {
  CompatibilityError,
  OperationError,
  actionResult,
} from "./compatibility";
import type { PluginCommandContext } from "@get-bb/plugin-sdk";
import {
  blocked,
  classify,
  COMMAND,
  commandContext,
  type Commands,
  snapshot,
  terminals,
  type HostSnapshot,
  type Surface,
} from "./host";

export type CreateTerminal = (
  threadId: string,
) => Promise<{ id: string; threadId: string | null }>;
export interface Runtime {
  read(): HostSnapshot;
  focus(host: HostSnapshot): ReturnType<typeof classify>;
  blocked(): boolean;
  create: CreateTerminal;
  wait(): Promise<void>;
  now(): number;
}
export function browserRuntime(create: CreateTerminal): Runtime {
  return {
    read: () => snapshot(),
    focus: (host) => classify(document, host),
    blocked: () => blocked(),
    create,
    wait: () => new Promise((resolve) => setTimeout(resolve, 25)),
    now: () => performance.now(),
  };
}
export function sameSurface(a: Surface | null, b: Surface): boolean {
  return (
    !!a &&
    a.threadId === b.threadId &&
    a.paneId === b.paneId &&
    a.panel === b.panel
  );
}

export class Toggle {
  readonly last = new Map<string, string>();
  private operation: {
    target: string | null;
    surface: Surface;
    settled: boolean;
    cancelled: boolean;
  } | null = null;
  private disposed = false;
  constructor(private readonly runtime: Runtime) {}

  observe(host = this.runtime.read()): void {
    const focus = this.runtime.focus(host);
    if (this.operation && !sameSurface(host.surface, this.operation.surface))
      this.operation.cancelled = true;
    if (focus.kind === "terminal") {
      this.last.set(focus.threadId, focus.terminalId);
      if (
        this.operation?.target === focus.terminalId &&
        sameSurface(host.surface, this.operation.surface)
      ) {
        this.operation.settled = true;
        this.operation = null;
      }
    }
    // Unknown terminal ownership can hide a newer focus; stale history is unsafe.
    if (focus.kind === "unknown" && focus.invalidateHistory !== false)
      this.last.clear();
  }
  available(context: PluginCommandContext): boolean {
    // Keep the palette command reachable even when private host discovery fails.
    return !this.disposed && context.threadId !== null;
  }
  invalidate(): void {
    this.last.clear();
    if (this.operation) this.operation.cancelled = true;
  }
  async run(context: PluginCommandContext): Promise<void> {
    if (this.disposed || this.operation || this.runtime.blocked()) return;
    const host = this.runtime.read(),
      surface = host.surface;
    if (!surface)
      throw new CompatibilityError(
        "TT_SURFACE",
        "Cannot resolve the active chat pane and primary composer. Open an editable thread and retry.",
      );
    if (surface.threadId !== context.threadId) return;
    const focus = this.runtime.focus(host);
    if (focus.kind === "unknown")
      throw new CompatibilityError(
        "TT_FOCUS",
        "Cannot identify the current terminal input and its owning chat pane.",
      );
    if (focus.kind === "terminal") {
      this.last.set(focus.threadId, focus.terminalId);
      if (
        !terminals(surface.panel.getTabs()).some(
          (t) => t.id === focus.terminalId,
        )
      )
        throw new CompatibilityError(
          "TT_FOCUS",
          "The focused terminal does not belong to the active panel.",
        );
      if (!actionResult(surface.panel.close(), "TT_PANEL"))
        throw new OperationError("BB could not hide the terminal panel.");
      surface.composer.focus();
      return;
    }
    const operation = {
      target: null as string | null,
      surface,
      settled: false,
      cancelled: false,
    };
    this.operation = operation;
    try {
      const tabs = terminals(surface.panel.getTabs());
      let target =
        tabs.find((t) => t.id === this.last.get(surface.threadId)) ?? tabs[0];
      if (target) {
        operation.target = target.id;
        if (!actionResult(surface.panel.selectTab(target.key), "TT_PANEL")) {
          // One fresh read/retry; disappearance never silently starts a shell.
          const fresh = terminals(surface.panel.getTabs());
          target =
            fresh.find((t) => t.id === this.last.get(surface.threadId)) ??
            fresh[0];
          operation.target = target?.id ?? null;
          if (
            !target ||
            !actionResult(surface.panel.selectTab(target.key), "TT_PANEL")
          )
            throw new OperationError(
              "The terminal tab is no longer available.",
            );
        }
      } else {
        const session = await this.runtime.create(surface.threadId);
        if (
          !session ||
          typeof session.id !== "string" ||
          !session.id ||
          session.threadId !== surface.threadId
        )
          throw new CompatibilityError(
            "TT_SESSION",
            "bb returned an unrecognized terminal creation result. No focus action was performed.",
          );
        if (operation.cancelled || this.disposed || this.runtime.blocked())
          return;
        const current = this.runtime.read();
        if (!sameSurface(current.surface, surface)) return;
        operation.target = session.id;
        if (
          session.threadId !== surface.threadId ||
          !actionResult(current.surface!.openTerminal(session), "TT_SESSION")
        ) {
          throw new OperationError(
            "BB could not open the new terminal in this chat pane.",
          );
        }
        target = { id: session.id, key: "" };
      }
      // Selection's native autofocus is asynchronous. Keep the lock until real
      // input focus, not just until selectTab returns; never queue extra toggles.
      const deadline = this.runtime.now() + 8000;
      while (!operation.cancelled && !operation.settled && !this.disposed) {
        if (this.runtime.blocked()) return;
        const current = this.runtime.read();
        if (!sameSurface(current.surface, surface)) return;
        if (this.runtime.now() >= deadline)
          throw new OperationError(
            "BB did not focus the terminal. Its session has been left open.",
          );
        const actual = this.runtime.focus(current);
        if (actual.kind === "terminal" && actual.terminalId === target.id) {
          this.last.set(surface.threadId, target.id);
          return;
        }
        await this.runtime.wait();
      }
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }
  dispose(): void {
    this.disposed = true;
    this.last.clear();
  }
}

/** Capture only this registered command, preserving host bindings and dispatch. */
export function captureShortcut(
  event: KeyboardEvent,
  host: HostSnapshot,
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    !host.commands ||
    blocked()
  )
    return false;
  const commands = host.commands;
  if (!matchesShortcut(event, commands)) return false;
  if (!actionResult(commands.dispatch(COMMAND, event.target), "TT_COMMANDS"))
    return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function matchesShortcut(event: KeyboardEvent, commands: Commands): boolean {
  const shortcut = commands.getShortcut(COMMAND);
  if (shortcut === null) return false;
  if (
    !shortcut ||
    typeof shortcut.key !== "string" ||
    !shortcut.key ||
    [
      shortcut.mod,
      shortcut.meta,
      shortcut.control,
      shortcut.alt,
      shortcut.shift,
    ].some((value) => value !== undefined && typeof value !== "boolean")
  )
    throw new CompatibilityError(
      "TT_SHORTCUT",
      "bb returned an unrecognized keyboard binding.",
    );
  const physicalDefault =
    shortcut.key === "`" &&
    shortcut.control === true &&
    !shortcut.mod &&
    !shortcut.meta &&
    !shortcut.alt &&
    !shortcut.shift &&
    event.code === "Backquote" &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey;
  if (physicalDefault) return true;
  const matched = commands.getShortcutCommand(event, [COMMAND]);
  if (matched !== null && typeof matched !== "string")
    throw new CompatibilityError(
      "TT_SHORTCUT",
      "bb returned an unrecognized shortcut match.",
    );
  return matched === COMMAND;
}

/** The actual capture listener, shared with tests of unmodified/rebound keys. */
export function createShortcutHandler(
  readHost: () => HostSnapshot = snapshot,
  readCommands: () => Commands | null = commandContext,
  onError: (cause: unknown) => void = () => {},
) {
  return (event: KeyboardEvent): void => {
    if (event.repeat || event.isComposing || event.defaultPrevented) return;
    try {
      if (blocked()) return;
      const commands = readCommands();
      if (!commands)
        throw new CompatibilityError(
          "TT_COMMANDS",
          "Cannot access bb's keyboard dispatcher.",
        );
      if (matchesShortcut(event, commands)) captureShortcut(event, readHost());
    } catch (cause) {
      // Report without consuming keys when the host contract cannot be resolved.
      onError(cause);
    }
  };
}
