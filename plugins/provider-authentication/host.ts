import { spawn } from "node:child_process";
import {
  experimental_defineHostEntry,
  type ExperimentalHostRpcContext,
  type ExperimentalHostWorkerLease,
} from "@vesnalia/plugin-sdk/host";
import {
  type AuthAttempt,
  type AttemptState,
  hostContract,
  hostSignals,
  type ProviderStatus,
} from "./contract.js";
import {
  appendBoundedOutput,
  extractClaudeConsentUrl,
  parseClaudeStatus,
} from "./claude.js";

const STATUS_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 30_000;
const ATTEMPT_TIMEOUT_MS = 10 * 60_000;
const SUBMIT_TIMEOUT_MS = 60_000;

export interface SpawnedProcess {
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  onError(listener: (error: NodeJS.ErrnoException) => void): void;
  onExit(listener: (code: number | null) => void): void;
  write(input: string): void;
  kill(): void;
}

export interface HostDependencies {
  spawn(command: string, args: readonly string[]): SpawnedProcess;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

interface CommandResult {
  stdout: string;
  errorCode: string | null;
}

interface InternalAttempt {
  snapshot: AuthAttempt;
  process: SpawnedProcess;
  lease: ExperimentalHostWorkerLease;
  output: string;
  submitted: boolean;
  timer: ReturnType<typeof setTimeout>;
  ready: Promise<AuthAttempt>;
  resolveReady: (attempt: AuthAttempt) => void;
  exited: Promise<number | null>;
  resolveExited: (code: number | null) => void;
  notify: (state: AttemptState) => Promise<void>;
}

type HostContext = ExperimentalHostRpcContext<typeof hostSignals>;

function copyAttempt(attempt: InternalAttempt): AuthAttempt {
  return { ...attempt.snapshot };
}

function isTerminal(state: AttemptState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export function createProviderAuthenticationHostEntry(deps: HostDependencies) {
  let current: InternalAttempt | null = null;
  let lifecycleSignal: AbortSignal | null = null;

  function runCommand(
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let child: SpawnedProcess;
      try {
        child = deps.spawn(command, args);
      } catch (error) {
        resolve({
          stdout: "",
          errorCode: (error as NodeJS.ErrnoException).code ?? "spawn-failed",
        });
        return;
      }
      let stdout = "";
      let settled = false;
      const finish = (result: CommandResult): void => {
        if (settled) return;
        settled = true;
        deps.clearTimer(timer);
        resolve(result);
      };
      const timer = deps.setTimer(() => {
        child.kill();
        finish({ stdout, errorCode: "timeout" });
      }, timeoutMs);
      child.onStdout((chunk) => {
        stdout = appendBoundedOutput(stdout, chunk);
      });
      child.onError((error) => {
        finish({ stdout, errorCode: error.code ?? "spawn-failed" });
      });
      child.onExit(() => {
        finish({ stdout, errorCode: null });
      });
    });
  }

  async function inspect(): Promise<ProviderStatus> {
    const result = await runCommand("claude", ["auth", "status"], STATUS_TIMEOUT_MS);
    if (result.errorCode === "ENOENT") return { kind: "cli-missing" };
    const status = parseClaudeStatus(result.stdout);
    if (status !== null) return status;
    return {
      kind: "unavailable",
      message:
        result.errorCode === "timeout"
          ? "Claude Code did not respond in time."
          : "Claude Code did not return a valid authentication status.",
    };
  }

  function release(attempt: InternalAttempt): void {
    deps.clearTimer(attempt.timer);
    void attempt.lease.dispose();
  }

  function update(
    attempt: InternalAttempt,
    state: AttemptState,
    error: string | null = null,
  ): void {
    attempt.snapshot = {
      ...attempt.snapshot,
      state,
      error,
      consentUrl: isTerminal(state) ? null : attempt.snapshot.consentUrl,
    };
    attempt.resolveReady(copyAttempt(attempt));
    void attempt.notify(state).catch(() => undefined);
  }

  function fail(attempt: InternalAttempt, message: string, kill: boolean): void {
    if (isTerminal(attempt.snapshot.state)) return;
    if (kill) attempt.process.kill();
    update(attempt, "failed", message);
    release(attempt);
  }

  function disposeAttempt(): void {
    const attempt = current;
    current = null;
    if (attempt === null) return;
    if (!isTerminal(attempt.snapshot.state)) attempt.process.kill();
    release(attempt);
  }

  function bindLifecycle(signal: AbortSignal): void {
    if (lifecycleSignal === signal) return;
    lifecycleSignal = signal;
    signal.addEventListener("abort", disposeAttempt, { once: true });
  }

  async function begin(
    attemptId: string,
    context: HostContext,
  ): Promise<AuthAttempt> {
    bindLifecycle(context.lifecycle.signal);
    if (current !== null && !isTerminal(current.snapshot.state)) {
      if (current.snapshot.id !== attemptId) {
        throw new Error("Claude authentication is already in progress on this machine.");
      }
      return copyAttempt(current);
    }

    let child: SpawnedProcess;
    try {
      child = deps.spawn("claude", ["auth", "login", "--claudeai"]);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      return {
        id: attemptId,
        providerId: "claude-code",
        state: "failed",
        consentUrl: null,
        error: missing
          ? "Claude Code is not installed on this machine."
          : "Claude authentication could not be started.",
      };
    }

    let resolveReady!: (attempt: AuthAttempt) => void;
    let resolveExited!: (code: number | null) => void;
    const ready = new Promise<AuthAttempt>((resolve) => {
      resolveReady = resolve;
    });
    const exited = new Promise<number | null>((resolve) => {
      resolveExited = resolve;
    });
    const attempt: InternalAttempt = {
      snapshot: {
        id: attemptId,
        providerId: "claude-code",
        state: "starting",
        consentUrl: null,
        error: null,
      },
      process: child,
      lease: context.experimental_retainWorker(),
      output: "",
      submitted: false,
      timer: deps.setTimer(() => undefined, ATTEMPT_TIMEOUT_MS),
      ready,
      resolveReady,
      exited,
      resolveExited,
      notify: async (state) => {
        await context.experimental_emitSignal("attemptChanged", {
          attemptId,
          state,
        });
      },
    };
    deps.clearTimer(attempt.timer);
    attempt.timer = deps.setTimer(() => {
      fail(attempt, "Claude authentication expired. Start a new attempt.", true);
    }, ATTEMPT_TIMEOUT_MS);
    current = attempt;

    const readOutput = (chunk: string): void => {
      attempt.output = appendBoundedOutput(attempt.output, chunk);
      if (attempt.snapshot.consentUrl !== null) return;
      const consentUrl = extractClaudeConsentUrl(attempt.output);
      if (consentUrl === null) return;
      attempt.snapshot = { ...attempt.snapshot, consentUrl };
      update(attempt, "awaiting-code");
    };
    child.onStdout(readOutput);
    child.onStderr(readOutput);
    child.onError((error) => {
      fail(
        attempt,
        error.code === "ENOENT"
          ? "Claude Code is not installed on this machine."
          : "Claude authentication could not be started.",
        false,
      );
      attempt.resolveExited(null);
    });
    child.onExit((code) => {
      attempt.resolveExited(code);
      if (!attempt.submitted && !isTerminal(attempt.snapshot.state)) {
        fail(attempt, "Claude authentication ended before a code was submitted.", false);
      }
    });

    const startTimer = deps.setTimer(() => {
      if (attempt.snapshot.state === "starting") {
        fail(attempt, "Claude Code did not provide a consent link.", true);
      }
    }, START_TIMEOUT_MS);
    const result = await attempt.ready;
    deps.clearTimer(startTimer);
    return result;
  }

  return experimental_defineHostEntry({
    contract: hostContract,
    experimental_signals: hostSignals,
    handlers: {
      inspect,
      getAttempt() {
        return current === null ? null : copyAttempt(current);
      },
      begin({ attemptId }, context) {
        return begin(attemptId, context);
      },
      async submitCode({ attemptId, code }) {
        const attempt = current;
        if (attempt === null || attempt.snapshot.id !== attemptId) {
          throw new Error("This authentication attempt is no longer active.");
        }
        if (attempt.snapshot.state !== "awaiting-code") {
          throw new Error("Claude Code is not waiting for an authorization code.");
        }
        attempt.submitted = true;
        update(attempt, "submitting");
        try {
          attempt.process.write(`${code}\n`);
        } catch {
          fail(attempt, "The authorization code could not be submitted.", true);
          return copyAttempt(attempt);
        }
        let submitTimer!: ReturnType<typeof setTimeout>;
        const timedOut = new Promise<null>((resolve) => {
          submitTimer = deps.setTimer(() => resolve(null), SUBMIT_TIMEOUT_MS);
        });
        const exitCode = await Promise.race([attempt.exited, timedOut]);
        deps.clearTimer(submitTimer);
        if (exitCode === null) {
          fail(attempt, "Claude Code did not finish authentication in time.", true);
          return copyAttempt(attempt);
        }
        update(attempt, "verifying");
        const status = await inspect();
        if (exitCode === 0 && status.kind === "signed-in") {
          update(attempt, "succeeded");
          release(attempt);
        } else {
          fail(attempt, "Claude Code rejected the authorization code.", false);
        }
        return copyAttempt(attempt);
      },
      cancel({ attemptId }) {
        const attempt = current;
        if (attempt === null || attempt.snapshot.id !== attemptId) {
          throw new Error("This authentication attempt is no longer active.");
        }
        if (!isTerminal(attempt.snapshot.state)) {
          attempt.process.kill();
          update(attempt, "cancelled");
          release(attempt);
        }
        return copyAttempt(attempt);
      },
    },
    dispose() {
      disposeAttempt();
    },
  });
}

export default createProviderAuthenticationHostEntry({
  spawn(command, args) {
    const child = spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      onStdout(listener) {
        child.stdout.on("data", (chunk: Buffer) => listener(chunk.toString("utf8")));
      },
      onStderr(listener) {
        child.stderr.on("data", (chunk: Buffer) => listener(chunk.toString("utf8")));
      },
      onError(listener) {
        child.on("error", listener);
      },
      onExit(listener) {
        child.on("exit", listener);
      },
      write(input) {
        child.stdin.write(input);
      },
      kill() {
        child.kill("SIGTERM");
      },
    };
  },
  setTimer(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimer(timer) {
    clearTimeout(timer);
  },
});
