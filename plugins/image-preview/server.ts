import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
