/**
 * Whether the FirstMate tab can be seen: VesnALIA keeps a closed panel's tabs mounted, so the board asks before
 * it reads. `experimental_useTabVisible` is VesnALIA 0.48's.
 *
 * It is looked up when the bundle runs, not when it is built. VesnALIA builds a plugin's app against its own
 * list of the SDK's exports: VesnALIA 0.47 refuses a named import of a hook it lacks, and resolves a namespace
 * read of one to nothing in the bundle. A git install is built once, by the VesnALIA it was installed on, and
 * keeps that bundle after VesnALIA is upgraded, so a bundle built by VesnALIA 0.47 must still find the hook on VesnALIA 0.48.
 * Every bundle reads the SDK's app members from `globalThis.__aliaPluginRuntime.pluginSdkApp`, the runtime VesnALIA
 * hands it (VesnALIA's build emits that read, and the SDK's own forwarders make it); this reads the hook from
 * the same place. Where it is absent (VesnALIA 0.47) the board reads whether it can be seen or not, as it did
 * before. Which applies is fixed when the module loads, so the hooks a component calls never change.
 */
import * as aliaApp from "@vesnalia/plugin-sdk/app";

type TabVisibleHook = () => boolean;

interface PluginRuntime {
  pluginSdkApp?: { experimental_useTabVisible?: unknown };
}

function lookUpHook(): TabVisibleHook | undefined {
  const runtime = (globalThis as { __aliaPluginRuntime?: PluginRuntime }).__aliaPluginRuntime;
  const fromRuntime = runtime?.pluginSdkApp?.experimental_useTabVisible;
  if (typeof fromRuntime === "function") return fromRuntime as TabVisibleHook;
  // In tests, with no runtime installed when this loads, the SDK's own export.
  return (aliaApp as Partial<typeof aliaApp>).experimental_useTabVisible;
}

const tabVisibleHook = lookUpHook();

export function useTabVisible(): boolean {
  return tabVisibleHook === undefined ? true : tabVisibleHook();
}
