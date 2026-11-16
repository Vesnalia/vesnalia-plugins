// Wire schemas for Peek's RPC. These run at the boundary in both directions;
// the type assertions at the bottom keep them in lockstep with types.ts.

import { z } from "zod";
import type { PeekEntryRef, PeekEntrySummary, PeekReport } from "./types.js";

const confidence = z.enum(["declared", "detected"]);
const risk = z.enum(["high", "normal"]);

export const peekEntrySummarySchema = z.object({
  entryId: z.string(),
  marketplace: z.string(),
  marketplaceDisplayName: z.string(),
  pluginId: z.string(),
  displayName: z.string(),
  description: z.string(),
  author: z.string().nullable(),
  official: z.boolean(),
  installed: z.boolean(),
  compatible: z.boolean(),
  incompatibleReason: z.string().nullable(),
  installs: z.number().nullable(),
  category: z.string().nullable(),
  repositoryUrl: z.string().nullable(),
  source: z.string(),
  iconUrl: z.string().nullable(),
  screenshots: z.array(z.string()),
  overview: z.string().nullable(),
});

export const peekEntryRefSchema = z.object({
  entryId: z.string(),
  marketplace: z.string(),
  pluginId: z.string(),
  displayName: z.string(),
  author: z.string().nullable(),
});

export const peekReportSchema = z.object({
  entry: peekEntrySummarySchema,
  source: z.object({
    via: z.enum(["bundled", "npm", "github", "git", "installed", "none"]),
    ok: z.boolean(),
    note: z.string().nullable(),
    filesRead: z.number(),
    resolved: z.string().nullable(),
  }),
  manifest: z
    .object({
      packageName: z.string(),
      version: z.string().nullable(),
      enginesAlia: z.string().nullable(),
      dependencies: z.array(z.string()),
    })
    .nullable(),
  surfaces: z.array(
    z.object({
      kind: z.string(),
      where: z.string(),
      label: z.string(),
      detail: z.string().nullable(),
      risk,
      confidence,
    }),
  ),
  settings: z.array(
    z.object({
      key: z.string().nullable(),
      label: z.string().nullable(),
      type: z.string().nullable(),
      secret: z.boolean(),
      confidence,
    }),
  ),
  capabilities: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string().nullable(),
      risk,
      confidence,
    }),
  ),
  commands: z.array(
    z.object({
      name: z.string(),
      summary: z.string().nullable(),
      subcommands: z.array(z.string()),
      confidence,
    }),
  ),
  skills: z.array(z.object({ name: z.string(), description: z.string().nullable() })),
  themes: z.array(
    z.object({ id: z.string().nullable(), name: z.string(), swatches: z.array(z.string()) }),
  ),
  warnings: z.array(z.string()),
  generatedAt: z.string(),
});

// Both directions, so neither file can drift without a build error.
type SchemaReport = z.infer<typeof peekReportSchema>;
type SchemaEntry = z.infer<typeof peekEntrySummarySchema>;
const _reportMatches: (value: SchemaReport) => PeekReport = (value) => value;
const _reportMatchesBack: (value: PeekReport) => SchemaReport = (value) => value;
const _entryMatches: (value: SchemaEntry) => PeekEntrySummary = (value) => value;
const _refMatches: (value: z.infer<typeof peekEntryRefSchema>) => PeekEntryRef = (value) => value;
const _refMatchesBack: (value: PeekEntryRef) => z.infer<typeof peekEntryRefSchema> = (value) => value;
void _refMatches;
void _refMatchesBack;
void _reportMatches;
void _reportMatchesBack;
void _entryMatches;
