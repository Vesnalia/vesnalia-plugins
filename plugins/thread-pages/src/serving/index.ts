// createAliaServingHost(VesnALIA): ServingHost over alia.http (DESIGN §C). `files` absent (R-S7 is core on VesnALIA, D-alia-4);
// `surface` absent (D-alia-18).
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { ServingHost } from "../../core/src/host/index.ts";
import { mountRoutes } from "./mount.ts";
import { createOrigin, createOwnOrigins, loopbackOrigin } from "./origin.ts";

export function routeBase(pluginId: string): string {
  return `/api/v1/plugins/${pluginId}/http`;
}

export function createAliaServingHost(alia: AliaPluginApi): ServingHost {
  const base = routeBase(alia.pluginId);
  return {
    mount: (routes) => mountRoutes(alia, routes),
    base: () => base,
    origin: createOrigin(alia),
    ownOrigins: createOwnOrigins(alia),
    checkOrigin: async () => loopbackOrigin(alia), // 04 R6.7a: VesnALIA's loopback server opens the page with no sign-in (HOST_FACTS H-25)
  };
}
