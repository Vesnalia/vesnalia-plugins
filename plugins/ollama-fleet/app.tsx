import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
} from "@vesnalia/plugin-sdk/app";

import type {
  Endpoint,
  ProbeResult,
  rpcContract,
} from "./server";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Unknown size";

  const units = ["B", "KB", "MB", "GB", "TB"];

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit >= 3 ? 1 : 0)} ${units[unit]}`;
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function useFleet() {
  const rpc = useRpc<typeof rpcContract>();

  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);

    try {
      const list = await rpc.call("fleet_list");
      setEndpoints(list.endpoints);

      if (list.endpoints.length === 0) {
        setResults([]);
      } else {
        const status = await rpc.call("fleet_probe_all");
        setResults(status.results);
      }

      setError(null);
    } catch (cause) {
      report(cause);
    } finally {
      setLoading(false);
    }
  }, [rpc, report]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refetch();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [refetch]);

  useRealtime("fleet-changed", () => {
    void refetch();
  });

  return {
    rpc,
    endpoints,
    results,
    setResults,
    error,
    report,
    refetch,
    loading,
  };
}

function EndpointCard({
  endpoint,
  result,
  onRefresh,
  onRemove,
}: {
  endpoint: Endpoint;
  result: ProbeResult | undefined;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{endpoint.name}</h3>

            {result === undefined ? (
              <span className="text-xs text-muted-foreground">
                Not checked
              </span>
            ) : result.online ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="size-2 rounded-full bg-foreground" />
                Online
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
                <span className="size-2 rounded-full bg-destructive" />
                Offline
              </span>
            )}
          </div>

          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {endpoint.baseUrl}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
          >
            Refresh
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${endpoint.name}`}
            onClick={onRemove}
          >
            <Icon name="Trash2" className="size-4" />
          </Button>
        </div>
      </div>

      {result === undefined ? null : result.online ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Latency</p>
              <p className="mt-1 text-lg font-medium">
                {result.latencyMs ?? "—"} ms
              </p>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Models</p>
              <p className="mt-1 text-lg font-medium">
                {result.models.length}
              </p>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Running</p>
              <p className="mt-1 text-lg font-medium">
                {result.runningModels.length}
              </p>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Reliability</p>
              <p className="mt-1 text-lg font-medium">
                {Math.round(result.healthReliability * 100)}%
              </p>
            </div>
          </div>

          {result.runningModels.length > 0 ? (
            <div className="mt-3 rounded-md border border-border px-3 py-2">
              <p className="text-xs font-medium">Currently loaded</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {result.runningModels.map((model) => (
                  <li key={model.name} className="flex flex-wrap justify-between gap-2">
                    <code>{model.name}</code>
                    <span>
                      {model.sizeVram === null
                        ? formatBytes(model.size)
                        : `${formatBytes(model.sizeVram)} VRAM`}
                      {model.contextLength === null
                        ? ""
                        : ` · ${model.contextLength.toLocaleString()} context`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.runningError === null ? null : (
            <p className="mt-3 text-xs text-muted-foreground">
              Running-model status unavailable: {result.runningError}
            </p>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">
              Models ({result.models.length})
            </summary>

            <div className="mt-2 overflow-hidden rounded-md border border-border">
              {result.models.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Ollama returned no models.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {result.models.map((model) => (
                    <li key={model.name} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <code className="text-sm">{model.name}</code>

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {model.location}
                          </span>

                          {model.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}

                          {result.runningModels.some(
                            (running) => running.name === model.name,
                          ) ? (
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                              running
                            </span>
                          ) : null}

                          <span className="ml-1 text-xs text-muted-foreground">
                            {formatBytes(model.size)}
                          </span>
                        </div>
                      </div>

                      {model.parameterSize !== null ||
                      model.quantization !== null ||
                      model.family !== null ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[
                            model.family,
                            model.parameterSize,
                            model.quantization,
                            model.contextLength === null
                              ? null
                              : `${model.contextLength.toLocaleString()} context`,
                            model.classificationSource === "override"
                              ? "custom routing"
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </>
      ) : (
        <p className="mt-4 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {result.error ?? "Unable to reach Ollama"}
        </p>
      )}
    </div>
  );
}

function FleetPage() {
  const {
    rpc,
    endpoints,
    results,
    setResults,
    error,
    report,
    refetch,
    loading,
  } = useFleet();

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [pending, setPending] = useState(false);

  const statusById = new Map(
    (results ?? []).map((result) => [
      result.endpoint.id,
      result,
    ]),
  );

  const addEndpoint = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanUrl = baseUrl.trim();

    if (
      cleanName === "" ||
      cleanUrl === "" ||
      pending
    ) {
      return;
    }

    setPending(true);

    try {
      await rpc.call("fleet_add", {
        name: cleanName,
        baseUrl: cleanUrl,
      });

      setName("");
      setBaseUrl("");

      await refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setPending(false);
    }
  };

  const refreshEndpoint = async (id: string) => {
    try {
      const result = await rpc.call("fleet_probe", {
        id,
      });

      setResults((current) => {
        const others = (current ?? []).filter(
          (candidate) => candidate.endpoint.id !== id,
        );

        return [...others, result];
      });
    } catch (cause) {
      report(cause);
    }
  };

  const removeEndpoint = async (id: string) => {
    try {
      await rpc.call("fleet_remove", {
        id,
      });

      await refetch();
    } catch (cause) {
      report(cause);
    }
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-4xl px-4 pb-8 pt-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              Ollama Fleet
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Discover and monitor Ollama inference servers
              available to VesnALIA. Health refreshes every 60 seconds.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => void refetch()}
            disabled={loading}
          >
            {loading ? "Checking…" : "Refresh all"}
          </Button>
        </div>

        <form
          onSubmit={addEndpoint}
          className="mt-5 rounded-lg border border-border bg-card p-4"
        >
          <h3 className="text-sm font-medium">
            Add Ollama server
          </h3>

          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Input
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="Desktop PC"
              aria-label="Server name"
            />

            <Input
              value={baseUrl}
              onChange={(event) =>
                setBaseUrl(event.target.value)
              }
              placeholder="http://10.0.0.50:11434"
              aria-label="Ollama server URL"
            />

            <Button
              type="submit"
              disabled={
                pending ||
                name.trim() === "" ||
                baseUrl.trim() === ""
              }
            >
              <Icon name="Plus" className="size-4" />
              Add
            </Button>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            You can paste either the Ollama root URL or its
            /v1 URL. Fleet normalizes it to the Ollama server
            root.
          </p>
        </form>

        {error === null ? null : (
          <p
            role="alert"
            className="mt-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="mt-5 space-y-3">
          {endpoints === null ? (
            <EmptyState>Loading Ollama Fleet…</EmptyState>
          ) : endpoints.length === 0 ? (
            <EmptyState>
              No Ollama servers configured yet. Add your
              desktop Ollama server above.
            </EmptyState>
          ) : (
            endpoints.map((endpoint) => (
              <EndpointCard
                key={endpoint.id}
                endpoint={endpoint}
                result={statusById.get(endpoint.id)}
                onRefresh={() =>
                  void refreshEndpoint(endpoint.id)
                }
                onRemove={() =>
                  void removeEndpoint(endpoint.id)
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "ollama-fleet",
    title: "Ollama Fleet",
    icon: "ListTodo",
    path: "ollama-fleet",
    component: FleetPage,
  });
});
