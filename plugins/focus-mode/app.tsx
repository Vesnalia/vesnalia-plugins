import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbContext,
  type PluginCommandRegistration,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { FocusReader, type FocusReaderState } from "./reader";
import "./app.css";

const OPEN_FOCUS = "bb-plugin-focus-mode:open";

function openFocus(threadId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_FOCUS, { detail: threadId }));
}

export const focusCommand: PluginCommandRegistration = {
  id: "open",
  title: "Focus mode: read current chat",
  isAvailable: ({ threadId }) => threadId !== null,
  run: ({ threadId }) => {
    if (threadId) openFocus(threadId);
  },
};

function FocusButton({ threadId }: PluginThreadHeaderActionProps) {
  return (
    <button
      type="button"
      className="bb-focus-mode-button bb-focus-mode-trigger"
      aria-label="Enter focus mode"
      title="Focus mode"
      onClick={() => openFocus(threadId)}
    >
      <Icon name="Maximize2" className="size-4" aria-hidden />
    </button>
  );
}

function FocusOverlay() {
  const route = useBbContext();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const onReaderState = useCallback((state: FocusReaderState) => setWorking(state.working), []);

  useEffect(() => {
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (typeof event.detail !== "string" || !event.detail.trim()) return;
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setThreadId(event.detail);
    };
    window.addEventListener(OPEN_FOCUS, open);
    return () => window.removeEventListener(OPEN_FOCUS, open);
  }, []);

  useEffect(() => {
    setThreadId((current) => (current === route.threadId ? current : null));
  }, [route.projectId, route.threadId]);

  return (
    <Dialog.Root open={threadId !== null} onOpenChange={() => setThreadId(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="bb-focus-mode-backdrop" />
        <Dialog.Content
          className="bb-focus-mode-reader"
          onOpenAutoFocus={(event) => {
            if (!transcript.current) return;
            event.preventDefault();
            transcript.current.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <Dialog.Title className="bb-focus-mode-sr-only">Focus mode</Dialog.Title>
          <Dialog.Description className="bb-focus-mode-sr-only">
            Read the current conversation as text only, without tool output, the
            composer, or surrounding panels. Press Escape or Exit focus to return to your previous layout.
          </Dialog.Description>
          <div className="bb-focus-mode-toolbar">
            <Dialog.Close className="bb-focus-mode-button bb-focus-mode-exit">
              <Icon name="Minimize2" className="size-3.5" aria-hidden />
              Exit focus
              <kbd aria-hidden>Esc</kbd>
            </Dialog.Close>
            <span
              className="bb-focus-mode-status"
              data-working={working ? "true" : "false"}
              role="status"
              aria-label={working ? "Agent is working" : "Agent is idle"}
              title={working ? "Agent is working" : "Agent is idle"}
            />
          </div>
          {threadId && (
            <FocusReader
              key={threadId}
              threadId={threadId}
              scrollRef={transcript}
              onStateChange={onReaderState}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default definePluginApp((app) => {
  app.commands.register(focusCommand);
  app.slots.experimental_threadHeaderAction({
    id: "focus",
    title: "Focus mode",
    component: FocusButton,
  });
  app.slots.experimental_appOverlay({ id: "reader", component: FocusOverlay });
});
