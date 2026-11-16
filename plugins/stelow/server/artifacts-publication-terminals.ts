import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { parsePushRemoteUrl } from "../lib/remote-url.mjs";

export type PushShellSession = {
  id: string;
  title: string;
  status: string;
  exitCode: number | null;
  createdAt: number;
};

type PushRead = {
  text: string | null;
  unavailable: boolean;
  pushState: "waiting" | "running" | "succeeded" | "failed";
  pushExit: number | null;
};

function decodeOutput(chunks: Array<{ dataBase64: string }>): string {
  return chunks
    .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
    .join("")
    // Terminal output legitimately contains carriage returns and ANSI controls.
    // eslint-disable-next-line no-control-regex
    .replace(/[^\n]*\r(?!\n)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    .slice(-4000);
}

export async function readPushShell(
  alia: AliaPluginApi,
  session: PushShellSession,
): Promise<PushRead> {
  try {
    const out = await alia.sdk.terminals.output({ terminalId: session.id, tailBytes: 8000 });
    const text = decodeOutput((out.chunks ?? []) as Array<{ dataBase64: string }>);
    const marker = text.match(/STELOW_PUSH_EXIT:(\d+)/);
    const parsed = marker ? Number.parseInt(marker[1] ?? "", 10) : null;
    const pushExit = parsed !== null && Number.isNaN(parsed) ? null : parsed;
    const pushState = marker
      ? (pushExit === 0 ? "succeeded" as const : "failed" as const)
      : /git push\s*$/.test(text) ? "waiting" as const : "running" as const;
    return { text: text || null, unavailable: false, pushState, pushExit };
  } catch {
    return { text: null, unavailable: true, pushState: "failed" as const, pushExit: null };
  }
}

export async function pushShellSessions(
  alia: AliaPluginApi,
  environmentId: string,
): Promise<PushShellSession[]> {
  const listed = await alia.sdk.terminals.list({
    scope: { kind: "environment", environmentId },
  }).catch(() => null);
  const sessions = (listed as { sessions?: PushShellSession[] } | null)?.sessions ?? [];
  return sessions
    .filter((session) => session.title.startsWith("Stelow push"))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);
}

export async function livePushShell(
  alia: AliaPluginApi,
  environmentId: string,
): Promise<PushShellSession | null> {
  for (const session of await pushShellSessions(alia, environmentId)) {
    const read = await readPushShell(alia, session);
    if (!read.unavailable && read.pushState === "running") return session;
  }
  return null;
}

export async function retirePushShells(
  alia: AliaPluginApi,
  environmentId: string,
): Promise<void> {
  const previous = await pushShellSessions(alia, environmentId);
  for (const session of previous) {
    await alia.sdk.terminals.close({ terminalId: session.id, mode: "if-clean" }).catch(() => null);
  }
  for (const session of previous) {
    const read = await readPushShell(alia, session);
    if (read.unavailable || read.pushState !== "running") {
      await alia.sdk.terminals.close({ terminalId: session.id, mode: "force" }).catch(() => null);
    }
  }
}

export async function createPublicationShell(
  alia: AliaPluginApi,
  environmentId: string,
  title: string,
): Promise<{ id: string }> {
  const terminal = await alia.sdk.terminals.create({
    cols: 120,
    rows: 30,
    scope: { kind: "environment", environmentId },
    start: { mode: "shell" },
    title,
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const live = await alia.sdk.terminals.get({ terminalId: terminal.id }).catch(() => null);
    if (live?.status === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return terminal;
}

export async function sendShellCommand(
  alia: AliaPluginApi,
  terminalId: string,
  command: string,
): Promise<void> {
  await alia.sdk.terminals.input({
    terminalId,
    dataBase64: Buffer.from(`${command}\r`).toString("base64"),
  });
}

export async function pushTerminalSnapshot(
  alia: AliaPluginApi,
  environmentId: string,
) {
  const sessions = await pushShellSessions(alia, environmentId);
  const terminals = await Promise.all(sessions.map(async (session) => {
    const read = await readPushShell(alia, session);
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
      pushState: read.pushState,
      pushExit: read.pushExit,
      outputTail: read.text,
      outputUnavailable: read.unavailable,
    };
  }));
  let remote: { owner: string; repo: string; webUrl: string } | null = null;
  for (const terminal of terminals) {
    remote = parsePushRemoteUrl(terminal.outputTail);
    if (remote) break;
  }
  return { remote, terminals };
}
