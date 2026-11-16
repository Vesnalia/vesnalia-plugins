import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginPendingInteractionProps,
} from "@vesnalia/plugin-sdk/app";
import type { AuthStatus, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

function useAuthStatus() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rpc.call("auth_status");
      setStatus(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useRealtime("claude-auth-changed", () => {
    refetch();
  });

  return { rpc, status, loading, error, refetch, setStatus };
}

/** Reusable action buttons for opening OAuth URL or copying it to clipboard */
function AuthUrlActionButtons({ authUrl, compact }: { authUrl: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(authUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        <a
          href={authUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 py-1.5"
        >
          1. Tap to Sign In on Claude.com
        </a>
        <Button variant="outline" size="sm" onClick={copyUrl} className="h-8 text-xs">
          <Icon name="Copy" className="size-3.5 mr-1" />
          {copied ? "Copied!" : "Copy Link"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={authUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
      >
        <Icon name="Zap" className="size-4 mr-2" />
        Open Claude Login Page
      </a>
      <Button variant="outline" size="sm" onClick={copyUrl}>
        <Icon name="Copy" className="size-4 mr-1.5" />
        {copied ? "Copied!" : "Copy Link"}
      </Button>
    </div>
  );
}

function ClaudeAuthPage() {
  const { rpc, status, loading, error, refetch } = useAuthStatus();
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    authUrl: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const startLogin = async () => {
    setActionError(null);
    setActionSuccess(null);
    setCode("");
    setSubmitting(true);
    try {
      const session = await rpc.call("start_login");
      setActiveSession(session);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelLogin = async () => {
    if (!activeSession) return;
    try {
      await rpc.call("cancel_login", { sessionId: activeSession.sessionId });
    } catch {
      // ignore
    }
    setActiveSession(null);
    setCode("");
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeSession || !code.trim() || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await rpc.call("submit_code", {
        sessionId: activeSession.sessionId,
        code: code.trim(),
      });
      if (res.success) {
        setActionSuccess("Successfully authenticated Claude Code CLI!");
        setActiveSession(null);
        setCode("");
        refetch();
      } else {
        setActionError(res.error || "Authentication failed. Please verify the code.");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const cleanCredentials = async () => {
    if (!confirm("This will sign you out of Claude Code CLI, delete credentials from the system credential store, and clear dead session flags. Continue?")) return;
    try {
      await rpc.call("clean_credentials");
      setActionSuccess("Deleted credentials and cleared dead session flags.");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const isLoggedIn = status?.loggedIn && !status?.isExpired;

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Claude Code Auth</h1>
          <p className="text-sm text-muted-foreground">
            Manage headless Claude Code CLI credentials and remote OAuth sign-in.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
          <Icon name="RefreshCcw" className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {actionSuccess && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          {actionSuccess}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          Failed to load status: {error}
        </div>
      )}

      {/* Auth Status Card */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`size-3 rounded-full ${
                isLoggedIn ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            <span className="font-semibold text-base">
              {isLoggedIn ? "Authenticated" : "Not Logged In"}
            </span>
          </div>
          {status?.subscriptionType && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary uppercase">
              {status.subscriptionType}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-sm border-t border-border">
          <div>
            <span className="text-muted-foreground text-xs block">Account Email</span>
            <span className="font-medium">{status?.accountEmail ?? "Not signed in"}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Auto-Refresh Token</span>
            <span className="font-medium">
              {status?.hasRefreshToken ? (
                <span className="text-emerald-600 dark:text-emerald-400">Present (in credential store)</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">Missing (expires daily)</span>
              )}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Session Status</span>
            <span>
              {status?.isExpired
                ? "Expired"
                : status?.expiresInMinutes !== null && status?.expiresInMinutes !== undefined
                ? `${status.expiresInMinutes} minutes remaining`
                : "Unknown"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Provider Method</span>
            <span>{status?.authMethod ?? "none"}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Refresh Token Expiry</span>
            <span>
              {status?.refreshTokenExpiresAt
                ? new Date(status.refreshTokenExpiresAt).toLocaleDateString()
                : "None"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Dead OAuth Flag</span>
            <span>
              {status?.deadFlag ? (
                <span className="text-amber-600 dark:text-amber-400 font-medium">Yes (Clean recommended)</span>
              ) : (
                "No"
              )}
            </span>
          </div>
        </div>

        <div className="pt-3 border-t border-border flex flex-wrap gap-2">
          {!activeSession ? (
            <>
              <Button onClick={startLogin} disabled={submitting}>
                <Icon name="Zap" className="size-4 mr-1.5" />
                {isLoggedIn ? "Re-authenticate" : "Authenticate Now"}
              </Button>
              <Button variant="outline" onClick={cleanCredentials}>
                Sign Out / Clean
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Active Login Flow */}
      {activeSession && (
        <div className="rounded-xl border-2 border-primary/50 bg-card p-5 shadow-md space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Sign In with Claude</h2>
            <Button variant="ghost" size="sm" onClick={cancelLogin}>
              Cancel
            </Button>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">
              Step 1: Open the Claude authorization page in your browser
            </p>
            <AuthUrlActionButtons authUrl={activeSession.authUrl} />
          </div>

          <form onSubmit={submitCode} className="space-y-3 pt-3 border-t border-border">
            <label htmlFor="auth-code" className="text-sm font-medium text-foreground block">
              Step 2: Paste the authorization code from the page
            </label>
            <div className="flex gap-2">
              <Input
                id="auth-code"
                placeholder="Paste authorization code here..."
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={submitting}
                className="flex-1 font-mono text-sm"
                autoFocus
              />
              <Button type="submit" disabled={submitting || !code.trim()}>
                {submitting ? (
                  <>
                    <Icon name="Loading" className="size-4 mr-1.5 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "Complete"
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              After authorizing in your browser, copy the code provided and paste it above to finish login.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * Chat Composer Pending Interaction slot.
 * Renders an interactive login card directly in the chat composer when claude_auth_login is invoked.
 */
function ClaudeAuthInteraction({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const payload = interaction.payload as {
    sessionId?: string;
    authUrl?: string;
    accountEmail?: string;
  };
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    submit({ code: code.trim() });
  };

  return (
    <div className="p-4 bg-card border-t border-border space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Zap" className="size-5 text-primary" />
          <span className="font-semibold text-sm">Claude Code Authentication</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => cancel()} disabled={submitting}>
          Dismiss
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        To sign in or renew Claude Code credentials from your mobile device or browser:
      </p>

      {payload.authUrl && (
        <div className="space-y-2">
          <AuthUrlActionButtons authUrl={payload.authUrl} compact />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-2 pt-2 border-t border-border">
        <div className="flex gap-2">
          <Input
            placeholder="2. Paste authorization code here..."
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={submitting}
            className="flex-1 font-mono text-xs"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={submitting || !code.trim()} className="text-xs">
            {submitting ? (
              <>
                <Icon name="Loading" className="size-3.5 mr-1 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "claude-auth",
    title: "Claude Auth",
    icon: "Zap",
    path: "claude-auth",
    component: ClaudeAuthPage,
  });

  app.slots.pendingInteraction({
    id: "claude-auth-interaction",
    component: ClaudeAuthInteraction,
  });
});
