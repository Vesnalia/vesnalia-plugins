/**
 * Disposable spawns (draft bursts, independent reviews).
 *
 * These die with their worker through lifecycleOwnerThreadId (VesnALIA 0.43
 * dependent threads). Hosts predating the field strip unknown keys and honor
 * the spawn; a host that rejects it instead gets one retry without the field,
 * so drafts and reviews never break on older daemons.
 */
import { type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { assertDisposableSpawn } from "../../lib/delegation-map.mjs";
import { spawnThread } from "../workers-spawn.js";

type SpawnArgs = Parameters<AliaPluginApi["sdk"]["threads"]["spawn"]>[0];

export function createDisposableSpawner(alia: AliaPluginApi) {
  return async function spawnDisposable(
    args: SpawnArgs,
    site: string,
  ): Promise<{ id: string }> {
    // Fail fast through the registry before any SDK call: unknown sites,
    // visible spawns, and full permission refuse here, not mid-flight.
    assertDisposableSpawn({ site, args });
    try {
      return await spawnThread(alia, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        "lifecycleOwnerThreadId" in args &&
        /lifecycleOwnerThreadId|unrecognized key/i.test(message)
      ) {
        const { lifecycleOwnerThreadId: _dropped, ...rest } =
          args as SpawnArgs & Record<string, unknown>;
        return await spawnThread(alia, rest as SpawnArgs);
      }
      throw error;
    }
  };
}

export type SpawnDisposable = ReturnType<typeof createDisposableSpawner>;
