/**
 * `alia diff-review open` asks VesnALIA's windows to open a review. A window showing the thread the request
 * names opens it on the Reviews page (VesnALIA cannot pick one window, and a window elsewhere is left
 * alone); the command also prints the page's address. Renders nothing.
 */
import { useAliaContext, useAliaNavigate, useRealtime } from "@vesnalia/plugin-sdk/app";
import { useRef } from "react";

import { OPEN_CHANNEL, openRequest, REVIEWS_PATH, reviewSubPath } from "../shared/routes";

export function OpenReviewOverlay() {
  const navigate = useAliaNavigate();
  const context = useAliaContext();
  const threadRef = useRef(context.threadId);
  threadRef.current = context.threadId;
  useRealtime(OPEN_CHANNEL, (payload) => {
    const request = openRequest(payload);
    if (request === null || request.threadId !== threadRef.current) return;
    navigate.toPluginPanel(REVIEWS_PATH, { subPath: reviewSubPath(request) });
  });
  return null;
}
