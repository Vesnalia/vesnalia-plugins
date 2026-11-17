// Local bench provider (example) — VesnALIA server entry. Wiring only; the logic is
// in provider.ts. Machines are directories under the OS temp dir.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { benchProviderContract } from "./contract.ts";
import { createLocalBenchProvider } from "./provider.ts";

export default async function plugin(alia: AliaPluginApi): Promise<void> {
  const provider = createLocalBenchProvider();
  alia.rpc.register(benchProviderContract, provider.handlers, {
    experimental_description: "Example bench provider: lends local temp directories as bench machines.",
  });
  // Stops timers and kills running execs; machines and state.json stay so a
  // reloaded plugin still lists and destroys them.
  alia.onDispose(() => provider.dispose());
}
