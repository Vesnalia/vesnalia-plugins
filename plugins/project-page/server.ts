import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { repositoryUrl, selectReadme } from "./project-data";

const projectSchema = z.object({ id: z.string(), name: z.string() });
const pageSchema = z.object({
  project: projectSchema,
  repositoryUrl: z.string().nullable(),
  checkoutPath: z.string().nullable(),
  readme: z.object({ path: z.string(), content: z.string() }).nullable(),
  error: z.string().nullable(),
});
export type ProjectPageData = z.infer<typeof pageSchema>;
export const rpcContract = defineRpcContract({
  projects: { input: z.null(), output: z.array(projectSchema) },
  page: { input: z.object({ projectId: z.string().min(1).max(200) }), output: pageSchema },
});

export default function plugin(alia: AliaPluginApi) {
  async function page(projectId: string): Promise<ProjectPageData> {
    const project = await alia.sdk.projects.get({ projectId });
    const source = project.sources.find(source => source.isDefault) ?? project.sources[0];
    const result: ProjectPageData = {
      project: { id: project.id, name: project.name },
      repositoryUrl: repositoryUrl(project.gitRemoteUrl),
      checkoutPath: source?.path ?? null,
      readme: null,
      error: null,
    };
    if (!source) return { ...result, error: "This project has no checkout connected." };
    try {
      const routing = { projectId, hostId: source.hostId };
      const files = await alia.sdk.projects.files({ ...routing, query: "readme", limit: "200" });
      const path = selectReadme(files.files.map(file => file.path));
      if (!path) {
        if (files.truncated) result.error = "README search was incomplete. Try refreshing.";
        return result;
      }
      const file = await alia.sdk.projects.fileContent({ ...routing, path });
      if (file.contentEncoding !== "utf8") throw new Error("The README isn't a text file.");
      if (file.sizeBytes > 512_000) throw new Error("The README is too large to preview (500 KB maximum).");
      result.readme = { path, content: file.content };
    } catch (cause) {
      result.error = cause instanceof Error ? cause.message : "Couldn't read the project's README.";
    }
    return result;
  }
  alia.rpc.register(rpcContract, {
    projects: async () => (await alia.sdk.projects.list()).map(({ id, name }) => ({ id, name })),
    page: ({ projectId }) => page(projectId),
  });
  alia.cli.register({
    name: "project-page",
    summary: "Read a project's homepage",
    commands: [{ name: "show", summary: "Read project metadata and README", usage: "alia project-page show <project-id>" }],
    async run(argv) {
      if (argv[0] !== "show" || argv.length !== 2) return { exitCode: 1, stderr: "Usage: VesnALIA project-page show <project-id>" };
      return { exitCode: 0, stdout: JSON.stringify(await page(argv[1])) };
    },
  });
}
