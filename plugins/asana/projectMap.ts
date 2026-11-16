// Which VesnALIA project each Asana project's tasks belong in, so "Start thread"
// opens the composer in the right project.
//
// Stored in this plugin's kv as one map keyed by Asana project GID. An entry
// is "confirmed" (the user picked it, possibly "none") or "learned" (a thread
// started from a task in that Asana project ran in that VesnALIA project). Name
// suggestions are computed on the fly and only used once confirmed.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { suggestProject } from "./projectMatch";

const MAP_KEY = "project-map";

/** Realtime channel the frontend refetches the mapping on. */
export const PROJECT_MAP_CHANGED = "project-map-changed";

const entrySchema = z.object({
  /** null: the user said this Asana project has no VesnALIA project. */
  aliaProjectId: z.string().nullable(),
  source: z.enum(["confirmed", "learned"]),
  asanaName: z.string(),
  at: z.number(),
});
type Entry = z.infer<typeof entrySchema>;
const mapSchema = z.record(z.string(), entrySchema);

export const projectMapRowSchema = z.object({
  asanaGid: z.string(),
  asanaName: z.string(),
  /** The VesnALIA project tasks open in, or null. */
  aliaProjectId: z.string().nullable(),
  /** How aliaProjectId was chosen; "suggested" is a name match not yet confirmed. */
  source: z.enum(["confirmed", "learned", "suggested", "none"]),
});
export type ProjectMapRow = z.infer<typeof projectMapRowSchema>;

export const aliaProjectSchema = z.object({ id: z.string(), name: z.string() });

export function createProjectMap(alia: AliaPluginApi) {
  async function read(): Promise<Record<string, Entry>> {
    const parsed = mapSchema.safeParse(await alia.storage.kv.get<unknown>(MAP_KEY));
    return parsed.success ? parsed.data : {};
  }

  async function write(map: Record<string, Entry>): Promise<void> {
    await alia.storage.kv.set(MAP_KEY, map);
    alia.realtime.publish(PROJECT_MAP_CHANGED, null);
  }

  async function aliaProjects(): Promise<{ id: string; name: string }[]> {
    const projects = await alia.sdk.projects.list();
    return projects
      .filter((project) => project.kind === "standard")
      .map((project) => ({ id: project.id, name: project.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Confirms a mapping, or with null says the Asana project has no VesnALIA project. */
  async function confirm(asanaGid: string, asanaName: string, aliaProjectId: string | null) {
    if (aliaProjectId !== null && !(await aliaProjects()).some((project) => project.id === aliaProjectId)) {
      throw new Error("That VesnALIA project doesn't exist.");
    }
    const map = await read();
    map[asanaGid] = { aliaProjectId, source: "confirmed", asanaName, at: Date.now() };
    await write(map);
  }

  /** Forgets a mapping, so suggestions and learning apply again. */
  async function forget(asanaGid: string) {
    const map = await read();
    if (!(asanaGid in map)) return;
    delete map[asanaGid];
    await write(map);
  }

  /**
   * Learns from a thread linked to a task: its first Asana project maps to
   * the thread's VesnALIA project. Confirmed choices are never overwritten.
   */
  async function learn(asanaProjects: { gid: string; name: string }[], aliaProjectId: string) {
    const first = asanaProjects[0];
    if (first === undefined) return;
    if (!(await aliaProjects()).some((project) => project.id === aliaProjectId)) return;
    const map = await read();
    const existing = map[first.gid];
    if (existing?.source === "confirmed") return;
    if (existing?.aliaProjectId === aliaProjectId) return;
    map[first.gid] = { aliaProjectId, source: "learned", asanaName: first.name, at: Date.now() };
    await write(map);
    alia.log.info(`learned Asana project ${first.gid} → ${aliaProjectId}`);
  }

  /**
   * The mapping table: every Asana project seen on your tasks or already
   * mapped, with the VesnALIA project tasks open in and how it was chosen.
   */
  async function rows(seen: { gid: string; name: string }[]): Promise<ProjectMapRow[]> {
    const [map, projects] = await Promise.all([read(), aliaProjects()]);
    const names = new Map<string, string>();
    for (const [gid, entry] of Object.entries(map)) names.set(gid, entry.asanaName);
    for (const project of seen) names.set(project.gid, project.name);
    const known = new Set(projects.map((project) => project.id));
    return [...names.entries()]
      .map(([asanaGid, asanaName]): ProjectMapRow => {
        const entry = map[asanaGid];
        if (entry !== undefined && (entry.aliaProjectId === null || known.has(entry.aliaProjectId))) {
          return { asanaGid, asanaName, aliaProjectId: entry.aliaProjectId, source: entry.source };
        }
        const suggestion = suggestProject(asanaName, projects);
        return suggestion === null
          ? { asanaGid, asanaName, aliaProjectId: null, source: "none" }
          : { asanaGid, asanaName, aliaProjectId: suggestion.id, source: "suggested" };
      })
      .sort((a, b) => a.asanaName.localeCompare(b.asanaName));
  }

  /** Asana project GID → VesnALIA project ID, for confirmed and learned mappings only. */
  async function effective(): Promise<Record<string, string>> {
    const map = await read();
    const result: Record<string, string> = {};
    for (const [gid, entry] of Object.entries(map)) {
      if (entry.aliaProjectId !== null) result[gid] = entry.aliaProjectId;
    }
    return result;
  }

  return { aliaProjects, confirm, forget, learn, rows, effective };
}
