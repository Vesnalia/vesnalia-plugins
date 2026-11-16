// Turning a plugin's files into an impact report.
//
// Two tiers, never blurred:
//   declared - read straight out of package.json's `VesnALIA` block. Authoritative.
//   detected - found by scanning the plugin's entry sources or built bundles
//              for SDK call sites. Good signal, but a plugin can register a
//              surface in a way this scan misses, so the UI labels it.
//
// Nothing here imports or runs plugin code: every input is text.

import type { PackageSource } from "./sources.js";
import { boolProp, findAll, relativeImports, sliceCallArgs, stringProp, stringPropList, topLevelEntries } from "./extract.js";
import type { PeekCapability, PeekCommand, PeekSetting, PeekSkill, PeekSurface, PeekTheme } from "./types.js";

interface AliaManifest {
  name?: unknown;
  description?: unknown;
  server?: unknown;
  app?: unknown;
  host?: unknown;
  skills?: unknown;
  themes?: unknown;
  branding?: unknown;
}

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  engines?: { alia?: unknown };
  dependencies?: Record<string, unknown>;
  alia?: AliaManifest;
}

export interface Analysis {
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
  warnings: string[];
  filesRead: number;
}

/** Every frontend slot, and what installing it would actually do to the UI. */
const SLOTS: Record<string, { where: string; label: string; risk?: "high" }> = {
  navPanel: { where: "Sidebar", label: "Adds its own page to the sidebar" },
  homepageSection: { where: "Home", label: "Adds a section to the home screen" },
  settingsSection: { where: "Settings", label: "Adds controls to its settings page" },
  experimental_appOverlay: { where: "Everywhere", label: "Mounts floating UI over the whole app" },
  threadPanelAction: { where: "Thread panel", label: "Adds a tab to the thread side panel" },
  experimental_newThreadPanelAction: { where: "New thread", label: "Adds a tab to the new-thread panel" },
  pendingInteraction: { where: "Thread", label: "Renders its own agent prompts inline" },
  sidebarFooterAction: { where: "Sidebar footer", label: "Adds a button to the sidebar footer" },
  experimental_sidebarNavigation: { where: "Sidebar", label: "Adds entries to sidebar navigation" },
  experimental_threadList: { where: "Sidebar", label: "Changes how the thread list renders" },
  experimental_threadHeaderAction: { where: "Thread header", label: "Adds a button to the thread header" },
  experimental_browserToolbarAction: { where: "Browser", label: "Adds a button to the browser toolbar" },
  fileOpener: { where: "Files", label: "Offers to open files instead of the built-in preview" },
  experimental_sourceCodeRenderer: { where: "File viewer", label: "Renders some files its own way" },
  experimental_diffRenderer: { where: "Diff viewer", label: "Renders some diffs its own way" },
  messageDirective: { where: "Chat", label: "Renders custom blocks inside messages" },
  messageAction: { where: "Chat", label: "Adds an action to messages" },
  commandPaletteAction: { where: "Command palette", label: "Adds a command-palette entry" },
  experimental_providerIcon: { where: "Providers", label: "Replaces provider artwork" },
  experimental_timelineRenderer: { where: "Timeline", label: "Renders its own timeline rows" },
  experimental_environmentProviderInputs: { where: "New thread", label: "Adds fields to the environment picker" },
  experimental_machineProviderInputs: { where: "Machines", label: "Adds fields to machine creation" },
};

const SLOT_DETAIL_KEYS = ["title", "label", "id", "path", "name"];

/** Backend call sites, and the plain-language capability each one implies. */
const CAPABILITY_MARKERS: {
  marker: string;
  id: string;
  label: string;
  detail?: string;
  risk?: "high";
}[] = [
  { marker: ".background.service(", id: "service", label: "Runs a background service while VesnALIA is open" },
  { marker: ".background.schedule(", id: "schedule", label: "Runs work on a schedule" },
  { marker: ".agents.registerTool(", id: "tool", label: "Adds a tool your agents can call" },
  { marker: ".agents.contributeInstructions(", id: "instructions", label: "Adds instructions to every agent turn" },
  { marker: ".agents.configure(", id: "agent-config", label: "Changes agent configuration" },
  { marker: ".http.route(", id: "http", label: "Serves HTTP endpoints from the VesnALIA server" },
  { marker: ".providers.register(", id: "provider", label: "Registers an agent provider", risk: "high" },
  { marker: ".experimental_environments.", id: "environments", label: "Provisions environments threads run in", risk: "high" },
  { marker: ".experimental_machines.", id: "machines", label: "Provisions machines threads run on", risk: "high" },
  { marker: ".storage.database(", id: "database", label: "Keeps its own SQLite database" },
  { marker: ".ui.requestInput(", id: "input", label: "Can interrupt you with its own prompts" },
  { marker: ".ui.registerMentionProvider(", id: "mentions", label: "Adds sources to @-mentions" },
  { marker: ".realtime.publish(", id: "realtime", label: "Pushes live updates to open windows" },
  { marker: "child_process", id: "exec", label: "Runs commands on your machine", risk: "high" },
  { marker: "node:fs", id: "fs", label: "Reads and writes files on your machine", risk: "high" },
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Candidate paths for an import or manifest entry whose extension may be implicit. */
function entryCandidates(specifier: string): string[] {
  const base = specifier.replace(/^\.\//, "");
  const withoutExtension = base.replace(/\.(js|ts|jsx|tsx|mjs)$/, "");
  return [
    base,
    `${withoutExtension}.ts`,
    `${withoutExtension}.tsx`,
    `${withoutExtension}.js`,
    `${withoutExtension}.jsx`,
    `${withoutExtension}/index.ts`,
    `${withoutExtension}/index.tsx`,
    `${withoutExtension}/index.js`,
  ];
}

/** Long lines and no indentation: build output, not authored source. */
function isMinified(text: string): boolean {
  const sample = text.slice(0, 40_000);
  const lines = sample.split("\n");
  return sample.length / Math.max(1, lines.length) > 400;
}

async function readFirst(source: PackageSource, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const text = await source.read(candidate);
    if (text !== null) return text;
  }
  return null;
}

/**
 * Read a declared entry plus one level of its relative imports, so a plugin
 * that splits registrations across files still reports them. Falls back to the
 * published bundle when the sources are not in the package.
 */
async function readEntry(
  source: PackageSource,
  entry: string | null,
  bundle: string,
): Promise<{ text: string; fromBundle: boolean } | null> {
  if (entry !== null) {
    const head = await readFirst(source, entryCandidates(entry));
    if (head !== null) {
      // A published plugin points its manifest straight at dist/, so reading
      // the "source" can still mean reading minified build output.
      const built = /(^|\/)dist\//.test(entry) || isMinified(head);
      if (built) return { text: head, fromBundle: true };
      const parts = [head];
      const directory = entry.replace(/^\.\//, "").split("/").slice(0, -1).join("/");
      for (const specifier of relativeImports(head, 10)) {
        const joined = directory === ""
          ? specifier.replace(/^\.\//, "")
          : `${directory}/${specifier.replace(/^\.\//, "")}`;
        // Normalize any "../" segments the join introduced.
        const normalized = joined.split("/").reduce<string[]>((stack, segment) => {
          if (segment === "..") stack.pop();
          else if (segment !== "." && segment !== "") stack.push(segment);
          return stack;
        }, []).join("/");
        const imported = await readFirst(source, entryCandidates(normalized));
        if (imported !== null) parts.push(imported);
      }
      return { text: parts.join("\n"), fromBundle: false };
    }
  }
  const built = await source.read(bundle);
  return built === null ? null : { text: built, fromBundle: true };
}

function detailFor(fragment: string | null): string | null {
  if (fragment === null) return null;
  for (const key of SLOT_DETAIL_KEYS) {
    const value = stringProp(fragment, key);
    if (value !== null) return value;
  }
  return null;
}

function scanSurfaces(appText: string): PeekSurface[] {
  const surfaces: PeekSurface[] = [];
  const push = (kind: string, where: string, label: string, detail: string | null, risk: "high" | "normal") => {
    // One entry per distinct (kind, detail); a plugin may register several.
    if (surfaces.some((existing) => existing.kind === kind && existing.detail === detail)) return;
    surfaces.push({ kind, where, label, detail, risk, confidence: "detected" });
  };
  for (const [slot, meta] of Object.entries(SLOTS)) {
    for (const index of findAll(appText, `.${slot}(`, 8)) {
      const args = sliceCallArgs(appText, index + slot.length + 1);
      push(slot, meta.where, meta.label, detailFor(args), meta.risk === "high" ? "high" : "normal");
    }
  }
  for (const index of findAll(appText, ".contentScripts.register(", 4)) {
    const args = sliceCallArgs(appText, index + ".contentScripts.register".length);
    push(
      "contentScript",
      "App shell",
      "Runs a script that can read and rewrite any part of the VesnALIA UI",
      detailFor(args),
      "high",
    );
  }
  if (appText.includes(".composer.customize(")) {
    push("composerCustomization", "Composer", "Changes the message composer", null, "normal");
  }
  for (const index of findAll(appText, ".experimental_icons.register(", 4)) {
    const args = sliceCallArgs(appText, index + ".experimental_icons.register".length);
    push("icon", "Everywhere", "Registers app-wide icon names", detailFor(args), "normal");
  }
  if (appText.includes(".commands.register(")) {
    push("keyboardCommand", "Keyboard", "Registers keyboard commands", null, "normal");
  }
  return surfaces;
}

function scanSettings(serverText: string): PeekSetting[] {
  const settings: PeekSetting[] = [];
  for (const index of findAll(serverText, ".settings.define(", 4)) {
    const args = sliceCallArgs(serverText, index + ".settings.define".length, 20_000);
    if (args === null) continue;
    for (const { key, body } of topLevelEntries(args)) {
      settings.push({
        key,
        label: stringProp(body, "label"),
        type: stringProp(body, "type"),
        secret: boolProp(body, "secret"),
        confidence: "detected",
      });
    }
  }
  return settings;
}

function scanCommands(serverText: string): PeekCommand[] {
  const commands: PeekCommand[] = [];
  for (const index of findAll(serverText, ".cli.register(", 4)) {
    const args = sliceCallArgs(serverText, index + ".cli.register".length, 20_000);
    if (args === null) continue;
    const name = stringProp(args, "name");
    if (name === null) continue;
    // The first `name:` is the command itself; the rest are its subcommands.
    const subcommands = stringPropList(args, "name", 24).filter((value) => value !== name);
    commands.push({ name, summary: stringProp(args, "summary"), subcommands, confidence: "detected" });
  }
  return commands;
}

function scanCapabilities(backendText: string): PeekCapability[] {
  const capabilities: PeekCapability[] = [];
  for (const marker of CAPABILITY_MARKERS) {
    if (!backendText.includes(marker.marker)) continue;
    let detail: string | null = null;
    if (marker.id === "tool") {
      const names = findAll(backendText, ".agents.registerTool(", 8)
        .map((index) => sliceCallArgs(backendText, index + ".agents.registerTool".length))
        .map((args) => (args === null ? null : stringProp(args, "name")))
        .filter((value): value is string => value !== null);
      if (names.length > 0) detail = names.join(", ");
    }
    capabilities.push({
      id: marker.id,
      label: marker.label,
      detail,
      risk: marker.risk === "high" ? "high" : "normal",
      confidence: "detected",
    });
  }
  return capabilities;
}

const SWATCH_VARIABLES = ["--background", "--foreground", "--primary", "--accent", "--muted", "--destructive"];

function swatchesFrom(css: string): string[] {
  const swatches: string[] = [];
  for (const variable of SWATCH_VARIABLES) {
    const match = new RegExp(`${variable}\\s*:\\s*([^;}]+)`).exec(css);
    const value = match?.[1]?.trim();
    if (value !== undefined && value !== "" && value.length < 64) swatches.push(value);
  }
  return swatches;
}

async function readSkills(
  source: PackageSource,
  directories: string[],
  paths: string[],
): Promise<PeekSkill[]> {
  const skills: PeekSkill[] = [];
  for (const directory of directories) {
    const prefix = `${directory.replace(/^\.\/|\/$/g, "")}/`;
    const candidates = paths.filter(
      (candidate) => candidate.startsWith(prefix) && candidate.endsWith("/SKILL.md"),
    );
    for (const candidate of candidates.slice(0, 12)) {
      const text = await source.read(candidate);
      const name = candidate.slice(prefix.length).replace(/\/SKILL\.md$/, "");
      const description = text === null ? null : /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
      skills.push({ name, description: description === null ? null : description.replace(/^["']|["']$/g, "") });
    }
  }
  return skills;
}

export async function analyze(source: PackageSource): Promise<Analysis> {
  const warnings: string[] = [];
  const manifestText = await source.read("package.json");
  if (manifestText === null) {
    return {
      manifest: null,
      surfaces: [],
      settings: [],
      capabilities: [],
      commands: [],
      skills: [],
      themes: [],
      warnings: ["Could not read the plugin's package.json, so nothing below was verified."],
      filesRead: source.readCount(),
    };
  }
  let parsed: PackageManifest;
  try {
    parsed = JSON.parse(manifestText) as PackageManifest;
  } catch {
    return {
      manifest: null,
      surfaces: [],
      settings: [],
      capabilities: [],
      commands: [],
      skills: [],
      themes: [],
      warnings: ["The plugin's package.json is not valid JSON."],
      filesRead: source.readCount(),
    };
  }
  const alia = parsed.alia ?? {};
  const manifest = {
    packageName: asString(parsed.name) ?? "unknown",
    version: asString(parsed.version),
    enginesAlia: asString(parsed.engines?.alia),
    dependencies: Object.keys(parsed.dependencies ?? {}).sort(),
  };

  const surfaces: PeekSurface[] = [];
  const capabilities: PeekCapability[] = [];

  // Declared facts first — these come from the manifest and are authoritative.
  if (asString(alia.host) !== null) {
    capabilities.push({
      id: "host",
      label: "Runs a full-trust daemon process on your machine",
      detail: "Node with full system access, outside the VesnALIA server",
      risk: "high",
      confidence: "declared",
    });
  }
  const hasApp = asString(alia.app) !== null;
  if (!hasApp) {
    surfaces.push({
      kind: "none",
      where: "Nothing visual",
      label: "Adds no frontend of its own",
      detail: null,
      risk: "normal",
      confidence: "declared",
    });
  }

  const paths = await source.list();
  const listingKnown = paths.length > 0;
  if (!listingKnown) {
    warnings.push("Could not list the package's files, so skills may be missing from this report.");
  }

  const appEntry = hasApp ? await readEntry(source, asString(alia.app), "dist/app.js") : null;
  if (hasApp) {
    if (appEntry === null) {
      warnings.push("This plugin ships a frontend, but neither its source nor its built bundle was readable — the UI list below is incomplete.");
    } else {
      surfaces.push(...scanSurfaces(appEntry.text));
      if (surfaces.every((surface) => surface.kind === "none")) {
        warnings.push("A frontend is declared but no known slot registration was found; it may use an API this scan does not know.");
      }
    }
  }

  const serverEntry = await readEntry(source, asString(alia.server), "dist/server.js");
  const hostEntry = asString(alia.host) === null ? null : await readEntry(source, asString(alia.host), "dist/host.js");
  const backendText = [serverEntry?.text ?? "", hostEntry?.text ?? ""].join("\n");
  if (serverEntry === null) {
    warnings.push("The plugin's backend entry was not readable — settings, commands and capabilities below are incomplete.");
  }
  capabilities.push(...scanCapabilities(backendText));
  const settings = scanSettings(backendText);
  const commands = scanCommands(backendText);

  const skillDirectories = Array.isArray(alia.skills) ? asStringArray(alia.skills) : ["skills"];
  const skills = listingKnown && skillDirectories.length > 0
    ? await readSkills(source, skillDirectories, paths)
    : [];

  const themes: PeekTheme[] = [];
  const declaredThemes = Array.isArray(alia.themes) ? alia.themes : [];
  for (const theme of declaredThemes.slice(0, 4)) {
    if (typeof theme !== "object" || theme === null) continue;
    const record = theme as { id?: unknown; name?: unknown; css?: unknown };
    const cssPath = asString(record.css);
    const css = cssPath === null ? null : await source.read(cssPath.replace(/^\.\//, ""));
    themes.push({
      id: asString(record.id),
      name: asString(record.name) ?? asString(record.id) ?? "Theme",
      swatches: css === null ? [] : swatchesFrom(css),
    });
  }

  if (appEntry?.fromBundle === true || serverEntry?.fromBundle === true) {
    warnings.push(
      "Part of this report was read from the plugin's built output rather than its sources, so some names may be missing.",
    );
  }

  return {
    manifest,
    surfaces,
    settings,
    capabilities,
    commands,
    skills,
    themes,
    warnings,
    filesRead: source.readCount(),
  };
}
