import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { runPluginMigrations } from "../core-migrations.js";
import { runExecutionMigrations } from "../execution-contract.js";
import { createPluginUpdateChecker } from "./plugin-update.js";

type Db = ReturnType<AliaPluginApi["storage"]["database"]>;

type StartupDeps = {
  alia: AliaPluginApi;
  db: Db;
  now: () => number;
  installedVersion: string;
};

export function startRuntimeServices(deps: StartupDeps) {
  const updates = createPluginUpdateChecker({
    alia: deps.alia,
    installedVersion: deps.installedVersion,
    now: deps.now,
  });
  deps.alia.background.schedule("stelow-plugin-update-check", "17 6 * * *", () => void updates.refresh(true));
  // The check starts at boot and is cancelled at reload: it holds the API
  // handle, and a fetch that outlives the plugin turns into "stale API handle"
  // plus an unsettled invocation the host has to time out.
  deps.alia.onDispose(() => updates.dispose());
  void updates.refresh();
  runPluginMigrations(deps.alia, deps.db, deps.now);
  runExecutionMigrations(deps.db);
  return { updates };
}
