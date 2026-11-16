import { execFile } from "node:child_process";
import { open, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { git, head } from "./git-history";
import { IMAGE_MAX_BYTES, isImagePath, isSvgPath, type ImageMime, type ImageSide } from "../shared/images";
import { validWorkspacePath } from "../core/worktree";

export type ImageTarget = { type: "uncommitted" } | { type: "all"; mergeBaseRef: string } | { type: "range"; from: string; to: string };
const unavailable = (message: string): ImageSide => ({ kind: "unavailable", message: message.slice(0, 1000) });
const tooLarge = () => unavailable("Image exceeds the 2 MiB preview limit. Open the file in VesnALIA to view it.");
const missing: ImageSide = { kind: "missing" };
function imageMime(bytes: Buffer, path: string): ImageMime | undefined {
  const start = bytes.subarray(0, 16);
  if (start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (start[0] === 255 && start[1] === 216 && start[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(start.toString("ascii"))) return "image/gif";
  if (start.toString("ascii", 0, 4) === "RIFF" && start.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (start.toString("ascii", 0, 2) === "BM") return "image/bmp";
  if (start.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return "image/x-icon";
  if (start.toString("ascii", 4, 8) === "ftyp" && /^(avif|avis)$/.test(start.toString("ascii", 8, 12))) return "image/avif";
  if (isSvgPath(path)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!text.includes("\0") && /<svg(?:\s|>)/i.test(text.slice(0, 8192))) return "image/svg+xml";
    } catch { /* Not UTF-8 SVG. */ }
  }
}
function encode(bytes: Buffer, path: string): ImageSide {
  if (!bytes.length) return unavailable("Empty image file.");
  const mimeType = imageMime(bytes, path);
  return mimeType ? { kind: "image", mimeType, content: bytes.toString("base64"), sizeBytes: bytes.length } : unavailable("This file is not a supported image.");
}
async function safely(read: () => Promise<ImageSide>, signal?: AbortSignal): Promise<ImageSide> {
  try { signal?.throwIfAborted(); const result = await read(); signal?.throwIfAborted(); return result; }
  catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing;
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}
export function worktreeImage(workspace: string, path: string, signal?: AbortSignal): Promise<ImageSide> {
  return safely(async () => {
    if (!validWorkspacePath(path) || !isImagePath(path)) throw new Error("Invalid image path.");
    const root = await realpath(workspace), absolute = await realpath(resolve(root, path));
    if (!validWorkspacePath(relative(root, absolute).replaceAll("\\", "/"))) throw new Error("Image is outside the workspace.");
    const file = await open(absolute, "r");
    try {
      const info = await file.stat();
      if (!info.isFile()) return unavailable("Image preview requires a regular file.");
      if (info.size > IMAGE_MAX_BYTES) return tooLarge();
      const bytes = Buffer.alloc(IMAGE_MAX_BYTES + 1); let size = 0;
      while (size < bytes.length) {
        signal?.throwIfAborted();
        const read = await file.read(bytes, size, bytes.length - size, size);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      return size > IMAGE_MAX_BYTES ? tooLarge() : encode(bytes.subarray(0, size), path);
    } finally { await file.close(); }
  }, signal);
}
function blob(workspace: string, oid: string, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["--no-pager", "-C", workspace, "cat-file", "blob", oid], {
      encoding: "buffer", maxBuffer: IMAGE_MAX_BYTES + 1, timeout: 20_000, signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end();
  });
}
function revisionImage(workspace: string, revision: string | null, path: string, signal?: AbortSignal): Promise<ImageSide> {
  return safely(async () => {
    if (!revision) return missing;
    if (!validWorkspacePath(path)) throw new Error("Invalid image path.");
    const entry = await git(workspace, ["ls-tree", "-z", revision, "--", `:(literal)${path}`], signal);
    if (!entry) return missing;
    const match = /^100(?:644|755) blob ([0-9a-f]{40}(?:[0-9a-f]{24})?)\t/.exec(entry);
    if (!match) return unavailable("Image preview requires a regular file.");
    const size = Number((await git(workspace, ["cat-file", "-s", match[1]], signal)).trim());
    if (size > IMAGE_MAX_BYTES) return tooLarge();
    return encode(await blob(workspace, match[1], signal), path);
  }, signal);
}
export async function imageDiff(workspace: string, input: { target: ImageTarget; path: string; previousPath: string | null }, signal?: AbortSignal) {
  if (!validWorkspacePath(input.path) || !isImagePath(input.path) || input.previousPath !== null && !validWorkspacePath(input.previousPath)) throw new Error("Invalid image path.");
  const { target } = input;
  const from = target.type === "range" ? target.from : target.type === "all" ? target.mergeBaseRef : await head(workspace, signal);
  const [old, next] = await Promise.all([
    revisionImage(workspace, from, input.previousPath ?? input.path, signal),
    target.type === "range" ? revisionImage(workspace, target.to, input.path, signal) : worktreeImage(workspace, input.path, signal),
  ]);
  return { old, next };
}
