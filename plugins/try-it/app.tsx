// Try It form: shown in place of the composer while a test request is pending.
import { useMemo, useState } from "react";
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import qrcode from "qrcode-generator";
import type { TryItPayload } from "./server";
import type { CheckResult } from "./lib/url";
import { ICONS } from "./lib/icons";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function QrCode({ url }: { url: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const size = qr.getModuleCount();
    let d = "";
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (qr.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
      }
    }
    return { d, size: size + 4 };
  }, [url]);
  // Always dark on white: a scanner cannot read a code inverted by a dark theme.
  return (
    <svg viewBox={`0 0 ${path.size} ${path.size}`} className="size-28 shrink-0 rounded bg-white" role="img" aria-label={`QR code for ${url}`}>
      <path d={path.d} fill="#000" />
    </svg>
  );
}

const CHOICES: { value: CheckResult; label: string; icon: string }[] = [
  { value: "pass", label: "Works", icon: "try-it/check" },
  { value: "fail", label: "Broken", icon: "try-it/x" },
];

function TryItForm({ interaction, submit, cancel }: {
  interaction: { payload: unknown };
  submit: (value: never) => unknown;
  cancel: () => unknown;
}) {
  const payload = interaction.payload as TryItPayload;
  const navigate = useBbNavigate();
  const [results, setResults] = useState<Record<number, CheckResult>>({});
  const [note, setNote] = useState("");
  const send = () => {
    submit({
      results: payload.checks.map((check, index) => ({ check, result: results[index] ?? "skip" })),
      note,
    } as never);
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-start gap-3">
        <QrCode url={payload.url} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{payload.title}</div>
          <Button size="sm" className="mt-2" onClick={() => navigate.openUrl(payload.url)}>
            <Icon name="try-it/open" className="size-4" />
            Open
          </Button>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{payload.url}</div>
          {payload.changed.length === 0 ? null : (
            <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
              {payload.changed.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {payload.checks.map((check, index) => (
          <li key={check} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1">{check}</span>
            {CHOICES.map((choice) => (
              <Button
                key={choice.value}
                size="sm"
                variant={results[index] === choice.value ? "default" : "outline"}
                className={cn(results[index] === choice.value && choice.value === "fail" && "bg-destructive text-destructive-foreground")}
                aria-pressed={results[index] === choice.value}
                onClick={() => setResults((current) => ({ ...current, [index]: choice.value }))}
              >
                <Icon name={choice.icon} className="size-4" />
                {choice.label}
              </Button>
            ))}
          </li>
        ))}
      </ul>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What did you see? Optional"
        aria-label="Note for the agent"
        rows={2}
        className="mt-2 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => cancel()}>Later</Button>
        <Button size="sm" onClick={send}>Send to agent</Button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  for (const [name, component] of Object.entries(ICONS)) {
    app.experimental_icons.register({ name, component });
  }
  app.slots.pendingInteraction({ id: "try-it", component: TryItForm as never });
});
