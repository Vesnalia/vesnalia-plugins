import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");
  return () => {
    alia.log.info("disposed");
  };
}
