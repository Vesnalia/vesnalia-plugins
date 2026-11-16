// alia-plugin-model-favicons — frontend entry.
//
// VesnALIA renders one icon per provider, never per model: `availableModelSchema`
// carries no icon field, so every model row in the picker inherits its
// provider's logo. This plugin therefore draws a mark per provider id with
// `app.slots.experimental_providerIcon` — the only supported way to replace a
// provider's logo with inline React.
//
// A registered mark wins over the provider's own logo (VesnALIA renders the
// registered component instead of the masked logo asset), and the provider's
// `iconTint` still applies to it, so the mark follows the VesnALIA theme.
//
// The registered component is stable and reads the current choice at render
// time (lib/icon-store.tsx): VesnALIA collects registrations once and rejects a
// second registration for the same (kind, provider id).
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { DEFAULT_MARKS, MARKS, MARK_IDS } from "@/lib/provider-marks";
import type { MarkId } from "@/lib/provider-marks";
import { providerIconComponent, setOverrides } from "@/lib/icon-store";
import type { Overrides } from "@/lib/icon-store";

/** The override map, kept current by the server's "icons-changed" signal. */
function useOverrides() {
  const rpc = useRpc<typeof rpcContract>();
  const [overrides, setLocal] = useState<Overrides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const apply = useCallback((next: Overrides) => {
    setLocal(next);
    // Keep the render-time store in sync so provider icons update live.
    setOverrides(next);
  }, []);
  const refetch = useCallback(() => {
    rpc.call("icons_list").then((result) => {
      apply(result.overrides);
      setError(null);
    }, report);
  }, [rpc, report, apply]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  // server.ts publishes after every write — from this page, another window,
  // or `alia model-favicons set` run by an agent — so the list never goes stale.
  useRealtime("icons-changed", refetch);
  return { rpc, overrides, error, report, refetch };
}

function MarkPreview({ mark }: { mark: MarkId }) {
  const Component = MARKS[mark];
  return <Component className="size-4 text-foreground" />;
}

/** The dashed box VesnALIA's own list pages use for loading and empty states. */
function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function FaviconsPage() {
  const { rpc, overrides, error, report, refetch } = useOverrides();
  const [providerId, setProviderId] = useState("");
  const [mark, setMark] = useState<MarkId>("agent");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextProvider = providerId.trim();
    if (nextProvider === "" || pending) return;
    setPending(true);
    try {
      await rpc.call("icons_set", { providerId: nextProvider, mark });
      setProviderId("");
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setPending(false);
    }
  };

  const rows =
    overrides === null
      ? []
      : Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <p className="text-sm text-muted-foreground">
          alia draws one icon per provider, so an override changes the mark for every
          model that provider offers. Agents set one with{" "}
          <code>alia model-favicons set &lt;provider-id&gt; &lt;mark&gt;</code>.
        </p>

        <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            placeholder="acp-zcode"
            aria-label="Provider id"
            className="min-w-40 flex-1"
          />
          <select
            value={mark}
            onChange={(event) => setMark(event.target.value as MarkId)}
            aria-label="Mark"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {MARK_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={pending || providerId.trim() === ""}>
            <Icon name="Plus" className="size-4" />
            Set
          </Button>
        </form>

        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4">
          {overrides === null ? (
            <EmptyState>Loading icons…</EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState>
              No overrides. VesnALIA&apos;s own logos are in use — but a custom ACP agent
              still shows the generic Toolbox mark.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card px-4">
              {rows.map(([id, idMark]) => (
                <li key={id} className="flex items-center gap-3 py-2.5 text-sm">
                  <MarkPreview mark={(idMark in MARKS ? idMark : "agent") as MarkId} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
                  <span className="text-xs text-muted-foreground">{idMark}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={`Reset the icon for ${id}`}
                    onClick={() => {
                      rpc
                        .call("icons_reset", { providerId: id })
                        .then(refetch, report);
                    }}
                  >
                    <Icon name="Trash2" className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {overrides !== null && rows.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {rows.length} override{rows.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  // The icons themselves. One registration per provider id; VesnALIA keeps the first
  // registration for a (kind, id) pair and warns about later duplicates.
  for (const [providerId, defaultMark] of Object.entries(DEFAULT_MARKS)) {
    app.slots.experimental_providerIcon({
      providerKind: "agent",
      providerId,
      icon: providerIconComponent(providerId, MARKS[defaultMark]),
    });
  }

  app.slots.navPanel({
    id: "model-favicons",
    title: "Model Favicons",
    icon: "Palette",
    // Routed at /plugins/model-favicons/model-favicons; the component receives
    // the remainder as `subPath` for deep links within the page.
    path: "model-favicons",
    component: FaviconsPage,
  });
});
