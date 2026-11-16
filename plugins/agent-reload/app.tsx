import { useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "./lib/portal-scope";
import type { rpcContract } from "./server";

function AgentReloadButton({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const portalScopeProps = usePortalScopeProps();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSupported(false);
    rpcRef.current
      .call("reload_supported", { threadId })
      .then((result) => {
        if (!cancelled) setSupported(result.supported);
      })
      .catch((error: unknown) => {
        console.warn("Agent Reload support check failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (!supported) return null;

  async function reload() {
    setBusy(true);
    try {
      const result = await rpc.call("reload", { threadId });
      if (result.ok) {
        toast.success("Agent session will restart before the next message");
      } else {
        toast.error(`Agent reload refused: ${result.message}`);
      }
    } catch (error) {
      toast.error(
        `Agent reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const label = "Reload agent session";
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-busy={busy}
            disabled={busy}
            onClick={reload}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Icon name="RotateCcw" className="size-4" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            {...portalScopeProps}
            side="bottom"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            {label} before the next message
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "agent-reload",
    title: "Agent Reload",
    component: AgentReloadButton,
  });
});
