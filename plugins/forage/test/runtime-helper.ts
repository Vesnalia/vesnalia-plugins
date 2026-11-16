import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { createForageRuntime, type RuntimeDependencies } from "../src/operations.ts";
import { SqliteSourceRepository } from "../src/sources/repository.ts";
import { configureSourceDatabase, SOURCE_MIGRATIONS } from "../src/sources/schema.ts";
import type { WebConfig } from "../src/web/config.ts";

export function fixtureRuntime(alia: AliaPluginApi, getConfig: () => Promise<WebConfig>, overrides: Partial<RuntimeDependencies> = {}) {
 const db = alia.storage.database(); configureSourceDatabase(db); alia.storage.migrate(db, [...SOURCE_MIGRATIONS]);
 const unsupported = (): never => { throw new Error("Crawl not installed in this fetch-only fixture"); };
 const runtime = createForageRuntime({ getConfig, sources: new SqliteSourceRepository(db), resolveScope: async scope => scope, allowRestrictedThreadCapture: () => false,
  jobs: { create: unsupported, status: unsupported, list: unsupported, cancel: unsupported, resume: unsupported, cancelScope: unsupported, run: unsupported, wake: unsupported }, ...overrides });
 alia.onDispose(() => runtime.dispose());
 return runtime;
}
