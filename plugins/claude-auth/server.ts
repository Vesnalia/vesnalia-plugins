import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  defineRpcContract,
  type AliaPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@vesnalia/plugin-sdk";
import { z } from "zod";

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

// Shared Protocol Constants between TypeScript backend and Python PTY bridge
const PROTOCOL = {
  AUTH_URL_PREFIX: "AUTH_URL:",
  CODE_PREFIX: "CODE:",
  SUCCESS_PREFIX: "SUCCESS:",
  ERROR_PREFIX: "ERROR:",
  CANCEL_CMD: "CANCEL",
} as const;

export const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string(),
  accountEmail: z.string().nullable().optional(),
  subscriptionType: z.string().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
  expiresInMinutes: z.number().nullable().optional(),
  refreshTokenExpiresAt: z.number().nullable().optional(),
  hasRefreshToken: z.boolean(),
  isExpired: z.boolean(),
  deadFlag: z.boolean(), // Indicates bridgeOauthDeadExpiresAt flag in ~/.claude.json
});

export type AuthStatus = z.infer<typeof authStatusSchema>;

export interface LoginResult {
  success: boolean;
  error?: string;
  status?: AuthStatus;
}

export const rpcContract = defineRpcContract({
  auth_status: {
    input: z.null(),
    output: authStatusSchema,
  },
  start_login: {
    input: z.null(),
    output: z.object({
      sessionId: z.string(),
      authUrl: z.string(),
    }),
  },
  submit_code: {
    input: z.object({
      sessionId: z.string(),
      code: z.string().trim().min(1),
    }),
    output: z.object({
      success: z.boolean(),
      error: z.string().optional(),
      status: authStatusSchema.optional(),
    }),
  },
  cancel_login: {
    input: z.object({ sessionId: z.string() }),
    output: z.object({ cancelled: z.boolean() }),
  },
  clean_credentials: {
    input: z.null(),
    output: z.object({ cleaned: z.boolean() }),
  },
});

const AUTH_CHANGED_CHANNEL = "claude-auth-changed";
const INTERACTION_RENDERER_ID = "claude-auth-interaction";

function defaultLoggedOutStatus(): AuthStatus {
  return {
    loggedIn: false,
    authMethod: "none",
    accountEmail: null,
    subscriptionType: null,
    expiresAt: null,
    expiresInMinutes: null,
    refreshTokenExpiresAt: null,
    hasRefreshToken: false,
    isExpired: true,
    deadFlag: false,
  };
}

export function formatStatusText(status: AuthStatus): string {
  if (!status.loggedIn) {
    return "Claude Code CLI is NOT logged in. Run `alia claude-auth login` or use `claude_auth_login` to authenticate.";
  }

  const lines = [
    "Claude Code CLI Auth Status:",
    `  Logged In:         YES`,
    `  Account:           ${status.accountEmail ?? "Unknown"}`,
    `  Subscription:      ${status.subscriptionType ?? "Standard"}`,
    `  Has Refresh Token: ${status.hasRefreshToken ? "YES (refresh token present)" : "NO (may expire daily)"}`,
  ];

  if (status.expiresInMinutes !== null && status.expiresInMinutes !== undefined) {
    lines.push(`  Expires In:        ${status.expiresInMinutes} mins`);
  }

  if (status.deadFlag) {
    lines.push(`  Dead OAuth Flag:   YES (clean credentials recommended)`);
  }

  return lines.join("\n");
}

// Find the python helper script relative to plugin root without hardcoded user paths
function getPythonScriptPath(): string {
  const currentDir = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.resolve(currentDir, "../scripts/pty_auth.py"),
    path.resolve(currentDir, "scripts/pty_auth.py"),
    path.resolve(currentDir, "../../scripts/pty_auth.py"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  throw new Error(`Claude Auth helper script (scripts/pty_auth.py) not found relative to ${currentDir}`);
}

interface ActiveLoginSession {
  sessionId: string;
  proc: ReturnType<typeof spawn>;
  authUrl: string;
  resolveResult?: (res: LoginResult) => void;
  timer: NodeJS.Timeout;
}

export default async function plugin(alia: AliaPluginApi) {
  const pythonScript = getPythonScriptPath();
  const activeSessions = new Map<string, ActiveLoginSession>();

  function cleanupSession(sessionId: string) {
    const session = activeSessions.get(sessionId);
    if (session) {
      clearTimeout(session.timer);
      try {
        const stdin = session.proc.stdin;
        if (stdin && !stdin.destroyed) {
          stdin.write(`${PROTOCOL.CANCEL_CMD}\n`);
        }
        session.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      activeSessions.delete(sessionId);
    }
  }

  alia.onDispose(() => {
    for (const sessionId of activeSessions.keys()) {
      cleanupSession(sessionId);
    }
    activeSessions.clear();
    alia.log.info("Claude Auth plugin disposed");
  });

  async function fetchStatus(): Promise<AuthStatus> {
    return new Promise((resolve) => {
      const proc = spawn(PYTHON_BIN, [pythonScript, "status"]);
      let out = "";
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.on("close", () => {
        try {
          const parsed = JSON.parse(out.trim());
          resolve(parsed);
        } catch {
          resolve(defaultLoggedOutStatus());
        }
      });
      proc.on("error", () => {
        resolve(defaultLoggedOutStatus());
      });
    });
  }

  async function cleanCredentials(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(PYTHON_BIN, [pythonScript, "clean"]);
      proc.on("close", () => {
        resolve(true);
      });
      proc.on("error", () => {
        resolve(false);
      });
    });
  }

  async function startLoginSession(): Promise<{ sessionId: string; authUrl: string }> {
    const sessionId = randomUUID();
    return new Promise((resolve, reject) => {
      const proc = spawn(PYTHON_BIN, [pythonScript, "login"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let resolved = false;

      const timeout = setTimeout(() => {
        cleanupSession(sessionId);
        if (!resolved) {
          reject(new Error("Timeout waiting for Claude authorization URL"));
        }
      }, 300_000); // 5 minutes

      proc.stdout.on("data", (chunk) => {
        stdoutBuf += chunk.toString();
        if (!resolved) {
          const urlMatch = stdoutBuf.match(new RegExp(`${PROTOCOL.AUTH_URL_PREFIX}\\s*(https:\\/\\/[^\\s\\r\\n]+)`));
          if (urlMatch) {
            resolved = true;
            const authUrl = urlMatch[1];
            const session: ActiveLoginSession = {
              sessionId,
              proc,
              authUrl,
              timer: timeout,
            };
            activeSessions.set(sessionId, session);
            resolve({ sessionId, authUrl });
            return;
          }

          const errMatch = stdoutBuf.match(new RegExp(`${PROTOCOL.ERROR_PREFIX}\\s*([^\\r\\n]+)`));
          if (errMatch) {
            resolved = true;
            clearTimeout(timeout);
            cleanupSession(sessionId);
            reject(new Error(errMatch[1]));
            return;
          }
        } else {
          // Check for final result
          const session = activeSessions.get(sessionId);
          if (session?.resolveResult) {
            if (stdoutBuf.includes(PROTOCOL.SUCCESS_PREFIX)) {
              fetchStatus().then((st) => {
                session.resolveResult?.({ success: true, status: st });
                cleanupSession(sessionId);
              });
            } else if (stdoutBuf.includes(PROTOCOL.ERROR_PREFIX)) {
              const errMatch = stdoutBuf.match(new RegExp(`${PROTOCOL.ERROR_PREFIX}\\s*([^\\r\\n]+)`));
              session.resolveResult?.({
                success: false,
                error: errMatch ? errMatch[1].trim() : "Authentication failed",
              });
              cleanupSession(sessionId);
            }
          }
        }
      });

      proc.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      proc.on("close", (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Login process exited with code ${code} without providing an authorization URL`));
          return;
        }

        const session = activeSessions.get(sessionId);
        if (session?.resolveResult) {
          fetchStatus().then((st) => {
            if (st.loggedIn) {
              session.resolveResult?.({ success: true, status: st });
            } else {
              session.resolveResult?.({ success: false, error: "Process closed before authentication completed" });
            }
            cleanupSession(sessionId);
          });
        }
      });
    });
  }

  async function submitLoginCode(sessionId: string, code: string): Promise<LoginResult> {
    const session = activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: "Login session expired or invalid" };
    }

    const stdin = session.proc.stdin;
    if (!stdin || stdin.destroyed) {
      cleanupSession(sessionId);
      return { success: false, error: "Interactive terminal process is no longer active" };
    }

    return new Promise((resolve) => {
      session.resolveResult = resolve;
      try {
        stdin.write(`${PROTOCOL.CODE_PREFIX} ${code}\n`);
      } catch (err) {
        resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
        cleanupSession(sessionId);
      }
    });
  }

  // Register RPC handlers
  alia.rpc.register(rpcContract, {
    async auth_status() {
      return await fetchStatus();
    },
    async start_login() {
      return await startLoginSession();
    },
    async submit_code(params) {
      const res = await submitLoginCode(params.sessionId, params.code);
      if (res.success && res.status) {
        alia.realtime.publish(AUTH_CHANGED_CHANNEL, { status: res.status });
      }
      return res;
    },
    async cancel_login(params) {
      cleanupSession(params.sessionId);
      return { cancelled: true };
    },
    async clean_credentials() {
      const cleaned = await cleanCredentials();
      const status = await fetchStatus();
      alia.realtime.publish(AUTH_CHANGED_CHANNEL, { status });
      return { cleaned };
    },
  });

  // Configure agent tools and skills
  alia.agents.configure((_context) => ({
    tools: ["claude_auth_status", "claude_auth_login"],
    skills: ["claude-auth"],
  }));

  // Register Agent Tools
  alia.agents.registerTool({
    name: "claude_auth_status",
    description: "Check the authentication status of the local Claude Code CLI, including whether auto-refresh tokens are valid or daily logout is occurring.",
    presentation: {
      label: {
        pending: "Checking Claude auth status",
        completed: "Checked Claude auth status",
      },
    },
    parameters: z.object({}),
    async execute() {
      const status = await fetchStatus();
      return formatStatusText(status);
    },
  });

  alia.agents.registerTool({
    name: "claude_auth_login",
    description: "Initiate Claude Code CLI authentication. Opens an interactive OAuth flow accessible on mobile or remote browsers via Tailscale, allowing the user to sign in and submit the verification code.",
    presentation: {
      label: {
        pending: "Starting Claude login session",
        completed: "Started Claude login session",
      },
    },
    parameters: z.object({}),
    async execute(_params, { threadId }) {
      const status = await fetchStatus();

      let session: { sessionId: string; authUrl: string };
      try {
        session = await startLoginSession();
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to initiate Claude login: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }

      if (threadId) {
        // Render interaction form in thread
        void (async () => {
          try {
            const inputResult = await alia.ui.requestInput({
              threadId,
              rendererId: INTERACTION_RENDERER_ID,
              title: "Claude Code Authentication",
              payload: {
                sessionId: session.sessionId,
                authUrl: session.authUrl,
                accountEmail: (status.accountEmail ?? null) as string | null,
              },
              timeoutMs: 300_000,
            });

            if (inputResult.outcome === "cancelled") {
              cleanupSession(session.sessionId);
              await alia.sdk.threads.send({
                threadId,
                input: [{ type: "text", text: "Claude Code authentication was cancelled by the user.", mentions: [] }],
                mode: "steer-if-active",
              });
              return;
            }

            const code = (inputResult.value as { code?: string })?.code?.trim();
            if (!code) {
              cleanupSession(session.sessionId);
              await alia.sdk.threads.send({
                threadId,
                input: [{ type: "text", text: "No authorization code was provided.", mentions: [] }],
                mode: "steer-if-active",
              });
              return;
            }

            const res = await submitLoginCode(session.sessionId, code);
            if (res.success) {
              alia.realtime.publish(AUTH_CHANGED_CHANNEL, { status: res.status });
              await alia.sdk.threads.send({
                threadId,
                input: [
                  {
                    type: "text",
                    text: `✅ **Successfully authenticated Claude Code CLI!**\n` +
                      `- Account: ${res.status?.accountEmail ?? "Active"}\n` +
                      `- Subscription: ${res.status?.subscriptionType ?? "Standard"}\n` +
                      `- Refresh token: ${res.status?.hasRefreshToken ? "Present (in credential store)" : "Not present"}\n\n` +
                      `You can now run Claude commands and provider agents smoothly.`,
                    mentions: [],
                  },
                ],
                mode: "steer-if-active",
              });
            } else {
              await alia.sdk.threads.send({
                threadId,
                input: [
                  {
                    type: "text",
                    text: `❌ Authentication failed: ${res.error ?? "Invalid code"}. Please try calling \`claude_auth_login\` again.`,
                    mentions: [],
                  },
                ],
                mode: "steer-if-active",
              });
            }
          } catch (e) {
            alia.log.error(`Claude auth interaction encountered an error: ${e instanceof Error ? e.message : String(e)}`);
            cleanupSession(session.sessionId);
          }
        })();

        return "The Claude Code login card is now on your screen. Tap the link to authenticate on your mobile browser, copy the code, paste it into the form, and submit.";
      }

      return `Please visit this URL on your phone or browser to authenticate:\n\n${session.authUrl}\n\nSession ID: ${session.sessionId}`;
    },
  });

  // Register CLI Command: VesnALIA claude-auth [status|login|clean|submit]
  alia.cli.register({
    name: "claude-auth",
    summary: "Manage Claude Code CLI authentication and remote login",
    commands: [
      { name: "status", summary: "Check authentication status", usage: "alia claude-auth status [--json]" },
      { name: "login", summary: "Start an interactive remote login session", usage: "alia claude-auth login" },
      { name: "submit", summary: "Submit OAuth code for an active login session", usage: "alia claude-auth submit <sessionId> <code>" },
      { name: "clean", summary: "Clean credentials and reset dead flags", usage: "alia claude-auth clean" },
    ],
    async run(argv: string[], _ctx: PluginCliContext): Promise<PluginCliResult> {
      const sub = argv[0] || "status";

      if (sub === "status") {
        const isJson = argv.includes("--json");
        const st = await fetchStatus();
        const text = isJson ? JSON.stringify(st, null, 2) : formatStatusText(st);
        return { exitCode: 0, stdout: text + "\n" };
      }

      if (sub === "clean") {
        await cleanCredentials();
        const msg = "Cleaned up Claude Code credentials and reset dead OAuth flags in ~/.claude.json.\nRun `alia claude-auth login` to re-authenticate.";
        return { exitCode: 0, stdout: msg + "\n" };
      }

      if (sub === "login") {
        try {
          const session = await startLoginSession();
          const lines = [
            "Visit this URL to authenticate Claude Code on your browser or mobile phone:",
            "",
            session.authUrl,
            "",
            "After authorizing, copy the provided code and submit it with:",
            `  VesnALIA claude-auth submit ${session.sessionId} <code>`,
          ];
          return { exitCode: 0, stdout: lines.join("\n") + "\n" };
        } catch (e) {
          const errMsg = `Failed to start login session: ${e instanceof Error ? e.message : String(e)}`;
          return { exitCode: 1, stderr: errMsg + "\n" };
        }
      }

      if (sub === "submit") {
        const sessionId = argv[1];
        const code = argv[2];
        if (!sessionId || !code) {
          return { exitCode: 1, stderr: "Usage: VesnALIA claude-auth submit <sessionId> <code>\n" };
        }

        const res = await submitLoginCode(sessionId, code);
        if (res.success) {
          return { exitCode: 0, stdout: "Successfully authenticated Claude Code CLI!\n" };
        } else {
          return { exitCode: 1, stderr: `Authentication failed: ${res.error}\n` };
        }
      }

      return { exitCode: 1, stderr: `Unknown subcommand "${sub}". Available: status, login, submit, clean\n` };
    },
  });
}
