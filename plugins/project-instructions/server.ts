import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const KEY_PREFIX = "instructions:";

// bb truncates a contribution above this length without reporting it, so the
// limit is enforced at every write instead of losing the tail silently.
const MAX_LENGTH = 4096;

const usage = [
  "Usage:",
  "  bb project-instructions get [--project <id>]",
  "  bb project-instructions set <text...> [--project <id>]",
  "  bb project-instructions clear [--project <id>]",
  "  bb project-instructions list",
  "",
  "--project defaults to the project of the calling thread.",
  `Instructions are limited to ${MAX_LENGTH} characters.`,
].join("\n");

export const MAX_INSTRUCTIONS_LENGTH = MAX_LENGTH;

export const rpcContract = defineRpcContract({
  listProjects: {
    input: z.null(),
    output: z.object({
      maxLength: z.number(),
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          instructions: z.string(),
        }),
      ),
    }),
  },
  save: {
    input: z
      .object({
        projectId: z.string(),
        text: z.string().max(MAX_LENGTH, `Instructions are limited to ${MAX_LENGTH} characters.`),
      })
      .strict(),
    output: z.object({ saved: z.boolean() }),
  },
});

function parseProjectFlag(argv: string[]): { rest: string[]; projectId?: string } {
  const index = argv.indexOf("--project");
  if (index === -1) return { rest: argv };
  return {
    rest: [...argv.slice(0, index), ...argv.slice(index + 2)],
    projectId: argv[index + 1],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function plugin(bb: BbPluginApi) {
  // contributeInstructions is synchronous, so the kv rows are mirrored here
  // and the mirror is the only thing the thread-start path touches.
  const byProject = new Map<string, string>();

  for (const key of await bb.storage.kv.list(KEY_PREFIX)) {
    const text = await bb.storage.kv.get<string>(key);
    if (text) byProject.set(key.slice(KEY_PREFIX.length), text);
  }

  // Writes run one at a time. Two overlapping saves of the same project could
  // otherwise settle in a different order than they reached kv, leaving the
  // mirror disagreeing with storage until the next reload.
  let pending: Promise<unknown> = Promise.resolve();

  function write(projectId: string, text: string): Promise<void> {
    const run = pending.then(
      () => commit(projectId, text),
      () => commit(projectId, text),
    );
    pending = run.catch(() => undefined);
    return run;
  }

  async function commit(projectId: string, text: string) {
    const trimmed = text.trim();
    if (trimmed.length > MAX_LENGTH) {
      throw new Error(`Instructions are limited to ${MAX_LENGTH} characters.`);
    }

    const key = `${KEY_PREFIX}${projectId}`;
    if (trimmed) {
      await bb.storage.kv.set(key, trimmed);
      byProject.set(projectId, trimmed);
    } else {
      await bb.storage.kv.delete(key);
      byProject.delete(projectId);
    }
    bb.realtime.publish("changed", { projectId });
  }

  bb.agents.contributeInstructions(({ projectId }) => byProject.get(projectId) ?? null);

  bb.rpc.register(rpcContract, {
    async listProjects() {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return {
        maxLength: MAX_LENGTH,
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          instructions: byProject.get(project.id) ?? "",
        })),
      };
    },
    async save({ projectId, text }) {
      await write(projectId, text);
      return { saved: true };
    },
  });

  bb.cli.register({
    name: "project-instructions",
    summary: "Per-project instructions injected into each thread's system prompt",
    commands: [
      {
        name: "get",
        summary: "Show this project's instructions",
        usage: "bb project-instructions get [--project <id>]",
      },
      {
        name: "set",
        summary: "Replace this project's instructions",
        usage: "bb project-instructions set <text...> [--project <id>]",
      },
      {
        name: "clear",
        summary: "Remove this project's instructions",
        usage: "bb project-instructions clear [--project <id>]",
      },
      {
        name: "list",
        summary: "List every project with instructions",
        usage: "bb project-instructions list",
      },
    ],
    async run(argv, ctx) {
      const { rest, projectId: flagProjectId } = parseProjectFlag(argv);
      const [command, ...args] = rest;
      const projectId = flagProjectId ?? ctx.projectId;

      if (command === "list") {
        if (byProject.size === 0) {
          return { exitCode: 0, stdout: "No projects configured." };
        }
        const lines = [...byProject].map(
          ([id, text]) => `${id}\t${text.split("\n")[0]?.slice(0, 80) ?? ""}`,
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      }

      if (!command || !["get", "set", "clear"].includes(command)) {
        return { exitCode: 2, stderr: usage };
      }

      if (!projectId) {
        return { exitCode: 2, stderr: "No project in context. Pass --project <id>." };
      }

      if (command === "get") {
        return { exitCode: 0, stdout: byProject.get(projectId) ?? "" };
      }

      if (command === "clear") {
        try {
          await write(projectId, "");
        } catch (error) {
          return { exitCode: 1, stderr: messageOf(error) };
        }
        return { exitCode: 0, stdout: `Cleared instructions for ${projectId}.` };
      }

      const text = args.join(" ").trim();
      if (!text) {
        return { exitCode: 2, stderr: "Nothing to set. Pass the instruction text." };
      }
      if (text.length > MAX_LENGTH) {
        return {
          exitCode: 2,
          stderr: `Instructions are limited to ${MAX_LENGTH} characters. Got ${text.length}.`,
        };
      }

      try {
        await write(projectId, text);
      } catch (error) {
        return { exitCode: 1, stderr: messageOf(error) };
      }
      return { exitCode: 0, stdout: `Set instructions for ${projectId}.` };
    },
  });
}
