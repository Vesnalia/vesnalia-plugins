import { type BbPluginApi, defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createLoginSessions } from "./tokenmaxx/login.js";
import {
  dashboardSchema,
  manager,
  managerPaths,
  providerIdSchema,
  resetCreditsSchema,
  resetOutcomeSchema,
  tokenAnalyticsSchema,
} from "./tokenmaxx/manager.js";
import {
  BinaryMissingError,
  type DoctorCheck,
  parseDoctor,
  resolveBinary,
  runTokenmaxx,
} from "./tokenmaxx/process.js";
import { fingerprint, readState } from "./tokenmaxx/state.js";

const stateSchema = z.object({
  binaryPath: z.string().nullable(),
  daemon: z.enum(["running", "stopped", "missing-binary", "error"]),
  daemonError: z.string().nullable(),
  home: z.string(),
  proxyPort: z.number().nullable(),
  snapshot: dashboardSchema.nullable(),
  tokens: tokenAnalyticsSchema.nullable(),
  version: z.string().nullable(),
});

export type PluginState = z.infer<typeof stateSchema>;

const commandResultSchema = z.object({
  exitCode: z.number(),
  output: z.string(),
});

const loginProviderSchema = z.enum(["codex", "claude"]);

export const STATE_CHANNEL = "state";

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateSchema },
  refresh: { input: z.null(), output: stateSchema },
  switchAccount: {
    input: z.object({ accountId: z.string(), provider: providerIdSchema }).strict(),
    output: stateSchema,
  },
  setPolicy: {
    input: z
      .object({
        enabled: z.boolean().optional(),
        hiddenWindowIds: z.array(z.string()).optional(),
        hysteresisPercent: z.number().optional(),
        minimumDwellMilliseconds: z.number().optional(),
        provider: providerIdSchema,
        thresholdPercent: z.number().optional(),
      })
      .strict(),
    output: stateSchema,
  },
  removeAccount: {
    input: z.object({ accountId: z.string() }).strict(),
    output: stateSchema,
  },
  resetCredits: {
    input: z.object({ accountId: z.string() }).strict(),
    output: resetCreditsSchema,
  },
  consumeReset: {
    input: z.object({ accountId: z.string() }).strict(),
    output: z.object({ outcome: resetOutcomeSchema, state: stateSchema }),
  },
  doctor: {
    input: z.null(),
    output: z.object({
      checks: z.array(z.object({ detail: z.string(), name: z.string(), status: z.string() })),
      raw: z.string(),
    }),
  },
  daemonControl: {
    input: z.object({ action: z.enum(["start", "stop"]) }).strict(),
    output: z.object({ result: commandResultSchema, state: stateSchema }),
  },
  routing: {
    input: z
      .object({
        action: z.enum(["install", "uninstall"]),
        target: z.enum(["native", "pi"]),
      })
      .strict(),
    output: commandResultSchema,
  },
  startLogin: {
    input: z
      .object({ apiKey: z.boolean().default(false), provider: loginProviderSchema })
      .strict(),
    output: z.object({ terminalId: z.string() }),
  },
  loginOutput: {
    input: z.object({ sinceSeq: z.number(), terminalId: z.string() }).strict(),
    output: z.object({
      exitCode: z.number().nullable(),
      nextSeq: z.number(),
      status: z.string(),
      text: z.string(),
    }),
  },
  loginInput: {
    input: z.object({ data: z.string(), terminalId: z.string() }).strict(),
    output: z.object({ sent: z.boolean() }),
  },
  endLogin: {
    input: z.object({ terminalId: z.string() }).strict(),
    output: z.object({ state: stateSchema }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    binaryPath: {
      type: "string",
      label: "tokenmaxx binary",
      default: "",
    },
    home: {
      type: "string",
      label: "TOKENMAXX_HOME",
      default: "",
    },
    refreshSeconds: {
      type: "select",
      label: "Dashboard refresh (seconds)",
      options: ["3", "5", "10", "30", "60"],
      default: "5",
    },
  });

  const logins = createLoginSessions(bb);

  const context = async () => {
    const values = await settings.get();
    const paths = managerPaths(values.home);
    return {
      client: manager(paths.socketPath),
      configuredBinary: values.binaryPath,
      paths,
      refreshMs: Number(values.refreshSeconds) * 1_000,
    };
  };

  const currentState = async () => {
    const { configuredBinary, paths } = await context();
    return readState({
      configuredBinary,
      root: paths.root,
      socketPath: paths.socketPath,
    });
  };

  const announce = async () => {
    const state = await currentState();
    bb.realtime.publish(STATE_CHANNEL, { fingerprint: fingerprint(state) });
    return state;
  };

  const command = async (args: string[], timeoutMs: number) => {
    const { configuredBinary, paths } = await context();
    const binary = resolveBinary(configuredBinary);
    if (binary === null) throw new BinaryMissingError();
    const result = await runTokenmaxx({ args, binary, home: paths.root, timeoutMs });
    return {
      exitCode: result.exitCode,
      output: [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join("\n"),
    };
  };

  bb.rpc.register(rpcContract, {
    state: () => currentState(),

    refresh: async () => {
      const { client } = await context();
      await client.refresh();
      return announce();
    },

    switchAccount: async ({ accountId, provider }) => {
      const { client } = await context();
      await client.switchAccount(provider, accountId);
      return announce();
    },

    setPolicy: async (patch) => {
      const { client } = await context();
      // Auto-rotation only switches once the user has authorized it, and
      // turning it on in this panel is that authorization.
      await client.setPolicy(
        patch.enabled === true ? { ...patch, authorizationConfirmed: true } : patch,
      );
      return announce();
    },

    removeAccount: async ({ accountId }) => {
      const { client } = await context();
      await client.removeAccount(accountId);
      return announce();
    },

    resetCredits: async ({ accountId }) => {
      const { client } = await context();
      return client.resetCredits(accountId);
    },

    consumeReset: async ({ accountId }) => {
      const { client } = await context();
      const outcome = await client.consumeReset(accountId);
      return { outcome, state: await announce() };
    },

    doctor: async () => {
      const result = await command(["doctor"], 60_000);
      const checks: DoctorCheck[] = parseDoctor(result.output);
      return { checks, raw: result.output };
    },

    daemonControl: async ({ action }) => {
      const result = await command(["daemon", action], 90_000);
      return { result, state: await announce() };
    },

    routing: ({ action, target }) =>
      command(target === "pi" ? [action, "pi"] : [action], 90_000),

    startLogin: async ({ apiKey, provider }) => {
      const { configuredBinary, paths } = await context();
      const binary = resolveBinary(configuredBinary);
      if (binary === null) throw new BinaryMissingError();
      return logins.start({
        args: ["login", provider, ...(apiKey ? ["--api-key"] : [])],
        binary,
        home: paths.root,
        title: `tokenmaxx login ${provider}`,
      });
    },

    loginOutput: ({ sinceSeq, terminalId }) => logins.read({ sinceSeq, terminalId }),

    loginInput: async ({ data, terminalId }) => {
      await logins.write({ data, terminalId });
      return { sent: true };
    },

    endLogin: async ({ terminalId }) => {
      await logins.close(terminalId);
      return { state: await announce() };
    },
  });

  bb.background.service("poll", {
    async start(signal) {
      let previous = "";
      while (!signal.aborted) {
        try {
          const state = await currentState();
          const next = fingerprint(state);
          if (next !== previous) {
            previous = next;
            bb.realtime.publish(STATE_CHANNEL, { fingerprint: next });
          }
        } catch (error) {
          bb.log.warn(`poll failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { refreshMs } = await context();
        await new Promise<void>((wake) => {
          const timer = setTimeout(wake, refreshMs);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              wake();
            },
            { once: true },
          );
        });
      }
    },
  });

  bb.onDispose(async () => {
    await logins.closeAll();
  });
}
