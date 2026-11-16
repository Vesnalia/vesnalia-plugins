import type { BbPluginApi } from "@get-bb/plugin-sdk";

// `tokenmaxx login` drives `codex login` / `claude setup-token` with inherited
// stdio, so it needs a real pty. A bb terminal on the server's own host is one,
// and its output can be streamed into the panel.
export const createLoginSessions = (bb: BbPluginApi) => {
  const sessions = new Set<string>();

  const primaryHostId = async (): Promise<string> => {
    const config = await bb.sdk.system.config();
    if (config.primaryHostId === null) {
      throw new Error("bb has no primary host to run the login on.");
    }
    return config.primaryHostId;
  };

  return {
    start: async (input: { binary: string; home: string; args: string[]; title: string }) => {
      const home = input.home.trim();
      const prefix = home.length > 0 ? `TOKENMAXX_HOME=${JSON.stringify(home)} ` : "";
      const command = `${prefix}${JSON.stringify(input.binary)} ${input.args.join(" ")}`;
      const terminal = await bb.sdk.terminals.create({
        cols: 100,
        rows: 30,
        scope: { kind: "host_path", hostId: await primaryHostId(), cwd: null },
        start: { command, mode: "command" },
        title: input.title,
      });
      sessions.add(terminal.id);
      return { terminalId: terminal.id };
    },

    read: async (input: { terminalId: string; sinceSeq: number }) => {
      const [output, session] = await Promise.all([
        bb.sdk.terminals.output({ terminalId: input.terminalId, sinceSeq: input.sinceSeq }),
        bb.sdk.terminals.get({ terminalId: input.terminalId }),
      ]);
      return {
        text: output.chunks
          .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
          .join(""),
        nextSeq: output.nextSeq,
        status: session.status,
        exitCode: session.exitCode,
      };
    },

    write: async (input: { terminalId: string; data: string }) => {
      await bb.sdk.terminals.input({
        terminalId: input.terminalId,
        dataBase64: Buffer.from(input.data, "utf8").toString("base64"),
      });
    },

    close: async (terminalId: string) => {
      sessions.delete(terminalId);
      await bb.sdk.terminals.close({ terminalId, mode: "force" }).catch(() => undefined);
    },

    closeAll: async () => {
      const open = [...sessions];
      sessions.clear();
      await Promise.allSettled(
        open.map((terminalId) => bb.sdk.terminals.close({ terminalId, mode: "force" })),
      );
    },
  };
};
