// Until 1.0.0 this plugin was guided-review, and VesnALIA keeps a plugin's database under its id. The first start under
// the new id copies the former install's database in, so its reviews, drafts, and settings carry over.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export const FORMER_PLUGIN_ID = "guided-review";

type Database = ReturnType<AliaPluginApi["storage"]["database"]>;

/** Copy the former install's tables into `db` while `db` has none. True when it did. */
export function importFormerInstall(alia: AliaPluginApi, db: Database, checkLedger: () => void): boolean {
  if (alia.pluginId === FORMER_PLUGIN_ID) return false;
  if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table'`).get()) return false;
  const former = join(alia.server.experimental_dataDir, "plugins", FORMER_PLUGIN_ID, "data.db");
  if (!existsSync(former)) return false;
  db.prepare(`ATTACH DATABASE ? AS former`).run(former);
  try {
    checkLedger();
    // Tables first, each filled as it's made; then their indexes. Its _alia_migrations comes too, so no migration reruns.
    const schema = db.prepare(`SELECT type, name, sql FROM former.sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC`).all() as Array<{ type: string; name: string; sql: string }>;
    db.transaction(() => {
      for (const { type, name, sql } of schema) {
        db.exec(sql);
        if (type === "table") db.exec(`INSERT INTO main."${name}" SELECT * FROM former."${name}"`);
      }
    })();
  } finally {
    db.exec(`DETACH DATABASE former`);
  }
  alia.log.info(`Brought in the reviews from ${FORMER_PLUGIN_ID}`);
  return true;
}
