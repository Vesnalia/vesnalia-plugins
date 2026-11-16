// alia-plugin-design-director — backend entry.
//
// This plugin is headless on purpose. Everything it ships lives in
// skills/design-director/, which VesnALIA injects into every agent thread as the
// plugin skills tier (see `alia.skills` in package.json). The skill drives the
// design process through the `VesnALIA` CLI and the scripts beside it, so there is
// no page, no RPC surface, and no plugin-owned storage to register here.
//
// VesnALIA still requires a server entry, so this is it: a factory that logs and
// returns.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function plugin(alia: AliaPluginApi) {
  alia.log.info("design-director skill available to threads");
}
