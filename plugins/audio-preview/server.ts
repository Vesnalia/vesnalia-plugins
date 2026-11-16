import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { extensionOf, formatLabel } from "./lib/formats";
import {
  createAudioPreviewUrl,
  readAudioBytes,
  resolveAudioLocation,
} from "./lib/resolve-audio";

const sourceSchema = z
  .object({
    kind: z.enum(["host", "thread-storage", "workspace"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
  })
  .strict();

const fileInputSchema = z
  .object({
    path: z.string().min(1),
    source: sourceSchema,
  })
  .strict();

export const rpcContract = defineRpcContract({
  prepare: {
    input: fileInputSchema,
    output: z.object({
      url: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      format: z.string(),
      extension: z.string(),
      expiresAtMs: z.number(),
    }),
  },
  loadBytes: {
    input: fileInputSchema,
    output: z.object({
      contentBase64: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      format: z.string(),
      sizeBytes: z.number().int(),
    }),
  },
});

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded — audio file opener is registered by the app bundle");

  alia.rpc.register(rpcContract, {
    async prepare({ path, source }) {
      const resolved = await resolveAudioLocation(alia, path, source);
      try {
        const preview = await createAudioPreviewUrl(alia, resolved);
        alia.log.info(`preview ${resolved.fileName} (${resolved.mimeType})`);
        return {
          url: preview.url,
          fileName: resolved.fileName,
          mimeType: resolved.mimeType,
          format: formatLabel(path),
          extension: extensionOf(path),
          expiresAtMs: preview.expiresAtMs,
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        alia.log.warn(`preview failed for ${resolved.fileName}: ${message}`);
        throw cause instanceof Error ? cause : new Error(message);
      }
    },
    async loadBytes({ path, source }) {
      const resolved = await resolveAudioLocation(alia, path, source);
      const bytes = await readAudioBytes(alia, resolved);
      alia.log.info(`bytes ${resolved.fileName} (${bytes.sizeBytes})`);
      return {
        contentBase64: bytes.contentBase64,
        fileName: resolved.fileName,
        mimeType: resolved.mimeType,
        format: formatLabel(path),
        sizeBytes: bytes.sizeBytes,
      };
    },
  });
}
