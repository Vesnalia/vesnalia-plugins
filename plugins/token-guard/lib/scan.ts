// Finds tokens already sitting in agent history on the server machine.
// Results hold kind, fingerprint and counts, never a value.
import { createReadStream, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detect, MAX_TOKEN_LENGTH } from "./detect.ts";

export interface ScanRoot {
  label: string;
  path: string;
  /** The file changes constantly, so its date says nothing about the token. */
  undated?: boolean;
}

export interface ScanRow {
  kind: string;
  revokeUrl: string;
  fingerprint: string;
  occurrences: number;
  files: number;
  sources: string[];
  lastSeen: string;
}

export interface ScanReport {
  finishedAt: string;
  filesScanned: number;
  bytesScanned: number;
  unreadable: number;
  rows: ScanRow[];
  truncated: boolean;
}

const MAX_ROWS = 500;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

export function defaultRoots(dataDir: string | null): ScanRoot[] {
  const home = homedir();
  return [
    { label: "Claude Code", path: join(home, ".claude", "projects") },
    { label: "Codex", path: join(home, ".codex", "sessions") },
    ...(dataDir === null ? [] : [{ label: "VesnALIA database", path: join(dataDir, "alia.db"), undated: true }]),
  ];
}

async function* walk(path: string): AsyncGenerator<string> {
  const stat = await fs.stat(path).catch(() => null);
  if (stat === null) return;
  if (stat.isFile()) {
    yield path;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of await fs.readdir(path, { withFileTypes: true }).catch(() => [])) {
    if (entry.isSymbolicLink() || SKIP_DIRS.has(entry.name)) continue;
    yield* walk(join(path, entry.name));
  }
}

/** Calls onFinding once per occurrence, including one split across chunks. */
export async function scanFile(
  path: string,
  onFinding: (finding: ReturnType<typeof detect>[number]) => void,
  signal?: AbortSignal,
): Promise<number> {
  let tail = "";
  let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    signal?.throwIfAborted();
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    const text = tail + buffer.toString("latin1");
    // A match reaching into the last stretch waits for the next chunk.
    const limit = text.length - MAX_TOKEN_LENGTH;
    const consumed = Math.max(limit, 0);
    for (const finding of detect(text)) {
      if (finding.end <= limit) onFinding(finding);
    }
    tail = text.slice(consumed);
    // The server shares this thread with everything else it does.
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (const finding of detect(tail)) onFinding(finding);
  return bytes;
}

export async function scan(roots: readonly ScanRoot[], signal?: AbortSignal): Promise<ScanReport> {
  const rows = new Map<string, ScanRow & { fileSet: Set<string>; sourceSet: Set<string> }>();
  let filesScanned = 0;
  let bytesScanned = 0;
  let unreadable = 0;
  for (const root of roots) {
    for await (const file of walk(root.path)) {
      signal?.throwIfAborted();
      const mtime = await fs.stat(file).then((s) => s.mtime.toISOString(), () => "");
      try {
        bytesScanned += await scanFile(
          file,
          (finding) => {
            let row = rows.get(finding.fingerprint);
            if (row === undefined) {
              row = {
                kind: finding.kind,
                revokeUrl: finding.revokeUrl,
                fingerprint: finding.fingerprint,
                occurrences: 0,
                files: 0,
                sources: [],
                lastSeen: "",
                fileSet: new Set(),
                sourceSet: new Set(),
              };
              rows.set(finding.fingerprint, row);
            }
            row.occurrences += 1;
            row.fileSet.add(file);
            row.sourceSet.add(root.label);
            if (!root.undated && mtime > row.lastSeen) row.lastSeen = mtime;
          },
          signal,
        );
        filesScanned += 1;
      } catch (cause) {
        if (signal?.aborted) throw cause;
        unreadable += 1;
      }
    }
  }
  const sorted = [...rows.values()]
    .map(({ fileSet, sourceSet, ...row }) => ({
      ...row,
      files: fileSet.size,
      sources: [...sourceSet].sort(),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.lastSeen.localeCompare(a.lastSeen));
  return {
    finishedAt: new Date().toISOString(),
    filesScanned,
    bytesScanned,
    unreadable,
    rows: sorted.slice(0, MAX_ROWS),
    truncated: sorted.length > MAX_ROWS,
  };
}
