import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { createPlugin } from "./src/plugin.ts";

/** Unife Pages for VesnALIA: every session gets one page it writes itself. */
export default async function aliaPagesPlugin(alia: AliaPluginApi): Promise<void> {
  await createPlugin(alia);
}
