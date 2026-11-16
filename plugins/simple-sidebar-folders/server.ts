// bb-plugin-simple-sidebar-folders — backend.
//
// Owns one thing: the list of folders and which projects each one holds. The
// sidebar layout itself is all frontend (app.tsx). Folders live in plugin kv
// storage on the BB server, so every client sees the same folders; which
// folders are folded is per client and never reaches the server.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Member project ids. A project is in at most one folder. */
  projectIds: z.array(z.string()),
});
export type Folder = z.infer<typeof folderSchema>;

const nameSchema = z.string().trim().min(1).max(80);

export const rpcContract = defineRpcContract({
  folders_list: {
    input: z.null(),
    output: z.object({ folders: z.array(folderSchema) }),
  },
  folder_create: {
    input: z.object({ name: nameSchema }),
    output: folderSchema,
  },
  folder_rename: {
    input: z.object({ id: z.string(), name: nameSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  folder_delete: {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  folder_move: {
    input: z.object({ id: z.string(), direction: z.enum(["up", "down"]) }),
    output: z.object({ ok: z.boolean() }),
  },
  project_assign: {
    input: z.object({ projectId: z.string(), folderId: z.string().nullable() }),
    output: z.object({ ok: z.boolean() }),
  },
});

/** Realtime channel app.tsx refetches on. Empty payload: always re-read. */
export const FOLDERS_CHANGED = "folders-changed";
const KV_KEY = "folders";

export default async function plugin(bb: BbPluginApi) {
  async function read(): Promise<Folder[]> {
    const parsed = z.array(folderSchema).safeParse(await bb.storage.kv.get(KV_KEY));
    return parsed.success ? parsed.data : [];
  }
  async function write(folders: Folder[]): Promise<void> {
    await bb.storage.kv.set(KV_KEY, folders);
    bb.realtime.publish(FOLDERS_CHANGED, {});
  }

  async function create(name: string): Promise<Folder> {
    const folder: Folder = { id: randomUUID().slice(0, 8), name, projectIds: [] };
    await write([...(await read()), folder]);
    return folder;
  }
  async function rename(id: string, name: string): Promise<boolean> {
    const folders = await read();
    const folder = folders.find((candidate) => candidate.id === id);
    if (folder === undefined) return false;
    folder.name = name;
    await write(folders);
    return true;
  }
  async function remove(id: string): Promise<boolean> {
    const folders = await read();
    const remaining = folders.filter((folder) => folder.id !== id);
    if (remaining.length === folders.length) return false;
    await write(remaining);
    return true;
  }
  async function move(id: string, direction: "up" | "down"): Promise<boolean> {
    const folders = await read();
    const from = folders.findIndex((folder) => folder.id === id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= folders.length) return false;
    const [folder] = folders.splice(from, 1);
    folders.splice(to, 0, folder!);
    await write(folders);
    return true;
  }
  /** Move a project into a folder, or out of every folder with null. */
  async function assign(projectId: string, folderId: string | null): Promise<boolean> {
    const folders = await read();
    if (folderId !== null && !folders.some((folder) => folder.id === folderId)) {
      return false;
    }
    for (const folder of folders) {
      folder.projectIds = folder.projectIds.filter((id) => id !== projectId);
      if (folder.id === folderId) folder.projectIds.push(projectId);
    }
    await write(folders);
    return true;
  }

  bb.rpc.register(rpcContract, {
    folders_list: async () => ({ folders: await read() }),
    folder_create: ({ name }) => create(name),
    folder_rename: async ({ id, name }) => ({ ok: await rename(id, name) }),
    folder_delete: async ({ id }) => ({ ok: await remove(id) }),
    folder_move: async ({ id, direction }) => ({ ok: await move(id, direction) }),
    project_assign: async ({ projectId, folderId }) => ({
      ok: await assign(projectId, folderId),
    }),
  });

  const usage = [
    "Usage:",
    "  bb sidebar-folders list [--json]",
    "  bb sidebar-folders create <name>",
    "  bb sidebar-folders rename <folder-id> <name>",
    "  bb sidebar-folders delete <folder-id>",
    "  bb sidebar-folders move <folder-id> up|down",
    "  bb sidebar-folders assign <project-id> <folder-id|none>",
  ].join("\n");

  bb.cli.register({
    name: "sidebar-folders",
    summary: "Group sidebar projects into collapsible folders",
    commands: [
      { name: "list", summary: "List folders and their projects", usage: "bb sidebar-folders list [--json]" },
      { name: "create", summary: "Create a folder", usage: "bb sidebar-folders create <name>" },
      { name: "rename", summary: "Rename a folder", usage: "bb sidebar-folders rename <folder-id> <name>" },
      {
        name: "delete",
        summary: "Delete a folder (its projects become unfiled)",
        usage: "bb sidebar-folders delete <folder-id>",
      },
      { name: "move", summary: "Move a folder up or down", usage: "bb sidebar-folders move <folder-id> up|down" },
      {
        name: "assign",
        summary: "Put a project in a folder, or none to unfile it",
        usage: "bb sidebar-folders assign <project-id> <folder-id|none>",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const ok = (stdout: string) => ({ exitCode: 0, stdout });
      const fail = (stderr: string) => ({ exitCode: 1, stderr });
      const unknownFolder = (id: string) =>
        fail(`No folder with id ${id}. Run "bb sidebar-folders list" to see ids.`);

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return ok(usage);
        case "list": {
          const folders = await read();
          const projects = await bb.sdk.projects.list({ includePersonal: true });
          const names = new Map(projects.map((project) => [project.id, project.name]));
          const filed = new Set(folders.flatMap((folder) => folder.projectIds));
          const unfiled = projects.filter((project) => !filed.has(project.id));
          if (json) {
            return ok(
              JSON.stringify({
                folders: folders.map((folder) => ({
                  ...folder,
                  projects: folder.projectIds.map((id) => ({ id, name: names.get(id) ?? null })),
                })),
                unfiled: unfiled.map((project) => ({ id: project.id, name: project.name })),
              }),
            );
          }
          const line = (id: string) => `    ${id}  ${names.get(id) ?? "(deleted project)"}`;
          const blocks = folders.map((folder) =>
            [`${folder.name}  (${folder.id})`, ...folder.projectIds.map(line)].join("\n"),
          );
          blocks.push(["Unfiled", ...unfiled.map((project) => line(project.id))].join("\n"));
          return ok(blocks.join("\n\n"));
        }
        case "create": {
          const name = nameSchema.safeParse(args.join(" "));
          if (!name.success) break;
          const folder = await create(name.data);
          return ok(json ? JSON.stringify(folder) : `Created ${folder.name} (${folder.id})`);
        }
        case "rename": {
          const [id, ...rest] = args;
          const name = nameSchema.safeParse(rest.join(" "));
          if (id === undefined || !name.success) break;
          return (await rename(id, name.data)) ? ok(`Renamed ${id}`) : unknownFolder(id);
        }
        case "delete": {
          const [id] = args;
          if (id === undefined || args.length !== 1) break;
          return (await remove(id)) ? ok(`Deleted ${id}`) : unknownFolder(id);
        }
        case "move": {
          const [id, direction] = args;
          if (id === undefined || (direction !== "up" && direction !== "down")) break;
          return (await move(id, direction))
            ? ok(`Moved ${id} ${direction}`)
            : fail(`Cannot move ${id} ${direction}.`);
        }
        case "assign": {
          const [projectId, folderId] = args;
          if (projectId === undefined || folderId === undefined || args.length !== 2) break;
          const target = folderId === "none" ? null : folderId;
          return (await assign(projectId, target))
            ? ok(target === null ? `Unfiled ${projectId}` : `Moved ${projectId} to ${target}`)
            : unknownFolder(folderId);
        }
      }
      return fail(usage);
    },
  });
}
