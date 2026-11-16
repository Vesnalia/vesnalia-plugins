import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi): Promise<void> {
  alia.log.info("Project Colors loaded");
}
