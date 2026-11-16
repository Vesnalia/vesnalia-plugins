import { useEffect, useState } from "react";
import type { AuthAttempt } from "../contract";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";

const ACTIVE_STATES = new Set([
  "starting",
  "awaiting-code",
  "submitting",
  "verifying",
]);

export function AuthenticationDialog({
  open,
  attempt,
  error,
  onOpenChange,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  attempt: AuthAttempt | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setCode("");
  }, [attempt?.id]);

  const active = attempt !== null && ACTIVE_STATES.has(attempt.state);
  const pending = attempt?.state === "submitting" || attempt?.state === "verifying";

  async function submit(): Promise<void> {
    const value = code;
    setCode("");
    setSubmitting(true);
    try {
      await onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && active) void onCancel();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Authenticate Claude Code</DialogTitle>
          <DialogDescription className="text-pretty">
            Complete consent with Claude, then paste the authorization code here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1" aria-live="polite">
          {attempt?.state === "starting" ? (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <Icon name="Spinner" className="animate-spin" aria-hidden />
              Starting Claude authentication…
            </div>
          ) : null}

          {attempt?.state === "awaiting-code" && attempt.consentUrl !== null ? (
            <>
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-normal text-muted-foreground">
                Open Claude in a new tab and approve access. Claude will show a
                one-time code after consent.
              </div>
              <Button asChild className="w-full">
                <a href={attempt.consentUrl} target="_blank" rel="noreferrer">
                  Open Claude consent screen
                  <Icon name="ExternalLink" aria-hidden />
                </a>
              </Button>
              <div className="space-y-2">
                <label htmlFor="claude-authorization-code" className="text-sm font-medium">
                  Authorization code
                </label>
                <Input
                  id="claude-authorization-code"
                  value={code}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Paste the code from Claude"
                  className="font-mono text-base sm:text-sm"
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && code.length > 0) void submit();
                  }}
                />
                <p className="text-xs leading-normal text-muted-foreground">
                  Include the complete value, including the part after #.
                </p>
              </div>
            </>
          ) : null}

          {pending || submitting ? (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <Icon name="Spinner" className="animate-spin" aria-hidden />
              {attempt?.state === "verifying"
                ? "Verifying authentication…"
                : "Submitting authorization code…"}
            </div>
          ) : null}

          {attempt?.state === "succeeded" ? (
            <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success/5 px-3 py-2.5 text-sm text-foreground">
              <Icon name="CircleCheck" className="mt-0.5 text-success" aria-hidden />
              Claude Code is authenticated on this machine.
            </div>
          ) : null}

          {attempt?.state === "failed" || error !== null ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">
              <Icon name="AlertCircle" className="mt-0.5" aria-hidden />
              {error ?? attempt?.error ?? "Authentication failed."}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {active ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => void onCancel()}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          {attempt?.state === "awaiting-code" ? (
            <Button type="button" disabled={code.length === 0 || submitting} onClick={() => void submit()}>
              Submit code
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
