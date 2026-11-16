import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded; typography preferences stay on each client");
}
