// The floating "quick new thread" dialog.
//
// Registered as an app overlay (app.slots.experimental_appOverlay), so it is
// mounted once per window, outside any route layout, and stays available on
// every screen — including while you are reading another thread.
//
// Open it with Ctrl/Cmd+N, or the "Quick Thread: new thread" command-palette
// row (which dispatches OPEN_EVENT on window).
//
// Dispatch:
//   Enter / "Create & open"     -> create the thread and navigate to it
//   Ctrl/Cmd+Enter / "Background" -> create the thread, stay where you are,
//                                    show a toast with an Open action
import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbContext,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const OPEN_EVENT = "quick-thread:open";

type DispatchMode = "open" | "background";

function isNewThreadHotkey(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    (event.key === "n" || event.key === "N")
  );
}

export function QuickThreadOverlay() {
  const { projectId } = useBbContext();
  const nav = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DispatchMode>("open");
  const [focusNonce, setFocusNonce] = useState(0);
  const [busy, setBusy] = useState(false);

  const modeRef = useRef<DispatchMode>("open");
  modeRef.current = mode;
  const wrapperRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    setMode("open");
    setOpen(true);
    setFocusNonce((n) => n + 1);
  }, []);

  // Global open: Ctrl/Cmd+N and the command-palette bridge event.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewThreadHotkey(event)) return;
      event.preventDefault();
      setOpen((current) => {
        if (!current) {
          setMode("open");
          setFocusNonce((n) => n + 1);
        }
        return !current;
      });
    };
    const onOpenEvent = () => show();
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, [show]);

  // Ask the embedded composer to submit itself (it owns its own submit button
  // and Enter handling; we drive it by dispatching a plain Enter keydown on
  // its editor so both the button row and the Ctrl+Enter hotkey go through the
  // same host path).
  const submitComposer = useCallback(() => {
    const editor = wrapperRef.current?.querySelector<HTMLElement>(
      '[contenteditable="true"], textarea',
    );
    if (!editor) return;
    editor.focus();
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

  const dispatchWith = useCallback(
    (next: DispatchMode) => {
      modeRef.current = next;
      setMode(next);
      submitComposer();
    },
    [submitComposer],
  );

  const onKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        dispatchWith("background");
      }
    },
    [dispatchWith],
  );

  const handleSubmit = useCallback(
    async (request: unknown) => {
      const chosen = modeRef.current;
      setBusy(true);
      try {
        const { threadId } = await rpc.call("create_thread", {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          request: request as any,
        });
        setOpen(false);
        setMode("open");
        if (chosen === "open") {
          nav.toThread(threadId);
        } else {
          toast.success("Thread started", {
            action: { label: "Open", onClick: () => nav.toThread(threadId) },
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [nav, rpc],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-3xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>New thread</DialogTitle>
        </DialogHeader>

        <div
          ref={wrapperRef}
          onKeyDownCapture={onKeyDownCapture}
          className="flex flex-col gap-3"
        >
          <NewThreadComposer
            defaultProjectId={projectId ?? undefined}
            focusRequest={focusNonce}
            draftKey="quick-thread"
            placeholder="What do you want to start?"
            onSubmit={handleSubmit}
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              <kbd className="font-mono">Enter</kbd> opens the new thread ·{" "}
              <kbd className="font-mono">⌘/Ctrl+Enter</kbd> keeps you here
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => dispatchWith("background")}
              >
                Run in background
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                className={cn(mode === "open" && "ring-1 ring-ring")}
                onClick={() => dispatchWith("open")}
              >
                Create &amp; open
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
