// alia-plugin-password-gate — a VesnALIA plugin frontend entry.
//
// Compiled by `alia plugin build` into dist/app.js + dist/app.css. React and
// @vesnalia/plugin-sdk/app are provided by the VesnALIA app at load time (never
// bundled), so this file must be loaded by VesnALIA, not imported directly.
//
// The plugin renders a full-screen unlock panel through
// `experimental_appOverlay`, which mounts once per app window outside
// route-owned layout. It stays mounted (returning null once unlocked or when
// no password is configured) so a later reload re-locks the window.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { definePluginApp, useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

/** How often an open window re-checks whether the gate is configured. */
const STATUS_POLL_MS = 5000;

// The trusted-device token. The server mints it and keeps only its hash; this
// browser stores the token so the device skips the prompt. Scoped per plugin
// id so two installs do not share a device.
const TOKEN_KEY = "alia-plugin-password-gate.device-token";

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The gate
    // still works; it just cannot remember this device.
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore: losing the token only costs another password prompt.
  }
}

/**
 * The unlock panel. Until the status check answers, an opaque backdrop covers
 * the app without the form: the gate must never paint app contents before it
 * knows whether a password is required, and it must not flash a password
 * prompt that is about to turn out unnecessary.
 */
function PasswordGateOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const [required, setRequired] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [password, setPassword] = useState("");
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    let wasRequired = false;
    const check = () => {
      rpc.call("gate_status", { token: readToken() }).then(
        (result) => {
          if (!active) return;
          // A password that appears while this window is open must lock it
          // again; the window was never asked for the new credential.
          if (result.required && !wasRequired) setUnlocked(false);
          wasRequired = result.required;
          // A token the server no longer honors (revoked, expired, or issued
          // under a rotated password) has no further use: drop it instead of
          // sending it on every poll forever.
          if (result.required && !result.trusted && readToken() !== null) writeToken(null);
          setTrusted(result.trusted);
          setRequired(result.required);
        },
        // Fail open: if the plugin backend is unreachable, never brick the app.
        () => {
          if (active) setRequired(false);
        },
      );
    };
    check();
    // The password lives in the server's environment, which no event reports.
    // Polling is what lets a window notice that it was unset (and stop
    // blocking) or set (and start blocking) without an app reload.
    const timer = setInterval(check, STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [rpc]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || password === "") return;
    setPending(true);
    setError(null);
    try {
      const result = await rpc.call("gate_verify", {
        password,
        trust,
        label: navigator.userAgent.slice(0, 120),
      });
      if (result.ok) {
        if (result.token !== null) writeToken(result.token);
        setUnlocked(true);
        setPassword("");
      } else {
        setError("Incorrect password.");
        setPassword("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  if (unlocked || trusted || required === false) return null;

  // Status still in flight: cover the app, but do not offer a password prompt
  // whose necessity is not yet known.
  if (required === null) {
    return <div className="fixed inset-0 z-[10000] bg-background" />;
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm rounded-xl p-6 shadow-sm">
        <div className="space-y-1.5 text-center">
          <h1 className="text-lg font-bold text-foreground">Unlock VesnALIA</h1>
          <p className="text-sm text-muted-foreground">
            This session is password-protected.
          </p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Icon
                name="Lock"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                aria-label="Session password"
                autoComplete="current-password"
                className="rounded-full pl-9 pr-4"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="icon"
              aria-label="Unlock"
              disabled={pending || password === ""}
              className="shrink-0 rounded-lg border border-border"
            >
              <Icon name="Lock" className="size-4 text-warning-text" />
            </Button>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={trust}
              onCheckedChange={(value) => setTrust(value === true)}
            />
            Trust this device
          </label>
        </form>

        {error === null ? null : (
          <p role="alert" className="mt-3 text-center text-sm text-destructive">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}

/**
 * Step-by-step usage, rendered on the plugin's settings detail page. Read from
 * inside VesnALIA, so it is written for the person using the app rather than for a
 * developer reading the repo.
 */
function HowToUse() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<{
    required: boolean;
    trusted: boolean;
  } | null>(null);

  useEffect(() => {
    rpc.call("gate_status", { token: readToken() }).then(
      (result) => setState({ required: result.required, trusted: result.trusted }),
      () => setState(null),
    );
  }, [rpc]);

  return (
    <div className="space-y-4 text-sm text-muted-foreground">
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Type a password in the{" "}
          <span className="font-medium text-foreground">Access password</span>{" "}
          field above and click away. It saves by itself — there is no Save
          button, and nothing to reload.
        </li>
        <li>
          The app locks immediately: every window shows an{" "}
          <span className="font-medium text-foreground">Unlock VesnALIA</span> panel
          and stays behind it until someone enters that password.
        </li>
        <li>
          On a computer you use often, tick{" "}
          <span className="font-medium text-foreground">Trust this device</span>{" "}
          before unlocking. That browser then skips the panel until the trust
          window ends.
        </li>
        <li>
          To stop locking the app, clear the{" "}
          <span className="font-medium text-foreground">Access password</span>{" "}
          field above and click away.
        </li>
      </ol>

      <div className="space-y-1.5">
        <p className="font-medium text-foreground">Forgot the password?</p>
        <p>
          This page sits behind the unlock panel, so the field above cannot be
          reached while the gate is locked. Open a terminal on the VesnALIA machine
          and run:
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-secondary p-3 text-xs text-foreground">
          {"alia password-gate reset"}
        </pre>
        <p>
          That clears the password, opens the app, and forgets every trusted
          device. Then set a new password here. If you already know the new
          password, replace it directly instead — the app stays locked the whole
          time:
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-secondary p-3 text-xs text-foreground">
          {"alia plugin config password-gate set password '<new password>'"}
        </pre>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-foreground">Managing trusted devices</p>
        <p>
          Every browser that ticked{" "}
          <span className="font-medium text-foreground">Trust this device</span>{" "}
          appears here. Revoke one that should ask for the password again — it
          locks within a few seconds, with no reload:
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-secondary p-3 text-xs text-foreground">
          {`alia password-gate devices\nbb password-gate revoke --all`}
        </pre>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-foreground">Current state</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            {state === null
              ? "Unavailable."
              : state.required
                ? "Locked — a password is set, so the app asks for it."
                : "Open — no password is set, so nothing is locked."}
          </li>
          <li>
            {state?.trusted === true
              ? "This browser is a trusted device."
              : "This browser is not a trusted device."}
          </li>
          <li>Trust window: the value in “Trust a device for (days)” above.</li>
        </ul>
      </div>

      <p>
        The password is never sent to the browser: it is typed into the unlock
        panel, compared on the server, and only a yes-or-no answer comes back.
        It is stored in a file only the VesnALIA process can read.
      </p>
    </div>
  );
}

/**
 * What this gate does and does not protect, on the plugin's settings detail
 * page. Stated plainly because the limits are real and easy to assume away.
 */
function SecurityNotes() {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        This is a lock on the app window, not a lock on your data. It keeps
        someone who walks up to an open VesnALIA from reading your threads; it does
        not stop anyone who can already run commands on the VesnALIA machine or reach
        its port.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          The panel is part of the page. Removing it in the browser's developer
          tools hides the lock in that window until the page is reloaded.
        </li>
        <li>
          Turning the plugin off (<code className="text-foreground">alia plugin disable password-gate</code>{" "}
          or <code className="text-foreground">alia plugin safe-mode on</code>)
          stops the gate completely.
        </li>
        <li>
          VesnALIA's own API is not gated: anything that can reach the server's port
          can read threads and projects without the password.
        </li>
        <li>
          The password can be read from the VesnALIA machine's disk, and a short one
          can be guessed — there is no attempt limit.
        </li>
      </ul>
      <p>
        For real protection, keep the VesnALIA server off untrusted networks and
        restrict who can read its data directory.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "password-gate",
    component: PasswordGateOverlay,
  });
  app.slots.settingsSection({
    id: "how-to-use",
    title: "How to use",
    component: HowToUse,
  });
  app.slots.settingsSection({
    id: "security-notes",
    title: "What this protects",
    component: SecurityNotes,
  });
});
