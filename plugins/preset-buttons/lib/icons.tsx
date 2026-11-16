// The OSS icon catalogue for preset buttons.
//
// Rendering strategy. The plugin draws every icon through the host's name
// registry (`experimental_Icon` with a `name` string), so a preset, a built-in
// set, and the settings editor all talk in icon *names* — never in JSX. That
// single vocabulary is what lets a stored `icon` value survive a settings
// write and render in the button row unchanged.
//
// NAMESPACING (important). A plugin can register its own glyphs into that
// registry with `app.experimental_icons.register()`, and the host resolves a
// name in this order: a plugin-registered name first, THEN a built-in BB icon
// of the same name. So a registered name SHADOWS any built-in it collides
// with — and the host's built-ins power surfaces outside this plugin (notably
// the top-left sidebar). Registering a bare `"Zap"`, `"Star"`, `"Settings"`,
// etc. would silently replace the host's own icons everywhere, not just on the
// preset buttons. That is exactly why every name here carries the namespace
// prefix: `pb-Zap`, `pb-Star`, ... A namespaced name can only ever resolve to
// a glyph a plugin asked to be drawn, never a built-in.
//
// So we register a curated set of HugeIcons (MIT, stroke icons,
// `currentColor`-tinted, tree-shakeable — already a dependency of this
// plugin) under namespaced names, and the preset `icon` field stores those
// same namespaced names. That single move:
//
//   * makes the shipped default icons resolve reliably — `pb-Zap`,
//     `pb-Layers`, `pb-Brain`, `pb-AiBrain01`, `pb-Code`, `pb-Target`,
//     `pb-Cloud`, `pb-Beaker` — without ever touching a built-in name the
//     host's own UI depends on;
//   * hands the picker a concrete, expressive, on-brand pool to browse, all of
//     which will actually render.
//
// Everything here is plain data plus tiny components; there is no server
// concern and no host dependency, so the module is safe to import from both
// `app.tsx` (registration) and `PresetSettings.tsx` (picker).

import type { ComponentType } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgObject } from "@hugeicons/core-free-icons/types";

import Zap from "@hugeicons/core-free-icons/ZapIcon";
import Layers01 from "@hugeicons/core-free-icons/Layers01Icon";
import Brain from "@hugeicons/core-free-icons/BrainIcon";
import AiBrain01 from "@hugeicons/core-free-icons/AiBrain01Icon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import Target01 from "@hugeicons/core-free-icons/Target01Icon";
import Cloud from "@hugeicons/core-free-icons/CloudIcon";
import Beaker from "@hugeicons/core-free-icons/BeakerIcon";
import Bolt from "@hugeicons/core-free-icons/BoltIcon";
import Rocket from "@hugeicons/core-free-icons/RocketIcon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import Star from "@hugeicons/core-free-icons/StarIcon";
import Fire from "@hugeicons/core-free-icons/FireIcon";
import Cube from "@hugeicons/core-free-icons/CubeIcon";
import Database from "@hugeicons/core-free-icons/DatabaseIcon";
import Server from "@hugeicons/core-free-icons/ServerIcon";
import Globe from "@hugeicons/core-free-icons/GlobeIcon";
import Cpu from "@hugeicons/core-free-icons/CpuIcon";
import Terminal from "@hugeicons/core-free-icons/TerminalIcon";
import Brackets from "@hugeicons/core-free-icons/BracketsIcon";
import FileCode from "@hugeicons/core-free-icons/FileCodeIcon";
import Binary from "@hugeicons/core-free-icons/BinaryIcon";
import Function from "@hugeicons/core-free-icons/FunctionIcon";
import PieChart02 from "@hugeicons/core-free-icons/PieChart02Icon";
import Gauge from "@hugeicons/core-free-icons/GaugeIcon";
import Hdd from "@hugeicons/core-free-icons/HddIcon";
import Chip from "@hugeicons/core-free-icons/ChipIcon";
import ShieldCheck from "@hugeicons/core-free-icons/ShieldCheckIcon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Key01 from "@hugeicons/core-free-icons/Key01Icon";
import User from "@hugeicons/core-free-icons/UserIcon";
import Users from "@hugeicons/core-free-icons/UsersIcon";
import Clock01 from "@hugeicons/core-free-icons/Clock01Icon";
import Timer02 from "@hugeicons/core-free-icons/Timer02Icon";
import Activity02 from "@hugeicons/core-free-icons/Activity02Icon";
import Pulse02 from "@hugeicons/core-free-icons/Pulse02Icon";
import Network from "@hugeicons/core-free-icons/NetworkIcon";
import Link01 from "@hugeicons/core-free-icons/Link01Icon";
import Unlink01 from "@hugeicons/core-free-icons/Unlink01Icon";
import FolderZip from "@hugeicons/core-free-icons/FolderZipIcon";
import File01 from "@hugeicons/core-free-icons/File01Icon";
import DocumentCode from "@hugeicons/core-free-icons/DocumentCodeIcon";
import Crown from "@hugeicons/core-free-icons/CrownIcon";
import Award01 from "@hugeicons/core-free-icons/Award01Icon";
import ChessKing from "@hugeicons/core-free-icons/ChessKingIcon";
import Diamond02 from "@hugeicons/core-free-icons/Diamond02Icon";
import Gem from "@hugeicons/core-free-icons/GemIcon";
import Hexagon01 from "@hugeicons/core-free-icons/Hexagon01Icon";
import Triangle from "@hugeicons/core-free-icons/TriangleIcon";
import Square from "@hugeicons/core-free-icons/SquareIcon";
import CircleIcon from "@hugeicons/core-free-icons/CircleIcon";
import Infinity01 from "@hugeicons/core-free-icons/Infinity01Icon";
import Orbit01 from "@hugeicons/core-free-icons/Orbit01Icon";
import Atom02 from "@hugeicons/core-free-icons/Atom02Icon";
import Math from "@hugeicons/core-free-icons/MathIcon";
import Sigma from "@hugeicons/core-free-icons/SigmaIcon";
import Pi from "@hugeicons/core-free-icons/PiIcon";
import Variable from "@hugeicons/core-free-icons/VariableIcon";
import Settings01 from "@hugeicons/core-free-icons/Settings01Icon";
import SlidersHorizontal from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import ToggleOn from "@hugeicons/core-free-icons/ToggleOnIcon";
import Wrench01 from "@hugeicons/core-free-icons/Wrench01Icon";
import Alert02 from "@hugeicons/core-free-icons/Alert02Icon";
import TriangleAlert from "@hugeicons/core-free-icons/TriangleAlertIcon";

/**
 * The prefix placed before every registered name so a glyph can never shadow a
 * host built-in. The host's registry is global across the app, so a short,
 * unambiguous prefix is the safeguard; keep it stable because it is baked into
 * every stored preset `icon` value.
 */
export const ICON_NAMESPACE = "pb";

/** Turn a friendly base name (e.g. "Zap") into its namespaced registry name. */
export function iconName(base: string): string {
  return `${ICON_NAMESPACE}-${base}`;
}

/**
 * A single registrable icon. `name` is the namespaced registry key (what the
 * picker selects and the preset `icon` field stores); `baseName` is the
 * friendly name a user reads. `component` swallows a `className` (HugeIcons
 * uses `currentColor`, so the host's size / tint classes apply directly).
 */
export interface IconEntry {
  /** Namespaced registry name, e.g. `pb-Zap`. */
  name: string;
  /** Friendly base name shown to the user, e.g. `Zap`. */
  baseName: string;
  label: string;
  group: string;
  component: ComponentType<{ className?: string }>;
}

/** Render one HugeIcons path set, honouring `className` for size and tint. */
function makeIcon(data: IconSvgObject, baseName: string): IconEntry["component"] {
  const Component = ({ className }: { className?: string }) => (
    <HugeiconsIcon icon={data} className={className} aria-hidden />
  );
  Component.displayName = `PbIcon_${baseName}`;
  return Component;
}

/** Build a namespaced entry from a friendly base name. */
function icon(baseName: string, label: string, group: string, data: IconSvgObject): IconEntry {
  return {
    name: iconName(baseName),
    baseName,
    label,
    group,
    component: makeIcon(data, baseName),
  };
}

/**
 * The full curated pool, browsable in the picker and used for aliasing. Names
 * are grouped so the picker can present a sensible grid with headers. The
 * registry key for each is namespaced (see `iconName` above).
 */
export const ICON_GROUPS: readonly { group: string; icons: IconEntry[] }[] = [
  {
    group: "Speed",
    icons: [
      icon("Zap", "Zap", "Speed", Zap),
      icon("Bolt", "Bolt", "Speed", Bolt),
      icon("Rocket", "Rocket", "Speed", Rocket),
      icon("Gauge", "Gauge", "Speed", Gauge),
    ],
  },
  {
    group: "Intelligence",
    icons: [
      icon("AiBrain01", "Brain", "Intelligence", AiBrain01),
      icon("Brain", "Brain", "Intelligence", Brain),
      icon("Sparkles", "Sparkles", "Intelligence", Sparkles),
      icon("Beaker", "Beaker", "Intelligence", Beaker),
    ],
  },
  {
    group: "Code",
    icons: [
      icon("Code", "Code", "Code", Code),
      icon("Brackets", "Brackets", "Code", Brackets),
      icon("Terminal", "Terminal", "Code", Terminal),
      icon("FileCode", "File Code", "Code", FileCode),
      icon("Binary", "Binary", "Code", Binary),
      icon("Function", "Function", "Code", Function),
      icon("PieChart", "Pie Chart", "Code", PieChart02),
      icon("Math", "Math", "Code", Math),
      icon("Sigma", "Sigma", "Code", Sigma),
      icon("Pi", "Pi", "Code", Pi),
      icon("Variable", "Variable", "Code", Variable),
    ],
  },
  {
    group: "Infrastructure",
    icons: [
      icon("Layers", "Layers", "Infrastructure", Layers01),
      icon("Cube", "Cube", "Infrastructure", Cube),
      icon("Database", "Database", "Infrastructure", Database),
      icon("Server", "Server", "Infrastructure", Server),
      icon("Globe", "Globe", "Infrastructure", Globe),
      icon("Network", "Network", "Infrastructure", Network),
      icon("Cpu", "CPU", "Infrastructure", Cpu),
      icon("Chip", "Chip", "Infrastructure", Chip),
      icon("Hdd", "Hard Drive", "Infrastructure", Hdd),
      icon("Cloud", "Cloud", "Infrastructure", Cloud),
    ],
  },
  {
    group: "Security",
    icons: [
      icon("Target", "Target", "Security", Target01),
      icon("Shield", "Shield", "Security", ShieldCheck),
      icon("Lock", "Lock", "Security", Lock),
      icon("Key", "Key", "Security", Key01),
    ],
  },
  {
    group: "People",
    icons: [
      icon("User", "User", "People", User),
      icon("Users", "Users", "People", Users),
      icon("Crown", "Crown", "People", Crown),
      icon("Award", "Award", "People", Award01),
      icon("Chess", "Chess King", "People", ChessKing),
    ],
  },
  {
    group: "State",
    icons: [
      icon("Star", "Star", "State", Star),
      icon("Fire", "Fire", "State", Fire),
      icon("Diamond", "Diamond", "State", Diamond02),
      icon("Gem", "Gem", "State", Gem),
      icon("Hexagon", "Hexagon", "State", Hexagon01),
      icon("Triangle", "Triangle", "State", Triangle),
      icon("Square", "Square", "State", Square),
      icon("Circle", "Circle", "State", CircleIcon),
      icon("Infinity", "Infinity", "State", Infinity01),
      icon("Orbit", "Orbit", "State", Orbit01),
      icon("Atom", "Atom", "State", Atom02),
    ],
  },
  {
    group: "Activity",
    icons: [
      icon("Clock", "Clock", "Activity", Clock01),
      icon("Timer", "Timer", "Activity", Timer02),
      icon("Activity", "Activity", "Activity", Activity02),
      icon("Pulse", "Pulse", "Activity", Pulse02),
    ],
  },
  {
    group: "Files",
    icons: [
      icon("File", "File", "Files", File01),
      icon("Folder", "Folder", "Files", FolderZip),
      icon("Doc", "Document Code", "Files", DocumentCode),
    ],
  },
  {
    group: "Controls",
    icons: [
      icon("Settings", "Settings", "Controls", Settings01),
      icon("Sliders", "Sliders", "Controls", SlidersHorizontal),
      icon("Toggle", "Toggle", "Controls", ToggleOn),
      icon("Wrench", "Wrench", "Controls", Wrench01),
      icon("Link", "Link", "Controls", Link01),
      icon("Unlink", "Unlink", "Controls", Unlink01),
    ],
  },
  {
    group: "Status",
    icons: [
      icon("Alert", "Alert", "Status", Alert02),
      icon("AlertTriangle", "Warning", "Status", TriangleAlert),
    ],
  },
];

/** A flat, deduplicated view of every icon, in display order. */
export const ALL_ICONS: readonly IconEntry[] = ICON_GROUPS.flatMap((group) =>
  group.icons,
);

/** Find an icon entry by its namespaced registered name (the preset's `icon`). */
export function findIcon(name: string | undefined): IconEntry | undefined {
  if (name === undefined) return undefined;
  return ALL_ICONS.find((entry) => entry.name === name);
}

/**
 * Search the pool by friendly name or human label. Lowercased substring match,
 * so typing "cpu" or "bra" surfaces the icons a user probably means.
 */
export function searchIcons(query: string): readonly IconEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return ALL_ICONS;
  return ALL_ICONS.filter((entry) => {
    const hay = `${entry.baseName} ${entry.label}`.toLowerCase();
    return hay.includes(needle);
  });
}
