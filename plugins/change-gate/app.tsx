// Change Gate: the approval form in place of the composer, and the journal page.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { GateEntry, GateRequest } from "./lib/journal";
import { ICONS } from "./lib/icons";
import { Button } from "@/components/ui/button";

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

function GateForm({ interaction, submit, cancel }: {
  interaction: { payload: unknown };
  submit: (value: never) => unknown;
  cancel: () => unknown;
}) {
  const request = interaction.payload as GateRequest;
  const [comment, setComment] = useState("");
  const answer = (approved: boolean) => submit({ approved, comment } as never);
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <div className="font-medium">The agent wants to change something</div>
      <Field label="What">{request.what}</Field>
      <Field label="Where">{request.where}</Field>
      <Field label="How to undo">{request.rollback}</Field>
      {request.commands.length === 0 ? null : (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Commands</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono">{request.commands.join("\n")}</pre>
        </details>
      )}
      <input
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Comment for the agent, optional"
        aria-label="Comment for the agent"
        className="mt-3 h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => cancel()}>Later</Button>
        <Button variant="outline" size="sm" onClick={() => answer(false)}>Decline</Button>
        <Button size="sm" onClick={() => answer(true)}>Approve</Button>
      </div>
    </div>
  );
}

const LABEL: Record<GateEntry["decision"], string> = { approved: "Approved", declined: "Declined", dismissed: "Put off" };

function JournalPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<GateEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("journal").then((r) => setEntries(r.entries), (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime("journal-changed", load);
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {error === null ? null : <p role="alert" className="text-sm text-destructive">{error}</p>}
        {entries !== null && entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No decisions yet. They appear here when an agent asks before changing production.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {(entries ?? []).map((e) => (
              <li key={e.id} className="px-3 py-2 text-sm">
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span className={e.decision === "declined" ? "text-destructive" : undefined}>{LABEL[e.decision]}</span>
                  <span>{new Date(e.at).toLocaleString()}</span>
                  <span className="truncate">{e.where}</span>
                </div>
                <div className="mt-0.5 break-words">{e.what}</div>
                {e.comment === "" ? null : <div className="mt-0.5 text-xs text-muted-foreground">{e.comment}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  for (const [name, component] of Object.entries(ICONS)) {
    app.experimental_icons.register({ name, component });
  }
  app.slots.pendingInteraction({ id: "change-gate", component: GateForm as never });
  app.slots.navPanel({ id: "change-gate", title: "Change Gate", icon: "change-gate/shield", path: "change-gate", component: JournalPage });
});
