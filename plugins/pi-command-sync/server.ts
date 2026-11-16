import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { hostContract, rpcContract } from "./contract.js";

export default function plugin(alia: AliaPluginApi) {
  const host = alia.hosts.experimental_client({ contract: hostContract });
  alia.providers.experimental_contributeEnv("pi", async ({ hostId }) => {
    const { launcher } = await host.call("prepareRuntime", null, { hostId });
    return [{ name: "ALIA_PI_BRIDGE_COMMAND", value: launcher, reason: "Load native Pi commands in VesnALIA" }];
  });
  alia.rpc.register(rpcContract, {
    syncCommands: ({ hostId, cwd }) => host.call("syncCommands", { cwd }, { hostId }),
  });
  alia.cli.register({
    name: "pi-command-sync", summary: "Refresh the ordinary Pi command menu without a model call",
    commands: [{ name: "sync", summary: "Sync a host's Pi commands", usage: "alia pi-command-sync sync --host <host-id> [--cwd <absolute-path>]" }],
    async run(argv) {
      const usage = "alia pi-command-sync sync --host <host-id> [--cwd <absolute-path>]";
      if (argv.length < 3 || argv[0] !== "sync" || argv[1] !== "--host" || !argv[2] ||
          (argv.length !== 3 && (argv.length !== 5 || argv[3] !== "--cwd" || !argv[4]))) {
        return { exitCode: 1, stderr: usage };
      }
      const result = await host.call("syncCommands", { cwd: argv[4] ?? null }, { hostId: argv[2] });
      return { exitCode: 0, stdout: JSON.stringify({ providerId: "pi", ...result }) };
    },
  });
}
