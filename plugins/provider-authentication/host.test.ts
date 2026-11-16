import { experimental_createHostEntryHarness } from "@vesnalia/plugin-sdk/testing/host";
import { describe, expect, it, vi } from "vitest";
import {
  createProviderAuthenticationHostEntry,
  type HostDependencies,
  type SpawnedProcess,
} from "./host.js";

const consentUrl =
  "https://claude.com/cai/oauth/authorize?response_type=code&state=state-1&code_challenge=challenge-1";

class FakeProcess implements SpawnedProcess {
  readonly writes: string[] = [];
  readonly kill = vi.fn();
  private stdoutListeners: Array<(chunk: string) => void> = [];
  private stderrListeners: Array<(chunk: string) => void> = [];
  private errorListeners: Array<(error: NodeJS.ErrnoException) => void> = [];
  private exitListeners: Array<(code: number | null) => void> = [];

  onStdout(listener: (chunk: string) => void): void {
    this.stdoutListeners.push(listener);
  }

  onStderr(listener: (chunk: string) => void): void {
    this.stderrListeners.push(listener);
  }

  onError(listener: (error: NodeJS.ErrnoException) => void): void {
    this.errorListeners.push(listener);
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  write(input: string): void {
    this.writes.push(input);
  }

  emitStdout(chunk: string): void {
    for (const listener of this.stdoutListeners) listener(chunk);
  }

  emitStderr(chunk: string): void {
    for (const listener of this.stderrListeners) listener(chunk);
  }

  emitError(code: string): void {
    const error = Object.assign(new Error("process error"), { code });
    for (const listener of this.errorListeners) listener(error);
  }

  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }
}

function createDependencies(status: object) {
  const loginProcesses: FakeProcess[] = [];
  const spawn = vi.fn((_command: string, args: readonly string[]) => {
    const process = new FakeProcess();
    if (args[0] === "auth" && args[1] === "status") {
      queueMicrotask(() => {
        process.emitStdout(JSON.stringify(status));
        process.emitExit(0);
      });
    } else {
      loginProcesses.push(process);
    }
    return process;
  });
  const deps: HostDependencies = {
    spawn,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
  };
  return { deps, loginProcesses, spawn };
}

describe("provider authentication host entry", () => {
  it("reports first-time signed-out and existing signed-in states", async () => {
    const signedOut = createDependencies({ loggedIn: false, authMethod: "none" });
    const signedOutHarness = experimental_createHostEntryHarness(
      createProviderAuthenticationHostEntry(signedOut.deps),
    );
    await expect(signedOutHarness.experimental_call("inspect", null)).resolves.toEqual({
      kind: "signed-out",
    });
    await signedOutHarness.experimental_dispose();

    const signedIn = createDependencies({
      loggedIn: true,
      email: "person@example.com",
      orgName: "Example",
      subscriptionType: "max",
    });
    const signedInHarness = experimental_createHostEntryHarness(
      createProviderAuthenticationHostEntry(signedIn.deps),
    );
    await expect(signedInHarness.experimental_call("inspect", null)).resolves.toEqual({
      kind: "signed-in",
      identity: "person@example.com",
      organization: "Example",
      subscription: "max",
    });
    await signedInHarness.experimental_dispose();
  });

  it("retains the worker, submits the opaque code, and verifies success", async () => {
    const { deps, loginProcesses } = createDependencies({
      loggedIn: true,
      email: "person@example.com",
      subscriptionType: "max",
    });
    const harness = experimental_createHostEntryHarness(
      createProviderAuthenticationHostEntry(deps),
    );

    const beginning = harness.experimental_call("begin", { attemptId: "attempt-1" });
    await vi.waitFor(() => expect(loginProcesses).toHaveLength(1));
    loginProcesses[0]!.emitStdout(`Opening browser\n${consentUrl.slice(0, 55)}`);
    loginProcesses[0]!.emitStderr(consentUrl.slice(55));

    await expect(beginning).resolves.toMatchObject({
      id: "attempt-1",
      state: "awaiting-code",
      consentUrl,
    });
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);

    const submitting = harness.experimental_call("submitCode", {
      attemptId: "attempt-1",
      code: "opaque-code#state-1",
    });
    await vi.waitFor(() =>
      expect(loginProcesses[0]!.writes).toEqual(["opaque-code#state-1\n"]),
    );
    loginProcesses[0]!.emitExit(0);

    await expect(submitting).resolves.toMatchObject({
      id: "attempt-1",
      state: "succeeded",
      consentUrl: null,
      error: null,
    });
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    expect(JSON.stringify(harness.experimental_getSignals())).not.toContain("opaque-code");
    await harness.experimental_dispose();
  });

  it("rejects concurrent attempts and cancels only its owned process", async () => {
    const { deps, loginProcesses } = createDependencies({ loggedIn: false });
    const harness = experimental_createHostEntryHarness(
      createProviderAuthenticationHostEntry(deps),
    );

    const beginning = harness.experimental_call("begin", { attemptId: "attempt-1" });
    await vi.waitFor(() => expect(loginProcesses).toHaveLength(1));
    loginProcesses[0]!.emitStdout(consentUrl);
    await beginning;

    await expect(
      harness.experimental_call("begin", { attemptId: "attempt-2" }),
    ).rejects.toThrow("already in progress");
    await expect(
      harness.experimental_call("cancel", { attemptId: "attempt-1" }),
    ).resolves.toMatchObject({ state: "cancelled", consentUrl: null });
    expect(loginProcesses[0]!.kill).toHaveBeenCalledOnce();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    await harness.experimental_dispose();
  });

  it("stops an active login when the worker lifecycle is disposed", async () => {
    const { deps, loginProcesses } = createDependencies({ loggedIn: false });
    const harness = experimental_createHostEntryHarness(
      createProviderAuthenticationHostEntry(deps),
    );
    const beginning = harness.experimental_call("begin", { attemptId: "attempt-1" });
    await vi.waitFor(() => expect(loginProcesses).toHaveLength(1));
    loginProcesses[0]!.emitStdout(consentUrl);
    await beginning;

    await harness.experimental_dispose();
    expect(loginProcesses[0]!.kill).toHaveBeenCalledOnce();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  });
});
