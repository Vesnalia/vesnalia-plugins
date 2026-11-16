// Getting a plugin's files without installing it.
//
// Providers, in the order Peek prefers them:
//   bundled   - ships inside the VesnALIA app; read straight off disk.
//   path      - installed from a local directory; read that directory.
//   npm       - fetch the published tarball and read it in memory.
//   github    - fetch the repository tarball from codeload in one request.
//   github-raw- fallback: the tree API plus one raw fetch per file needed.
// Nothing is executed, nothing is written into VesnALIA's plugin directory, and
// every provider is bounded in bytes and in request count.
//
// A provider's `read` never throws. A file that is missing, oversized or
// unreachable comes back as null and the reason is recorded in `problems()`,
// so one flaky request degrades a section of the report instead of failing it.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readTarGz } from "./tar.js";
import type { PeekSourceVia } from "./types.js";

/** Read-only view of one plugin's package contents. */
export interface PackageSource {
  via: PeekSourceVia;
  /** Exact release this view describes (commit, tag, or version). */
  resolved: string | null;
  /** Every path we know about, relative to the package root. */
  list(): Promise<string[]>;
  /** File contents as text, or null when absent, too big, or unreachable. */
  read(filePath: string): Promise<string | null>;
  /** How many files were actually read, for the report's provenance line. */
  readCount(): number;
  /** Anything that went wrong while reading, for the report's notes. */
  problems(): string[];
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export class PeekSourceError extends Error {}

function describeFetchFailure(cause: unknown): string {
  if (cause instanceof PeekSourceError) return cause.message;
  if (cause instanceof Error) {
    return cause.name === "AbortError" ? "the request timed out" : cause.message;
  }
  return String(cause);
}

async function fetchWithLimit(
  url: string,
  init: { accept?: string; maxBytes: number; token?: string | null },
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      accept: init.accept ?? "*/*",
      "user-agent": "alia-plugin-peek",
    };
    if (init.token !== undefined && init.token !== null) {
      headers.authorization = `Bearer ${init.token}`;
    }
    const response = await fetch(url, { headers, signal: controller.signal });
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) {
      throw new PeekSourceError(
        "GitHub rate limit reached. Add a token in Peek's settings to raise it.",
      );
    }
    if (!response.ok) {
      throw new PeekSourceError(`${response.status} ${response.statusText}`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > init.maxBytes) return null;
    const body = Buffer.from(await response.arrayBuffer());
    return body.byteLength > init.maxBytes ? null : body;
  } finally {
    clearTimeout(timer);
  }
}

// --- local directory -------------------------------------------------------

/** Files under a directory on this machine (bundled, or a path install). */
export function directorySource(
  root: string,
  via: PeekSourceVia,
  resolved: string | null,
): PackageSource {
  let reads = 0;
  const problems: string[] = [];
  let listing: Promise<string[]> | null = null;
  const walk = async (dir: string, prefix: string, depth: number): Promise<string[]> => {
    if (depth > 6) return [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        found.push(...(await walk(path.join(dir, entry.name), relative, depth + 1)));
      } else if (entry.isFile()) {
        found.push(relative);
      }
      if (found.length > 4000) break;
    }
    return found;
  };
  return {
    via,
    resolved,
    list() {
      listing ??= walk(root, "", 0);
      return listing;
    },
    async read(filePath) {
      // Refuse anything that escapes the package root.
      const absolute = path.resolve(root, filePath);
      if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
      try {
        const info = await stat(absolute);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
        reads += 1;
        return await readFile(absolute, "utf8");
      } catch {
        return null;
      }
    },
    readCount: () => reads,
    problems: () => problems,
  };
}

/**
 * Locate the app's bundled-plugin directory. VesnALIA exposes no path for it, so we
 * walk up from the running server's own entry and check a few known layouts.
 */
export async function findBundledPluginDir(pluginId: string): Promise<string | null> {
  const seeds = [process.env.ALIA_APP_ROOT, process.argv[1], process.execPath].filter(
    (value): value is string => typeof value === "string" && value !== "",
  );
  const candidates = new Set<string>();
  for (const seed of seeds) {
    let dir = path.resolve(seed);
    for (let depth = 0; depth < 12; depth += 1) {
      candidates.add(path.join(dir, "builtin-plugins"));
      candidates.add(path.join(dir, "server", "dist", "builtin-plugins"));
      candidates.add(path.join(dir, "node_modules", "alia-app", "server", "dist", "builtin-plugins"));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const candidate of candidates) {
    const target = path.join(candidate, pluginId);
    try {
      if ((await stat(target)).isDirectory()) return target;
    } catch {
      // Not this layout; keep looking.
    }
  }
  return null;
}

// --- archives --------------------------------------------------------------

/** One downloaded archive, already in memory. */
function archiveSource(
  files: Map<string, Buffer>,
  via: PeekSourceVia,
  resolved: string | null,
  subdir: string | null,
): PackageSource {
  const prefix = subdir === null || subdir === "" ? "" : `${subdir.replace(/^\/+|\/+$/g, "")}/`;
  const scoped =
    prefix === ""
      ? files
      : new Map(
          [...files]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => [key.slice(prefix.length), value] as const),
        );
  let reads = 0;
  return {
    via,
    resolved,
    async list() {
      return [...scoped.keys()];
    },
    async read(filePath) {
      const bytes = scoped.get(filePath.replace(/^\.\//, ""));
      if (bytes === undefined) return null;
      reads += 1;
      return bytes.toString("utf8");
    },
    readCount: () => reads,
    problems: () => [],
  };
}

export async function npmSource(
  packageName: string,
  version: string | null,
  registry: string | null,
): Promise<PackageSource> {
  const base = (registry ?? "https://registry.npmjs.org").replace(/\/+$/, "");
  const metadata = await fetchWithLimit(
    `${base}/${encodeURIComponent(packageName).replace("%40", "@")}`,
    {
      accept: "application/vnd.npm.install-v1+json, application/json",
      maxBytes: 8 * 1024 * 1024,
    },
  );
  if (metadata === null) throw new PeekSourceError(`npm package ${packageName} was not found.`);
  const document = JSON.parse(metadata.toString("utf8")) as {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, { dist?: { tarball?: string } }>;
  };
  const chosen = version ?? document["dist-tags"]?.latest ?? null;
  const tarball = chosen === null ? undefined : document.versions?.[chosen]?.dist?.tarball;
  if (chosen === null || tarball === undefined) {
    throw new PeekSourceError(`npm package ${packageName} has no resolvable version.`);
  }
  const archive = await fetchWithLimit(tarball, { maxBytes: MAX_ARCHIVE_BYTES });
  if (archive === null) {
    throw new PeekSourceError(`The tarball for ${packageName}@${chosen} is too large to read.`);
  }
  return archiveSource(
    readTarGz(archive, { maxEntryBytes: MAX_FILE_BYTES }),
    "npm",
    `${packageName}@${chosen}`,
    null,
  );
}

// --- github ----------------------------------------------------------------

export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = /github\.com[/:]+([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url);
  if (match === null) return null;
  return { owner: match[1]!, repo: match[2]! };
}

/**
 * The whole repository at one ref, in a single request. codeload serves the
 * same archive `git clone` would produce and is not metered by the REST API's
 * hourly limit, so this is both faster and far less likely to be refused than
 * walking the tree API.
 */
export async function githubTarballSource(
  owner: string,
  repo: string,
  ref: string,
  subdir: string | null,
  token: string | null,
): Promise<PackageSource | null> {
  const archive = await fetchWithLimit(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`,
    { maxBytes: MAX_ARCHIVE_BYTES, token },
  );
  if (archive === null) return null;
  // GitHub archives carry a single `<repo>-<ref>/` root, like npm's `package/`.
  const files = readTarGz(archive, { maxEntryBytes: MAX_FILE_BYTES });
  return files.size === 0 ? null : archiveSource(files, "github", ref, subdir);
}

/**
 * Fallback for a repository whose archive is unavailable or too large: list
 * once through the tree API, then fetch only the files the analyzer asks for.
 */
export async function githubRawSource(
  owner: string,
  repo: string,
  ref: string,
  subdir: string | null,
  token: string | null,
): Promise<PackageSource> {
  const prefix = subdir === null || subdir === "" ? "" : `${subdir.replace(/^\/+|\/+$/g, "")}/`;
  const problems: string[] = [];
  let paths: string[] = [];
  try {
    const tree = await fetchWithLimit(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { accept: "application/vnd.github+json", maxBytes: 8 * 1024 * 1024, token },
    );
    if (tree !== null) {
      const document = JSON.parse(tree.toString("utf8")) as {
        truncated?: boolean;
        tree?: { path?: string; type?: string }[];
      };
      if (document.truncated === true) {
        problems.push("This repository's file list was too long to read in full.");
      } else {
        paths = (document.tree ?? [])
          .filter((node) => node.type === "blob" && typeof node.path === "string")
          .map((node) => node.path as string)
          .filter((candidate) => prefix === "" || candidate.startsWith(prefix))
          .map((candidate) => candidate.slice(prefix.length));
      }
    }
  } catch (cause) {
    problems.push(`Could not list this repository's files: ${describeFetchFailure(cause)}.`);
  }
  let reads = 0;
  return {
    via: "github",
    resolved: ref,
    async list() {
      return paths;
    },
    async read(filePath) {
      const clean = filePath.replace(/^\.\//, "");
      try {
        const raw = await fetchWithLimit(
          `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${prefix}${clean}`,
          { maxBytes: MAX_FILE_BYTES },
        );
        if (raw === null) return null;
        reads += 1;
        return raw.toString("utf8");
      } catch (cause) {
        // One unreachable file must not fail the whole report.
        problems.push(`Could not read ${clean}: ${describeFetchFailure(cause)}.`);
        return null;
      }
    },
    readCount: () => reads,
    problems: () => problems,
  };
}
