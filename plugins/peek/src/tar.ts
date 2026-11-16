// Minimal gzip+tar reader for npm tarballs.
//
// npm publishes plain ustar archives, so a dependency-free reader is enough:
// 512-byte headers, 512-byte-aligned payloads, two zero blocks at the end.
// Entries larger than `maxEntryBytes` are skipped rather than buffered, and
// the whole archive is capped by the caller before it reaches here.

import { gunzipSync } from "node:zlib";

export interface TarEntry {
  /** Path with the single npm "package/" prefix already stripped. */
  path: string;
  bytes: Buffer;
}

const BLOCK = 512;

function readString(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  if (text === "") return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Extract a gzipped tar into a path -> contents map. `stripPrefix` removes the
 * archive's single root directory (npm uses "package/"); pass false to keep it.
 */
export function readTarGz(
  gzipped: Buffer,
  options: { maxEntryBytes?: number; stripPrefix?: boolean } = {},
): Map<string, Buffer> {
  const maxEntryBytes = options.maxEntryBytes ?? 4 * 1024 * 1024;
  const stripPrefix = options.stripPrefix ?? true;
  const tar = gunzipSync(gzipped);
  const files = new Map<string, Buffer>();
  let offset = 0;
  // A long-name header (type "L") describes the *next* entry's path.
  let pendingLongName: string | null = null;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = pendingLongName ?? readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = readOctal(header, 124, 12);
    const typeFlag = readString(header, 156, 1);
    offset += BLOCK;
    const payload = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;
    pendingLongName = null;
    if (typeFlag === "L") {
      pendingLongName = payload.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    // "0"/"" are regular files; directories, links and PAX records are not.
    if (typeFlag !== "0" && typeFlag !== "") continue;
    if (size > maxEntryBytes) continue;
    const full = prefix === "" ? name : `${prefix}/${name}`;
    const relative = stripPrefix ? full.replace(/^[^/]+\//, "") : full;
    if (relative === "") continue;
    files.set(relative, Buffer.from(payload));
  }
  return files;
}

export type { TarEntry as PeekTarEntry };
