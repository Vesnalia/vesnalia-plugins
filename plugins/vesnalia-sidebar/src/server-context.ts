import type { AliaPluginApi, PluginRpcHandlers } from "@vesnalia/plugin-sdk";
import type { aliaSidebarRpcContract } from "./contract";

export interface ServerContext {
  alia: AliaPluginApi;
  db: ReturnType<AliaPluginApi["storage"]["database"]>;
}

export type ServerHandlers = PluginRpcHandlers<typeof aliaSidebarRpcContract>;
