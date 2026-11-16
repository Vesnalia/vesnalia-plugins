import { useEffect, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useComposer,
  useRpc,
  useSdk,
} from "@vesnalia/plugin-sdk/app";
import type { PluginComposerApi } from "@vesnalia/plugin-sdk";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { findLocalMac } from "./find-local-mac";
import type { rpcContract } from "./contract";

interface CaptureJob {
  id: string;
  composer: PluginComposerApi;
  controller: AbortController;
  started: boolean;
  cancelRemote?: () => void;
}
let job: CaptureJob | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => job;
function setJob(value: CaptureJob | null) {
  job = value;
  listeners.forEach((listener) => listener());
}
function cancelCapture() {
  job?.controller.abort();
  job?.cancelRemote?.();
  setJob(null);
}
function startCapture(composer: PluginComposerApi) {
  if (job) {
    toast.info(
      "A screenshot is already in progress. Select an area or press Escape.",
    );
    return;
  }
  setJob({
    id: crypto.randomUUID(),
    composer,
    controller: new AbortController(),
    started: false,
  });
}
function ScreenshotAction() {
  const composer = useComposer();
  const current = useSyncExternalStore(subscribe, snapshot);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-foreground"
      aria-label={current ? "Cancel screenshot" : "Take screenshot"}
      disabled={composer.isSubmitting}
      onClick={() => (current ? cancelCapture() : startCapture(composer))}
    >
      <Icon
        name={current ? "screenshot/cancel" : "screenshot/camera"}
        className="size-4"
      />
    </Button>
  );
}
function ScreenshotController() {
  const current = useSyncExternalStore(subscribe, snapshot);
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  useEffect(() => {
    if (!current || current.started) return;
    current.started = true;
    const request = current;
    const signal = request.controller.signal;
    const notice = toast.loading("Connecting to this Mac…");
    const dismissNotice = () => toast.dismiss(notice);
    signal.addEventListener("abort", dismissNotice, { once: true });
    async function capture() {
      try {
        const scope = request.composer.scope;
        const projectId =
          scope.kind === "new-thread"
            ? scope.projectId
            : (await sdk.threads.get({ threadId: scope.threadId })).projectId;
        signal.throwIfAborted();
        if (!projectId)
          throw new Error("Select a project before taking a screenshot.");
        const hostId = await findLocalMac(
          await rpc.call("localBridges"),
          signal,
        );
        signal.throwIfAborted();
        request.cancelRemote = () => {
          void rpc.call("cancel", { captureId: request.id }).catch(() => {});
        };
        toast.loading("Select an area on this Mac. Escape cancels.", {
          id: notice,
        });
        const result = await rpc.call("capture", {
          captureId: request.id,
          hostId,
          projectId,
        });
        if (
          signal.aborted ||
          snapshot()?.id !== request.id ||
          result.status === "cancelled"
        )
          return;
        request.composer.replace((draft) => ({
          ...draft,
          attachments: [
            ...draft.attachments,
            {
              type: "localImage",
              path: result.path,
              name: result.name,
              mimeType: "image/png",
              sizeBytes: result.sizeBytes,
              sourceProjectId: projectId,
            },
          ],
        }));
        request.composer.focus();
        toast.success("Screenshot attached");
      } catch (cause) {
        if (!signal.aborted)
          toast.error(
            cause instanceof Error
              ? cause.message
              : "Could not take a screenshot. Try again.",
          );
      } finally {
        signal.removeEventListener("abort", dismissNotice);
        dismissNotice();
        if (snapshot()?.id === request.id) setJob(null);
      }
    }
    void capture();
  }, [current?.id]);
  useEffect(() => () => cancelCapture(), []);
  return null;
}
export default definePluginApp((app) => {
  app.composer.customize({
    id: "screenshot",
    actions: [{ id: "capture", component: ScreenshotAction }],
    plusMenu: [
      {
        id: "capture",
        label: "Take screenshot",
        icon: "screenshot/camera",
        run: ({ composer }) => startCapture(composer),
      },
    ],
  });
  app.slots.experimental_appOverlay({
    id: "screenshot-controller",
    component: ScreenshotController,
  });
  app.contentScripts.register({
    id: "capture-cleanup",
    mount: () => cancelCapture,
  });
});
