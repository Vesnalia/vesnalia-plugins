import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { CustomShader, GlassConfig } from "./config";

export function useGlassConfig() {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [config, setConfig] = useState<GlassConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const version = useRef(0);
  const busy = useRef(false);
  const refreshRequested = useRef(false);
  const pending = useRef<Partial<GlassConfig>>({});
  const hasPending = () => Object.keys(pending.current).length > 0;

  const refetch = useCallback(async () => {
    if (busy.current || hasPending()) { refreshRequested.current = true; return; }
    refreshRequested.current = false;
    const revision = ++version.current;
    try {
      const next = await rpcRef.current.call("getConfig");
      if (mounted.current && revision === version.current) { setConfig(next); setError(null); }
    } catch {
      if (mounted.current && revision === version.current) setError("Couldn’t load settings. Check your connection and try again.");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refetch();
    return () => { mounted.current = false; ++version.current; };
  }, [refetch]);
  useRealtime("glass", () => { void refetch(); });

  // Coalesce edits during a request and merge its response beneath newer edits.
  // Drain queued changes even if the user navigates away from this panel.
  const flush = useCallback(async () => {
    if (busy.current || !hasPending()) return;
    busy.current = true;
    if (mounted.current) { setSaving(true); setError(null); }
    try {
      while (hasPending()) {
        const patch = pending.current;
        pending.current = {};
        try {
          const next = await rpcRef.current.call("setConfig", patch);
          if (mounted.current) setConfig({ ...next, ...pending.current });
        } catch {
          pending.current = { ...patch, ...pending.current };
          if (mounted.current) setError("Changes haven’t been saved. Check your connection, then retry.");
          break;
        }
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setSaving(false);
        if (refreshRequested.current && !hasPending()) void refetch();
      }
    }
  }, [refetch]);
  const update = useCallback((patch: Partial<GlassConfig>) => {
    ++version.current;
    pending.current = { ...pending.current, ...patch };
    setConfig((current) => current && { ...current, ...patch });
    void flush();
  }, [flush]);
  const reset = useCallback(async () => {
    if (busy.current || hasPending()) return false;
    busy.current = true;
    ++version.current;
    setSaving(true);
    setError(null);
    try {
      const next = await rpcRef.current.call("resetConfig");
      if (mounted.current) setConfig({ ...next, ...pending.current });
      return true;
    } catch {
      if (mounted.current) setError("Couldn’t reset settings. Your saved settings are unchanged. Try again.");
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
      if (hasPending()) void flush();
      else if (mounted.current && refreshRequested.current) void refetch();
    }
  }, [flush, refetch]);
  const libraryAction = useCallback(async (method: "saveShader" | "deleteShader", shader: CustomShader | string) => {
    if (busy.current || hasPending()) return false;
    busy.current = true; ++version.current;
    setSaving(true); setError(null);
    try {
      const next = method === "saveShader"
        ? await rpcRef.current.call("saveShader", { shader: shader as CustomShader, activate: true })
        : await rpcRef.current.call("deleteShader", { id: shader as string });
      if (mounted.current) setConfig({ ...next, ...pending.current });
      return true;
    } catch (error) {
      if (mounted.current) setError(`Couldn’t ${method === "saveShader" ? "save" : "remove"} the shader. ${error instanceof Error ? error.message : "Try again."}`);
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
      if (hasPending()) void flush();
      else if (mounted.current && refreshRequested.current) void refetch();
    }
  }, [flush, refetch]);
  return { config, error, saving, update, reset,
    saveShader: (shader: CustomShader) => libraryAction("saveShader", shader),
    deleteShader: (id: string) => libraryAction("deleteShader", id),
    retry: () => hasPending() ? flush() : refetch() };
}
