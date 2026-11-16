// Shared shapes between the Peek backend and its frontend.
//
// Every fact Peek reports carries a confidence: "declared" comes from the
// plugin's own package.json manifest, "detected" comes from reading its entry
// sources or built bundles. The UI must keep the two visually distinct so a
// heuristic never reads as a guarantee.

export type PeekConfidence = "declared" | "detected";

export type PeekRisk = "high" | "normal";

/** One place in the VesnALIA UI a plugin would appear. */
export interface PeekSurface {
  /** SDK slot name, e.g. "navPanel". */
  kind: string;
  /** Where in the app it lands, e.g. "Sidebar". */
  where: string;
  /** What it does there. */
  label: string;
  /** The plugin's own title/id for it, when we could read one. */
  detail: string | null;
  risk: PeekRisk;
  confidence: PeekConfidence;
}

/** One setting the plugin would add to its Settings page. */
export interface PeekSetting {
  key: string | null;
  label: string | null;
  type: string | null;
  secret: boolean;
  confidence: PeekConfidence;
}

/** One non-UI capability: CLI, network, daemon, storage, background work. */
export interface PeekCapability {
  id: string;
  label: string;
  detail: string | null;
  risk: PeekRisk;
  confidence: PeekConfidence;
}

export interface PeekCommand {
  name: string;
  summary: string | null;
  subcommands: string[];
  confidence: PeekConfidence;
}

export interface PeekSkill {
  name: string;
  description: string | null;
}

export interface PeekTheme {
  id: string | null;
  name: string;
  /** CSS colors pulled from the theme file, for a real swatch row. */
  swatches: string[];
}

export type PeekSourceVia = "bundled" | "npm" | "github" | "git" | "installed" | "none";

/** How Peek got the plugin's files — or why it could not. */
export interface PeekSourceInfo {
  via: PeekSourceVia;
  ok: boolean;
  /** Human sentence shown when ok is false, or as a footnote when it is true. */
  note: string | null;
  filesRead: number;
  /** Exact release the report describes: tag, commit, or npm version. */
  resolved: string | null;
}

export interface PeekEntrySummary {
  entryId: string;
  marketplace: string;
  marketplaceDisplayName: string;
  pluginId: string;
  displayName: string;
  description: string;
  author: string | null;
  official: boolean;
  installed: boolean;
  compatible: boolean;
  incompatibleReason: string | null;
  installs: number | null;
  category: string | null;
  repositoryUrl: string | null;
  source: string;
  iconUrl: string | null;
  screenshots: string[];
  overview: string | null;
}

/** The minimum the store decorator needs to match a card to an entry. */
export interface PeekEntryRef {
  entryId: string;
  marketplace: string;
  pluginId: string;
  displayName: string;
  author: string | null;
}

export interface PeekReport {
  entry: PeekEntrySummary;
  source: PeekSourceInfo;
  manifest: {
    packageName: string;
    version: string | null;
    enginesAlia: string | null;
    dependencies: string[];
  } | null;
  surfaces: PeekSurface[];
  settings: PeekSetting[];
  capabilities: PeekCapability[];
  commands: PeekCommand[];
  skills: PeekSkill[];
  themes: PeekTheme[];
  /** Notes about incomplete analysis. Always shown; never silently dropped. */
  warnings: string[];
  generatedAt: string;
}
