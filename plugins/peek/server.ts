// Peek — see what a VesnALIA plugin would change before you install it.
//
// The frontend decorates the plugin store's cards with a Preview button. This
// backend answers that button: it resolves the catalog entry to its exact
// release, reads that release's files without installing them, and returns an
// impact report — which parts of the VesnALIA UI the plugin would touch, which
// settings it would add, and which capabilities it would take.
//
// Peek never installs, never enables, and never executes plugin code. Every
// file it reads is read as text.

import { stat } from "node:fs/promises";
import path from "node:path";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { analyze } from "./src/analyze.js";
import {
  directorySource,
  findBundledPluginDir,
  githubRawSource,
  githubTarballSource,
  npmSource,
  parseGithubUrl,
  PeekSourceError,
  type PackageSource,
} from "./src/sources.js";
import { peekEntryRefSchema, peekReportSchema } from "./src/schema.js";
import type { PeekEntryRef, PeekEntrySummary, PeekReport, PeekSourceInfo } from "./src/types.js";

export type { PeekReport, PeekEntryRef, PeekEntrySummary } from "./src/types.js";

export const rpcContract = defineRpcContract({
  /**
   * Just enough of every store entry for the frontend to match a card to an
   * entry id. Deliberately omits overview and screenshots: the full catalog
   * runs to hundreds of kilobytes, and only the previewed entry needs them.
   */
  peek_entries: {
    input: z.null(),
    output: z.object({ entries: z.array(peekEntryRefSchema) }),
  },
  /** The impact report for one entry. */
  peek_report: {
    input: z.object({
      entryId: z.string().min(1),
      marketplace: z.string().min(1),
      refresh: z.boolean().optional(),
    }),
    output: z.object({ report: peekReportSchema }),
  },
});

/** Cached reports are keyed by the exact release, so a new release misses. */
const CACHE_PREFIX = "report:";
const ENTRY_CACHE_TTL_MS = 5 * 60 * 1000;

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    githubToken: {
      type: "string",
      label: "GitHub token",
      description:
        "Optional. Raises the rate limit when previewing plugins hosted on GitHub. A read-only token with no scopes is enough.",
      secret: true,
    },
    cacheHours: {
      type: "number",
      label: "Cache reports for (hours)",
      description: "A report is also invalidated whenever the plugin's resolved release changes.",
      default: 24,
    },
  });
  const { githubToken, cacheHours } = await settings.get();
  const cacheTtlMs = Math.max(0, cacheHours) * 60 * 60 * 1000;

  function summarize(entry: {
    entryId: string;
    marketplace: string;
    marketplaceDisplayName: string;
    pluginId: string;
    displayName: string;
    description: string;
    author: { name: string } | null;
    official: boolean;
    installed: boolean;
    compatible: boolean;
    incompatibleReason: string | null;
    installs?: number | null;
    category?: string;
    repositoryUrl?: string | null;
    source: string;
    iconUrl: string | null;
    screenshots?: string[];
    overview?: string;
  }): PeekEntrySummary {
    return {
      entryId: entry.entryId,
      marketplace: entry.marketplace,
      marketplaceDisplayName: entry.marketplaceDisplayName,
      pluginId: entry.pluginId,
      displayName: entry.displayName,
      description: entry.description,
      author: entry.author?.name ?? null,
      official: entry.official,
      installed: entry.installed,
      compatible: entry.compatible,
      incompatibleReason: entry.incompatibleReason,
      installs: entry.installs ?? null,
      category: entry.category ?? null,
      repositoryUrl: entry.repositoryUrl ?? null,
      source: entry.source,
      iconUrl: entry.iconUrl,
      screenshots: entry.screenshots ?? [],
      overview: entry.overview ?? null,
    };
  }

  let entriesCache: { at: number; entries: PeekEntrySummary[] } | null = null;
  async function listEntries(): Promise<PeekEntrySummary[]> {
    if (entriesCache !== null && Date.now() - entriesCache.at < ENTRY_CACHE_TTL_MS) {
      return entriesCache.entries;
    }
    const response = await alia.sdk.plugins.catalog.search({ query: "" });
    const entries = response.results.map(summarize);
    entriesCache = { at: Date.now(), entries };
    return entries;
  }

  async function findEntry(entryId: string, marketplace: string): Promise<PeekEntrySummary> {
    const entries = await listEntries();
    const match = entries.find(
      (entry) => entry.entryId === entryId && entry.marketplace === marketplace,
    );
    if (match === undefined) {
      throw new Error(`No store entry ${entryId} in ${marketplace}.`);
    }
    return match;
  }

  /**
   * The directory a path-installed plugin lives in, when there is one. Lets a
   * developer preview the plugin they are editing instead of a published
   * release. Returns null for managed git and npm installs.
   */
  async function localInstallDirectory(pluginId: string): Promise<string | null> {
    try {
      const detail = await alia.sdk.plugins.getSource({ pluginId });
      const match = /^path:(.+)$/.exec(detail.resolved);
      if (match === null) return null;
      const root = path.resolve(match[1]!.trim());
      return (await stat(root)).isDirectory() ? root : null;
    } catch {
      return null;
    }
  }

  /**
   * Pick where to read the plugin's files from. An installed plugin is already
   * on disk, so that wins; otherwise follow the install plan's resolved source.
   */
  async function openSource(
    entry: PeekEntrySummary,
  ): Promise<{ source: PackageSource | null; info: PeekSourceInfo }> {
    const base: PeekSourceInfo = { via: "none", ok: false, note: null, filesRead: 0, resolved: null };
    // A plugin installed from a local directory is already the real thing on
    // disk, so read it directly. VesnALIA's own <dataDir>/plugins/<id> holds only a
    // plugin's data, never its package, so there is nothing to read there.
    if (entry.installed) {
      const local = await localInstallDirectory(entry.pluginId);
      if (local !== null) {
        return {
          source: directorySource(local, "installed", "your local checkout"),
          info: {
            ...base,
            via: "installed",
            ok: true,
            resolved: "your local checkout",
            note: "Read from the directory this plugin is installed from, not from its published release.",
          },
        };
      }
    }
    let plan;
    try {
      plan = await alia.sdk.plugins.catalog.installPlan({
        entryId: entry.entryId,
        marketplace: entry.marketplace,
      });
    } catch (cause) {
      return {
        source: null,
        info: { ...base, note: `Could not resolve this entry's source: ${describe(cause)}` },
      };
    }
    if (plan.kind === "bundled") {
      const root = await findBundledPluginDir(plan.pluginId);
      if (root === null) {
        return {
          source: null,
          info: { ...base, via: "bundled", note: "This plugin ships inside the VesnALIA app, but its directory was not found on disk." },
        };
      }
      return {
        source: directorySource(root, "bundled", "bundled with VesnALIA"),
        info: { ...base, via: "bundled", ok: true, resolved: "bundled with VesnALIA", note: null },
      };
    }
    const resolved = plan.resolvedSource;
    try {
      if (resolved.kind === "npm") {
        const source = await npmSource(
          resolved.package,
          resolved.resolvedVersion ?? null,
          resolved.registry ?? null,
        );
        return { source, info: { ...base, via: "npm", ok: true, resolved: source.resolved } };
      }
      const github = parseGithubUrl(resolved.url);
      if (github === null) {
        return {
          source: null,
          info: {
            ...base,
            via: "git",
            note: `Peek can only read Git plugins hosted on GitHub. This one lives at ${resolved.url}.`,
          },
        };
      }
      const pinned = resolved.resolvedCommit ?? resolved.resolvedTag ?? resolved.ref ?? null;
      const ref = pinned ?? "HEAD";
      const token = typeof githubToken === "string" && githubToken !== "" ? githubToken : null;
      const subdirectory = resolved.subdir ?? null;
      // One archive request covers the whole repository and is not metered by
      // the REST API's hourly limit. Walking the tree API is the fallback.
      const source =
        (await githubTarballSource(github.owner, github.repo, ref, subdirectory, token)) ??
        (await githubRawSource(github.owner, github.repo, ref, subdirectory, token));
      // An unresolved entry is read from the default branch, so the report can
      // describe code no install would actually get. Say so rather than
      // printing a release that does not exist.
      const label = pinned === null ? "default branch" : resolved.resolvedTag ?? pinned.slice(0, 12);
      const note =
        pinned === null
          ? `alia could not pin this entry to a release${resolved.unresolvedReason === undefined ? "" : ` (${resolved.unresolvedReason})`}, so this describes the repository's default branch.`
          : null;
      return { source, info: { ...base, via: "github", ok: true, resolved: label, note } };
    } catch (cause) {
      const via = resolved.kind === "npm" ? "npm" : "github";
      return { source: null, info: { ...base, via, note: describe(cause) } };
    }
  }

  async function buildReport(
    entryId: string,
    marketplace: string,
    refresh: boolean,
  ): Promise<PeekReport> {
    const entry = await findEntry(entryId, marketplace);
    const { source, info } = await openSource(entry);
    const cacheKey = `${CACHE_PREFIX}${marketplace}/${entryId}/${info.resolved ?? "unresolved"}`;
    if (!refresh && cacheTtlMs > 0) {
      const cached = await alia.storage.kv.get<PeekReport>(cacheKey);
      if (cached !== undefined && Date.now() - Date.parse(cached.generatedAt) < cacheTtlMs) {
        // Entry metadata (installed, installs) goes stale faster than the
        // analysis does, so refresh that part from the live catalog.
        return { ...cached, entry };
      }
    }
    if (source === null) {
      return {
        entry,
        source: info,
        manifest: null,
        surfaces: [],
        settings: [],
        capabilities: [],
        commands: [],
        skills: [],
        themes: [],
        warnings: [info.note ?? "The plugin's files could not be read."],
        generatedAt: new Date().toISOString(),
      };
    }
    let analysis;
    try {
      analysis = await analyze(source);
    } catch (cause) {
      // A report that is partly unknown beats no report at all.
      analysis = {
        manifest: null,
        surfaces: [],
        settings: [],
        capabilities: [],
        commands: [],
        skills: [],
        themes: [],
        warnings: [`Reading this plugin failed partway through: ${describe(cause)}`],
        filesRead: source.readCount(),
      };
    }
    analysis.warnings.push(...source.problems());
    if (info.note !== null) analysis.warnings.unshift(info.note);
    const report: PeekReport = {
      entry,
      source: { ...info, filesRead: analysis.filesRead },
      manifest: analysis.manifest,
      surfaces: analysis.surfaces,
      settings: analysis.settings,
      capabilities: analysis.capabilities,
      commands: analysis.commands,
      skills: analysis.skills,
      themes: analysis.themes,
      warnings: analysis.warnings,
      generatedAt: new Date().toISOString(),
    };
    if (cacheTtlMs > 0) await alia.storage.kv.set(cacheKey, report);
    return report;
  }

  alia.rpc.register(rpcContract, {
    peek_entries: async () => ({ entries: (await listEntries()).map(toRef) }),
    peek_report: async ({ entryId, marketplace, refresh }) => ({
      report: await buildReport(entryId, marketplace, refresh === true),
    }),
  });

  const usage = [
    "Usage:",
    "  VesnALIA peek list [--json]                       List store entries you can preview",
    "  VesnALIA peek show <entry> [--marketplace <name>] [--json] [--refresh]",
    "                                              Report what <entry> would change",
  ].join("\n");

  alia.cli.register({
    name: "peek",
    summary: "Preview what a VesnALIA plugin would change before installing it",
    commands: [
      { name: "list", summary: "List previewable store entries", usage: "alia peek list [--json]" },
      {
        name: "show",
        summary: "Report a plugin's UI, settings and capability impact",
        usage: "alia peek show <entry> [--marketplace <name>] [--json] [--refresh]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const refresh = argv.includes("--refresh");
      const rest = argv.filter((argument) => argument !== "--json" && argument !== "--refresh");
      const marketplaceIndex = rest.indexOf("--marketplace");
      const marketplaceArgument = marketplaceIndex === -1 ? null : rest[marketplaceIndex + 1] ?? null;
      const positional =
        marketplaceIndex === -1
          ? rest
          : rest.filter(
              (_argument, index) => index !== marketplaceIndex && index !== marketplaceIndex + 1,
            );
      const [command, target] = positional;
      try {
        if (command === undefined || command === "help" || command === "--help") {
          return { exitCode: 0, stdout: usage };
        }
        if (command === "list") {
          const entries = await listEntries();
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify(entries)
              : entries
                  .map((entry) => `${entry.entryId.padEnd(28)} ${entry.marketplace.padEnd(16)} ${entry.displayName}`)
                  .join("\n"),
          };
        }
        if (command === "show" && target !== undefined) {
          const entries = await listEntries();
          const inMarketplace = (entry: PeekEntrySummary) =>
            marketplaceArgument === null || entry.marketplace === marketplaceArgument;
          // Entry ids win; a display name is accepted so the argument can be
          // copied straight off a store card.
          const byId = entries.filter((entry) => entry.entryId === target && inMarketplace(entry));
          const candidates =
            byId.length > 0
              ? byId
              : entries.filter(
                  (entry) =>
                    entry.displayName.toLowerCase() === target.toLowerCase() && inMarketplace(entry),
                );
          if (candidates.length === 0) {
            return {
              exitCode: 1,
              stderr: `No store entry or plugin named "${target}". Run "alia peek list".`,
            };
          }
          if (candidates.length > 1) {
            return {
              exitCode: 1,
              stderr: `"${target}" exists in ${candidates
                .map((entry) => entry.marketplace)
                .join(", ")}. Pass --marketplace.`,
            };
          }
          const entry = candidates[0]!;
          const report = await buildReport(entry.entryId, entry.marketplace, refresh);
          return { exitCode: 0, stdout: json ? JSON.stringify(report) : formatReport(report) };
        }
      } catch (cause) {
        return { exitCode: 1, stderr: describe(cause) };
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  alia.log.info("ready");
}

/** The catalog row reduced to what a store card can be matched against. */
function toRef(entry: PeekEntrySummary): PeekEntryRef {
  return {
    entryId: entry.entryId,
    marketplace: entry.marketplace,
    pluginId: entry.pluginId,
    displayName: entry.displayName,
    author: entry.author,
  };
}

function describe(cause: unknown): string {
  if (cause instanceof PeekSourceError) return cause.message;
  return cause instanceof Error && cause.message !== "" ? cause.message : String(cause);
}

/** Plain-text rendering for `alia peek show`, mirroring the overlay's sections. */
function formatReport(report: PeekReport): string {
  const lines: string[] = [];
  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    lines.push("", title, ...rows.map((row) => `  ${row}`));
  };
  lines.push(`${report.entry.displayName} — ${report.entry.description}`);
  lines.push(
    `${report.entry.marketplaceDisplayName}${report.entry.author === null ? "" : ` · ${report.entry.author}`}` +
      `${report.source.resolved === null ? "" : ` · ${report.source.resolved}`}`,
  );
  section(
    "Changes to the VesnALIA interface",
    report.surfaces.map(
      (surface) =>
        `${surface.where.padEnd(16)} ${surface.label}${surface.detail === null ? "" : ` — "${surface.detail}"`}` +
        `${surface.risk === "high" ? "  [full access]" : ""}`,
    ),
  );
  section(
    "Settings it adds",
    report.settings.map(
      (setting) =>
        `${(setting.label ?? setting.key ?? "?").padEnd(32)} ${setting.type ?? "?"}${setting.secret ? "  [secret]" : ""}`,
    ),
  );
  section(
    "Capabilities",
    report.capabilities.map(
      (capability) =>
        `${capability.label}${capability.detail === null ? "" : ` — ${capability.detail}`}` +
        `${capability.risk === "high" ? "  [high]" : ""}`,
    ),
  );
  section(
    "CLI commands",
    report.commands.map(
      (command) =>
        `alia ${command.name}${command.subcommands.length === 0 ? "" : ` (${command.subcommands.join(", ")})`}`,
    ),
  );
  section("Agent skills", report.skills.map((skill) => skill.name));
  section("Themes", report.themes.map((theme) => theme.name));
  section("Notes", report.warnings);
  return lines.join("\n");
}
