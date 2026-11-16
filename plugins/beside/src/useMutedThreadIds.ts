import { useMemo } from "react";
import { useRpc } from "@vesnalia/plugin-sdk/app";
import type { aliaSidebarRpcContract } from "./server";
import { useLifecycleRows } from "./lifecycleStore";

export function useMutedThreadIds() {
  const rpc = useRpc<typeof aliaSidebarRpcContract>();
  const rows = useLifecycleRows(rpc);
  const mutedIds = useMemo<ReadonlySet<string> | null>(
    () =>
      rows === null
        ? null
        : new Set(
            [...rows.values()]
              .filter((row) => row.mutedAt != null)
              .map((row) => row.threadId),
          ),
    [rows],
  );
  return { mutedIds, rpc };
}
