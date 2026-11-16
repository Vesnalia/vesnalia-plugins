import { useEffect } from "react";
import { definePluginApp, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  compatibilityReport,
  CompatibilityError,
  OperationError,
} from "./src/compatibility";
import {
  browserRuntime,
  createShortcutHandler,
  Toggle,
  type CreateTerminal,
} from "./src/toggle";

export default definePluginApp((app) => {
  if (
    typeof app.commands?.register !== "function" ||
    typeof app.contentScripts?.register !== "function" ||
    typeof app.slots?.experimental_appOverlay !== "function"
  )
    throw new CompatibilityError(
      "TT_SDK",
      "Required Plugin SDK registration APIs are unavailable.",
    );
  let create: CreateTerminal | null = null;
  let toggle: Toggle | null = null;
  const report = compatibilityReport((message) => toast.error(message));
  function Services() {
    const sdk = useSdk();
    useEffect(() => {
      const operation: CreateTerminal = (threadId) => {
        if (typeof sdk.terminals?.create !== "function")
          throw new CompatibilityError(
            "TT_SDK",
            "The native terminal creation API is unavailable.",
          );
        return sdk.terminals.create({
          scope: { kind: "thread", threadId },
          cols: 100,
          rows: 30,
        });
      };
      create = operation;
      return () => {
        if (create === operation) create = null;
      };
    }, [sdk]);
    return null;
  }
  app.slots.experimental_appOverlay({ id: "services", component: Services });
  app.commands.register({
    id: "toggle",
    title: "Toggle terminal",
    defaultShortcut: { key: "`", control: true },
    isAvailable: (context) => toggle?.available(context) ?? false,
    run: async (context) => {
      try {
        await toggle?.run(context);
      } catch (cause) {
        if (cause instanceof CompatibilityError) toggle?.invalidate();
        report(cause, true);
      }
    },
  });
  app.contentScripts.register({
    id: "focus",
    mount({ signal }) {
      const runtime = browserRuntime(async (threadId) => {
        if (!create)
          throw new OperationError(
            "Terminal Toggle is still loading. Try again in a moment.",
          );
        return create(threadId);
      });
      const instance = new Toggle(runtime);
      toggle = instance;
      const observe = (event?: FocusEvent) => {
        if (event && !event.isTrusted) return;
        try {
          instance.observe();
        } catch (cause) {
          instance.invalidate();
          report(cause);
        }
      };
      const onFocus = (event: FocusEvent) => {
        observe(event);
        // Capture may precede React's pane focus update. Resolve again after
        // it commits, without retaining a stale element or inventing history.
        const target = event.target;
        queueMicrotask(() => {
          if (!signal.aborted && document.activeElement === target) observe();
        });
      };
      const keydown = createShortcutHandler(undefined, undefined, (cause) => {
        instance.invalidate();
        report(cause);
      });
      document.addEventListener("focusin", onFocus, true);
      window.addEventListener("keydown", keydown, true);
      observe();
      return () => {
        document.removeEventListener("focusin", onFocus, true);
        window.removeEventListener("keydown", keydown, true);
        instance.dispose();
        if (toggle === instance) toggle = null;
      };
    },
  });
});
