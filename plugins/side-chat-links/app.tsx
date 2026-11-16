// Side chat links — frontend.
//
// Shows a link under each message that has side chats forked from it. The
// link opens a panel tab for that message's group of side chats, with one
// inner tab per side chat.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_useAppPanel,
  experimental_useRpcQuery,
  Markdown,
  ThreadChat,
  useAliaNavigate,
  useRpc,
  useSdk,
  type AliaNavigate,
  type ExperimentalMessageMetadataProps,
  type ExperimentalPanelController,
  type ExperimentalThreadActionTabProps,
  type ThreadChatMessageAction,
} from "@vesnalia/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  rpcContract,
  SIDE_CHAT_TITLE_MAX_LENGTH,
  type SideChat,
} from "./shared/contract";
import {
  defaultSideChatLabel,
  groupTitle,
  linkDescription,
  sideChatLabel,
} from "./shared/label";
import { groupByMessage, resolveSelected } from "./shared/selection";

const PLUGIN_ID = "side-chat-links";
const TAB_ID = "side-chat";
/**
 * This plugin's own icon (icons/thread.svg, declared in package.json). The
 * bundled Side chat plugin's icon means "start a side chat"; this one marks
 * side chats that exist.
 */
const THREAD_ICON = "side-chat-links/thread";
const TAB_REFERENCE = {
  id: TAB_ID,
  context: { kind: "thread" },
  availability: "action",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What a panel tab of this plugin shows, read from the params it was opened
 * with:
 *
 * - `group`: the side chats of one message (null for those whose message is
 *   not known);
 * - `overview`: every group of the thread, for the tab opened from the
 *   panel's + menu, which has no params.
 */
type TabView =
  | { kind: "group"; messageId: string | null }
  | { kind: "overview" };

function groupParams(messageId: string | null) {
  return { messageId };
}

function parseTabView(params: unknown): TabView {
  if (!isRecord(params) || !("messageId" in params)) return { kind: "overview" };
  const { messageId } = params;
  return {
    kind: "group",
    messageId: typeof messageId === "string" ? messageId : null,
  };
}

/**
 * The side chat a panel tab shows on its own: the bundled Side chat plugin's
 * tab, or a tab an earlier version of this plugin opened. Null for any other
 * tab.
 */
export function singleSideChatTabThreadId(params: unknown): string | null {
  if (!isRecord(params)) return null;
  const { threadId, sourceThreadId } = params;
  return typeof threadId === "string" &&
    threadId.length > 0 &&
    typeof sourceThreadId === "string" &&
    sourceThreadId.length > 0
    ? threadId
    : null;
}

// Which side chat each group's tab shows. It is kept in localStorage so a
// reload shows the same side chat, and outside React so a tab an earlier
// version opened can hand its side chat over.
const SELECTION_STORAGE_PREFIX = "side-chat-links:selected:";
const selections = new Map<string, string>();
const selectionListeners = new Set<() => void>();

function groupKey(sourceThreadId: string, messageId: string | null): string {
  return `${sourceThreadId}:${messageId ?? ""}`;
}

function readSelection(key: string): string | null {
  const selected = selections.get(key);
  if (selected !== undefined) return selected;
  try {
    return localStorage.getItem(`${SELECTION_STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}

function writeSelection(key: string, sideChatThreadId: string) {
  selections.set(key, sideChatThreadId);
  try {
    localStorage.setItem(`${SELECTION_STORAGE_PREFIX}${key}`, sideChatThreadId);
  } catch {
    // Storage can be unavailable; the choice then lasts until a reload.
  }
  for (const listener of selectionListeners) listener();
}

function subscribeSelection(listener: () => void): () => void {
  selectionListeners.add(listener);
  return () => selectionListeners.delete(listener);
}

function useSelection(key: string): string | null {
  return useSyncExternalStore(subscribeSelection, () => readSelection(key));
}

/**
 * Open the panel tab of one message's group of side chats. Tabs that show
 * one of the group's side chats on its own are closed first, so the same chat
 * is not open twice; the bundled plugin opens such a tab for every new side
 * chat.
 */
export function openSideChatGroup(args: {
  panel: ExperimentalPanelController;
  navigate: AliaNavigate;
  sourceThreadId: string;
  messageId: string | null;
  group: readonly SideChat[];
}): void {
  const { panel, navigate, sourceThreadId, messageId, group } = args;
  const inGroup = new Set(group.map((sideChat) => sideChat.threadId));
  for (const tab of panel.getTabs().tabs) {
    if (tab.detail.kind !== "plugin") continue;
    const shown = singleSideChatTabThreadId(tab.detail.params);
    if (shown !== null && inGroup.has(shown)) panel.closeTab(tab.key);
  }
  const opened = panel.openTab({
    tab: TAB_REFERENCE,
    title: groupTitle(group),
    params: groupParams(messageId),
  });
  if (opened) return;
  // A surface without a side panel: open the side chat as a thread instead.
  const fallback = resolveSelected(
    group,
    readSelection(groupKey(sourceThreadId, messageId)),
  );
  if (fallback !== null) navigate.toThread(fallback.threadId);
}

/** Marks this plugin's links so the stylesheet below can find them. */
const LINKS_ATTRIBUTE = "data-side-chat-links";

/**
 * VesnALIA draws the row under a message (copy, fork, time) only while the pointer
 * is over the message, and puts plugin content after the buttons. A link that
 * says "this response has side chats" has to be visible all the time, so for
 * a row that holds one of our links this stylesheet:
 *
 * 1. dissolves VesnALIA's fading wrapper, which makes the links and VesnALIA's own
 *    metadata separate items of the row;
 * 2. moves the links to the start of the row, where they do not leave a gap
 *    for the hidden buttons;
 * 3. gives VesnALIA's own metadata (the time) its hover fade back.
 *
 * It relies on VesnALIA's markup: `data-message-action-metadata` on the wrapper and
 * `data-message-column` on the message. If a VesnALIA release changes those, the
 * links are still drawn, but only on hover, like the rest of the row.
 */
const LINKS_STYLESHEET = (() => {
  const wrapper = `[data-message-action-metadata]:has([${LINKS_ATTRIBUTE}])`;
  const others = `${wrapper} > :not(:has([${LINKS_ATTRIBUTE}])) > *`;
  const message = "[data-message-column]";
  return `
${wrapper} { display: contents !important; }
${wrapper} > :has([${LINKS_ATTRIBUTE}]), [${LINKS_ATTRIBUTE}] { order: -1; }
${others} { opacity: 0; transition: opacity 150ms; }
${message}:hover ${others}, ${message}:focus-within ${others} { opacity: 1; }
@media (hover: none) { ${others} { opacity: 1; } }
`;
})();

/**
 * In VesnALIA's macOS desktop window the panel's tab strip sits in the title bar,
 * where VesnALIA sizes every button to the title bar's control height
 * (`MACOS_TITLE_BAR_CONTROL_SIZE_CLASS` in VesnALIA's lib/alia-desktop.ts). That
 * also stretches the small close button inside each tab, so its hover
 * highlight is a tall block instead of a square. This puts the close button
 * back to the size VesnALIA gives it everywhere else. It applies to every panel
 * tab, not only this plugin's: the tabs carry nothing that tells them apart.
 * Touch screens keep VesnALIA's own larger close target.
 */
const TAB_CLOSE_STYLESHEET = `
@media (hover: hover) and (pointer: fine) {
  [data-tab-pill] > [data-tab-pill-close] { height: 1rem !important; }
}
`;

/** The thread's side chats, oldest first; null until they have loaded. */
function useLoadedSideChats(threadId: string): readonly SideChat[] | null {
  const input = useMemo(() => ({ threadId }), [threadId]);
  const { data } = experimental_useRpcQuery({
    contract: rpcContract,
    method: "listSideChats",
    input,
  });
  return data?.sideChats ?? null;
}

const NO_SIDE_CHATS: readonly SideChat[] = [];

function useSideChats(threadId: string): readonly SideChat[] {
  return useLoadedSideChats(threadId) ?? NO_SIDE_CHATS;
}

/** The link drawn under a message that has side chats. */
function SideChatLink({ message }: ExperimentalMessageMetadataProps) {
  const sideChats = useSideChats(message.threadId);
  const panel = experimental_useAppPanel();
  const navigate = useAliaNavigate();
  const group = sideChats.filter(
    (sideChat) => sideChat.messageId === message.id,
  );
  if (group.length === 0) return null;
  const description = linkDescription(
    group.map((sideChat) => sideChatLabel(sideChats, sideChat.threadId)),
  );
  return (
    <span
      className="ml-1 inline-flex items-center"
      {...{ [LINKS_ATTRIBUTE]: "" }}
    >
      <button
        type="button"
        className="inline-flex h-[18px] items-center gap-1 rounded-md border border-border px-1 text-xs leading-4 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={description}
        title={description}
        onClick={() =>
          openSideChatGroup({
            panel,
            navigate,
            sourceThreadId: message.threadId,
            messageId: message.id,
            group,
          })
        }
      >
        <Icon name={THREAD_ICON} className="size-3 shrink-0" />
        {group.length > 1 ? <span>{group.length}</span> : null}
      </button>
    </span>
  );
}

function ReplyingTo({ anchorText }: { anchorText: string }) {
  const trimmed = anchorText.trim();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) {
      setOverflows(node.scrollHeight > node.clientHeight + 1);
    }
  }, []);
  if (trimmed.length === 0) return null;
  return (
    <div className="mx-1 mb-2 flex flex-col items-start gap-1">
      <span className="text-xs leading-none text-muted-foreground">
        <Icon
          name="CornerDownRight"
          className="mr-1 inline-block size-3 align-middle"
        />
        Replying to
      </span>
      <div
        className={`max-w-full rounded-md bg-surface-recessed p-1.5 text-xs leading-5 text-foreground ${
          overflows ? "cursor-pointer" : ""
        }`}
        role={overflows ? "button" : undefined}
        title={
          overflows ? (expanded ? "Collapse" : "Show full message") : undefined
        }
        onClick={overflows ? () => setExpanded((value) => !value) : undefined}
      >
        <div
          ref={measureRef}
          className={
            expanded
              ? "break-words"
              : "max-h-20 overflow-hidden break-words " +
                (overflows
                  ? "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]"
                  : "")
          }
        >
          <Markdown
            content={trimmed}
            className="text-xs leading-5 [&_blockquote]:my-1 [&_h1]:mb-1 [&_h1]:mt-0 [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:mt-0 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-0 [&_h3]:text-xs [&_li]:mb-0 [&_ol]:mb-1 [&_p]:mb-1 [&_ul]:mb-1"
          />
        </div>
      </div>
    </div>
  );
}

/** The input that replaces an inner tab while its side chat is renamed. */
function RenameInput(props: {
  sideChat: SideChat;
  placeholder: string;
  onDone: () => void;
}) {
  const { sideChat, placeholder, onDone } = props;
  const rpc = useRpc<typeof rpcContract>();
  const [draft, setDraft] = useState(sideChat.title ?? "");
  const [saving, setSaving] = useState(false);
  // Escape removes the input, and a removed input can still report a blur.
  const cancelled = useRef(false);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (saving) return;
    const title = draft.trim();
    if (title === (sideChat.title ?? "")) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await rpc.call("renameSideChat", { threadId: sideChat.threadId, title });
      onDone();
    } catch (error) {
      toast.error(
        `Failed to rename side chat: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      setSaving(false);
    }
  }

  return (
    <form className="shrink-0" onSubmit={(event) => void save(event)}>
      <input
        autoFocus
        aria-label="Side chat name"
        className="h-6 w-40 rounded-md border border-border bg-transparent px-2 text-xs text-foreground outline-none focus:border-ring"
        value={draft}
        maxLength={SIDE_CHAT_TITLE_MAX_LENGTH}
        placeholder={placeholder}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => {
          if (!cancelled.current) void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            onDone();
          }
        }}
      />
    </form>
  );
}

/** The row of inner tabs, one per side chat of the group. */
function SideChatTabStrip(props: {
  sideChats: readonly SideChat[];
  selectedThreadId: string;
  onSelect: (threadId: string) => void;
}) {
  const { sideChats, selectedThreadId, onSelect } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div
      role="tablist"
      aria-label="Side chats"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1"
    >
      {sideChats.map((sideChat) => {
        const selected = sideChat.threadId === selectedThreadId;
        if (renaming === sideChat.threadId) {
          return (
            <RenameInput
              key={sideChat.threadId}
              sideChat={sideChat}
              placeholder={defaultSideChatLabel(sideChats, sideChat.threadId)}
              onDone={() => setRenaming(null)}
            />
          );
        }
        return (
          <div
            key={sideChat.threadId}
            className={`inline-flex h-6 shrink-0 items-center rounded-md text-xs ${
              selected
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              className={`h-6 max-w-40 truncate pl-2 ${selected ? "pr-1" : "pr-2"}`}
              title={sideChat.anchorText.trim().slice(0, 200) || undefined}
              onClick={() => onSelect(sideChat.threadId)}
              onDoubleClick={() => setRenaming(sideChat.threadId)}
            >
              {sideChatLabel(sideChats, sideChat.threadId)}
            </button>
            {selected ? (
              <button
                type="button"
                className="mr-0.5 inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                aria-label="Rename side chat"
                title="Rename side chat"
                onClick={() => setRenaming(sideChat.threadId)}
              >
                <Icon name="Edit" className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** One side chat, drawn as the bundled Side chat plugin draws it. */
function SideChatView(props: { sourceThreadId: string; sideChat: SideChat }) {
  const sdk = useSdk();
  const { sourceThreadId, sideChat } = props;
  const threadId = sideChat.threadId;
  const messageActions = useMemo<ThreadChatMessageAction[]>(
    () => [
      {
        id: "send-to-main",
        title: "Send to main thread",
        icon: "ArrowTurnBackward",
        roles: ["assistant"],
        async run(message) {
          const text = message.text.trim();
          if (text.length === 0) return;
          try {
            await sdk.threads.send({
              threadId: sourceThreadId,
              mode: "queue-if-active",
              input: [{ type: "text", text, mentions: [] }],
              senderThreadId: threadId,
            });
            toast.success("Sent to main thread");
          } catch (error) {
            toast.error(
              `Failed to send to main thread: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },
      },
    ],
    [sdk, sourceThreadId, threadId],
  );
  return (
    <ThreadChat
      threadId={threadId}
      variant="compact"
      layout="contained"
      permissionPolicy="editable"
      className="min-h-0 flex-1"
      leadingContent={<ReplyingTo anchorText={sideChat.anchorText} />}
      messageActions={messageActions}
    />
  );
}

/** One message's side chats, an inner tab each. */
function SideChatGroup(props: {
  sourceThreadId: string;
  messageId: string | null;
  group: readonly SideChat[];
}) {
  const { sourceThreadId, messageId, group } = props;
  const key = groupKey(sourceThreadId, messageId);
  const selected = resolveSelected(group, useSelection(key));
  if (selected === null) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        This message has no side chats now. They may have been archived or
        deleted.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SideChatTabStrip
        sideChats={group}
        selectedThreadId={selected.threadId}
        onSelect={(sideChatThreadId) => writeSelection(key, sideChatThreadId)}
      />
      <SideChatView
        key={selected.threadId}
        sourceThreadId={sourceThreadId}
        sideChat={selected}
      />
    </div>
  );
}

/** Every group of the thread, shown by the tab opened from the + menu. */
function SideChatOverview({ threadId }: { threadId: string }) {
  const sideChats = useSideChats(threadId);
  const panel = experimental_useAppPanel();
  const navigate = useAliaNavigate();
  const groups = groupByMessage(sideChats);
  if (groups.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        This thread has no side chats yet. Use Reply in side chat on a message
        to start one.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1 p-2">
      {groups.map((group) => (
        <li key={group.messageId ?? ""}>
          <button
            type="button"
            className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() =>
              openSideChatGroup({
                panel,
                navigate,
                sourceThreadId: threadId,
                messageId: group.messageId,
                group: group.sideChats,
              })
            }
          >
            <span className="text-foreground">
              {groupTitle(group.sideChats)}
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {group.sideChats
                .map((sideChat) => sideChatLabel(sideChats, sideChat.threadId))
                .join(", ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A panel tab of this plugin: one group, or the overview of all groups. */
function SideChatsTab({ threadId, params }: ExperimentalThreadActionTabProps) {
  const loaded = useLoadedSideChats(threadId);
  const sideChats = loaded ?? NO_SIDE_CHATS;
  // A tab an earlier version of this plugin opened names one side chat: show
  // that side chat's group, with it selected.
  const legacyThreadId = singleSideChatTabThreadId(params);
  const legacy = sideChats.find(
    (sideChat) => sideChat.threadId === legacyThreadId,
  );
  const legacyMessageId = legacy?.messageId ?? null;
  useEffect(() => {
    if (legacyThreadId !== null && legacy !== undefined) {
      writeSelection(groupKey(threadId, legacyMessageId), legacyThreadId);
    }
  }, [legacy, legacyMessageId, legacyThreadId, threadId]);
  const view: TabView =
    legacy !== undefined
      ? { kind: "group", messageId: legacyMessageId }
      : parseTabView(params);
  // Nothing is drawn while loading, so "no side chats" never flashes.
  if (loaded === null) return null;
  if (view.kind === "overview") return <SideChatOverview threadId={threadId} />;
  return (
    <SideChatGroup
      sourceThreadId={threadId}
      messageId={view.messageId}
      group={sideChats.filter(
        (sideChat) => sideChat.messageId === view.messageId,
      )}
    />
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "stylesheet",
    mount() {
      const style = document.createElement("style");
      style.setAttribute("data-alia-plugin", PLUGIN_ID);
      style.textContent = LINKS_STYLESHEET + TAB_CLOSE_STYLESHEET;
      document.head.append(style);
      return () => style.remove();
    },
  });
  app.slots.experimental_messageMetadata({
    id: "side-chat-links",
    placement: "actionRow",
    component: SideChatLink,
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: TAB_ID,
    title: "Side chats",
    icon: THREAD_ICON,
    component: SideChatsTab,
    layout: "flush",
  });
});
