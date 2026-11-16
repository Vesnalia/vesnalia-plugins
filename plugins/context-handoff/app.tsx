// A per-thread switch and context meter, directly above the chat input.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useAliaNavigate, useComposer, useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import type { HandoffView, rpcContract } from "./server";

const POLL_MS = 5_000;
const STATE_CHANGED = "state-changed";
/** Percentage boundaries within the provider-reported window. */
const YELLOW_AT = 20;
const ORANGE_AT = 30;
const RED_AT = 40;
const DARK_RED_AT = 65;
const BLUE = "var(--primary, #3b82f6)";
const YELLOW = "#faf76b";
const ORANGE = "#ff9245";

function meterColor(used: number): string {
  return used >= DARK_RED_AT ? "#991b1b" : used >= RED_AT ? "#ef4444" : used >= ORANGE_AT ? ORANGE : used >= YELLOW_AT ? YELLOW : BLUE;
}

function isView(value: unknown): value is HandoffView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.threadId === "string" && typeof v.autoHandoff === "boolean" &&
    typeof v.enabled === "boolean" && typeof v.eligible === "boolean" &&
    ["watching", "preparing", "handed-off"].includes(v.stage as string) &&
    (v.limit === null || (typeof v.limit === "number" && Number.isFinite(v.limit) && v.limit > 0)) &&
    (v.contextWindow === null || (typeof v.contextWindow === "number" && Number.isFinite(v.contextWindow) && v.contextWindow > 0)) &&
    typeof v.part === "number" && Number.isInteger(v.part) && v.part > 0 &&
    (v.nextThreadId === null || typeof v.nextThreadId === "string") &&
    (v.next === null || ["starting", "confirmed", "failed", "stalled"].includes(v.next as string)) &&
    typeof v.creating === "boolean" && typeof v.stuck === "boolean" && typeof v.requested === "boolean" &&
    (v.usedTokens === null || (typeof v.usedTokens === "number" && Number.isFinite(v.usedTokens) && v.usedTokens >= 0));
}

function formatTokens(value: number): string {
  return `${Math.round(value / 1_000)}k`;
}

function HandoffBanner() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useAliaNavigate();
  const scope = composer.scope;
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const currentThread = useRef(threadId);
  currentThread.current = threadId;
  const revision = useRef(0);
  const [state, setState] = useState<HandoffView | null>(null);
  const [stale, setStale] = useState(false);
  const [busyThread, setBusyThread] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accept = useCallback((next: unknown) => {
    if (!isView(next) || next.threadId !== currentThread.current) return;
    revision.current++;
    setState(next);
    setStale(false);
  }, []);

  const refresh = useCallback(() => {
    const id = currentThread.current;
    if (id === null) return;
    const request = ++revision.current;
    rpc.call("state", { threadId: id }).then(next => {
      if (id === currentThread.current && request === revision.current) accept(next);
    }, () => {
      if (id === currentThread.current && request === revision.current) setStale(true);
    });
  }, [rpc, accept]);

  useEffect(() => {
    revision.current++;
    setState(null);
    setNotice(null);
    setStale(false);
    if (threadId === null) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => { clearInterval(timer); revision.current++; };
  }, [threadId, refresh]);
  useRealtime(STATE_CHANGED, accept);

  const toggle = async () => {
    if (!state || state.threadId !== threadId || busyThread === threadId) return;
    const id = state.threadId;
    setBusyThread(id);
    setNotice(null);
    revision.current++;
    try {
      const reply = await rpc.call("set_enabled", { threadId: id, enabled: !state.autoHandoff });
      if (currentThread.current !== id) return;
      accept(reply.view);
      if (!reply.ok) setNotice(reply.result);
    } catch (error) {
      if (currentThread.current === id) setNotice(error instanceof Error ? error.message : "Could not save the switch.");
    } finally {
      setBusyThread(previous => previous === id ? null : previous);
      if (currentThread.current === id) refresh();
    }
  };

  if (threadId === null) return null;
  if (!state || state.threadId !== threadId) {
    return stale ? <div role="status" className="px-1.5 text-xs text-muted-foreground">Context meter unavailable. Retrying…</div> : null;
  }
  if (!state.eligible) return null;
  if (state.stage === "handed-off" && state.nextThreadId !== null) {
    const nextId = state.nextThreadId;
    const nextPart = state.part + 1;
    const open = <button type="button" className="text-foreground hover:underline" onClick={() => navigate.toThread(nextId)}>Open part {nextPart}</button>;
    if (state.next === "failed" || state.next === "stalled") {
      return <div role="alert" className="flex flex-wrap items-center gap-x-2 px-1.5 text-xs" style={{ color: "var(--warning-text, #d97706)" }}>
        <span>{state.next === "failed" ? `Part ${nextPart} failed to start.` : `Part ${nextPart} stopped before confirming your notes.`}</span>
        {open}
        <span className="text-muted-foreground">{state.next === "failed" ? "to retry it there" : "to see why"}, or archive it to cancel the handoff.</span>
      </div>;
    }
    if (state.next === "starting") {
      return <div role="status" className="flex flex-wrap items-center gap-x-2 px-1.5 text-xs text-muted-foreground">
        <span>Part {nextPart} is starting; waiting for it to confirm your notes.</span>
        {open}
      </div>;
    }
    return <div className="flex items-center gap-2 px-1.5 text-xs text-muted-foreground">
      <span>Context handed off.</span>
      {open}
    </div>;
  }

  const used = state.usedTokens;
  const window = state.contextWindow;
  const percent = used === null || window === null ? null : used / window * 100;
  const fraction = percent === null ? 0 : Math.min(1, percent / 100);
  const color = percent === null ? BLUE : meterColor(percent);
  const active = state.enabled && state.autoHandoff;
  // Automatic handoff is at 30% of the provider-reported context window.
  const autoAt = active && !state.requested;
  const target = autoAt ? 0.3 : null;
  const explanation = !state.enabled ? "Automatic handoff is disabled in plugin settings." : active
    ? state.requested
      ? "Handing off: the agent finishes its current step, saves notes and continues in a fresh thread."
      : "Hands off at 30% after the current turn and important work finish."
    : "Turn on below 20% to hand off at 30%. At or above 20%, request a handoff after the current turn and important work finish.";

  return <div className="text-xs text-muted-foreground">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 tabular-nums" title={explanation}>
      <div className="flex items-center gap-2">
        <span>Context</span>
        {percent !== null ? <div role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} aria-valuetext={`${percent.toFixed(1)}% of the context window${autoAt ? "; hands off at 30%" : ""}`} style={{ position: "relative", width: 88, height: 5, borderRadius: 999, overflow: "hidden", background: "var(--border, #454545)" }}>
          <div data-meter-fill="" style={{ width: `${fraction * 100}%`, height: "100%", borderRadius: 999, background: color, transition: "width 300ms ease, background-color 300ms ease" }} />
          {target !== null ? <div data-meter-target="" aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: `${target * 100}%`, width: 1, background: "var(--muted-foreground, #999)" }} /> : null}
        </div> : null}
        <span>{percent === null ? (used === null ? "Usage unavailable" : "Context window unavailable") : `${percent.toFixed(1)}%`}{stale ? " · updating…" : ""}</span>
      </div>
      <span className="flex-1" />
      <button type="button" role="switch" aria-label="Automatic context handoff" aria-checked={state.autoHandoff} disabled={busyThread === threadId || !state.enabled} onClick={() => void toggle()} className="inline-flex items-center gap-2 rounded py-1 disabled:opacity-50" title={explanation}>
        <span>Auto handoff</span>
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", width: 30, height: 18, padding: 2, boxSizing: "border-box", borderRadius: 999, background: active ? "var(--primary, #3b82f6)" : "var(--border, #555)" }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", transform: active ? "translateX(12px)" : "translateX(0)", transition: "transform 150ms ease" }} />
        </span>
        <span>{state.autoHandoff ? "On" : "Off"}</span>
      </button>
    </div>
    {state.stage === "preparing" && state.creating ? <div role="status" className="px-1.5">Starting part {state.part + 1}…</div>
      : state.stage === "preparing" && state.stuck ? <div role="status" className="px-1.5">Starting part {state.part + 1} didn't finish. Ask the agent to run <code>alia context-handoff ready</code> again, or turn Auto handoff off to continue here.</div>
      : state.stage === "preparing" && active ? <div role="status" className="px-1.5">Preparing handoff at a safe stopping point…</div>
      : state.requested && active ? <div role="status" className="px-1.5">Handing off at the next safe stopping point…</div> : null}
    {!state.enabled ? <div role="status" className="px-1.5">Automatic handoff is paused in plugin settings.</div> : null}
    {notice ? <div role="alert" className="px-1.5 text-destructive">{notice}</div> : null}
  </div>;
}

export default definePluginApp(app => {
  app.composer.customize({
    id: "context-handoff",
    scopes: ["thread"],
    banners: [{ id: "context-handoff-banner", chrome: "bare", component: HandoffBanner }],
  });
});
