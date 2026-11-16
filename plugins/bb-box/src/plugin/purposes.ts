import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { forPurpose } from "../transports/spawns.ts";

type RegisterTool = AliaPluginApi["agents"]["registerTool"];

/** alia.agents.registerTool, with what each tool starts counted as for "tool <its name>". */
const registered = new WeakMap<AliaPluginApi, string[]>();

export function registeredTools(alia: AliaPluginApi): readonly string[] {
  return registered.get(alia) ?? [];
}

export function toolsForPurposes(alia: AliaPluginApi): RegisterTool {
  return ((tool: { name: string; execute: (params: unknown, context: unknown) => unknown }) => {
    alia.agents.registerTool({ ...tool, execute: (params: unknown, context: unknown) => forPurpose(`tool ${tool.name}`, () => tool.execute(params, context)) } as never);
    registered.set(alia, [...registeredTools(alia), tool.name]);
  }) as RegisterTool;
}
