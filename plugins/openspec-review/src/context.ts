import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { Scope } from "./contracts.js";

export async function resolveContext(alia: AliaPluginApi, scope: Scope) {
  const environment = await alia.sdk.environments.get({ environmentId: scope.environmentId });
  if (environment.projectId !== scope.projectId) throw new Error("environment_project_mismatch");
  if (!environment.path || !environment.hostId) throw new Error("environment_not_ready");
  const host = await alia.sdk.hosts.get({ hostId: environment.hostId });
  if (host.status !== "connected") throw new Error("host_disconnected");
  return { hostId: environment.hostId, checkout: environment.path, cwd: environment.path };
}
