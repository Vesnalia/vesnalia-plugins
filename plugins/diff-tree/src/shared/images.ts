import { z } from "zod";

// Two base64 sides stay below the host RPC's 8 MiB response limit.
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const imageMimeSchema = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon", "image/avif", "image/svg+xml"]);
export const imageSideSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), mimeType: imageMimeSchema, content: z.string().max(4 * Math.ceil(IMAGE_MAX_BYTES / 3)).refine(value => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), "Expected base64 image content"), sizeBytes: z.number().int().min(1).max(IMAGE_MAX_BYTES) }).strict(),
  z.object({ kind: z.literal("missing") }).strict(),
  z.object({ kind: z.literal("unavailable"), message: z.string().max(1000) }).strict(),
]);
export const imagePairSchema = z.object({ old: imageSideSchema, next: imageSideSchema }).strict();
export type ImageSide = z.infer<typeof imageSideSchema>;
export type ImagePair = z.infer<typeof imagePairSchema>;
export type ImageMime = z.infer<typeof imageMimeSchema>;
export function isImagePath(path: string) { return /\.(?:png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i.test(path); }
export function isSvgPath(path: string) { return /\.svg$/i.test(path); }
