// alia-plugin-live-markdown — backend.
//
// Two RPCs over alia.sdk.files: `read` returns the file's exact text and its
// sha256; `write` saves with compare-and-swap against the sha256 the editor
// last saw, so an agent's concurrent edit becomes a conflict, never a silent
// overwrite. The editor never re-serializes Markdown: what it writes is the
// buffer, byte for byte.
import path from "node:path";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

/** Larger files stay in VesnALIA's read-only preview; a live-preview buffer this big is not a note. */
const MAX_EDITABLE_BYTES = 4 * 1024 * 1024;

const sourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    experimental_hostId: z.string().optional(),
  })
  .strict();

const fileSchema = z.object({ path: z.string().min(1), source: sourceSchema }).strict();

type Source = z.infer<typeof sourceSchema>;

export const rpcContract = defineRpcContract({
  read: {
    input: fileSchema,
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        content: z.string(),
        sha256: z.string(),
        absolutePath: z.string(),
      }),
      z.object({ kind: z.literal("unsupported"), reason: z.string() }),
    ]),
  },
  write: {
    input: fileSchema.extend({
      content: z.string(),
      expectedSha256: z.string().nullable(),
    }),
    output: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("written"), sha256: z.string() }),
      z.object({ outcome: z.literal("conflict"), currentSha256: z.string().nullable() }),
    ]),
  },
});

interface Target {
  path: string;
  rootPath: string;
  hostId?: string;
}

export default async function plugin(alia: AliaPluginApi) {
  async function resolveTarget(source: Source, filePath: string): Promise<Target> {
    if (source.kind === "thread-storage") {
      if (source.threadId === null) throw new Error("This thread-storage file has no thread");
      const { hostId, storageRootPath } = await alia.sdk.threads.storageLocation({
        threadId: source.threadId,
      });
      return { path: path.join(storageRootPath, filePath), rootPath: storageRootPath, hostId };
    }

    if (source.environmentId === null) {
      if (source.kind !== "workspace" || source.projectId === null) {
        throw new Error("This file has no environment or project to resolve it against");
      }
      const project = await alia.sdk.projects.get({ projectId: source.projectId });
      const checkout =
        source.experimental_hostId === undefined
          ? (project.sources.find((entry) => entry.isDefault) ?? project.sources[0])
          : project.sources.find((entry) => entry.hostId === source.experimental_hostId);
      if (checkout === undefined) throw new Error("This project has no matching source checkout");
      return {
        path: path.join(checkout.path, filePath),
        rootPath: checkout.path,
        hostId: checkout.hostId,
      };
    }

    const environment = await alia.sdk.environments.get({ environmentId: source.environmentId });
    const hostId = environment.hostId ? { hostId: environment.hostId } : {};
    if (source.kind === "host") {
      const api = path.win32.isAbsolute(filePath) ? path.win32 : path.posix;
      return { path: filePath, rootPath: api.dirname(filePath), ...hostId };
    }
    if (!environment.path) throw new Error("This environment has no workspace path");
    return { path: path.join(environment.path, filePath), rootPath: environment.path, ...hostId };
  }

  alia.rpc.register(rpcContract, {
    async read({ path: filePath, source }) {
      const target = await resolveTarget(source, filePath);
      const file = await alia.sdk.files.read(target);
      if (file.contentEncoding !== "utf8") {
        return { kind: "unsupported" as const, reason: "This file is not UTF-8 text" };
      }
      if (file.sizeBytes > MAX_EDITABLE_BYTES) {
        return {
          kind: "unsupported" as const,
          reason: `This file is too large to edit live (${Math.round(file.sizeBytes / 1024 / 1024)} MB)`,
        };
      }
      return {
        kind: "text" as const,
        content: file.content,
        sha256: file.sha256,
        absolutePath: target.path,
      };
    },

    async write({ path: filePath, source, content, expectedSha256 }) {
      const target = await resolveTarget(source, filePath);
      const result = await alia.sdk.files.write({
        ...target,
        content,
        contentEncoding: "utf8",
        expectedSha256,
      });
      return result.outcome === "written"
        ? { outcome: "written" as const, sha256: result.sha256 }
        : { outcome: "conflict" as const, currentSha256: result.currentSha256 };
    },
  });
}
