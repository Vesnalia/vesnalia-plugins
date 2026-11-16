import { CompatibilityError } from "./compatibility";
import type {
  ExperimentalPanelController,
  PluginCommandShortcut,
} from "@vesnalia/plugin-sdk";
import {
  ancestors,
  callable,
  currentNode,
  fields,
  paneOf,
  props,
  rootFor,
  walk,
  traverse,
  type Fiber,
} from "./fiber";

export interface ComposerHost {
  scope: { kind: "thread"; threadId: string };
  focus(): void;
  isAvailable?(): boolean;
}
export interface Surface {
  paneId: string;
  threadId: string;
  panel: Pick<ExperimentalPanelController, "getTabs" | "selectTab" | "close">;
  composer: ComposerHost;
  openTerminal(session: unknown): boolean;
}
export interface Commands {
  dispatch(id: string, target: EventTarget | null): boolean;
  getShortcut(id: string): PluginCommandShortcut | null;
  getShortcutCommand(
    event: KeyboardEvent,
    commands: readonly string[],
  ): string | null;
}
export interface HostSnapshot {
  tree: Fiber[];
  surface: Surface | null;
  commands: Commands | null;
}
export const INPUT =
  "[data-app-terminal] .xterm textarea.xterm-helper-textarea";
export const COMMAND = "plugin:terminal-toggle/toggle";

function isComposer(value: unknown): value is ComposerHost {
  const v = fields(value),
    scope = fields(v.scope);
  return (
    scope.kind === "thread" &&
    typeof scope.threadId === "string" &&
    callable(v.focus) &&
    (v.isAvailable === undefined || callable(v.isAvailable))
  );
}

/** Stop at the command provider, before traversing transcripts/composers. */
export function commandContext(doc: Document = document): Commands | null {
  const root =
    rootFor(doc.activeElement ?? doc.body) ??
    rootFor(doc.body.firstElementChild ?? doc.body);
  if (!root)
    throw new CompatibilityError(
      "TT_REACT",
      "Cannot access the committed React tree.",
    );
  for (const node of traverse(root)) {
    const value = fields(props(node).value);
    if (
      callable(value.dispatch) &&
      callable(value.getShortcut) &&
      callable(value.getShortcutCommand) &&
      callable(value.registerHandler)
    )
      return fields(root.stateNode).current === root
        ? (value as unknown as Commands)
        : null;
  }
  throw new CompatibilityError(
    "TT_COMMANDS",
    "Cannot access VesnALIA's keyboard dispatcher.",
  );
}

/** Shapes are checked before use; function/component names are never inspected. */
export function snapshot(doc: Document = document): HostSnapshot {
  const root =
    rootFor(doc.activeElement ?? doc.body) ??
    rootFor(doc.body.firstElementChild ?? doc.body);
  if (!root)
    throw new CompatibilityError(
      "TT_REACT",
      "Cannot access the committed React tree.",
    );
  const tree = walk(root);
  const commandValues = tree
    .map((n) => fields(props(n).value))
    .filter(
      (v) =>
        callable(v.dispatch) &&
        callable(v.getShortcut) &&
        callable(v.getShortcutCommand) &&
        callable(v.registerHandler),
    );
  const commandSet = [...new Set(commandValues)];
  if (commandSet.length !== 1)
    throw new CompatibilityError(
      "TT_COMMANDS",
      "Cannot identify one valid keyboard dispatcher.",
    );
  const commands = commandSet[0] as unknown as Commands;
  // Resolve ownership from the primary composer's committed ancestor chain.
  // A nested component's unrelated `capabilities.panel` is not a host contract.
  const owners: {
    paneId: string;
    threadId: string;
    navigation: Record<string, unknown>;
    composer: ComposerHost;
  }[] = [];
  for (const element of doc.querySelectorAll(
    '[data-app-composer][data-app-composer-role="primary"]',
  )) {
    const editor = currentNode(element, tree);
    if (!editor) continue;
    const pane = paneOf(editor);
    if (!pane?.focused) continue;
    const chain = ancestors(editor);
    const composer = chain.map((n) => props(n).value).find(isComposer);
    if (!composer || composer.isAvailable?.() === false) continue;
    const owner = chain.find((n) => {
      if (n.tag !== 10) return false; // React context provider, not arbitrary props.
      const value = fields(props(n).value);
      return [
        "panel",
        "openTerminal",
        "openFileExternally",
        "openFilePreview",
        "openUrl",
      ].every((key) => key in value);
    });
    if (!owner) continue;
    const threadId = ancestors(owner)
      .map((n) => props(n).threadId)
      .find((id): id is string => typeof id === "string");
    if (!threadId || composer.scope.threadId !== threadId) continue;
    owners.push({
      paneId: pane.paneId,
      threadId,
      navigation: fields(props(owner).value),
      composer,
    });
  }
  if (owners.length !== 1) return { tree, surface: null, commands };
  const { paneId, threadId, navigation, composer } = owners[0];
  const panel = fields(navigation.panel);
  for (const method of ["getTabs", "selectTab", "close"])
    if (!callable(panel[method]))
      throw new CompatibilityError(
        "TT_PANEL",
        `The native panel method '${method}' is unavailable.`,
      );
  if (!callable(navigation.openTerminal))
    throw new CompatibilityError(
      "TT_SESSION",
      "The native terminal reveal method is unavailable.",
    );
  return {
    tree,
    commands,
    surface: {
      paneId,
      threadId,
      composer,
      panel: navigation.panel as Surface["panel"],
      openTerminal: navigation.openTerminal as Surface["openTerminal"],
    },
  };
}

export type Focus =
  | { kind: "terminal"; terminalId: string; threadId: string; paneId: string }
  | { kind: "other" }
  | { kind: "unknown"; invalidateHistory?: boolean };
export function classify(doc: Document, host: HostSnapshot): Focus {
  const active = doc.activeElement;
  if (
    !doc.hasFocus() ||
    doc.visibilityState === "hidden" ||
    !active?.isConnected
  )
    return { kind: "unknown", invalidateHistory: false };
  if (!active.matches(INPUT)) {
    const terminalLike =
      active.closest("[data-app-terminal] .xterm") ||
      active.matches(".xterm textarea, textarea.xterm-helper-textarea") ||
      (active.tagName === "TEXTAREA" && active.closest("[data-app-terminal]"));
    return terminalLike ? { kind: "unknown" } : { kind: "other" };
  }
  if (active.closest('[inert], [aria-hidden="true"]'))
    return { kind: "unknown" };
  const wrapper = active.closest("[data-app-terminal]");
  const node = wrapper && currentNode(wrapper, host.tree);
  if (!node || !host.surface) return { kind: "unknown" };
  const identities = ancestors(node)
    .map(props)
    .filter(
      (p) =>
        typeof p.terminalId === "string" && fields(p.target).kind === "thread",
    );
  const ids = [...new Set(identities.map((p) => p.terminalId as string))];
  if (
    ids.length !== 1 ||
    identities.some((p) => fields(p.target).threadId !== host.surface!.threadId)
  )
    return { kind: "unknown" };
  // Shared panels live outside the chat's DOM subtree. Resolve their host owner.
  const directPane = paneOf(node);
  const sharedPane = ancestors(node)
    .map(props)
    .find(
      (p) =>
        typeof p.focusedPaneId === "string" &&
        callable(fields(p.registry).getSnapshot),
    );
  const paneId = sharedPane?.focusedPaneId ?? directPane?.paneId;
  if (paneId !== host.surface.paneId) return { kind: "unknown" };
  return {
    kind: "terminal",
    terminalId: ids[0],
    threadId: host.surface.threadId,
    paneId: host.surface.paneId,
  };
}
export function terminals(tabs: unknown): { key: string; id: string }[] {
  const value = fields(tabs);
  if (
    typeof value.open !== "boolean" ||
    !Array.isArray(value.tabs) ||
    (value.selectedKey !== null && typeof value.selectedKey !== "string")
  )
    throw new CompatibilityError(
      "TT_TABS",
      "alia returned an unrecognized panel-tab snapshot.",
    );
  const result: { key: string; id: string }[] = [];
  const keys = new Set<string>(),
    ids = new Set<string>();
  for (const item of value.tabs) {
    const tab = fields(item),
      detail = fields(tab.detail);
    if (
      typeof tab.key !== "string" ||
      !tab.key ||
      keys.has(tab.key) ||
      typeof detail.kind !== "string"
    )
      throw new CompatibilityError(
        "TT_TABS",
        "alia returned ambiguous or invalid panel tabs.",
      );
    keys.add(tab.key);
    if (detail.kind !== "terminal") continue;
    if (
      typeof detail.terminalId !== "string" ||
      !detail.terminalId ||
      ids.has(detail.terminalId)
    )
      throw new CompatibilityError(
        "TT_TABS",
        "alia returned ambiguous or invalid terminal identifiers.",
      );
    ids.add(detail.terminalId);
    result.push({ key: tab.key, id: detail.terminalId });
  }
  return result;
}
export function blocked(doc: Document = document): boolean {
  return (
    !!doc.querySelector(
      '[aria-modal="true"]:not([inert]):not([data-state="closed"]), [role="dialog"][data-state="open"]:not([inert])',
    ) || !!doc.activeElement?.closest("[data-app-browser], iframe, webview")
  );
}
