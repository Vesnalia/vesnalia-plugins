import path from "node:path";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  PERMISSION_MODES,
  type PermissionMode,
  type ResolvedExecution,
} from "./execution";

/**
 * VesnALIA's remembered execution defaults: one row per project in VesnALIA's own
 * database (`project_execution_defaults`). A chat created without an explicit
 * provider — `alia thread spawn` without `--provider`, a new chat outside a
 * section — starts from this row. VesnALIA writes it only when a chat is created in
 * its own composer, so a choice made in this plugin never reached it.
 *
 * The Plugin SDK can read the row (`projects.defaultExecutionOptions`) but
 * not write it, so the plugin writes it the way VesnALIA itself does: one upsert of
 * one row, inside an immediate transaction, after checking the table still
 * has the columns VesnALIA's upsert uses. A core setter would replace this file.
 *
 * Only the project's own level writes here: VesnALIA keeps one row per project,
 * and a chat started without a section lands in the project root.
 */
export type Remembered = {
  providerId: string;
  model: string;
  reasoningLevel: string;
  serviceTier: string;
  permissionMode: PermissionMode;
};

/** VesnALIA's own defaults for the fields it requires and the plugin may not pin. */
const ALIA_DEFAULT_REASONING = "medium";
const ALIA_DEFAULT_SERVICE_TIER = "default";
const ALIA_DEFAULT_PERMISSION: PermissionMode = "auto";

const COLUMNS = [
  "project_id",
  "provider_id",
  "model",
  "service_tier",
  "reasoning_level",
  "permission_mode",
  "updated_at",
] as const;

export const rememberedSchema = z.object({
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: z.string(),
  serviceTier: z.string(),
  permissionMode: z.enum(PERMISSION_MODES),
});

/** What the project page tells about VesnALIA's row, next to the plugin's own pins. */
export const aliaDefaultsSchema = z.object({
  /** VesnALIA's row for this project, or null when it has none. */
  remembered: rememberedSchema.nullable(),
  /** The remembered provider has a live bridge on the project's machine. */
  rememberedAvailable: z.boolean(),
  /** What the plugin's project setting would write; null when it pins nothing VesnALIA stores. */
  wanted: rememberedSchema.nullable(),
  /** The pinned provider has a live bridge on the project's machine. */
  wantedAvailable: z.boolean(),
  /** VesnALIA's row already says what the plugin pins. */
  matches: z.boolean(),
});
export type AliaDefaults = z.infer<typeof aliaDefaultsSchema>;

export const aliaSyncSchema = z.object({
  status: z.enum(["written", "unchanged", "nothing", "unavailable", "failed"]),
  providerId: z.string().nullable(),
  message: z.string().nullable(),
});
export type AliaSync = z.infer<typeof aliaSyncSchema>;

/**
 * The row the plugin's project setting stands for. Fields the plugin does not
 * pin keep VesnALIA's current value when it belongs to the same provider, else
 * VesnALIA's own default. With no provider pinned the row keeps VesnALIA's provider and
 * only the permission mode can change; with nothing pinned there is nothing
 * to say.
 */
export function wantedRemembered(
  resolved: Pick<ResolvedExecution, "model" | "permissionMode">,
  current: Remembered | null,
): Remembered | null {
  const permission = resolved.permissionMode?.value;
  const pin = resolved.model;
  if (!pin) {
    if (!permission || !current) return null;
    return { ...current, permissionMode: permission };
  }
  const same = current?.providerId === pin.providerId ? current : null;
  return {
    providerId: pin.providerId,
    model: pin.model,
    reasoningLevel:
      pin.reasoningLevel ?? same?.reasoningLevel ?? ALIA_DEFAULT_REASONING,
    serviceTier: pin.serviceTier ?? same?.serviceTier ?? ALIA_DEFAULT_SERVICE_TIER,
    permissionMode:
      permission ?? current?.permissionMode ?? ALIA_DEFAULT_PERMISSION,
  };
}

export const sameRemembered = (a: Remembered | null, b: Remembered | null) =>
  !!a &&
  !!b &&
  a.providerId === b.providerId &&
  a.model === b.model &&
  a.reasoningLevel === b.reasoningLevel &&
  a.serviceTier === b.serviceTier &&
  a.permissionMode === b.permissionMode;

/** VesnALIA's row as the SDK reports it, or null when it is missing or unreadable. */
export function parseRemembered(value: unknown): Remembered | null {
  const parsed = rememberedSchema.safeParse(value);
  return parsed.success && parsed.data.providerId && parsed.data.model
    ? parsed.data
    : null;
}

export const aliaDatabasePath = (dataDir: string) =>
  path.join(dataDir, "alia.db");

type DatabaseCtor = new (
  filename: string,
  options?: Database.Options,
) => Database.Database;

/**
 * Upserts one project's row in VesnALIA's database. `Ctor` is the server's own
 * better-sqlite3, taken from the plugin's storage handle, so no second
 * native build is loaded. VesnALIA keeps the file in WAL mode: readers never wait,
 * and a concurrent writer waits up to the busy timeout instead of failing.
 */
export function writeRemembered(
  Ctor: DatabaseCtor,
  file: string,
  projectId: string,
  value: Remembered,
): "written" | "unchanged" {
  const db = new Ctor(file, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    const columns = new Set(
      (
        db.prepare("PRAGMA table_info(project_execution_defaults)").all() as {
          name: string;
        }[]
      ).map((c) => c.name),
    );
    const missing = COLUMNS.filter((c) => !columns.has(c));
    if (missing.length)
      throw new Error(
        `VesnALIA's project_execution_defaults table changed (missing ${missing.join(", ")}). Not written.`,
      );
    return db
      .transaction(() => {
        if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId))
          throw new Error(`VesnALIA has no project ${projectId}.`);
        const row = db
          .prepare(
            "SELECT provider_id AS providerId, model, reasoning_level AS reasoningLevel, service_tier AS serviceTier, permission_mode AS permissionMode FROM project_execution_defaults WHERE project_id=?",
          )
          .get(projectId);
        if (sameRemembered(parseRemembered(row), value))
          return "unchanged" as const;
        db.prepare(
          `INSERT INTO project_execution_defaults (project_id, provider_id, model, service_tier, reasoning_level, permission_mode, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET provider_id=excluded.provider_id, model=excluded.model,
             service_tier=excluded.service_tier, reasoning_level=excluded.reasoning_level,
             permission_mode=excluded.permission_mode, updated_at=excluded.updated_at`,
        ).run(
          projectId,
          value.providerId,
          value.model,
          value.serviceTier,
          value.reasoningLevel,
          value.permissionMode,
          Date.now(),
        );
        return "written" as const;
      })
      .immediate();
  } finally {
    db.close();
  }
}
