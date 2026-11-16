// Groups files that are versions of one document, and picks the latest.
import { promises as fs } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

export interface FileEntry {
  path: string;
  name: string;
  mtime: number;
  size: number;
  version: number | null;
}

export interface VersionGroup {
  key: string;
  title: string;
  extension: string;
  root: string;
  latest: FileEntry;
  older: FileEntry[];
}

export const EXTENSIONS = new Set([".pptx", ".ppt", ".key", ".docx", ".doc", ".xlsx", ".xls", ".pdf", ".csv"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", "tessdata", "site-packages", "Pods"]);

// Word boundaries that also work next to Cyrillic, where \b does not.
const VERSION = /(?:^|[\s_.(\-–—])v(?:er(?:sion)?)?[\s_.-]?(\d{1,3})(?:\.\d+)*(?=$|[\s_.)\-–—])/i;
const NOISE: readonly RegExp[] = [
  /(?:^|[\s_\-–—])(?:final|финал(?:ьн\w*)?|итог(?:ов\w*)?|draft|черновик|copy|копия|new|новая|новый|patched|old|старая|старый)(?=$|[\s_\-–—.])/gi,
  /(?:^|[\s_\-–—(])\d{4}[-_.]?\d{2}[-_.]?\d{2}(?:[-_ ]?\d{4,6})?(?=$|[\s_\-–—).])/g,
  /\s*\(\d{1,3}\)\s*$/,
];

export function parseName(fileName: string): { key: string; title: string; version: number | null } {
  const stem = basename(fileName, extname(fileName));
  const match = stem.match(VERSION);
  let rest = match ? stem.replace(match[0], " ") : stem;
  for (const noise of NOISE) rest = rest.replace(noise, " ");
  const title = rest.replace(/[\s_\-–—.]+/g, " ").trim() || stem;
  return { key: title.toLowerCase().replace(/ё/g, "е"), title, version: match?.[1] ? Number(match[1]) : null };
}

function copyNumber(name: string): number {
  const match = basename(name, extname(name)).match(/\((\d{1,3})\)\s*$/);
  return match?.[1] ? Number(match[1]) : 0;
}

// Sync and download reset mtimes, so a date alone cannot beat a version number:
// an unnumbered file wins only when clearly newer than the best numbered one.
const CLEARLY_NEWER_MS = 60 * 60 * 1000;

function byRecency(a: FileEntry, b: FileEntry): number {
  return (b.version ?? -1) - (a.version ?? -1) || copyNumber(b.name) - copyNumber(a.name) || b.mtime - a.mtime;
}

const ARCHIVE_FOLDER = /(^|\/)_?(старые|старое|архив|old|archive|deprecated)[^/]*\//i;

// Someone moved these aside on purpose, whatever their numbers say.
export function orderVersions(files: readonly FileEntry[]): FileEntry[] {
  const archived = (file: FileEntry) => ARCHIVE_FOLDER.test(file.path);
  const current = files.filter((file) => !archived(file));
  if (current.length === 0 || current.length === files.length) return orderCurrent(files);
  return [...orderCurrent(current), ...orderCurrent(files.filter(archived))];
}

function orderCurrent(files: readonly FileEntry[]): FileEntry[] {
  const numbered = files.filter((file) => file.version !== null).sort(byRecency);
  const plain = files.filter((file) => file.version === null).sort((a, b) => b.mtime - a.mtime || copyNumber(b.name) - copyNumber(a.name));
  const topNumbered = numbered[0];
  const topPlain = plain[0];
  if (topNumbered !== undefined && topPlain !== undefined && topPlain.mtime > topNumbered.mtime + CLEARLY_NEWER_MS) {
    return [topPlain, ...numbered, ...plain.slice(1)];
  }
  return [...numbered, ...plain.sort(byRecency)];
}

export function group(root: string, files: readonly FileEntry[]): VersionGroup[] {
  const buckets = new Map<string, FileEntry[]>();
  for (const file of files) {
    const { key } = parseName(file.name);
    const id = `${key}|${extname(file.name).toLowerCase()}`;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(file);
    else buckets.set(id, [file]);
  }
  const groups: VersionGroup[] = [];
  for (const [id, bucket] of buckets) {
    const [latest, ...older] = orderVersions(bucket);
    if (latest === undefined) continue;
    groups.push({ key: `${root}|${id}`, title: parseName(latest.name).title, extension: extname(latest.name).toLowerCase(), root, latest, older });
  }
  return groups.sort((a, b) => b.latest.mtime - a.latest.mtime);
}

export async function collect(root: string, signal?: AbortSignal, limit = 20000): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    signal?.throwIfAborted();
    const dir = stack.pop() as string;
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path);
      } else if (EXTENSIONS.has(extname(entry.name).toLowerCase()) && !entry.name.startsWith("~$")) {
        const stat = await fs.stat(path).catch(() => null);
        if (stat) out.push({ path, name: entry.name, mtime: stat.mtimeMs, size: stat.size, version: parseName(entry.name).version });
      }
    }
  }
  return out;
}

export function folderOf(root: string, path: string): string {
  const dir = dirname(path);
  return dir === root ? "" : dir.slice(root.length + 1);
}
