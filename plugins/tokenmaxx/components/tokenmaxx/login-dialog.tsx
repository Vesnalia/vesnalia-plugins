import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { rpcContract } from "../../server";
import { PROVIDER_LABEL, errorMessage } from "./format";

export type LoginRequest = {
  provider: "codex" | "claude";
  apiKey: boolean;
};

const ANSI = new RegExp(
  ["\\u001B\\[[0-9;?]*[ -/]*[@-~]", "\\u001B[()][A-Za-z0-9]", "\\u001B[=>]", "\\u0007"].join("|"),
  "g",
);

// Terminal output is a pty stream: strip escape sequences and honour carriage
// returns so a progress line reads as its final state rather than every frame.
const readable = (raw: string): string =>
  raw
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.split("\r").at(-1) ?? "")
    .join("\n");

type LoginDialogProps = {
  request: LoginRequest | null;
  onClose: (didFinish: boolean) => void;
};

export const LoginDialog = ({ request, onClose }: LoginDialogProps) => {
  const rpc = useRpc<typeof rpcContract>();
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("starting");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const outputRef = useRef<HTMLPreElement | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (request === null) return;
    let cancelled = false;
    seqRef.current = 0;
    setTranscript("");
    setStatus("starting");
    setExitCode(null);
    setTerminalId(null);

    rpc
      .call("startLogin", { apiKey: request.apiKey, provider: request.provider })
      .then((result) => {
        if (!cancelled) setTerminalId(result.terminalId);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error("Could not start the login", { description: errorMessage(error) });
        onClose(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onClose, request, rpc]);

  useEffect(() => {
    if (terminalId === null) return;
    let active = true;

    const tick = async () => {
      try {
        const chunk = await rpc.call("loginOutput", { sinceSeq: seqRef.current, terminalId });
        if (!active) return;
        seqRef.current = chunk.nextSeq;
        if (chunk.text.length > 0) setTranscript((current) => `${current}${chunk.text}`);
        setStatus(chunk.status);
        setExitCode(chunk.exitCode);
      } catch {
        // A closed terminal ends the stream; the transcript already shows why.
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 700);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [rpc, terminalId]);

  useEffect(() => {
    const element = outputRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [transcript]);

  const finish = useCallback(
    (didFinish: boolean) => {
      if (terminalId !== null) void rpc.call("endLogin", { terminalId });
      onClose(didFinish);
    },
    [onClose, rpc, terminalId],
  );

  const send = useCallback(() => {
    if (terminalId === null) return;
    const data = `${reply}\r`;
    setReply("");
    rpc.call("loginInput", { data, terminalId }).catch((error: unknown) => {
      toast.error("Could not send that", { description: errorMessage(error) });
    });
  }, [reply, rpc, terminalId]);

  const isDone = status === "exited";
  const providerLabel =
    request === null ? "" : PROVIDER_LABEL[request.provider === "codex" ? "openai" : "anthropic"];

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) finish(isDone && exitCode === 0);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sign in to {providerLabel}</DialogTitle>
          <DialogDescription>
            {request?.apiKey === true
              ? "Paste the API key when it asks, then name the account."
              : "A browser window opens for the provider's own login. Follow it, and answer any prompt below."}
          </DialogDescription>
        </DialogHeader>

        <pre
          ref={outputRef}
          aria-live="polite"
          aria-label="Login output"
          className="max-h-72 min-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
        >
          {readable(transcript).trimStart() ||
            (terminalId === null ? "Starting tokenmaxx…" : "Waiting for output…")}
        </pre>

        {isDone ? (
          <p className="text-sm">
            {exitCode === 0
              ? "Signed in. Make the account active from the Accounts tab whenever you want traffic on it."
              : `The login exited with code ${exitCode ?? "unknown"}. The output above says why.`}
          </p>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label className="sr-only" htmlFor="login-reply">
              Answer the prompt
            </label>
            <Input
              id="login-reply"
              name="login-reply"
              autoComplete="off"
              spellCheck={false}
              placeholder="Type here if the login asks something…"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              disabled={terminalId === null}
            />
            <Button type="submit" variant="outline" disabled={terminalId === null}>
              Send
            </Button>
          </form>
        )}

        <DialogFooter>
          <Button variant={isDone ? "default" : "outline"} onClick={() => finish(isDone)}>
            {isDone ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
