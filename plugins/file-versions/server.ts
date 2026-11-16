// File Versions: shows every version of a document across project folders.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { collect, folderOf, group } from "./lib/versions";

const fileSchema = z.object({ path: z.string(), name: z.string(), folder: z.string(), mtime: z.number(), size: z.number(), version: z.number().nullable() });
const groupSchema = z.object({ key: z.string(), title: z.string(), extension: z.string(), latest: fileSchema, older: z.array(fileSchema) });
const outputSchema = z.object({ groups: z.array(groupSchema), files: z.number(), roots: z.array(z.string()), hostId: z.string().nullable() });
export type VersionsOutput = z.infer<typeof outputSchema>;

export const rpcContract = defineRpcContract({
  scan: { input: z.null(), output: outputSchema },
});

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    extraFolders: {
      type: "string",
      label: "Extra folders to include, one absolute path per line",
      experimental_multiline: true,
      default: "",
    },
  });
  const { extraFolders } = await settings.get();
  const stop = new AbortController();
  alia.onDispose(() => stop.abort());

  async function run(): Promise<VersionsOutput> {
    const projects = await alia.sdk.projects.list({ includePersonal: true });
    const sources = projects.flatMap((project) => project.sources ?? []);
    const paths = [...sources.map((source) => source.path), ...extraFolders.split("\n").map((line) => line.trim()).filter(Boolean)];
    // A project nested inside another would otherwise be listed twice.
    const roots = [...new Set(paths)].sort().filter((root, _, all) => !all.some((other) => other !== root && root.startsWith(`${other}/`)));
    const groups: VersionsOutput["groups"] = [];
    let files = 0;
    for (const root of roots) {
      const found = await collect(root, stop.signal);
      files += found.length;
      for (const item of group(root, found)) {
        const view = (file: typeof item.latest) => ({ ...file, folder: folderOf(root, file.path) });
        groups.push({ key: item.key, title: item.title, extension: item.extension, latest: view(item.latest), older: item.older.map(view) });
      }
    }
    groups.sort((a, b) => b.older.length - a.older.length || b.latest.mtime - a.latest.mtime);
    return { groups: groups.slice(0, 2000), files, roots, hostId: sources[0]?.hostId ?? null };
  }

  alia.rpc.register(rpcContract, { scan: run });

  alia.cli.register({
    name: "file-versions",
    summary: "List documents with several versions and which one is the latest",
    commands: [{ name: "list", summary: "List documents with versions", usage: "alia file-versions list [--json]" }],
    async run(argv) {
      const out = await run();
      const multi = out.groups.filter((g) => g.older.length > 0);
      if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify({ ...out, groups: multi }) };
      return {
        exitCode: 0,
        stdout: [`${multi.length} documents with several versions, ${out.files} files.`, ...multi.map((g) => `${String(g.older.length + 1).padStart(3)}  ${g.latest.path}`)].join("\n"),
      };
    },
  });
}
