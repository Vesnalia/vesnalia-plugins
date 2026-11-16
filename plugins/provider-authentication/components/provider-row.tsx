import type { ProviderStatus } from "../contract";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";

function statusCopy(status: ProviderStatus): {
  label: string;
  detail: string;
  tone: string;
} {
  switch (status.kind) {
    case "signed-in":
      return {
        label: "Authenticated",
        detail:
          status.identity ??
          status.organization ??
          "Claude Code is ready on this machine.",
        tone: "bg-success",
      };
    case "signed-out":
      return {
        label: "Not authenticated",
        detail: "Sign in with a Claude subscription.",
        tone: "bg-muted-foreground/50",
      };
    case "cli-missing":
      return {
        label: "Not installed",
        detail: "Install Claude Code on this machine to continue.",
        tone: "bg-warning",
      };
    case "unavailable":
      return {
        label: "Unavailable",
        detail: status.message,
        tone: "bg-destructive",
      };
  }
}

export function ProviderRow({
  status,
  busy,
  onAuthenticate,
}: {
  status: ProviderStatus;
  busy: boolean;
  onAuthenticate: () => void;
}) {
  const copy = statusCopy(status);
  const canAuthenticate = status.kind === "signed-in" || status.kind === "signed-out";
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <Icon name="Lock" className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold leading-snug">Claude Code</h3>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
              <span className={`size-1.5 rounded-full ${copy.tone}`} aria-hidden />
              {copy.label}
            </span>
          </div>
          <p className="break-words text-sm leading-normal text-muted-foreground">
            {copy.detail}
          </p>
          {status.kind === "signed-in" && status.subscription !== null ? (
            <p className="text-xs capitalize text-muted-foreground">
              {status.subscription} subscription
            </p>
          ) : null}
        </div>
      </div>
      {canAuthenticate ? (
        <Button
          type="button"
          size="sm"
          variant={status.kind === "signed-out" ? "default" : "outline"}
          disabled={busy}
          onClick={onAuthenticate}
          className="w-full sm:w-auto"
        >
          {busy ? <Icon name="Spinner" className="animate-spin" aria-hidden /> : null}
          {status.kind === "signed-in" ? "Reauthenticate" : "Authenticate"}
        </Button>
      ) : null}
    </div>
  );
}
