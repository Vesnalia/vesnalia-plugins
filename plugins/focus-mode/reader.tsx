import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Markdown, useSdk } from "@get-bb/plugin-sdk/app";
import { mergeRows, readerMessages, type RowLike } from "./transcript";

const POLL_MS = 2000;
const STICK_TO_BOTTOM_PX = 160;
const BUSY_STATUSES = new Set(["active", "starting", "pending", "stopping"]);

interface OlderCursor {
  anchorId: string;
  anchorSeq: number;
}

interface TimelinePage {
  rows: readonly unknown[];
  timelinePage?: { olderCursor?: OlderCursor | null } | null;
}

export interface FocusReaderState {
  working: boolean;
}

/**
 * A text-only transcript: the user's prompts as quiet quotes and the
 * assistant's prose, in one narrow reading column. It reads the thread's
 * timeline through the public SDK and polls while open.
 */
export function FocusReader({
  threadId,
  scrollRef,
  onStateChange,
}: {
  threadId: string;
  scrollRef: Ref<HTMLDivElement>;
  onStateChange?: (state: FocusReaderState) => void;
}) {
  const sdk = useSdk();
  const [rows, setRows] = useState<Map<string, RowLike>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [olderCursor, setOlderCursor] = useState<OlderCursor | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorSet = useRef(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const prependAnchor = useRef<number | null>(null);

  const setScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scroller.current = node;
      if (typeof scrollRef === "function") scrollRef(node);
      else if (scrollRef) scrollRef.current = node;
    },
    [scrollRef],
  );

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const [page, thread] = await Promise.all([
          sdk.threads.timeline({
            threadId,
            includeNestedRows: "true",
            signal: controller.signal,
          }) as Promise<TimelinePage>,
          sdk.threads.get({ threadId, signal: controller.signal }),
        ]);
        if (!alive) return;
        setRows((known) => mergeRows(known, page.rows));
        setWorking(BUSY_STATUSES.has((thread as { status?: string }).status ?? ""));
        if (!cursorSet.current) {
          cursorSet.current = true;
          setOlderCursor(page.timelinePage?.olderCursor ?? null);
        }
        setFailed(false);
        setLoaded(true);
      } catch {
        if (!alive) return;
        setFailed(true);
        setLoaded(true);
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [sdk, threadId]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = (await sdk.threads.timeline({
        threadId,
        includeNestedRows: "true",
        beforeAnchorId: olderCursor.anchorId,
        beforeAnchorSeq: String(olderCursor.anchorSeq),
      })) as TimelinePage;
      prependAnchor.current = scroller.current
        ? scroller.current.scrollHeight - scroller.current.scrollTop
        : null;
      setRows((known) => mergeRows(known, page.rows));
      setOlderCursor(page.timelinePage?.olderCursor ?? null);
    } catch {
      // Leave the cursor so the next click retries.
    } finally {
      setLoadingOlder(false);
    }
  }, [sdk, threadId, olderCursor, loadingOlder]);

  const messages = useMemo(() => readerMessages(rows.values()), [rows]);

  useEffect(() => {
    onStateChange?.({ working });
    return () => onStateChange?.({ working: false });
  }, [onStateChange, working]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (prependAnchor.current !== null) {
      node.scrollTop = node.scrollHeight - prependAnchor.current;
      prependAnchor.current = null;
    } else if (pinned.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < STICK_TO_BOTTOM_PX;
  };

  return (
    <div
      ref={setScroller}
      className="bb-focus-mode-scroll"
      tabIndex={0}
      aria-label="Conversation"
      onScroll={onScroll}
      data-testid="bb-focus-mode-transcript"
    >
      <article className="bb-focus-mode-column">
        {olderCursor && (
          <button
            type="button"
            className="bb-focus-mode-earlier"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
          >
            {loadingOlder ? "Loading earlier messages…" : "Show earlier messages"}
          </button>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <blockquote key={message.id} className="bb-focus-mode-message bb-focus-mode-user">
              {message.text}
            </blockquote>
          ) : (
            <div key={message.id} className="bb-focus-mode-message bb-focus-mode-assistant">
              <Markdown content={message.text} className="bb-focus-mode-markdown" />
            </div>
          ),
        )}
        {loaded && messages.length === 0 && (
          <p className="bb-focus-mode-empty">
            {failed ? "Couldn’t load this conversation. Retrying…" : "No messages yet."}
          </p>
        )}
      </article>
    </div>
  );
}
