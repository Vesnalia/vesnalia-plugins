import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { contract } from "./contract";
export default function herdrTheme(alia: AliaPluginApi) {
  alia.settings.define({
    showBranches: { type: "boolean", label: "Show branch names", default: false,
      description: "Show VesnALIA's known Git branch beneath stock sidebar threads. Non-repository threads stay single-line." },
  });
  alia.rpc.register(contract, {
    select: async id => (await alia.sdk.theme.set(id)).themeId,
  });
}
