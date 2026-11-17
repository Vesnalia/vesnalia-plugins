// alia-box's server entry. See src/plugin/setup.ts.

import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { setup } from "./src/plugin/setup.ts";

export type { Contract } from "./src/plugin/contract.ts";

export default async function plugin(alia: AliaPluginApi): Promise<void> {
  await setup(alia);
}
